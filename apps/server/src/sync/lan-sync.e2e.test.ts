import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  application,
  StockItem,
  type BusinessEventV1,
  type SyncNodeRegistration
} from '@supermarket/core';
import { Money, Quantity, type SyncEnvelopeV1 } from '@supermarket/shared';
import {
  HttpsRemoteApplicationProbe,
  HttpsRemoteSaleIssueProbe,
  HttpsSyncEventPublisher
} from '@supermarket/driver-security';
import { UnavailableExchangeRateProvider } from '@supermarket/driver-exchange-rate';
import {
  applyMigrations,
  DrizzleAggregateAuthorityRegistry,
  DrizzleAuditWriter,
  DrizzleBusinessEventStore,
  DrizzleOutboxStore,
  DrizzleStockItemRepository,
  DrizzleSyncInboxWorkStore,
  DrizzleSyncReceptionStore,
  SqliteCoordinatedOperationStore,
  SqliteCommercialProjection,
  SqliteSaleIssueEvidenceReader,
  openDatabase,
  SqliteSyncNodeRegistry,
  SqliteUnitOfWork,
  type DatabaseHandle
} from '@supermarket/driver-db';
import type { FastifyInstance } from 'fastify';
import { buildSyncApp, SYNC_AGGREGATES_ROUTE, SYNC_DESTINATION_HEADER } from './sync-app.ts';
import { issueNodeCertificate, type NodeCertificate } from './testing/certificates.ts';

const COORDINATOR = 'node-coordinator';
let moment = new Date('2026-09-06T12:00:00.000Z');
const clock = { now: (): Date => moment };
let issued = 0;
const ids = { generate: (): string => `generated-${(issued += 1)}` };

const coordinatorCertificate = issueNodeCertificate(COORDINATOR);
const terminalCertificates: Readonly<Record<string, NodeCertificate>> = {
  'node-terminal-1': issueNodeCertificate('node-terminal-1'),
  'node-terminal-2': issueNodeCertificate('node-terminal-2')
};

const salePayload = (terminalId: string, quantityScaled: number): BusinessEventV1['payload'] => ({
  shiftId: `shift-${terminalId}`,
  terminalId,
  total: { minorUnits: 1000, currencyCode: 'USD' },
  paidTotal: { minorUnits: 1000, currencyCode: 'USD' },
  payments: [{
    paymentId: `payment-${terminalId}`,
    methodCode: 'CASH_USD',
    currencyCode: 'USD',
    amountMinorUnits: 1000
  }],
  items: [{
    itemId: `line-${terminalId}`, productId: 'product-1', quantityScaled, quantityScale: 0
  }]
});

const shiftEvent = (nodeId: string, terminalId: string): BusinessEventV1 => ({
  eventId: `event-shift-${terminalId}`,
  eventType: 'ShiftOpened',
  contractVersion: 1,
  aggregateId: `shift-${terminalId}`,
  aggregateType: 'Shift',
  aggregateVersion: 1,
  originNodeId: nodeId,
  correlationId: `correlation-shift-${terminalId}`,
  actorId: 'user-001',
  occurredAt: new Date('2026-09-06T09:00:00.000Z'),
  payload: {
    cashRegisterId: `register-${terminalId}`,
    terminalId,
    originNodeId: nodeId,
    openedBy: 'user-001',
    openingBalances: []
  }
});

const saleEvent = (
  nodeId: string,
  terminalId: string,
  quantityScaled: number
): BusinessEventV1 => ({
  eventId: `event-sale-${terminalId}`,
  eventType: 'SaleCompleted',
  contractVersion: 1,
  aggregateId: `sale-${terminalId}`,
  aggregateType: 'Sale',
  aggregateVersion: 4,
  originNodeId: nodeId,
  correlationId: `correlation-sale-${terminalId}`,
  actorId: 'user-001',
  occurredAt: new Date('2026-09-06T10:00:00.000Z'),
  payload: salePayload(terminalId, quantityScaled)
});

const saleReturnedEvent = (nodeId: string, terminalId: string): BusinessEventV1 => ({
  eventId: `event-return-${terminalId}`,
  eventType: 'SaleReturned',
  contractVersion: 1,
  aggregateId: `return-${terminalId}`,
  aggregateType: 'SaleReturn',
  aggregateVersion: 1,
  originNodeId: nodeId,
  correlationId: `correlation-return-${terminalId}`,
  actorId: 'user-001',
  occurredAt: new Date('2026-09-06T11:00:00.000Z'),
  payload: {
    saleId: `sale-${terminalId}`,
    originalDocumentId: `document-${terminalId}`,
    creditNoteId: `credit-${terminalId}`,
    shiftId: `shift-${terminalId}`,
    refundMinorUnits: 1000,
    currencyCode: 'USD',
    paymentMethodCode: 'CASH_USD',
    lineCount: 1
  }
});

const purchaseReceiptEvent = (nodeId: string, terminalId: string): BusinessEventV1 => ({
  eventId: `event-purchase-${terminalId}`,
  eventType: 'PurchaseReceiptCompleted',
  contractVersion: 1,
  aggregateId: `purchase-${terminalId}`,
  aggregateType: 'PurchaseReceipt',
  aggregateVersion: 2,
  originNodeId: nodeId,
  correlationId: `correlation-purchase-${terminalId}`,
  actorId: 'user-001',
  occurredAt: new Date('2026-09-06T11:30:00.000Z'),
  payload: {
    supplierId: 'supplier-001',
    sourceType: 'INVOICE',
    sourceNumber: 'FAC-LAN-001',
    terminalId,
    reason: 'Recepción confirmada',
    lineCount: 1,
    lines: [{
      lineId: 'purchase-line-001', productId: 'product-1', stockItemId: 'stock-1',
      unitCode: 'UND', quantityScaled: 3, quantityScale: 0,
      batchTracking: 'NOT_TRACKED', batch: null,
      valuationUnitCost: { minorUnits: 600, currencyCode: 'USD' }
    }]
  }
});

const stockCountApprovedEvent = (nodeId: string, terminalId: string): BusinessEventV1 => ({
  eventId: `event-count-${terminalId}`,
  eventType: 'StockCountApproved',
  contractVersion: 1,
  aggregateId: `count-${terminalId}`,
  aggregateType: 'StockCount',
  aggregateVersion: 4,
  originNodeId: nodeId,
  correlationId: `correlation-count-${terminalId}`,
  actorId: 'user-001',
  occurredAt: new Date('2026-09-06T11:45:00.000Z'),
  payload: {
    terminalId,
    reason: 'Conteo aprobado',
    lineCount: 1,
    lines: [{
      lineId: 'count-line-001', productId: 'product-1', stockItemId: 'stock-1',
      batchId: null, quantityScale: 0, expectedScaled: 5, countedScaled: 8,
      differenceScaled: 3, stockAvailabilityVersion: 2
    }]
  }
});

type Coordinator = {
  readonly handle: DatabaseHandle;
  readonly app: FastifyInstance;
  readonly port: number;
  readonly processor: application.ProcessSyncInbox;
  readonly workStore: DrizzleSyncInboxWorkStore;
  readonly unitOfWork: SqliteUnitOfWork;
};

type Terminal = {
  readonly nodeId: string;
  readonly terminalId: string;
  readonly handle: DatabaseHandle;
  readonly outbox: DrizzleOutboxStore;
  readonly unitOfWork: SqliteUnitOfWork;
};

let directory: string;
let coordinator: Coordinator;
const terminals = new Map<string, Terminal>();

const node = (
  overrides: Partial<SyncNodeRegistration> & Pick<SyncNodeRegistration, 'nodeId'>
): SyncNodeRegistration => ({
  storeId: 'store-001',
  role: 'TERMINAL',
  terminalId: null,
  credentialFingerprint: '',
  addressHost: null,
  addressPort: null,
  notAfter: new Date('2027-01-01T00:00:00.000Z'),
  registeredAt: clock.now(),
  registeredBy: 'operator-001',
  registrationReason: 'Alta manual de prueba.',
  ...overrides
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

const startCoordinator = async (
  available: number,
  name = 'coordinator'
): Promise<Coordinator> => {
  const handle = openDatabase(join(directory, `${name}.sqlite`));
  applyMigrations(handle.sqlite);
  const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
  const authorities = new DrizzleAggregateAuthorityRegistry(handle);
  const workStore = new DrizzleSyncInboxWorkStore(handle);
  const registry = new SqliteSyncNodeRegistry(handle);
  const stockItems = new DrizzleStockItemRepository(handle);

  await unitOfWork.execute(() => stockItems.save(stockedItem(available)));
  await unitOfWork.execute(() => registry.register(node({
    nodeId: COORDINATOR,
    role: 'COORDINATOR',
    credentialFingerprint: coordinatorCertificate.fingerprint
  })));
  for (const [nodeId, certificate] of Object.entries(terminalCertificates)) {
    await unitOfWork.execute(() => registry.register(node({
      nodeId,
      terminalId: nodeId.replace('node-terminal-', 'terminal-00'),
      credentialFingerprint: certificate.fingerprint
    })));
  }

  const app = buildSyncApp({
    receiverNodeId: COORDINATOR,
    resolveSender: new application.ResolveSyncSender(COORDINATOR, registry, clock),
    receiveSyncEvent: new application.ReceiveSyncEvent(
      COORDINATOR,
      new DrizzleSyncReceptionStore(handle),
      authorities,
      clock,
      unitOfWork,
      ids
    ),
    registerOwnedAggregate: new application.RegisterOwnedAggregate(
      authorities, clock, unitOfWork, ids, new DrizzleAuditWriter(handle)
    ),
    /** Progreso de aplicación: la lectura con la que el origen concilia. */
    applicationProgress: (eventId) => workStore.applicationProgress(eventId),
    /** Salida aplicada: la evidencia con la que una devolución restituye. */
    saleIssueEvidence: (saleEventId) =>
      new SqliteSaleIssueEvidenceReader(handle).findBySaleEventId(saleEventId),
    https: {
      key: coordinatorCertificate.privateKeyPem,
      cert: coordinatorCertificate.certificatePem,
      ca: Object.values(terminalCertificates).map(({ certificatePem }) => certificatePem)
    }
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();

  return {
    handle,
    app,
    port: typeof address === 'object' && address !== null ? address.port : 0,
    unitOfWork,
    workStore,
    processor: new application.ProcessSyncInbox(
      workStore,
      /** Los dos consumidores del coordinador, como los compone el nodo real. */
      new Map<string, application.SyncConsumer>([
        ['INVENTORY_AUTHORITY', new application.InventoryAuthorityConsumer(
          new application.ApplySaleCompletedToInventory(
            stockItems, ids, ids, application.ambientUnitOfWork,
            new DrizzleBusinessEventStore(handle), new DrizzleAuditWriter(handle),
            'SYNCED_SNAPSHOT'
          ),
          new application.ApplyPurchaseReceiptCompletedToInventory(
            stockItems, ids, ids, ids, application.ambientUnitOfWork,
            new DrizzleBusinessEventStore(handle), new DrizzleAuditWriter(handle),
            new DrizzleOutboxStore(handle)
          ),
          new application.ApplyStockCountApprovedToInventory(
            stockItems, ids, ids, ids, application.ambientUnitOfWork,
            new DrizzleBusinessEventStore(handle), new DrizzleAuditWriter(handle),
            new DrizzleOutboxStore(handle), COORDINATOR
          )
        )],
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

const openTerminal = (nodeId: string): Terminal => {
  const handle = openDatabase(join(directory, `${nodeId}.sqlite`));
  applyMigrations(handle.sqlite);
  return {
    nodeId,
    terminalId: nodeId.replace('node-terminal-', 'terminal-00'),
    handle,
    outbox: new DrizzleOutboxStore(handle),
    unitOfWork: new SqliteUnitOfWork(handle.sqlite)
  };
};

const relayFor = (
  terminal: Terminal,
  port = coordinator.port
): application.OutboxRelay => new application.OutboxRelay(
  COORDINATOR,
  terminal.outbox,
  new HttpsSyncEventPublisher({
    host: 'localhost',
    port,
    destinationNodeId: COORDINATOR,
    key: (terminalCertificates[terminal.nodeId] as NodeCertificate).privateKeyPem,
    cert: (terminalCertificates[terminal.nodeId] as NodeCertificate).certificatePem,
    ca: [coordinatorCertificate.certificatePem],
    timeoutMilliseconds: 2_000
  }),
  terminal.unitOfWork,
  clock,
  { jitter: () => 0 }
);

/** Alta técnica del agregado creado sin conexión, previa a su entrega comercial. */
const claimAuthority = (
  terminal: Terminal,
  aggregateType: string,
  aggregateId: string
): Promise<{ status: number; body: unknown }> => new Promise((resolve, reject) => {
  const certificate = terminalCertificates[terminal.nodeId] as NodeCertificate;
  const body = JSON.stringify({
    aggregateType,
    aggregateId,
    evidenceFingerprint: createHash('sha256').update(aggregateId).digest('hex')
  });
  const call = httpsRequest({
    host: 'localhost',
    port: coordinator.port,
    path: SYNC_AGGREGATES_ROUTE,
    method: 'POST',
    ca: [coordinatorCertificate.certificatePem],
    key: certificate.privateKeyPem,
    cert: certificate.certificatePem,
    headers: {
      'content-type': 'application/json',
      [SYNC_DESTINATION_HEADER]: COORDINATOR
    }
  }, (response) => {
    let raw = '';
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => { raw += chunk; });
    response.on('end', () => resolve({
      status: response.statusCode ?? 0,
      body: raw.length === 0 ? null : JSON.parse(raw) as unknown
    }));
  });
  call.on('error', reject);
  call.end(body);
});

const custody = (): unknown[] => coordinator.handle.sqlite.prepare(
  'select event_id, application_state, received_from_node_id from sync_inbox_event order by event_id'
).all();

const deliveries = (terminal: Terminal): unknown[] => terminal.handle.sqlite.prepare(
  'select event_id, status, attempts, cycle_attempts from sync_delivery order by event_id'
).all();

const saleIssues = (): number => coordinator.handle.sqlite
  .prepare("select count(*) from stock_movements where type = 'SALE_ISSUE'")
  .pluck().get() as number;

const balance = async (): Promise<number> => {
  const item = await new DrizzleStockItemRepository(coordinator.handle)
    .findByProductId('product-1');
  return item?.balance.scaledValue ?? -1;
};

const enqueueSale = async (terminal: Terminal, quantityScaled: number): Promise<void> => {
  await terminal.unitOfWork.execute(() => terminal.outbox.enqueue([
    shiftEvent(terminal.nodeId, terminal.terminalId),
    saleEvent(terminal.nodeId, terminal.terminalId, quantityScaled)
  ]));
};

const grantAuthority = async (terminal: Terminal): Promise<void> => {
  await claimAuthority(terminal, 'Shift', `shift-${terminal.terminalId}`);
  await claimAuthority(terminal, 'Sale', `sale-${terminal.terminalId}`);
};

beforeEach(async () => {
  moment = new Date('2026-09-06T12:00:00.000Z');
  directory = mkdtempSync(join(tmpdir(), 'lan-sync-'));
  coordinator = await startCoordinator(10);
  terminals.set('node-terminal-1', openTerminal('node-terminal-1'));
  terminals.set('node-terminal-2', openTerminal('node-terminal-2'));
});

afterEach(async () => {
  await coordinator.app.close();
  if (coordinator.handle.sqlite.open) coordinator.handle.close();
  for (const terminal of terminals.values()) {
    if (terminal.handle.sqlite.open) terminal.handle.close();
  }
  terminals.clear();
  rmSync(directory, { recursive: true, force: true });
});

const first = (): Terminal => terminals.get('node-terminal-1') as Terminal;
const second = (): Terminal => terminals.get('node-terminal-2') as Terminal;

describe('LAN de una tienda con coordinador y dos terminales', () => {
  it('aplica una recepción en el coordinador sin inventario POS duplicado', async () => {
    const terminal = first();
    const purchase = purchaseReceiptEvent(terminal.nodeId, terminal.terminalId);
    await terminal.unitOfWork.execute(() => terminal.outbox.enqueue([purchase]));
    await claimAuthority(terminal, 'PurchaseReceipt', purchase.aggregateId);

    expect(await relayFor(terminal).runBatch()).toBe(1);
    await coordinator.processor.runBatch();

    expect(await balance()).toBe(13);
    expect(terminal.handle.sqlite.prepare('select count(*) from stock_items').pluck().get()).toBe(0);
    expect(coordinator.handle.sqlite.prepare(`
      select reference_id as referenceId, unit_cost_minor_units as unitCost
      from stock_movements where reference_id = ?
    `).get(`${purchase.eventId}:purchase-line-001`)).toEqual({
      referenceId: `${purchase.eventId}:purchase-line-001`, unitCost: 600
    });
    expect(coordinator.handle.sqlite.prepare(
      "select count(*) from audit_log where action = 'PURCHASE_STOCK_RECEIVED'"
    ).pluck().get()).toBe(1);
    await expect(coordinator.workStore.applicationProgress(purchase.eventId))
      .resolves.toBe('APPLIED');
    expect(coordinator.handle.sqlite.prepare(`
      select count(*) from outbox_event where event_type = 'StockAvailabilityPublished'
    `).pluck().get()).toBe(1);
  });

  it('aplica el delta congelado de un conteo en el coordinador una sola vez', async () => {
    const terminal = first();
    const count = stockCountApprovedEvent(terminal.nodeId, terminal.terminalId);
    await terminal.unitOfWork.execute(() => terminal.outbox.enqueue([count]));
    await claimAuthority(terminal, 'StockCount', count.aggregateId);

    expect(await relayFor(terminal).runBatch()).toBe(1);
    await coordinator.processor.runBatch();
    await coordinator.processor.runBatch();

    /** Saldo actual 10 + delta congelado 3; no se reemplaza por el contado 8. */
    expect(await balance()).toBe(13);
    expect(terminal.handle.sqlite.prepare('select count(*) from stock_items').pluck().get()).toBe(0);
    expect(coordinator.handle.sqlite.prepare(`
      select type, reference_id as referenceId, quantity_scaled as quantity
      from stock_movements where reference_id = ?
    `).get(`${count.eventId}:count-line-001`)).toEqual({
      type: 'ADJUSTMENT_IN', referenceId: `${count.eventId}:count-line-001`, quantity: 3
    });
    expect(coordinator.handle.sqlite.prepare(
      "select count(*) from audit_log where action = 'STOCK_COUNT_ADJUSTMENT_APPLIED'"
    ).pluck().get()).toBe(1);
    await expect(coordinator.workStore.applicationProgress(count.eventId))
      .resolves.toBe('APPLIED');
    expect(coordinator.handle.sqlite.prepare(`
      select count(*) from outbox_event where event_type = 'StockAvailabilityPublished'
    `).pluck().get()).toBe(1);
  });

  it('entrega una venta acumulada durante el corte y la aplica una sola vez', async () => {
    const terminal = first();
    await enqueueSale(terminal, 2);

    /** Coordinador inalcanzable: la salida local conserva ambos hechos. */
    expect(await relayFor(terminal, 1).runBatch()).toBe(2);
    expect(deliveries(terminal)).toMatchObject([
      { event_id: 'event-sale-terminal-001', status: 'PENDING' },
      { event_id: 'event-shift-terminal-001', status: 'PENDING' }
    ]);
    expect(custody()).toEqual([]);

    moment = new Date('2026-09-06T12:05:00.000Z');
    await grantAuthority(terminal);
    const relay = relayFor(terminal);
    await relay.runBatch();
    await relay.runBatch();
    await coordinator.processor.runBatch();
    moment = new Date('2026-09-06T12:10:00.000Z');
    await coordinator.processor.runBatch();

    expect(deliveries(terminal)).toMatchObject([
      { event_id: 'event-sale-terminal-001', status: 'PUBLISHED' },
      { event_id: 'event-shift-terminal-001', status: 'PUBLISHED' }
    ]);
    expect(custody()).toEqual([
      { event_id: 'event-sale-terminal-001', application_state: 'PENDING_CONSUMER',
        received_from_node_id: 'node-terminal-1' },
      { event_id: 'event-shift-terminal-001', application_state: 'PENDING_CONSUMER',
        received_from_node_id: 'node-terminal-1' }
    ]);
    expect(saleIssues()).toBe(1);
    expect(await balance()).toBe(8);
  });

  it('reentrega tras un ACK perdido sin duplicar custodia ni efectos', async () => {
    const terminal = first();
    await enqueueSale(terminal, 2);
    await grantAuthority(terminal);
    const publisher = new HttpsSyncEventPublisher({
      host: 'localhost',
      port: coordinator.port,
      destinationNodeId: COORDINATOR,
      key: (terminalCertificates['node-terminal-1'] as NodeCertificate).privateKeyPem,
      cert: (terminalCertificates['node-terminal-1'] as NodeCertificate).certificatePem,
      ca: [coordinatorCertificate.certificatePem]
    });
    let lostAcknowledgements = 2;

    /** El coordinador confirma, pero la respuesta se pierde en el camino. */
    const lossy = new application.OutboxRelay(COORDINATOR, terminal.outbox, {
      publish: async (envelope: SyncEnvelopeV1) => {
        const acknowledgement = await publisher.publish(envelope);
        if (lostAcknowledgements > 0) {
          lostAcknowledgements -= 1;
          throw new Error('connection reset before the acknowledgement arrived');
        }
        return acknowledgement;
      }
    }, terminal.unitOfWork, clock, { jitter: () => 0 });

    await lossy.runBatch();
    await lossy.runBatch();
    moment = new Date('2026-09-06T12:10:00.000Z');
    const recovered = relayFor(terminal);
    await recovered.runBatch();
    await recovered.runBatch();
    await coordinator.processor.runBatch();
    moment = new Date('2026-09-06T12:15:00.000Z');
    await coordinator.processor.runBatch();
    moment = new Date('2026-09-06T12:20:00.000Z');
    await coordinator.processor.runBatch();

    expect(deliveries(terminal)).toMatchObject([
      { event_id: 'event-sale-terminal-001', status: 'PUBLISHED' },
      { event_id: 'event-shift-terminal-001', status: 'PUBLISHED' }
    ]);
    expect(coordinator.handle.sqlite.prepare('select count(*) from sync_inbox_event')
      .pluck().get()).toBe(2);
    expect(saleIssues()).toBe(1);
    expect(await balance()).toBe(8);
  });

  it('el ACK de una terminal no confirma a la otra ni la bloquea', async () => {
    const online = first();
    const offline = second();
    await enqueueSale(online, 2);
    await enqueueSale(offline, 1);
    await grantAuthority(online);

    const relay = relayFor(online);
    await relay.runBatch();
    await relay.runBatch();
    expect(await relayFor(offline, 1).runBatch()).toBe(2);

    expect(deliveries(online)).toMatchObject([
      { event_id: 'event-sale-terminal-001', status: 'PUBLISHED' },
      { event_id: 'event-shift-terminal-001', status: 'PUBLISHED' }
    ]);
    expect(deliveries(offline)).toMatchObject([
      { event_id: 'event-sale-terminal-002', status: 'PENDING' },
      { event_id: 'event-shift-terminal-002', status: 'PENDING' }
    ]);
    expect(custody()).toMatchObject([
      { event_id: 'event-sale-terminal-001' },
      { event_id: 'event-shift-terminal-001' }
    ]);

    moment = new Date('2026-09-06T12:05:00.000Z');
    await grantAuthority(offline);
    const recovered = relayFor(offline);
    await recovered.runBatch();
    await recovered.runBatch();

    expect(deliveries(offline)).toMatchObject([
      { event_id: 'event-sale-terminal-002', status: 'PUBLISHED' },
      { event_id: 'event-shift-terminal-002', status: 'PUBLISHED' }
    ]);
  });

  it('conserva ambas ventas de la última unidad y abre una discrepancia única', async () => {
    await coordinator.app.close();
    coordinator.handle.close();
    coordinator = await startCoordinator(1, 'coordinator-scarce');
    const online = first();
    const neighbour = second();
    await enqueueSale(online, 1);
    await enqueueSale(neighbour, 1);
    await grantAuthority(online);
    await grantAuthority(neighbour);

    for (const terminal of [online, neighbour]) {
      const relay = relayFor(terminal);
      await relay.runBatch();
      await relay.runBatch();
    }
    /** Un ciclo por vuelta: los turnos primero, las ventas cuando ya dependen de ellos. */
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await coordinator.processor.runBatch();
      moment = new Date(moment.getTime() + 300_000);
    }

    expect(coordinator.handle.sqlite.prepare('select count(*) from sync_inbox_event')
      .pluck().get()).toBe(4);
    expect(await balance()).toBe(0);
    expect(saleIssues()).toBe(1);
    expect(coordinator.handle.sqlite.prepare(
      'select event_id, consumer, reason_code, status from sync_discrepancy'
    ).all()).toEqual([{
      event_id: 'event-sale-terminal-002',
      consumer: 'INVENTORY_AUTHORITY',
      reason_code: 'STOCK_INSUFFICIENT',
      status: 'OPEN'
    }]);
  });

  it('agota el ciclo, pausa de forma durable y solo reanuda con autorización', async () => {
    const terminal = first();
    await enqueueSale(terminal, 2);
    const relay = relayFor(terminal, 1);

    for (let cycle = 0; cycle < 12; cycle += 1) {
      await relay.runBatch();
      moment = new Date(moment.getTime() + 120_000);
    }
    terminal.handle.close();

    const reopened = openTerminal('node-terminal-1');
    terminals.set('node-terminal-1', reopened);
    await relayFor(reopened, 1).runBatch();

    expect(deliveries(reopened)).toMatchObject([
      { event_id: 'event-sale-terminal-001', status: 'PAUSED', attempts: 10, cycle_attempts: 10 },
      { event_id: 'event-shift-terminal-001', status: 'PAUSED', attempts: 10, cycle_attempts: 10 }
    ]);

    const resumed = await new application.ResumeSyncDelivery(
      reopened.outbox,
      { authorize: async () => true },
      clock,
      reopened.unitOfWork,
      ids,
      new DrizzleAuditWriter(reopened.handle)
    ).execute({
      eventId: 'event-shift-terminal-001',
      destinationNodeId: COORDINATOR,
      reason: 'LAN restablecida y verificada.'
    }, {
      actorId: 'operator-001',
      actorRoleCodes: ['ADMIN'],
      terminalId: 'terminal-001',
      originNodeId: 'node-terminal-1',
      correlationId: 'correlation-resume'
    });

    expect(resumed).toMatchObject({ ok: true });
    expect(reopened.handle.sqlite.prepare(
      "select status, cycle_attempts, attempts from sync_delivery where event_id = 'event-shift-terminal-001'"
    ).get()).toEqual({ status: 'PENDING', cycle_attempts: 0, attempts: 10 });
    expect(reopened.handle.sqlite.prepare(
      "select count(*) from audit_log where action = 'SYNC_DELIVERY_RESUMED'"
    ).pluck().get()).toBe(1);
  });

  it('no acepta un agregado sin alta y lo acepta después de registrarla', async () => {
    const terminal = first();
    await enqueueSale(terminal, 2);

    expect(await relayFor(terminal).runBatch()).toBe(2);
    expect(terminal.handle.sqlite.prepare(
      "select status, last_error from sync_delivery where event_id = 'event-shift-terminal-001'"
    ).get()).toEqual({ status: 'BLOCKED', last_error: 'SYNC_AGGREGATE_OWNER_UNRESOLVED' });

    const alta = await claimAuthority(terminal, 'Shift', 'shift-terminal-001');
    expect(alta.body).toMatchObject({ status: 'REGISTERED', ownerNodeId: 'node-terminal-1' });
    expect(coordinator.handle.sqlite.prepare(
      "select count(*) from audit_log where action = 'SYNC_AGGREGATE_AUTHORITY_DELEGATED'"
    ).pluck().get()).toBe(1);
    expect(coordinator.handle.sqlite.prepare(
      'select reason_code from sync_quarantine'
    ).pluck().all()).toEqual([
      'SYNC_AGGREGATE_OWNER_UNRESOLVED', 'SYNC_AGGREGATE_OWNER_UNRESOLVED'
    ]);
  });

  /**
   * Escenario 10 del plan de 10.04: Internet y LAN se cortan por separado y no
   * son lo mismo. Internet es el proveedor externo de tasas; la LAN es el
   * enlace con el coordinador de la tienda.
   */
  it('distingue el corte de Internet del corte de LAN', async () => {
    const terminal = first();
    await enqueueSale(terminal, 2);
    await grantAuthority(terminal);

    /**
     * Internet caído: el proveedor externo falla cerrado y no sugiere nada.
     * La entrega a la tienda no depende de él y sigue funcionando.
     */
    const offlineInternet = new UnavailableExchangeRateProvider();
    await expect(offlineInternet.getSuggestedRate('USD', 'VES')).resolves.toMatchObject({
      ok: false,
      error: { code: 'EXCHANGE_RATE_PROVIDER_NOT_CONFIGURED' }
    });

    expect(await relayFor(terminal).runBatch()).toBe(2);
    expect(deliveries(terminal).map((entry) => (entry as { status: string }).status))
      .toEqual(['PUBLISHED', 'PUBLISHED']);

    /**
     * LAN caída con Internet disponible: la operación local continúa —la salida
     * acepta el hecho— y la cola espera al coordinador sin perderlo.
     */
    const neighbour = second();
    await enqueueSale(neighbour, 1);
    const unreachablePort = coordinator.port + 1;

    expect(await relayFor(neighbour, unreachablePort).runBatch()).toBe(2);

    expect(deliveries(neighbour).map((entry) => (entry as { status: string }).status))
      .toEqual(['PENDING', 'PENDING']);
    expect(neighbour.handle.sqlite.prepare('select count(*) from outbox_event')
      .pluck().get()).toBe(2);
  });

  /**
   * Escenario 4 del plan de 10.04: detener al consumidor durante su aplicación.
   * La custodia ya está tomada, así que el emisor no repite nada; el receptor
   * retoma su trabajo sin duplicar el efecto.
   */
  it('retoma la aplicación interrumpida sin duplicar el efecto ni la auditoría', async () => {
    const terminal = first();
    await enqueueSale(terminal, 2);
    await grantAuthority(terminal);
    const relay = relayFor(terminal);
    await relay.runBatch();
    await relay.runBatch();

    /** El ciclo reclama el trabajo y el proceso cae antes de aplicarlo. */
    await coordinator.unitOfWork.execute(() => coordinator.workStore.claimPending(
      clock.now(), new Date(clock.now().getTime() + 30_000), 10
    ));
    expect(saleIssues()).toBe(0);

    /** Al vencer el lease, otro ciclo retoma esas mismas tareas. */
    moment = new Date('2026-09-06T12:30:00.000Z');
    await coordinator.processor.runBatch();
    moment = new Date('2026-09-06T12:35:00.000Z');
    await coordinator.processor.runBatch();
    moment = new Date('2026-09-06T12:40:00.000Z');
    await coordinator.processor.runBatch();

    expect(saleIssues()).toBe(1);
    expect(await balance()).toBe(8);
    expect(coordinator.handle.sqlite.prepare(
      "select count(*) from audit_log where action = 'SALE_STOCK_ISSUED'"
    ).pluck().get()).toBe(1);
    /** La salida de la terminal no volvió a enviar: la custodia ya era suya. */
    expect(deliveries(terminal).map((entry) => (entry as { status: string }).status))
      .toEqual(['PUBLISHED', 'PUBLISHED']);
  });

  /**
   * Escenario 11 del plan de 10.04: la reconciliación de una operación
   * distribuida consulta el progreso del coordinador por transporte real. Es
   * una lectura autenticada como cualquier otra: no reenvía el hecho.
   */
  it('concilia consultando el progreso real del coordinador, sin reenviar el hecho', async () => {
    const terminal = first();
    await enqueueSale(terminal, 2);
    await terminal.unitOfWork.execute(() => terminal.outbox.enqueue([
      saleReturnedEvent(terminal.nodeId, terminal.terminalId)
    ]));
    await grantAuthority(terminal);
    await claimAuthority(terminal, 'SaleReturn', `return-${terminal.terminalId}`);

    const operationStore = new SqliteCoordinatedOperationStore(terminal.handle);
    const coordinated = new application.CoordinatedStockOperations(
      operationStore,
      { coordinatorNodeId: COORDINATOR, isReachable: async () => true },
      clock,
      terminal.unitOfWork,
      ids
    );
    const started = await coordinated.begin({
      kind: 'SALE_RETURN',
      fingerprint: `return-${terminal.terminalId}`,
      reason: 'Devolución de prueba durante reconexión.'
    }, {
      actorId: 'user-001',
      actorRoleCodes: ['ADMIN'],
      terminalId: terminal.terminalId,
      originNodeId: terminal.nodeId,
      correlationId: `correlation-return-${terminal.terminalId}`
    });
    if (!started.ok) throw new Error('the coordinated operation should have started');
    await coordinated.recordLocalEffect(
      started.value.operationId,
      [`event-return-${terminal.terminalId}`],
      terminal.nodeId
    );

    const relay = relayFor(terminal);
    await relay.runBatch();

    const probe = new HttpsRemoteApplicationProbe({
      host: 'localhost',
      port: coordinator.port,
      destinationNodeId: COORDINATOR,
      key: (terminalCertificates[terminal.nodeId] as NodeCertificate).privateKeyPem,
      cert: (terminalCertificates[terminal.nodeId] as NodeCertificate).certificatePem,
      ca: [coordinatorCertificate.certificatePem],
      timeoutMilliseconds: 2_000
    });

    /** Con custodia y trabajo pendiente la intención sigue sin cerrar. */
    expect((await coordinated.reconcile(probe))[0]?.status).toBe('PENDING_RECONCILIATION');
    /** Un evento que este nodo no conoce nunca responde aplicado. */
    await expect(probe.applicationOf('event-que-no-existe')).resolves.toBe('PENDING');

    for (let cycle = 0; cycle < 3; cycle += 1) {
      moment = new Date(moment.getTime() + 300_000);
      await coordinator.processor.runBatch();
    }

    expect((await coordinated.reconcile(probe))[0]?.status).toBe('COMPLETED');
    expect((await operationStore.findById(started.value.operationId))?.status).toBe('COMPLETED');
    /** La consulta no reenvió nada ni cambió la salida de la terminal. */
    expect(deliveries(terminal)).toHaveLength(3);
    expect(deliveries(terminal).every(
      (entry) => (entry as { status: string }).status === 'PUBLISHED'
    )).toBe(true);
    expect(saleIssues()).toBe(1);
  });

  /**
   * Frontera previa de la devolución del escenario 11: la terminal pregunta al
   * coordinador qué salió realmente antes de tocar nada. Mientras la salida no
   * esté aplicada no hay evidencia con la que restituir, y la respuesta llega
   * por el mismo transporte autenticado que todo lo demás.
   */
  it('entrega la salida aplicada solo cuando el coordinador ya la aplicó', async () => {
    const terminal = first();
    await enqueueSale(terminal, 2);
    await grantAuthority(terminal);

    const probe = new HttpsRemoteSaleIssueProbe({
      host: 'localhost',
      port: coordinator.port,
      destinationNodeId: COORDINATOR,
      key: (terminalCertificates[terminal.nodeId] as NodeCertificate).privateKeyPem,
      cert: (terminalCertificates[terminal.nodeId] as NodeCertificate).certificatePem,
      ca: [coordinatorCertificate.certificatePem],
      timeoutMilliseconds: 2_000
    });
    const saleEventId = `event-sale-${terminal.terminalId}`;

    /** Sin custodia todavía, el coordinador no reconoce la venta. */
    await expect(probe.saleIssuesOf(saleEventId))
      .resolves.toEqual({ state: 'NONE', lines: [] });

    await relayFor(terminal).runBatch();
    /** Con custodia pero sin efecto aplicado, sigue sin haber qué restituir. */
    await expect(probe.saleIssuesOf(saleEventId))
      .resolves.toEqual({ state: 'PENDING', lines: [] });

    for (let cycle = 0; cycle < 3; cycle += 1) {
      moment = new Date(moment.getTime() + 300_000);
      await coordinator.processor.runBatch();
    }

    await expect(probe.saleIssuesOf(saleEventId)).resolves.toEqual({
      state: 'APPLIED',
      lines: [{
        saleItemId: `line-${terminal.terminalId}`,
        productId: 'product-1',
        stockItemId: 'stock-1',
        batchId: null,
        quantityScaled: 2,
        quantityScale: 0,
        unitCost: null
      }]
    });
    /** La consulta es una lectura: no aplicó otra salida ni movió el saldo. */
    expect(saleIssues()).toBe(1);
    expect(await balance()).toBe(8);
  });

  /**
   * La evidencia de la salida es tan sensible como cualquier otro hecho: un
   * cliente sin certificado confiable no la obtiene, aunque conozca el
   * `eventId`.
   */
  it('no entrega la salida aplicada a un cliente sin identidad confiable', async () => {
    const terminal = first();
    await enqueueSale(terminal, 2);
    await grantAuthority(terminal);
    await relayFor(terminal).runBatch();
    for (let cycle = 0; cycle < 3; cycle += 1) {
      moment = new Date(moment.getTime() + 300_000);
      await coordinator.processor.runBatch();
    }

    const intruder = issueNodeCertificate('node-intruso');
    const probe = new HttpsRemoteSaleIssueProbe({
      host: 'localhost',
      port: coordinator.port,
      destinationNodeId: COORDINATOR,
      key: intruder.privateKeyPem,
      cert: intruder.certificatePem,
      ca: [coordinatorCertificate.certificatePem],
      timeoutMilliseconds: 2_000
    });

    await expect(probe.saleIssuesOf(`event-sale-${terminal.terminalId}`))
      .resolves.toEqual({ state: 'UNKNOWN', lines: [] });
  });
});
