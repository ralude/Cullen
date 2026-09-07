import { describe, expect, it } from 'vitest';
import { application, StockItem, type SyncSenderContext } from '@supermarket/core';
import { Money, Quantity, type SyncEnvelopeV1 } from '@supermarket/shared';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { applyMigrations } from './migrations.js';
import { SqliteCommercialProjection } from './commercial-projection.js';
import { DrizzleAuditWriter } from './audit-writer.js';
import { DrizzleBusinessEventStore } from './business-event-store.js';
import { DrizzleStockItemRepository } from './repositories.js';
import { DrizzleAggregateAuthorityRegistry } from './sync-authority-registry.js';
import { DrizzleSyncInboxWorkStore } from './sync-inbox-work-store.js';
import { DrizzleSyncReceptionStore } from './sync-reception-store.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

let moment = new Date('2026-09-06T12:00:00.000Z');
const clock = { now: (): Date => moment };
let issued = 0;
const ids = { generate: (): string => `generated-${(issued += 1)}` };

const sender: SyncSenderContext = {
  verifiedNodeId: 'node-terminal',
  verifiedTerminalId: 'terminal-001',
  coordinatorNodeId: 'node-coordinator'
};

const context = {
  actorId: 'operator-001',
  actorRoleCodes: ['ADMIN'],
  terminalId: 'terminal-coordinator',
  originNodeId: 'node-coordinator',
  correlationId: 'correlation-review'
};

const authorization = { authorize: async (): Promise<boolean> => true };

const salePayload = (quantityScaled: number): SyncEnvelopeV1['payload'] => ({
  shiftId: 'shift-001',
  terminalId: 'terminal-001',
  total: { minorUnits: 2320, currencyCode: 'USD' },
  paidTotal: { minorUnits: 2320, currencyCode: 'USD' },
  payments: [{
    paymentId: 'payment-001',
    methodCode: 'CASH_USD',
    currencyCode: 'USD',
    amountMinorUnits: 2320
  }],
  items: [{
    itemId: 'line-001', productId: 'product-1', quantityScaled, quantityScale: 0
  }]
});

const saleEnvelope = (
  overrides: Partial<SyncEnvelopeV1> = {},
  quantityScaled = 2
): SyncEnvelopeV1 => ({
  protocolVersion: 1,
  eventId: 'event-sale',
  eventType: 'SaleCompleted',
  contractVersion: 1,
  aggregateId: 'sale-001',
  aggregateType: 'Sale',
  aggregateVersion: 4,
  originNodeId: 'node-terminal',
  correlationId: 'correlation-001',
  actorId: 'user-001',
  occurredAt: '2026-09-06T10:00:00.000Z',
  payload: salePayload(quantityScaled),
  ...overrides
});

const shiftEnvelope = (): SyncEnvelopeV1 => ({
  ...saleEnvelope(),
  eventId: 'event-shift',
  eventType: 'ShiftOpened',
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

const stockedItem = (available: number): StockItem => {
  const item = StockItem.create({
    id: 'stock-1', productId: 'product-1', unitCode: 'UND', quantityScale: 0, tracksBatches: false
  });
  item.registerMovement({
    id: 'receipt-1',
    eventId: 'receipt-event-1',
    type: 'PURCHASE_RECEIPT',
    quantity: Quantity.fromScaled(available, 0),
    actorId: 'user-001',
    reason: 'Purchase',
    referenceId: 'r-1',
    occurredAt: new Date('2026-09-01T10:00:00.000Z'),
    unitCost: Money.fromMinorUnits(500, 'USD')
  });
  return item;
};

type Fixture = {
  readonly handle: DatabaseHandle;
  readonly receive: application.ReceiveSyncEvent;
  readonly processor: application.ProcessSyncInbox;
  readonly workStore: DrizzleSyncInboxWorkStore;
  readonly unitOfWork: SqliteUnitOfWork;
};

const fixture = async (available: number): Promise<Fixture> => {
  const handle = openDatabase(':memory:');
  applyMigrations(handle.sqlite);
  const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
  const authorities = new DrizzleAggregateAuthorityRegistry(handle);
  const workStore = new DrizzleSyncInboxWorkStore(handle);
  const stockItems = new DrizzleStockItemRepository(handle);

  await unitOfWork.execute(() => stockItems.save(stockedItem(available)));
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

  const inventory = new application.ApplySaleCompletedToInventory(
    stockItems,
    ids,
    ids,
    application.ambientUnitOfWork,
    new DrizzleBusinessEventStore(handle),
    new DrizzleAuditWriter(handle),
    'SYNCED_SNAPSHOT'
  );

  return {
    handle,
    unitOfWork,
    workStore,
    receive: new application.ReceiveSyncEvent(
      'node-coordinator',
      new DrizzleSyncReceptionStore(handle),
      authorities,
      clock,
      unitOfWork,
      ids
    ),
    processor: new application.ProcessSyncInbox(
      workStore,
      /** Los dos consumidores reales de `SaleCompleted`, como los compone el nodo. */
      new Map<string, application.SyncConsumer>([
        ['INVENTORY_AUTHORITY', new application.InventoryAuthorityConsumer(inventory)],
        ['COMMERCIAL_PROJECTION', new application.CommercialProjectionConsumer(
          new SqliteCommercialProjection(handle)
        )]
      ]),
      unitOfWork,
      clock,
      ids
    )
  };
};

const workState = (handle: DatabaseHandle): unknown[] => handle.sqlite.prepare(`
  select consumer, state, attempts, last_error from sync_inbox_work
  order by event_id, consumer
`).all();

const balanceOf = async (handle: DatabaseHandle): Promise<number> => {
  const item = await new DrizzleStockItemRepository(handle).findByProductId('product-1');
  return item?.balance.scaledValue ?? -1;
};

const saleIssues = (handle: DatabaseHandle): number => handle.sqlite
  .prepare("select count(*) from stock_movements where type = 'SALE_ISSUE'")
  .pluck().get() as number;

describe('aplicación recuperable del receptor', () => {
  it('aplica el efecto y marca el progreso juntos', async () => {
    const { handle, receive, processor } = await fixture(10);
    await receive.execute(shiftEnvelope(), sender);
    await receive.execute(saleEnvelope(), sender);

    /**
     * El primer ciclo proyecta el turno y deja esperando a la venta: su
     * dependencia se aplicó en este mismo lote, así que el segundo la aplica.
     */
    expect(await processor.runBatch()).toBe(3);
    moment = new Date('2026-09-06T12:05:00.000Z');
    expect(await processor.runBatch()).toBe(2);

    expect(workState(handle)).toEqual([
      { consumer: 'COMMERCIAL_PROJECTION', state: 'APPLIED', attempts: 2, last_error: null },
      { consumer: 'INVENTORY_AUTHORITY', state: 'APPLIED', attempts: 2, last_error: null },
      { consumer: 'COMMERCIAL_PROJECTION', state: 'APPLIED', attempts: 1, last_error: null }
    ]);
    moment = new Date('2026-09-06T12:00:00.000Z');
    expect(saleIssues(handle)).toBe(1);
    expect(await balanceOf(handle)).toBe(8);
    handle.close();
  });

  it('no completa el costo del coordinador en una salida sincronizada', async () => {
    const { handle, receive, processor } = await fixture(10);
    await receive.execute(shiftEnvelope(), sender);
    await receive.execute(saleEnvelope(), sender);

    await processor.runBatch();
    moment = new Date('2026-09-06T12:05:00.000Z');
    await processor.runBatch();

    expect(handle.sqlite.prepare(
      "select unit_cost_minor_units from stock_movements where type = 'SALE_ISSUE'"
    ).pluck().get()).toBeNull();
    moment = new Date('2026-09-06T12:00:00.000Z');
    handle.close();
  });

  it('espera a que la dependencia esté aplicada, no solo recibida', async () => {
    const { handle, receive, processor } = await fixture(10);
    await receive.execute(saleEnvelope(), sender);

    /** Ninguno de los dos consumidores aplica sin su dependencia aplicada. */
    expect(await processor.runBatch()).toBe(2);
    expect(handle.sqlite.prepare('select count(*) from sync_sale_projection').pluck().get())
      .toBe(0);

    expect(workState(handle)).toEqual([{
      consumer: 'COMMERCIAL_PROJECTION',
      state: 'PENDING',
      attempts: 1,
      last_error: 'SYNC_DEPENDENCY_NOT_APPLIED'
    }, {
      consumer: 'INVENTORY_AUTHORITY',
      state: 'PENDING',
      attempts: 1,
      last_error: 'SYNC_DEPENDENCY_NOT_APPLIED'
    }]);
    expect(saleIssues(handle)).toBe(0);
    handle.close();
  });

  it('no duplica el efecto ante una reentrega ni un segundo ciclo', async () => {
    const { handle, receive, processor } = await fixture(10);
    await receive.execute(shiftEnvelope(), sender);
    await receive.execute(saleEnvelope(), sender);
    await processor.runBatch();
    moment = new Date('2026-09-06T12:05:00.000Z');
    await processor.runBatch();

    await receive.execute(saleEnvelope(), sender);
    moment = new Date('2026-09-06T12:10:00.000Z');
    const second = await processor.runBatch();

    expect(second).toBe(0);
    /** Tampoco duplica la fila proyectada de la venta. */
    expect(handle.sqlite.prepare('select count(*) from sync_sale_projection').pluck().get())
      .toBe(1);
    expect(saleIssues(handle)).toBe(1);
    expect(handle.sqlite.prepare(
      "select count(*) from audit_log where action = 'SALE_STOCK_ISSUED'"
    ).pluck().get()).toBe(1);
    moment = new Date('2026-09-06T12:00:00.000Z');
    handle.close();
  });

  it('conserva la venta y abre una discrepancia única ante stock insuficiente', async () => {
    const { handle, receive, processor } = await fixture(1);
    await receive.execute(shiftEnvelope(), sender);
    await receive.execute(saleEnvelope({}, 5), sender);

    await processor.runBatch();
    moment = new Date('2026-09-06T12:05:00.000Z');
    await processor.runBatch();

    expect(workState(handle)).toEqual([{
      consumer: 'COMMERCIAL_PROJECTION',
      state: 'APPLIED',
      attempts: 2,
      last_error: null
    }, {
      consumer: 'INVENTORY_AUTHORITY',
      state: 'DISCREPANCY',
      attempts: 2,
      last_error: 'STOCK_INSUFFICIENT'
    }, {
      consumer: 'COMMERCIAL_PROJECTION',
      state: 'APPLIED',
      attempts: 1,
      last_error: null
    }]);
    /** La venta se conserva y se consolida; lo que falta es su efecto de stock. */
    expect(handle.sqlite.prepare('select count(*) from sync_sale_projection').pluck().get())
      .toBe(1);
    moment = new Date('2026-09-06T12:00:00.000Z');
    expect(saleIssues(handle)).toBe(0);
    expect(await balanceOf(handle)).toBe(1);
    expect(handle.sqlite.prepare(
      'select event_id, consumer, reason_code, status from sync_discrepancy'
    ).all()).toEqual([{
      event_id: 'event-sale',
      consumer: 'INVENTORY_AUTHORITY',
      reason_code: 'STOCK_INSUFFICIENT',
      status: 'OPEN'
    }]);
    expect(handle.sqlite.prepare('select count(*) from sync_inbox_event').pluck().get()).toBe(2);
    handle.close();
  });

  it('exige permiso, motivo y evidencia de aplicación para cerrar la discrepancia', async () => {
    const { handle, receive, processor, workStore, unitOfWork } = await fixture(1);
    await receive.execute(shiftEnvelope(), sender);
    await receive.execute(saleEnvelope({}, 5), sender);
    await processor.runBatch();
    moment = new Date('2026-09-06T12:05:00.000Z');
    await processor.runBatch();
    moment = new Date('2026-09-06T12:00:00.000Z');
    const [open] = await workStore.listDiscrepancies('OPEN');
    const resolve = new application.ResolveSyncDiscrepancy(
      workStore, authorization, clock, unitOfWork, ids, new DrizzleAuditWriter(handle)
    );
    const retry = new application.RetrySyncDiscrepancy(
      workStore, authorization, clock, unitOfWork, ids, new DrizzleAuditWriter(handle)
    );
    const discrepancyId = open?.discrepancyId as string;

    const premature = await resolve.execute({ discrepancyId, reason: 'Lo revisamos.' }, context);
    const denied = await new application.ResolveSyncDiscrepancy(
      workStore, { authorize: async () => false }, clock, unitOfWork, ids
    ).execute({ discrepancyId, reason: 'Sin permiso.' }, context);
    const missingReason = await retry.execute({ discrepancyId, reason: '  ' }, context);

    expect(premature).toMatchObject({ ok: false, error: { code: 'SYNC_DISCREPANCY_NOT_APPLIED' } });
    expect(denied).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(missingReason).toMatchObject({
      ok: false, error: { code: 'SYNC_DISCREPANCY_REASON_REQUIRED' }
    });
    expect(handle.sqlite.prepare('select status from sync_discrepancy').pluck().get()).toBe('OPEN');
    handle.close();
  });

  it('reintenta tras corregir la causa y cierra con evidencia, sin abrir otra discrepancia', async () => {
    const { handle, receive, processor, workStore, unitOfWork } = await fixture(1);
    const stockItems = new DrizzleStockItemRepository(handle);
    await receive.execute(shiftEnvelope(), sender);
    await receive.execute(saleEnvelope({}, 5), sender);
    await processor.runBatch();
    moment = new Date('2026-09-06T12:05:00.000Z');
    await processor.runBatch();
    moment = new Date('2026-09-06T12:00:00.000Z');
    const [open] = await workStore.listDiscrepancies('OPEN');
    const discrepancyId = open?.discrepancyId as string;

    const corrected = await stockItems.findByProductId('product-1');
    corrected?.registerMovement({
      id: 'receipt-2',
      eventId: 'receipt-event-2',
      type: 'PURCHASE_RECEIPT',
      quantity: Quantity.fromScaled(20, 0),
      actorId: 'user-001',
      reason: 'Purchase',
      referenceId: 'r-2',
      occurredAt: new Date('2026-09-06T11:00:00.000Z'),
      unitCost: Money.fromMinorUnits(500, 'USD')
    });
    await unitOfWork.execute(() => stockItems.save(corrected as StockItem));

    await new application.RetrySyncDiscrepancy(
      workStore, authorization, clock, unitOfWork, ids, new DrizzleAuditWriter(handle)
    ).execute({ discrepancyId, reason: 'Recepción cargada.' }, context);
    moment = new Date('2026-09-06T12:10:00.000Z');
    await processor.runBatch();
    const closed = await new application.ResolveSyncDiscrepancy(
      workStore, authorization, clock, unitOfWork, ids, new DrizzleAuditWriter(handle)
    ).execute({ discrepancyId, reason: 'Salida aplicada.' }, context);

    expect(closed).toMatchObject({ ok: true, value: { status: 'RESOLVED' } });
    expect(handle.sqlite.prepare('select count(*) from sync_discrepancy').pluck().get()).toBe(1);
    expect(saleIssues(handle)).toBe(1);
    expect(handle.sqlite.prepare(
      "select count(*) from audit_log where action = 'SYNC_DISCREPANCY_RESOLVED'"
    ).pluck().get()).toBe(1);
    moment = new Date('2026-09-06T12:00:00.000Z');
    handle.close();
  });

  it('retoma el trabajo reclamado tras un lease vencido sin duplicar efectos', async () => {
    const { handle, receive, workStore, unitOfWork } = await fixture(10);
    await receive.execute(shiftEnvelope(), sender);
    await receive.execute(saleEnvelope(), sender);
    await unitOfWork.execute(() => workStore.claimPending(
      clock.now(), new Date(clock.now().getTime() + 30_000), 10
    ));

    const stalled = await fixtureProcessor(handle, workStore, unitOfWork);
    moment = new Date('2026-09-06T12:01:00.000Z');
    const recovered = await stalled.runBatch();

    /** El turno y los dos consumidores de la venta retoman su trabajo reclamado. */
    expect(recovered).toBe(3);
    /** La venta espera a que su turno quede proyectado y aplica en el ciclo siguiente. */
    moment = new Date('2026-09-06T12:06:00.000Z');
    await stalled.runBatch();

    expect(handle.sqlite.prepare(
      "select attempts from sync_inbox_work where consumer = 'INVENTORY_AUTHORITY'"
    ).pluck().get()).toBe(3);
    expect(saleIssues(handle)).toBe(1);
    moment = new Date('2026-09-06T12:00:00.000Z');
    handle.close();
  });
});

const fixtureProcessor = async (
  handle: DatabaseHandle,
  workStore: DrizzleSyncInboxWorkStore,
  unitOfWork: SqliteUnitOfWork
): Promise<application.ProcessSyncInbox> => {
  const inventory = new application.ApplySaleCompletedToInventory(
    new DrizzleStockItemRepository(handle),
    ids,
    ids,
    application.ambientUnitOfWork,
    new DrizzleBusinessEventStore(handle),
    new DrizzleAuditWriter(handle),
    'SYNCED_SNAPSHOT'
  );
  return new application.ProcessSyncInbox(
    workStore,
    new Map<string, application.SyncConsumer>([
      ['INVENTORY_AUTHORITY', new application.InventoryAuthorityConsumer(inventory)],
      ['COMMERCIAL_PROJECTION', new application.CommercialProjectionConsumer(
        new SqliteCommercialProjection(handle)
      )]
    ]),
    unitOfWork,
    clock,
    ids
  );
};
