import { createHash } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { isAbsolute, join, relative, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  application,
  StockItem,
  type BusinessEventV1,
  type SyncNodeRegistration
} from '@supermarket/core';
import {
  applyMigrations,
  DrizzleAggregateAuthorityRegistry,
  DrizzleAuditWriter,
  DrizzleBusinessEventStore,
  DrizzleOutboxStore,
  DrizzleStockItemRepository,
  DrizzleSyncInboxWorkStore,
  DrizzleSyncReceptionStore,
  openDatabase,
  SqliteSyncNodeRegistry,
  SqliteUnitOfWork,
  type DatabaseHandle
} from '@supermarket/driver-db';
import { HttpsSyncEventPublisher } from '@supermarket/driver-security';
import { Money, Quantity } from '@supermarket/shared';
import type { FastifyInstance } from 'fastify';
import {
  buildSyncApp,
  SYNC_AGGREGATES_ROUTE,
  SYNC_DESTINATION_HEADER
} from '../src/sync/sync-app.ts';
import { issueNodeCertificate } from '../src/sync/testing/certificates.ts';

const COORDINATOR_NODE = 'perf-coordinator';
const TERMINAL_NODE = 'perf-terminal';
const TERMINAL_ID = 'perf-terminal-001';

type Coordinator = {
  readonly handle: DatabaseHandle;
  readonly app: FastifyInstance;
  readonly port: number;
  readonly processor: application.ProcessSyncInbox;
  readonly workStore: DrizzleSyncInboxWorkStore;
};

type Terminal = {
  readonly handle: DatabaseHandle;
  readonly outbox: DrizzleOutboxStore;
  readonly unitOfWork: SqliteUnitOfWork;
};

export type LanCycleMeasurement = {
  readonly deliveryMs: number;
  readonly applicationMs: number;
  readonly interruptedDeliveries: number;
  readonly durableReceipts: number;
  readonly appliedEvents: number;
  readonly authoritativeMovements: number;
};

const requireCondition = (condition: boolean, code: string): void => {
  if (!condition) throw new Error('PERF_LAN_DATASET_MISMATCH: ' + code);
};

const count = (handle: DatabaseHandle, sql: string, ...parameters: readonly string[]): number =>
  Number(handle.sqlite.prepare(sql).pluck().get(...parameters) ?? 0);

const timed = async (action: () => Promise<void>): Promise<number> => {
  const started = performance.now();
  await action();
  return performance.now() - started;
};

/**
 * Dos nodos efímeros con la misma composición que prueba la LAN de Fase 10.
 * Solo viven durante una repetición y sus certificados nunca salen a disco.
 */
export class LanCycleBenchmark {
  private readonly coordinatorCertificate = issueNodeCertificate(COORDINATOR_NODE);
  private readonly terminalCertificate = issueNodeCertificate(TERMINAL_NODE);

  constructor(private readonly artifactsDirectory: string) {}

  async run(run: number): Promise<LanCycleMeasurement> {
    const runDirectory = join(this.artifactsDirectory, 'lan-run-' + run);
    const child = relative(this.artifactsDirectory, runDirectory);
    if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) {
      throw new Error('PERF_LAN_ARTIFACT_PATH_INVALID');
    }
    mkdirSync(runDirectory, { recursive: true });
    let moment = new Date(Date.UTC(2026, 8, 6, 12 + run));
    const clock = { now: (): Date => moment };
    let generated = 0;
    const ids = { generate: (): string => 'perf-lan-generated-' + run + '-' + (++generated) };
    let coordinator: Coordinator | undefined;
    let terminal: Terminal | undefined;

    const registration = (
      overrides: Partial<SyncNodeRegistration> & Pick<SyncNodeRegistration, 'nodeId'>
    ): SyncNodeRegistration => ({
      storeId: 'perf-store',
      role: 'TERMINAL',
      terminalId: null,
      credentialFingerprint: '',
      addressHost: null,
      addressPort: null,
      notAfter: new Date('2027-01-01T00:00:00.000Z'),
      registeredAt: clock.now(),
      registeredBy: 'perf-operator',
      registrationReason: 'Alta controlada del escenario LAN de rendimiento.',
      ...overrides
    });

    const startCoordinator = async (seed: boolean): Promise<Coordinator> => {
      const handle = openDatabase(join(runDirectory, 'coordinator.sqlite'));
      applyMigrations(handle.sqlite);
      const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
      const authorities = new DrizzleAggregateAuthorityRegistry(handle);
      const workStore = new DrizzleSyncInboxWorkStore(handle);
      const registry = new SqliteSyncNodeRegistry(handle);
      const stockItems = new DrizzleStockItemRepository(handle);
      if (seed) {
        const stock = StockItem.create({
          id: 'perf-stock', productId: 'perf-product', unitCode: 'UND',
          quantityScale: 0, tracksBatches: false
        });
        stock.registerMovement({
          id: 'perf-opening-stock', eventId: 'perf-opening-event', type: 'PURCHASE_RECEIPT',
          quantity: Quantity.fromScaled(10, 0), actorId: 'perf-operator',
          reason: 'Inventario inicial del escenario LAN.', referenceId: 'perf-opening',
          occurredAt: clock.now(), unitCost: Money.fromMinorUnits(500, 'USD')
        });
        await unitOfWork.execute(() => stockItems.save(stock));
        await unitOfWork.execute(() => registry.register(registration({
          nodeId: COORDINATOR_NODE,
          role: 'COORDINATOR',
          credentialFingerprint: this.coordinatorCertificate.fingerprint
        })));
        await unitOfWork.execute(() => registry.register(registration({
          nodeId: TERMINAL_NODE,
          terminalId: TERMINAL_ID,
          credentialFingerprint: this.terminalCertificate.fingerprint
        })));
      }
      const app = buildSyncApp({
        receiverNodeId: COORDINATOR_NODE,
        resolveSender: new application.ResolveSyncSender(COORDINATOR_NODE, registry, clock),
        receiveSyncEvent: new application.ReceiveSyncEvent(
          COORDINATOR_NODE,
          new DrizzleSyncReceptionStore(handle),
          authorities,
          clock,
          unitOfWork,
          ids
        ),
        registerOwnedAggregate: new application.RegisterOwnedAggregate(
          authorities, clock, unitOfWork, ids, new DrizzleAuditWriter(handle)
        ),
        applicationProgress: (eventId) => workStore.applicationProgress(eventId),
        https: {
          key: this.coordinatorCertificate.privateKeyPem,
          cert: this.coordinatorCertificate.certificatePem,
          ca: [this.terminalCertificate.certificatePem]
        }
      }, { logDestination: { write: (): void => undefined } });
      await app.listen({ host: '127.0.0.1', port: 0 });
      const address = app.server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      requireCondition(port > 0, 'LAN_LISTENER_NOT_BOUND');
      return {
        handle,
        app,
        port,
        workStore,
        processor: new application.ProcessSyncInbox(
          workStore,
          new Map<string, application.SyncConsumer>([[
            'INVENTORY_AUTHORITY',
            new application.InventoryAuthorityConsumer(
              new application.ApplySaleCompletedToInventory(
                stockItems, ids, ids, application.ambientUnitOfWork,
                new DrizzleBusinessEventStore(handle), new DrizzleAuditWriter(handle),
                'SYNCED_SNAPSHOT'
              ),
              new application.ApplyPurchaseReceiptCompletedToInventory(
                stockItems, ids, ids, ids, application.ambientUnitOfWork,
                new DrizzleBusinessEventStore(handle), new DrizzleAuditWriter(handle),
                new DrizzleOutboxStore(handle)
              )
            )
          ]]),
          unitOfWork,
          clock,
          ids
        )
      };
    };

    const relay = (destinationPort: number): application.OutboxRelay => {
      if (!terminal) throw new Error('PERF_LAN_TERMINAL_NOT_OPEN');
      return new application.OutboxRelay(
        COORDINATOR_NODE,
        terminal.outbox,
        new HttpsSyncEventPublisher({
          host: 'localhost',
          port: destinationPort,
          destinationNodeId: COORDINATOR_NODE,
          key: this.terminalCertificate.privateKeyPem,
          cert: this.terminalCertificate.certificatePem,
          ca: [this.coordinatorCertificate.certificatePem],
          timeoutMilliseconds: 500
        }),
        terminal.unitOfWork,
        clock,
        { jitter: () => 0 }
      );
    };

    try {
      coordinator = await startCoordinator(true);
      const terminalHandle = openDatabase(join(runDirectory, 'terminal.sqlite'));
      applyMigrations(terminalHandle.sqlite);
      terminal = {
        handle: terminalHandle,
        outbox: new DrizzleOutboxStore(terminalHandle),
        unitOfWork: new SqliteUnitOfWork(terminalHandle.sqlite)
      };

      const suffix = String(run).padStart(4, '0');
      const event: BusinessEventV1 = {
        eventId: 'perf-purchase-event-' + suffix,
        eventType: 'PurchaseReceiptCompleted',
        contractVersion: 1,
        aggregateId: 'perf-purchase-' + suffix,
        aggregateType: 'PurchaseReceipt',
        aggregateVersion: 2,
        originNodeId: TERMINAL_NODE,
        correlationId: 'perf-lan-correlation-' + suffix,
        actorId: 'perf-operator',
        occurredAt: clock.now(),
        payload: {
          supplierId: 'perf-supplier',
          sourceType: 'INVOICE',
          sourceNumber: 'PERF-LAN-' + suffix,
          terminalId: TERMINAL_ID,
          reason: 'Recepción del escenario LAN.',
          lineCount: 1,
          lines: [{
            lineId: 'perf-purchase-line-' + suffix,
            productId: 'perf-product',
            stockItemId: 'perf-stock',
            unitCode: 'UND',
            quantityScaled: 1,
            quantityScale: 0,
            batchTracking: 'NOT_TRACKED',
            batch: null,
            valuationUnitCost: { minorUnits: 600, currencyCode: 'USD' }
          }]
        }
      };
      await terminal.unitOfWork.execute(() => terminal!.outbox.enqueue([event]));
      const authority = await this.claimAuthority(coordinator.port, event.aggregateId);
      requireCondition(authority === 200 || authority === 201, 'AUTHORITY_REGISTRATION_FAILED');

      const interruptedPort = coordinator.port;
      await coordinator.app.close();
      coordinator.handle.close();
      coordinator = undefined;
      requireCondition(await relay(interruptedPort).runBatch() === 1, 'INTERRUPTED_CLAIM_MISSING');
      requireCondition(
        count(terminal.handle, 'select count(*) from sync_delivery where status = ?', 'PENDING') === 1,
        'INTERRUPTED_DELIVERY_NOT_PENDING'
      );

      moment = new Date(moment.getTime() + 300_000);
      coordinator = await startCoordinator(false);
      const deliveryMs = await timed(async () => {
        requireCondition(await relay(coordinator!.port).runBatch() === 1, 'DELIVERY_NOT_CLAIMED');
      });
      const durableReceipts = count(
        coordinator.handle,
        'select count(*) from sync_inbox_event where event_id = ?',
        event.eventId
      );
      requireCondition(durableReceipts === 1, 'DURABLE_RECEIPT_MISSING');
      requireCondition(
        count(terminal.handle, 'select count(*) from sync_delivery where status = ?', 'PUBLISHED') === 1,
        'DELIVERY_NOT_PUBLISHED'
      );
      requireCondition(
        await coordinator.workStore.applicationProgress(event.eventId) === 'PENDING',
        'ACK_WAS_TREATED_AS_APPLICATION'
      );

      const applicationMs = await timed(async () => {
        requireCondition(await coordinator!.processor.runBatch() === 1, 'APPLICATION_NOT_CLAIMED');
      });
      const appliedEvents = await coordinator.workStore.applicationProgress(event.eventId) === 'APPLIED'
        ? 1
        : 0;
      const authoritativeMovements = count(
        coordinator.handle,
        'select count(*) from stock_movements where reference_id = ?',
        event.eventId + ':perf-purchase-line-' + suffix
      );
      requireCondition(appliedEvents === 1, 'APPLICATION_NOT_CONFIRMED');
      requireCondition(authoritativeMovements === 1, 'AUTHORITATIVE_EFFECT_MISSING');

      return {
        deliveryMs,
        applicationMs,
        interruptedDeliveries: 1,
        durableReceipts,
        appliedEvents,
        authoritativeMovements
      };
    } finally {
      await coordinator?.app.close();
      if (coordinator?.handle.sqlite.open) coordinator.handle.close();
      if (terminal?.handle.sqlite.open) terminal.handle.close();
      rmSync(runDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  private claimAuthority(port: number, aggregateId: string): Promise<number> {
    const body = JSON.stringify({
      aggregateType: 'PurchaseReceipt',
      aggregateId,
      evidenceFingerprint: createHash('sha256').update(aggregateId).digest('hex')
    });
    return new Promise((resolve, reject) => {
      const call = httpsRequest({
        host: 'localhost',
        port,
        path: SYNC_AGGREGATES_ROUTE,
        method: 'POST',
        ca: [this.coordinatorCertificate.certificatePem],
        key: this.terminalCertificate.privateKeyPem,
        cert: this.terminalCertificate.certificatePem,
        headers: {
          'content-type': 'application/json',
          [SYNC_DESTINATION_HEADER]: COORDINATOR_NODE
        }
      }, (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode ?? 0));
      });
      call.once('error', reject);
      call.end(body);
    });
  }
}
