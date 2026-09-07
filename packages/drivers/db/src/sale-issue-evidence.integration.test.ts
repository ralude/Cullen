import { describe, expect, it } from 'vitest';
import { application, StockItem, type SyncSenderContext } from '@supermarket/core';
import { Money, Quantity, type SyncEnvelopeV1 } from '@supermarket/shared';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleAuditWriter } from './audit-writer.js';
import { DrizzleBusinessEventStore } from './business-event-store.js';
import { DrizzleStockItemRepository } from './repositories.js';
import { SqliteSaleIssueEvidenceReader } from './sale-issue-evidence.js';
import { DrizzleAggregateAuthorityRegistry } from './sync-authority-registry.js';
import { DrizzleSyncInboxWorkStore } from './sync-inbox-work-store.js';
import { DrizzleSyncReceptionStore } from './sync-reception-store.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

let moment = new Date('2026-09-07T12:00:00.000Z');
const clock = { now: (): Date => moment };
let issued = 0;
const ids = { generate: (): string => `generated-${(issued += 1)}` };

const COORDINATOR = 'node-coordinator';

const sender: SyncSenderContext = {
  verifiedNodeId: 'node-terminal',
  verifiedTerminalId: 'terminal-001',
  coordinatorNodeId: COORDINATOR
};

const saleEnvelope = (quantityScaled: number): SyncEnvelopeV1 => ({
  protocolVersion: 1,
  eventId: 'event-sale',
  eventType: 'SaleCompleted',
  contractVersion: 2,
  aggregateId: 'sale-001',
  aggregateType: 'Sale',
  aggregateVersion: 4,
  originNodeId: 'node-terminal',
  correlationId: 'correlation-001',
  actorId: 'user-001',
  occurredAt: '2026-09-07T10:00:00.000Z',
  payload: {
    shiftId: 'shift-001',
    terminalId: 'terminal-001',
    total: { minorUnits: 2000, currencyCode: 'USD' },
    paidTotal: { minorUnits: 2000, currencyCode: 'USD' },
    payments: [{
      paymentId: 'payment-001', methodCode: 'CASH_USD', currencyCode: 'USD',
      amountMinorUnits: 2000
    }],
    items: [{
      itemId: 'line-001', productId: 'product-1', quantityScaled, quantityScale: 0,
      costSnapshot: {
        unitCost: { minorUnits: 500, currencyCode: 'USD' },
        version: 3, source: COORDINATOR, observedAt: '2026-09-07T09:00:00.000Z'
      }
    }]
  }
});

const shiftEnvelope = (): SyncEnvelopeV1 => ({
  ...saleEnvelope(2),
  eventId: 'event-shift',
  eventType: 'ShiftOpened',
  contractVersion: 1,
  aggregateId: 'shift-001',
  aggregateType: 'Shift',
  aggregateVersion: 1,
  payload: {
    cashRegisterId: 'register-001',
    terminalId: 'terminal-001',
    originNodeId: 'node-terminal',
    openedBy: 'user-001',
    openingBalances: []
  }
});

/** Dos lotes, para que una salida FEFO produzca más de una línea de evidencia. */
const batchedItem = (): StockItem => {
  const item = StockItem.create({
    id: 'stock-1', productId: 'product-1', unitCode: 'UND', quantityScale: 0,
    tracksBatches: true
  });
  item.registerBatch({
    id: 'batch-1', lotNumber: 'L1', expiresAt: new Date('2026-10-01T00:00:00.000Z')
  });
  item.registerBatch({
    id: 'batch-2', lotNumber: 'L2', expiresAt: new Date('2026-12-01T00:00:00.000Z')
  });
  for (const [index, batchId] of ['batch-1', 'batch-2'].entries()) {
    item.registerMovement({
      id: `receipt-${index}`,
      eventId: `receipt-event-${index}`,
      type: 'PURCHASE_RECEIPT',
      quantity: Quantity.fromScaled(2, 0),
      batchId,
      actorId: 'user-001',
      reason: 'Purchase',
      referenceId: `r-${index}`,
      occurredAt: new Date('2026-09-01T10:00:00.000Z'),
      unitCost: Money.fromMinorUnits(500, 'USD')
    });
  }
  return item;
};

type Fixture = {
  readonly handle: DatabaseHandle;
  readonly receive: application.ReceiveSyncEvent;
  readonly processor: application.ProcessSyncInbox;
  readonly reader: SqliteSaleIssueEvidenceReader;
};

const fixture = async (): Promise<Fixture> => {
  const handle = openDatabase(':memory:');
  applyMigrations(handle.sqlite);
  const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
  const authorities = new DrizzleAggregateAuthorityRegistry(handle);
  const workStore = new DrizzleSyncInboxWorkStore(handle);
  const stockItems = new DrizzleStockItemRepository(handle);

  await unitOfWork.execute(() => stockItems.save(batchedItem()));
  for (const aggregate of [
    { aggregateType: 'Sale', aggregateId: 'sale-001' },
    { aggregateType: 'Shift', aggregateId: 'shift-001' }
  ]) {
    await unitOfWork.execute(() => authorities.register({
      ...aggregate,
      ownerNodeId: 'node-terminal',
      source: 'MANUAL',
      evidenceFingerprint: `evidence-${aggregate.aggregateId}`,
      registeredAt: clock.now(),
      registeredBy: 'operator-001'
    }));
  }

  return {
    handle,
    reader: new SqliteSaleIssueEvidenceReader(handle),
    receive: new application.ReceiveSyncEvent(
      COORDINATOR, new DrizzleSyncReceptionStore(handle), authorities, clock, unitOfWork, ids
    ),
    processor: new application.ProcessSyncInbox(
      workStore,
      new Map<string, application.SyncConsumer>([
        ['INVENTORY_AUTHORITY', new application.InventoryAuthorityConsumer(
          new application.ApplySaleCompletedToInventory(
            stockItems, ids, ids, application.ambientUnitOfWork,
            new DrizzleBusinessEventStore(handle), new DrizzleAuditWriter(handle),
            'SYNCED_SNAPSHOT', undefined, COORDINATOR
          )
        )],
        ['COMMERCIAL_PROJECTION', {
          apply: (): Promise<{ ok: true; value: string }> =>
            Promise.resolve({ ok: true, value: 'APPLIED' })
        }]
      ]),
      unitOfWork,
      clock,
      ids
    )
  };
};

/** Aplica turno y venta: la venta espera a que su dependencia esté aplicada. */
const applySale = async (state: Fixture, quantityScaled: number): Promise<void> => {
  await state.receive.execute(shiftEnvelope(), sender);
  await state.receive.execute(saleEnvelope(quantityScaled), sender);
  await state.processor.runBatch();
  moment = new Date('2026-09-07T12:05:00.000Z');
  await state.processor.runBatch();
  moment = new Date('2026-09-07T12:00:00.000Z');
};

describe('evidencia de la salida aplicada por el coordinador', () => {
  it('responde una línea por lote consumido, con su costo congelado', async () => {
    const state = await fixture();
    await applySale(state, 3);

    expect(await state.reader.findBySaleEventId('event-sale')).toEqual({
      state: 'APPLIED',
      lines: [{
        saleItemId: 'line-001',
        productId: 'product-1',
        stockItemId: 'stock-1',
        batchId: 'batch-1',
        quantityScaled: 2,
        quantityScale: 0,
        unitCost: { minorUnits: 500, currencyCode: 'USD' }
      }, {
        saleItemId: 'line-001',
        productId: 'product-1',
        stockItemId: 'stock-1',
        batchId: 'batch-2',
        quantityScaled: 1,
        quantityScale: 0,
        unitCost: { minorUnits: 500, currencyCode: 'USD' }
      }]
    });
    state.handle.close();
  });

  it('no entrega líneas mientras la venta solo tiene custodia', async () => {
    const state = await fixture();
    await state.receive.execute(saleEnvelope(3), sender);

    expect(await state.reader.findBySaleEventId('event-sale'))
      .toEqual({ state: 'PENDING', lines: [] });
    state.handle.close();
  });

  it('no entrega líneas de una venta cuya aplicación quedó en discrepancia', async () => {
    const state = await fixture();
    /** Cinco unidades sobre cuatro disponibles: la salida no se aplica. */
    await applySale(state, 5);

    expect(await state.reader.findBySaleEventId('event-sale'))
      .toEqual({ state: 'DISCREPANCY', lines: [] });
    state.handle.close();
  });

  it('no reconoce una venta de la que no tiene custodia', async () => {
    const state = await fixture();
    await applySale(state, 3);

    expect(await state.reader.findBySaleEventId('event-desconocido'))
      .toEqual({ state: 'NONE', lines: [] });
    state.handle.close();
  });
});
