import { describe, expect, it } from 'vitest';
import { ok } from '@supermarket/shared';
import { application, type SyncSenderContext } from '@supermarket/core';
import type { SyncEnvelopeV1 } from '@supermarket/shared';
import { SqliteCommercialProjection } from './commercial-projection.js';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleAggregateAuthorityRegistry } from './sync-authority-registry.js';
import { DrizzleSyncInboxWorkStore } from './sync-inbox-work-store.js';
import { DrizzleSyncReceptionStore } from './sync-reception-store.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

/**
 * Consolidación comercial del coordinador.
 *
 * Proyecta lo que ocurrió en las terminales **para leer**: no importa sus
 * agregados, no reejecuta sus efectos y no toca las tablas operativas de este
 * nodo. Todo pasa por el receptor y el procesador reales sobre SQLite.
 */

let moment = new Date('2026-09-06T12:00:00.000Z');
const clock = { now: (): Date => moment };
let issued = 0;
const ids = { generate: (): string => `generated-${(issued += 1)}` };

const sender: SyncSenderContext = {
  verifiedNodeId: 'node-terminal-1',
  verifiedTerminalId: 'terminal-001',
  coordinatorNodeId: 'node-coordinator'
};

const envelope = (overrides: Partial<SyncEnvelopeV1>): SyncEnvelopeV1 => ({
  protocolVersion: 1,
  eventId: 'event-1',
  eventType: 'ShiftOpened',
  contractVersion: 1,
  aggregateId: 'shift-001',
  aggregateType: 'Shift',
  aggregateVersion: 1,
  originNodeId: 'node-terminal-1',
  correlationId: 'correlation-001',
  actorId: 'user-001',
  occurredAt: '2026-09-06T10:00:00.000Z',
  payload: {},
  ...overrides
});

const shiftOpened = (): SyncEnvelopeV1 => envelope({
  eventId: 'event-shift-opened',
  payload: {
    cashRegisterId: 'register-001',
    terminalId: 'terminal-001',
    originNodeId: 'node-terminal-1',
    openedBy: 'user-001',
    openingBalances: [
      { paymentMethodCode: 'CASH_USD', amount: { minorUnits: 5000, currencyCode: 'USD' } }
    ]
  }
});

const shiftClosed = (version = 3): SyncEnvelopeV1 => envelope({
  eventId: `event-shift-closed-${version}`,
  eventType: 'ShiftClosed',
  aggregateVersion: version,
  payload: {
    closedBy: 'user-002',
    balances: [{
      paymentMethodCode: 'CASH_USD',
      expected: { minorUnits: 7320, currencyCode: 'USD' },
      declared: { minorUnits: 7300, currencyCode: 'USD' },
      difference: { minorUnits: -20, currencyCode: 'USD' }
    }]
  }
});

const saleCompleted = (): SyncEnvelopeV1 => envelope({
  eventId: 'event-sale-completed',
  eventType: 'SaleCompleted',
  aggregateId: 'sale-001',
  aggregateType: 'Sale',
  aggregateVersion: 4,
  payload: {
    shiftId: 'shift-001',
    terminalId: 'terminal-001',
    total: { minorUnits: 2320, currencyCode: 'USD' },
    paidTotal: { minorUnits: 2320, currencyCode: 'USD' },
    payments: [{
      paymentId: 'payment-001', methodCode: 'CASH_USD',
      currencyCode: 'USD', amountMinorUnits: 2320
    }],
    items: [{ itemId: 'line-001', productId: 'product-1', quantityScaled: 2, quantityScale: 0 }]
  }
});

const saleReturned = (): SyncEnvelopeV1 => envelope({
  eventId: 'event-sale-returned',
  eventType: 'SaleReturned',
  aggregateId: 'return-001',
  aggregateType: 'SaleReturn',
  aggregateVersion: 1,
  payload: {
    saleId: 'sale-001',
    originalDocumentId: 'document-001',
    creditNoteId: 'credit-001',
    shiftId: 'shift-001',
    refundMinorUnits: 2320,
    currencyCode: 'USD',
    paymentMethodCode: 'CASH_USD',
    lineCount: 1
  }
});

const cashMovement = (): SyncEnvelopeV1 => envelope({
  eventId: 'event-cash-movement',
  eventType: 'CashMovementRegistered',
  aggregateVersion: 2,
  payload: {
    movementId: 'movement-001',
    movementType: 'SALE_PAYMENT',
    paymentMethodCode: 'CASH_USD',
    amount: { minorUnits: 2320, currencyCode: 'USD' },
    reason: 'Cobro de venta',
    registeredBy: 'user-001',
    reference: { sourceId: 'sale-001', sourceEventId: 'event-sale-completed' }
  }
});

const fiscalIssued = (): SyncEnvelopeV1 => envelope({
  eventId: 'event-fiscal-issued',
  eventType: 'FiscalDocumentIssued',
  aggregateId: 'document-001',
  aggregateType: 'FiscalDocument',
  aggregateVersion: 2,
  payload: {
    fiscalNumber: 'F-0001',
    referenceId: 'sale-001',
    evidence: {
      dispatchState: 'RESULT_RECEIVED',
      commandEffect: 'APPLIED',
      fiscalCommit: 'COMMITTED',
      printDelivery: 'COMPLETE'
    }
  }
});

const zReport = (): SyncEnvelopeV1 => envelope({
  eventId: 'event-z-report',
  eventType: 'FiscalZReportIssued',
  aggregateId: 'fiscal-day-001',
  aggregateType: 'FiscalDay',
  aggregateVersion: 5,
  payload: {
    reportId: 'report-z-001',
    reportNumber: 'Z-0007',
    evidence: {
      dispatchState: 'RESULT_RECEIVED',
      commandEffect: 'APPLIED',
      fiscalCommit: 'COMMITTED',
      printDelivery: 'COMPLETE'
    }
  }
});

type Coordinator = {
  readonly handle: DatabaseHandle;
  readonly receive: application.ReceiveSyncEvent;
  readonly processor: application.ProcessSyncInbox;
};

const coordinator = async (): Promise<Coordinator> => {
  const handle = openDatabase(':memory:');
  applyMigrations(handle.sqlite);
  const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
  const authorities = new DrizzleAggregateAuthorityRegistry(handle);
  for (const aggregate of [
    { aggregateType: 'Sale', aggregateId: 'sale-001' },
    { aggregateType: 'Shift', aggregateId: 'shift-001' },
    { aggregateType: 'SaleReturn', aggregateId: 'return-001' },
    { aggregateType: 'FiscalDocument', aggregateId: 'document-001' },
    { aggregateType: 'FiscalDay', aggregateId: 'fiscal-day-001' }
  ]) {
    await unitOfWork.execute(() => authorities.register({
      ...aggregate,
      ownerNodeId: 'node-terminal-1',
      source: 'MANUAL',
      evidenceFingerprint: `evidence-${aggregate.aggregateId}`,
      registeredAt: clock.now(),
      registeredBy: 'operator-001'
    }));
  }
  return {
    handle,
    receive: new application.ReceiveSyncEvent(
      'node-coordinator',
      new DrizzleSyncReceptionStore(handle),
      authorities,
      clock,
      unitOfWork,
      ids
    ),
    processor: new application.ProcessSyncInbox(
      new DrizzleSyncInboxWorkStore(handle),
      new Map<string, application.SyncConsumer>([
        ['COMMERCIAL_PROJECTION', new application.CommercialProjectionConsumer(
          new SqliteCommercialProjection(handle)
        )],
        /**
         * El consumidor de inventario tiene sus propias pruebas; aquí solo
         * necesita existir para que la venta quede aplicada y sus dependientes
         * dejen de esperar.
         */
        ['INVENTORY_AUTHORITY', { apply: async () => ok('APPLIED') }]
      ]),
      unitOfWork,
      clock,
      ids
    )
  };
};

const drain = async (node: Coordinator, cycles = 3): Promise<void> => {
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    await node.processor.runBatch();
    moment = new Date(moment.getTime() + 300_000);
  }
};

describe('consolidación comercial del coordinador', () => {
  it('proyecta ventas, turno, caja y fiscalidad de una terminal', async () => {
    const node = await coordinator();
    for (const entry of [
      shiftOpened(), saleCompleted(), cashMovement(), fiscalIssued(), zReport(), shiftClosed()
    ]) {
      await node.receive.execute(entry, sender);
    }

    await drain(node, 4);

    expect(node.handle.sqlite.prepare(`
      select sale_id as saleId, terminal_id as terminalId, origin_node_id as originNodeId,
        shift_id as shiftId, total_minor_units as total, item_count as itemCount,
        returned_at as returnedAt
      from sync_sale_projection
    `).get()).toEqual({
      saleId: 'sale-001',
      terminalId: 'terminal-001',
      originNodeId: 'node-terminal-1',
      shiftId: 'shift-001',
      total: 2320,
      itemCount: 1,
      returnedAt: null
    });
    expect(node.handle.sqlite.prepare(`
      select shift_id as shiftId, status, opened_by as openedBy, closed_by as closedBy
      from sync_shift_projection
    `).get()).toEqual({
      shiftId: 'shift-001', status: 'CLOSED', openedBy: 'user-001', closedBy: 'user-002'
    });
    expect(node.handle.sqlite.prepare(`
      select phase, declared_minor_units as declared, difference_minor_units as difference
      from sync_shift_balance_projection order by phase
    `).all()).toEqual([
      { phase: 'CLOSING', declared: 7300, difference: -20 },
      { phase: 'OPENING', declared: 5000, difference: null }
    ]);
    expect(node.handle.sqlite.prepare(`
      select movement_id as movementId, movement_type as movementType,
        amount_minor_units as amount, source_id as sourceId
      from sync_cash_movement_projection
    `).get()).toEqual({
      movementId: 'movement-001', movementType: 'SALE_PAYMENT',
      amount: 2320, sourceId: 'sale-001'
    });
    expect(node.handle.sqlite.prepare(`
      select entry_id as entryId, kind, fiscal_number as fiscalNumber,
        simulation_label as simulationLabel
      from sync_fiscal_projection order by kind
    `).all()).toEqual([
      { entryId: 'document-001', kind: 'DOCUMENT_ISSUED', fiscalNumber: 'F-0001', simulationLabel: 'SIMULACION' },
      { entryId: 'report-z-001', kind: 'Z_REPORT', fiscalNumber: 'Z-0007', simulationLabel: 'SIMULACION' }
    ]);
    node.handle.close();
  });

  it('no escribe las tablas operativas del coordinador ni emite documentos', async () => {
    const node = await coordinator();
    for (const entry of [shiftOpened(), saleCompleted(), cashMovement(), fiscalIssued()]) {
      await node.receive.execute(entry, sender);
    }

    await drain(node);

    for (const table of ['sales', 'shifts', 'cash_movements', 'fiscal_documents']) {
      expect({
        table,
        rows: node.handle.sqlite.prepare(`select count(*) from ${table}`).pluck().get()
      }).toEqual({ table, rows: 0 });
    }
    /** Tampoco encola nada: el coordinador no reenvía hechos ajenos. */
    expect(node.handle.sqlite.prepare('select count(*) from outbox_event').pluck().get()).toBe(0);
    node.handle.close();
  });

  it('marca la devolución sobre la venta sin borrarla ni cambiar sus totales', async () => {
    const node = await coordinator();
    await node.receive.execute(shiftOpened(), sender);
    await node.receive.execute(saleCompleted(), sender);
    await drain(node);
    await node.receive.execute(saleReturned(), sender);
    await drain(node);

    expect(node.handle.sqlite.prepare(`
      select total_minor_units as total, return_refund_minor_units as refund,
        return_currency_code as refundCurrency
      from sync_sale_projection
    `).get()).toMatchObject({ total: 2320, refund: 2320, refundCurrency: 'USD' });
    expect(node.handle.sqlite.prepare('select count(*) from sync_sale_projection')
      .pluck().get()).toBe(1);
    node.handle.close();
  });

  it('una devolución entregada antes que su venta espera a que esté aplicada', async () => {
    const node = await coordinator();
    await node.receive.execute(saleReturned(), sender);

    await drain(node, 2);
    expect(node.handle.sqlite.prepare(
      "select last_error from sync_inbox_work where event_id = 'event-sale-returned'"
    ).pluck().get()).toBe('SYNC_DEPENDENCY_NOT_APPLIED');

    await node.receive.execute(shiftOpened(), sender);
    await node.receive.execute(saleCompleted(), sender);
    await drain(node, 4);

    expect(node.handle.sqlite.prepare(
      'select return_refund_minor_units from sync_sale_projection'
    ).pluck().get()).toBe(2320);
    node.handle.close();
  });

  it('una reentrega no duplica filas ni totales', async () => {
    const node = await coordinator();
    for (const entry of [shiftOpened(), saleCompleted(), cashMovement()]) {
      await node.receive.execute(entry, sender);
      await node.receive.execute(entry, sender);
    }

    await drain(node, 4);

    expect(node.handle.sqlite.prepare(`
      select (select count(*) from sync_sale_projection)
        + (select count(*) from sync_shift_projection)
        + (select count(*) from sync_cash_movement_projection)
    `).pluck().get()).toBe(3);
    expect(node.handle.sqlite.prepare(
      'select sum(amount_minor_units) from sync_cash_movement_projection'
    ).pluck().get()).toBe(2320);
    node.handle.close();
  });

  it('un cierre atrasado no retrocede el turno ya cerrado', async () => {
    const node = await coordinator();
    await node.receive.execute(shiftOpened(), sender);
    await node.receive.execute(shiftClosed(5), sender);
    await drain(node);

    await node.receive.execute(shiftClosed(2), sender);
    await drain(node);

    expect(node.handle.sqlite.prepare(
      'select version, closed_by as closedBy from sync_shift_projection'
    ).get()).toEqual({ version: 5, closedBy: 'user-002' });
    node.handle.close();
  });
});
