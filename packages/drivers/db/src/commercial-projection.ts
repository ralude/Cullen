import type {
  CommercialProjection,
  ProjectedCashMovement,
  ProjectedFiscalEntry,
  ProjectedSale,
  ProjectedSaleReturn,
  ProjectedShiftBalance,
  ProjectedShiftClosure,
  ProjectedShiftOpening
} from '@supermarket/core';
import type { DatabaseHandle } from './connection.js';
import { mapDatabaseError, requireTransaction } from './unit-of-work.js';

/**
 * Consolidación comercial del coordinador sobre SQLite.
 *
 * Escribe únicamente las tablas `sync_*`: las operativas del coordinador siguen
 * siendo suyas y mezclarlas duplicaría totales. Cada aplicación es un upsert por
 * la identidad del agregado condicionado a la versión del hecho, de modo que una
 * reentrega no duplica y un hecho atrasado no retrocede nada.
 */
export class SqliteCommercialProjection implements CommercialProjection {
  constructor(private readonly handle: DatabaseHandle) {}

  async applySale(sale: ProjectedSale): Promise<void> {
    requireTransaction(this.handle.sqlite);
    try {
      this.handle.sqlite.prepare(`
        insert into sync_sale_projection (
          sale_id, origin_node_id, terminal_id, shift_id, total_minor_units,
          paid_total_minor_units, currency_code, item_count, version, occurred_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(sale_id) do update set
          origin_node_id = excluded.origin_node_id,
          terminal_id = excluded.terminal_id,
          shift_id = excluded.shift_id,
          total_minor_units = excluded.total_minor_units,
          paid_total_minor_units = excluded.paid_total_minor_units,
          currency_code = excluded.currency_code,
          item_count = excluded.item_count,
          version = excluded.version,
          occurred_at = excluded.occurred_at
          where excluded.version > sync_sale_projection.version
      `).run(
        sale.saleId,
        sale.originNodeId,
        sale.terminalId,
        sale.shiftId,
        sale.total.minorUnits,
        sale.paidTotal.minorUnits,
        sale.total.currencyCode,
        sale.itemCount,
        sale.version,
        sale.occurredAt.getTime()
      );
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  /**
   * Marca la devolución sobre la venta proyectada. No borra la venta ni cambia
   * sus totales originales: el hecho ocurrido sigue siendo el que fue.
   */
  async applySaleReturn(entry: ProjectedSaleReturn): Promise<void> {
    requireTransaction(this.handle.sqlite);
    try {
      this.handle.sqlite.prepare(`
        update sync_sale_projection set
          returned_at = ?,
          return_refund_minor_units = ?,
          return_currency_code = ?
        where sale_id = ? and returned_at is null
      `).run(
        entry.occurredAt.getTime(),
        entry.refund.minorUnits,
        entry.refund.currencyCode,
        entry.saleId
      );
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async applyShiftOpening(shift: ProjectedShiftOpening): Promise<void> {
    requireTransaction(this.handle.sqlite);
    try {
      this.handle.sqlite.prepare(`
        insert into sync_shift_projection (
          shift_id, origin_node_id, terminal_id, cash_register_id, status,
          opened_by, closed_by, version, opened_at, closed_at
        ) values (?, ?, ?, ?, 'OPEN', ?, null, ?, ?, null)
        on conflict(shift_id) do update set
          origin_node_id = excluded.origin_node_id,
          terminal_id = excluded.terminal_id,
          cash_register_id = excluded.cash_register_id,
          opened_by = excluded.opened_by,
          version = excluded.version,
          opened_at = excluded.opened_at
          where excluded.version > sync_shift_projection.version
      `).run(
        shift.shiftId,
        shift.originNodeId,
        shift.terminalId,
        shift.cashRegisterId,
        shift.openedBy,
        shift.version,
        shift.openedAt.getTime()
      );
      this.saveBalances(shift.shiftId, 'OPENING', shift.balances);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async applyShiftClosure(
    closure: ProjectedShiftClosure
  ): Promise<'APPLIED' | 'STALE' | 'MISSING_SHIFT'> {
    requireTransaction(this.handle.sqlite);
    try {
      /**
       * Un cierre de un turno que este nodo nunca vio abrir no inventa el
       * turno: informa que falta y el consumidor lo deja esperando.
       */
      const known = this.handle.sqlite.prepare(
        'select 1 from sync_shift_projection where shift_id = ?'
      ).get(closure.shiftId) !== undefined;
      if (!known) return 'MISSING_SHIFT';
      const updated = this.handle.sqlite.prepare(`
        update sync_shift_projection set
          status = 'CLOSED', closed_by = ?, closed_at = ?, version = ?
        where shift_id = ? and ? > version
      `).run(
        closure.closedBy,
        closure.closedAt.getTime(),
        closure.version,
        closure.shiftId,
        closure.version
      ).changes;
      if (updated !== 1) return 'STALE';
      this.saveBalances(closure.shiftId, 'CLOSING', closure.balances);
      return 'APPLIED';
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async applyCashMovement(movement: ProjectedCashMovement): Promise<void> {
    requireTransaction(this.handle.sqlite);
    try {
      /** El movimiento es inmutable: una reentrega no lo altera ni lo duplica. */
      this.handle.sqlite.prepare(`
        insert into sync_cash_movement_projection (
          movement_id, shift_id, origin_node_id, movement_type, payment_method_code,
          amount_minor_units, currency_code, registered_by, source_id, occurred_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(movement_id) do nothing
      `).run(
        movement.movementId,
        movement.shiftId,
        movement.originNodeId,
        movement.movementType,
        movement.paymentMethodCode,
        movement.amount.minorUnits,
        movement.amount.currencyCode,
        movement.registeredBy,
        movement.sourceId,
        movement.occurredAt.getTime()
      );
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async applyFiscalEntry(entry: ProjectedFiscalEntry): Promise<void> {
    requireTransaction(this.handle.sqlite);
    try {
      this.handle.sqlite.prepare(`
        insert into sync_fiscal_projection (
          entry_id, origin_node_id, kind, reference_id, fiscal_number, error_code,
          dispatch_state, command_effect, fiscal_commit, print_delivery,
          version, occurred_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(entry_id) do update set
          origin_node_id = excluded.origin_node_id,
          kind = excluded.kind,
          reference_id = excluded.reference_id,
          fiscal_number = excluded.fiscal_number,
          error_code = excluded.error_code,
          dispatch_state = excluded.dispatch_state,
          command_effect = excluded.command_effect,
          fiscal_commit = excluded.fiscal_commit,
          print_delivery = excluded.print_delivery,
          version = excluded.version,
          occurred_at = excluded.occurred_at
          where excluded.version > sync_fiscal_projection.version
      `).run(
        entry.entryId,
        entry.originNodeId,
        entry.kind,
        entry.referenceId,
        entry.fiscalNumber,
        entry.errorCode,
        entry.evidence?.dispatchState ?? null,
        entry.evidence?.commandEffect ?? null,
        entry.evidence?.fiscalCommit ?? null,
        entry.evidence?.printDelivery ?? null,
        entry.version,
        entry.occurredAt.getTime()
      );
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  private saveBalances(
    shiftId: string,
    phase: 'OPENING' | 'CLOSING',
    balances: readonly ProjectedShiftBalance[]
  ): void {
    const upsert = this.handle.sqlite.prepare(`
      insert into sync_shift_balance_projection (
        shift_id, payment_method_code, phase, expected_minor_units,
        declared_minor_units, difference_minor_units, currency_code
      ) values (?, ?, ?, ?, ?, ?, ?)
      on conflict(shift_id, payment_method_code, phase) do update set
        expected_minor_units = excluded.expected_minor_units,
        declared_minor_units = excluded.declared_minor_units,
        difference_minor_units = excluded.difference_minor_units,
        currency_code = excluded.currency_code
    `);
    for (const balance of balances) {
      upsert.run(
        shiftId,
        balance.paymentMethodCode,
        phase,
        balance.expected?.minorUnits ?? null,
        balance.declared.minorUnits,
        balance.difference?.minorUnits ?? null,
        balance.declared.currencyCode
      );
    }
  }
}
