import type {
  AppliedSaleIssueLine,
  SaleIssueApplicationState,
  SaleIssueEvidence,
  SaleIssueEvidenceReader
} from '@supermarket/core';
import type { DatabaseHandle } from './connection.js';
import { mapDatabaseError } from './unit-of-work.js';

type IssueRow = {
  readonly reference_id: string;
  readonly stock_item_id: string;
  readonly product_id: string;
  readonly batch_id: string | null;
  readonly quantity_scaled: number;
  readonly quantity_scale: number;
  readonly unit_cost_minor_units: number | null;
  readonly cost_currency_code: string | null;
};

/**
 * Lectura de la salida que el inventario autoritativo ya aplicó para una venta
 * recibida, identificada por el `eventId` de su `SaleCompleted`.
 *
 * `ApplySaleCompletedToInventory` registra cada movimiento `SALE_ISSUE` con
 * `referenceId = <eventId>:<saleItemId>`, así que esa referencia es la que
 * reconstruye la evidencia. Solo se responden líneas cuando la aplicación está
 * confirmada: una venta en custodia sin efecto, o con su aplicación en
 * discrepancia, no autoriza restituir nada (ADR-0026 D3).
 */
export class SqliteSaleIssueEvidenceReader implements SaleIssueEvidenceReader {
  constructor(private readonly handle: DatabaseHandle) {}

  async findBySaleEventId(saleEventId: string): Promise<SaleIssueEvidence> {
    try {
      const state = this.stateOf(saleEventId);
      if (state !== 'APPLIED') return { state, lines: [] };
      const rows = this.handle.sqlite.prepare(`
        select movement.reference_id, movement.stock_item_id, item.product_id,
          movement.batch_id, movement.quantity_scaled, movement.quantity_scale,
          movement.unit_cost_minor_units, movement.cost_currency_code
        from stock_movements movement
        join stock_items item on item.id = movement.stock_item_id
        where movement.type = 'SALE_ISSUE'
          and substr(movement.reference_id, 1, ?) = ?
        order by movement.reference_id, movement.id
      `).all(saleEventId.length + 1, `${saleEventId}:`) as IssueRow[];
      return { state, lines: rows.map((row) => toLine(saleEventId, row)) };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  /**
   * Estado de la aplicación del hecho en este receptor. Una tarea en
   * `DISCREPANCY` prevalece: la salida existe a medias y resolverla es una
   * decisión con evidencia, no un reintento ciego.
   */
  private stateOf(saleEventId: string): SaleIssueApplicationState {
    const custody = this.handle.sqlite.prepare(
      'select count(*) from sync_inbox_event where event_id = ?'
    ).pluck().get(saleEventId) as number;
    if (custody === 0) return 'NONE';
    const discrepancies = this.handle.sqlite.prepare(
      "select count(*) from sync_inbox_work where event_id = ? and state = 'DISCREPANCY'"
    ).pluck().get(saleEventId) as number;
    if (discrepancies > 0) return 'DISCREPANCY';
    const pending = this.handle.sqlite.prepare(
      "select count(*) from sync_inbox_work where event_id = ? and state <> 'APPLIED'"
    ).pluck().get(saleEventId) as number;
    return pending === 0 ? 'APPLIED' : 'PENDING';
  }
}

const toLine = (saleEventId: string, row: IssueRow): AppliedSaleIssueLine => ({
  saleItemId: row.reference_id.slice(saleEventId.length + 1),
  productId: row.product_id,
  stockItemId: row.stock_item_id,
  batchId: row.batch_id,
  quantityScaled: row.quantity_scaled,
  quantityScale: row.quantity_scale,
  unitCost: row.unit_cost_minor_units === null || row.cost_currency_code === null
    ? null
    : { minorUnits: row.unit_cost_minor_units, currencyCode: row.cost_currency_code }
});
