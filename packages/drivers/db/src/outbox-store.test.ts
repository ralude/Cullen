import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  application,
  Category,
  UnitOfMeasure,
  type BusinessEventV1,
  type OutboxStore
} from '@supermarket/core';
import type { SyncEnvelopeV1 } from '@supermarket/shared';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { applyMigrations, migrations } from './migrations.js';
import { DrizzleOutboxStore } from './outbox-store.js';
import {
  DrizzleCategoryRepository,
  DrizzleProductRepository,
  DrizzleUnitOfMeasureRepository
} from './repositories.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

const COORDINATOR = 'node-coordinator';

const salePayload = {
  shiftId: 'shift-001',
  terminalId: 'terminal-001',
  total: { minorUnits: 1000, currencyCode: 'USD' },
  paidTotal: { minorUnits: 1000, currencyCode: 'USD' },
  payments: [{
    paymentId: 'payment-001',
    methodCode: 'CASH_USD',
    currencyCode: 'USD',
    amountMinorUnits: 1000
  }],
  items: [{ itemId: 'item-001', productId: 'product-001', quantityScaled: 1, quantityScale: 0 }]
};

const event = ({
  eventId = 'event-001', aggregateId = 'sale-001', aggregateVersion = 5,
  occurredAt = '2026-08-29T10:00:00Z', eventType = 'SaleCompleted'
}: Partial<{
  eventId: string;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
  eventType: string;
}> = {}): BusinessEventV1 => ({
  eventId, eventType, contractVersion: 1,
  aggregateId, aggregateType: 'Sale', aggregateVersion,
  originNodeId: 'node-001', correlationId: `correlation-${eventId}`, actorId: 'user-001',
  occurredAt: new Date(occurredAt), payload: salePayload
});

const receipt = (envelope: SyncEnvelopeV1, receiverNodeId = COORDINATOR): unknown => ({
  protocolVersion: 1,
  eventId: envelope.eventId,
  receiverNodeId,
  status: 'ACCEPTED',
  application: 'PENDING_CONSUMER'
});

const localStatuses = (handle: DatabaseHandle): unknown[] => handle.sqlite.prepare(
  'select event_id, status, last_error from outbox_event order by event_id'
).all();

const deliveries = (handle: DatabaseHandle): unknown[] => handle.sqlite.prepare(`
  select event_id, destination_node_id, status, attempts, cycle_attempts, last_error
  from sync_delivery order by event_id, destination_node_id
`).all();

const relayFor = (
  store: OutboxStore,
  publisher: { publish: (envelope: SyncEnvelopeV1) => Promise<unknown> },
  unitOfWork: SqliteUnitOfWork,
  now: () => Date,
  destinationNodeId = COORDINATOR
): application.OutboxRelay => new application.OutboxRelay(
  destinationNodeId, store, publisher, unitOfWork, { now }, { jitter: () => 0 }
);

describe('outbox delivery', () => {
  it('keeps enqueue idempotent, retries safely and publishes outside the transaction', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const store = new DrizzleOutboxStore(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const queued = event();
    await expect(unitOfWork.execute(async () => {
      await store.enqueue([queued]);
      throw new Error('rollback requested');
    })).rejects.toMatchObject({ code: 'DATABASE_OPERATION_FAILED' });
    expect(handle.sqlite.prepare('select count(*) from outbox_event').pluck().get()).toBe(0);
    await unitOfWork.execute(() => store.enqueue([queued, queued]));

    let now = new Date('2026-08-29T10:00:00Z');
    let attempts = 0;
    const relay = relayFor(store, {
      publish: async (published) => {
        expect(handle.sqlite.inTransaction).toBe(false);
        expect(published).toMatchObject({
          eventId: queued.eventId,
          eventType: queued.eventType,
          aggregateId: queued.aggregateId,
          occurredAt: queued.occurredAt.toISOString(),
          payload: queued.payload
        });
        attempts += 1;
        if (attempts === 1) throw new Error('Network unavailable.');
        return receipt(published);
      }
    }, unitOfWork, () => now);

    expect(await relay.runBatch()).toBe(1);
    expect(deliveries(handle)).toEqual([{
      event_id: 'event-001', destination_node_id: COORDINATOR, status: 'PENDING',
      attempts: 1, cycle_attempts: 1, last_error: 'EVENT_PUBLICATION_FAILED'
    }]);
    now = new Date('2026-08-29T10:00:02Z');
    expect(await relay.runBatch()).toBe(1);
    await unitOfWork.execute(() => store.enqueue([queued]));
    expect(await relay.runBatch()).toBe(0);
    expect(deliveries(handle)).toEqual([{
      event_id: 'event-001', destination_node_id: COORDINATOR, status: 'PUBLISHED',
      attempts: 2, cycle_attempts: 0, last_error: null
    }]);
    expect(localStatuses(handle)).toEqual([
      { event_id: 'event-001', status: 'PUBLISHED', last_error: null }
    ]);
    handle.close();
  });

  it('entrega a cada destino por separado y un ACK no confirma al vecino', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const store = new DrizzleOutboxStore(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    await unitOfWork.execute(() => store.enqueue([event({ eventId: 'reference-001' })]));
    const now = (): Date => new Date('2026-08-29T12:00:00Z');

    const first = await relayFor(store, {
      publish: async (envelope) => receipt(envelope, 'node-terminal-1')
    }, unitOfWork, now, 'node-terminal-1').runBatch();
    const second = await relayFor(store, {
      publish: async () => { throw new Error('terminal 2 unreachable'); }
    }, unitOfWork, now, 'node-terminal-2').runBatch();

    expect([first, second]).toEqual([1, 1]);
    expect(deliveries(handle)).toEqual([
      { event_id: 'reference-001', destination_node_id: 'node-terminal-1', status: 'PUBLISHED',
        attempts: 1, cycle_attempts: 0, last_error: null },
      { event_id: 'reference-001', destination_node_id: 'node-terminal-2', status: 'PENDING',
        attempts: 1, cycle_attempts: 1, last_error: 'EVENT_PUBLICATION_FAILED' }
    ]);
    /**
     * `outbox_event.status` es historia local del nodo, no autoridad de
     * entrega: solo resume los destinos ya materializados. La entrega a cada
     * terminal se consulta en `sync_delivery`, que sigue pendiente para la
     * terminal desconectada.
     */
    expect(await store.summarize('node-terminal-2')).toMatchObject({ pending: 1, paused: 0 });
    expect(await store.summarize('node-terminal-1')).toMatchObject({ pending: 0, paused: 0 });
    expect(handle.sqlite.prepare('select count(*) from outbox_event').pluck().get()).toBe(1);
    handle.close();
  });

  it('pausa de forma durable al agotar el ciclo y solo reanuda con autorización', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const store = new DrizzleOutboxStore(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    await unitOfWork.execute(() => store.enqueue([event()]));
    let moment = new Date('2026-08-29T12:00:00Z');
    const relay = relayFor(store, {
      publish: async () => { throw new Error('coordinator unreachable'); }
    }, unitOfWork, () => moment);

    for (let cycle = 0; cycle < 12; cycle += 1) {
      await relay.runBatch();
      moment = new Date(moment.getTime() + 120_000);
    }

    expect(deliveries(handle)).toEqual([{
      event_id: 'event-001', destination_node_id: COORDINATOR, status: 'PAUSED',
      attempts: 10, cycle_attempts: 10, last_error: 'EVENT_PUBLICATION_FAILED'
    }]);
    expect(await store.listPaused(COORDINATOR)).toMatchObject([{ eventId: 'event-001' }]);

    expect(await unitOfWork.execute(() => store.resumeDelivery(
      'event-001', COORDINATOR, moment, 'operator-001'
    ))).toBe(true);
    expect(deliveries(handle)).toEqual([{
      event_id: 'event-001', destination_node_id: COORDINATOR, status: 'PENDING',
      attempts: 10, cycle_attempts: 0, last_error: 'EVENT_PUBLICATION_FAILED'
    }]);
    handle.close();
  });

  it('applies the batch limit with a deterministic event-id tiebreak', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const store = new DrizzleOutboxStore(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    await unitOfWork.execute(() => store.enqueue([
      event({ eventId: 'event-c', aggregateId: 'sale-c' }),
      event({ eventId: 'event-a', aggregateId: 'sale-a' }),
      event({ eventId: 'event-b', aggregateId: 'sale-b' })
    ]));

    expect((await unitOfWork.execute(() => store.claimAvailable(
      COORDINATOR, new Date('2026-08-29T10:00:00Z'), new Date('2026-08-29T10:00:30Z'), 2
    ))).map(({ eventId }) => eventId)).toEqual(['event-a', 'event-b']);
    handle.close();
  });

  it('claims one head per aggregate and blocks successors until the head is published', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const store = new DrizzleOutboxStore(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const versionNine = event({
      eventId: 'event-009', aggregateVersion: 9, occurredAt: '2026-08-29T09:00:00Z'
    });
    const versionFive = event({
      eventId: 'event-005', aggregateVersion: 5, occurredAt: '2026-08-29T11:00:00Z'
    });
    const otherAggregate = event({
      eventId: 'event-other', aggregateId: 'sale-002', aggregateVersion: 2,
      occurredAt: '2026-08-29T10:00:00Z'
    });
    await unitOfWork.execute(() => store.enqueue([versionNine, versionFive, otherAggregate]));

    const now = new Date('2026-08-29T12:00:00Z');
    const claimed = await unitOfWork.execute(() => store.claimAvailable(
      COORDINATOR, now, new Date('2026-08-29T12:00:30Z'), 2
    ));
    expect(claimed.map(({ eventId }) => eventId)).toEqual(['event-other', 'event-005']);
    await unitOfWork.execute(() => store.markPublished('event-other', COORDINATOR, 1, now));
    await unitOfWork.execute(() => store.markFailed(
      'event-005', COORDINATOR, 1, new Date('2026-08-29T13:00:00Z'), 'EVENT_PUBLICATION_FAILED'
    ));
    expect(await unitOfWork.execute(() => store.claimAvailable(
      COORDINATOR, new Date('2026-08-29T12:30:00Z'), new Date('2026-08-29T12:30:30Z'), 10
    ))).toEqual([]);

    const retriedHead = await unitOfWork.execute(() => store.claimAvailable(
      COORDINATOR, new Date('2026-08-29T13:00:00Z'), new Date('2026-08-29T13:00:30Z'), 10
    ));
    expect(retriedHead.map(({ eventId, attempts }) => ({ eventId, attempts })))
      .toEqual([{ eventId: 'event-005', attempts: 2 }]);
    await unitOfWork.execute(() => store.markPublished('event-005', COORDINATOR, 2, now));
    expect((await unitOfWork.execute(() => store.claimAvailable(
      COORDINATOR, now, new Date('2026-08-29T13:01:00Z'), 10
    ))).map(({ eventId }) => eventId)).toEqual(['event-009']);
    handle.close();
  });

  it('rejects callbacks from a claim replaced after its lease expires', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const store = new DrizzleOutboxStore(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    await unitOfWork.execute(() => store.enqueue([event()]));
    const first = (await unitOfWork.execute(() => store.claimAvailable(
      COORDINATOR, new Date('2026-08-29T10:00:00Z'), new Date('2026-08-29T10:00:30Z'), 1
    )))[0];
    expect(first?.attempts).toBe(1);
    expect(await unitOfWork.execute(() => store.claimAvailable(
      COORDINATOR, new Date('2026-08-29T10:00:29Z'), new Date('2026-08-29T10:00:59Z'), 1
    ))).toEqual([]);

    const replacement = (await unitOfWork.execute(() => store.claimAvailable(
      COORDINATOR, new Date('2026-08-29T10:00:31Z'), new Date('2026-08-29T10:01:01Z'), 1
    )))[0];
    expect(replacement?.attempts).toBe(2);
    expect(await unitOfWork.execute(() => store.isClaimActive(
      'event-001', COORDINATOR, 1, new Date('2026-08-29T10:00:32Z')
    ))).toBe(false);
    expect(await unitOfWork.execute(() => store.markPublished(
      'event-001', COORDINATOR, 1, new Date('2026-08-29T10:00:32Z')
    ))).toBe(false);
    expect(await unitOfWork.execute(() => store.markFailed(
      'event-001', COORDINATOR, 1, new Date('2026-08-29T10:02:00Z'), 'STALE_FAILURE'
    ))).toBe(false);
    expect(await unitOfWork.execute(() => store.markBlocked(
      'event-001', COORDINATOR, 1, 'SYNC_EVENT_TYPE_UNKNOWN'
    ))).toBe(false);
    expect(await unitOfWork.execute(() => store.markPublished(
      'event-001', COORDINATOR, 2, new Date('2026-08-29T10:00:32Z')
    ))).toBe(true);
    handle.close();
  });

  it('isolates an unsupported persisted contract without stopping other aggregates', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const store = new DrizzleOutboxStore(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    await unitOfWork.execute(() => store.enqueue([
      event({ eventId: 'event-future', occurredAt: '2026-08-29T09:00:00Z' }),
      event({
        eventId: 'event-successor', aggregateVersion: 6, occurredAt: '2026-08-29T09:30:00Z'
      }),
      event({
        eventId: 'event-other', aggregateId: 'sale-002', occurredAt: '2026-08-29T10:00:00Z'
      })
    ]));
    handle.sqlite.prepare('update outbox_event set contract_version = 2 where event_id = ?')
      .run('event-future');

    const claimed = await unitOfWork.execute(() => store.claimAvailable(
      COORDINATOR, new Date('2026-08-29T10:00:00Z'), new Date('2026-08-29T10:00:30Z'), 10
    ));

    expect(claimed.map(({ eventId }) => eventId)).toEqual(['event-other']);
    expect(deliveries(handle)).toEqual([
      { event_id: 'event-future', destination_node_id: COORDINATOR, status: 'BLOCKED',
        attempts: 0, cycle_attempts: 0, last_error: 'OUTBOX_CONTRACT_VERSION_UNSUPPORTED' },
      { event_id: 'event-other', destination_node_id: COORDINATOR, status: 'PROCESSING',
        attempts: 1, cycle_attempts: 1, last_error: null },
      { event_id: 'event-successor', destination_node_id: COORDINATOR, status: 'PENDING',
        attempts: 0, cycle_attempts: 0, last_error: null }
    ]);
    expect((await unitOfWork.execute(() => store.claimAvailable(
      COORDINATOR, new Date('2026-08-29T11:00:00Z'), new Date('2026-08-29T11:00:30Z'), 10
    ))).map(({ eventId }) => eventId)).toEqual(['event-other']);
    handle.close();
  });

  it('blocks a contract the relay cannot deliver and keeps its evidence after reopening', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'supermarket-outbox-blocked-'));
    const databasePath = join(directory, 'node.sqlite');
    let handle: DatabaseHandle | undefined;
    try {
      handle = openDatabase(databasePath);
      applyMigrations(handle.sqlite);
      const store = new DrizzleOutboxStore(handle);
      const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
      await unitOfWork.execute(() => store.enqueue([
        event({ eventId: 'event-unknown', eventType: 'StockMovementRegistered' }),
        event({
          eventId: 'event-successor', aggregateVersion: 6, occurredAt: '2026-08-29T11:00:00Z'
        })
      ]));

      let published = 0;
      const relay = relayFor(store, {
        publish: async (envelope) => { published += 1; return receipt(envelope); }
      }, unitOfWork, () => new Date('2026-08-29T12:00:00Z'));
      expect(await relay.runBatch()).toBe(1);
      expect(published).toBe(0);
      expect(await relay.runBatch()).toBe(0);
      handle.close();

      handle = openDatabase(databasePath);
      expect(deliveries(handle)).toEqual([
        { event_id: 'event-successor', destination_node_id: COORDINATOR, status: 'PENDING',
          attempts: 0, cycle_attempts: 0, last_error: null },
        { event_id: 'event-unknown', destination_node_id: COORDINATOR, status: 'BLOCKED',
          attempts: 1, cycle_attempts: 1, last_error: 'SYNC_EVENT_TYPE_UNKNOWN' }
      ]);
      expect(handle.sqlite.prepare('select payload from outbox_event where event_id = ?')
        .pluck().get('event-unknown')).toBe(JSON.stringify(salePayload));
    } finally {
      if (handle?.sqlite.open) handle.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('upgrades the delivery schema without losing rows, states or attempts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'supermarket-outbox-upgrade-'));
    const databasePath = join(directory, 'node.sqlite');
    let handle: DatabaseHandle | undefined;
    try {
      handle = openDatabase(databasePath);
      applyMigrations(handle.sqlite, migrations.filter(({ version }) => version < 27));
      expect(() => handle?.sqlite.prepare(`
        insert into outbox_event values (
          'event-history', 'SaleCompleted', 1, 'sale-001', 'Sale', 5, 'node-001',
          'correlation-history', 'user-001', 1000, '{"a":1}', 'PROCESSING', 3, 2000, 5000,
          'EVENT_PUBLICATION_FAILED', null, 1000
        )
      `).run()).not.toThrow();
      expect(() => handle?.sqlite.prepare(
        "update outbox_event set status = 'BLOCKED'"
      ).run()).toThrow();

      expect(applyMigrations(handle.sqlite)).toEqual([27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37]);
      expect(handle.sqlite.prepare(
        'select event_id, status, attempts, last_error from outbox_event'
      ).all()).toEqual([{
        event_id: 'event-history', status: 'PROCESSING', attempts: 3,
        last_error: 'EVENT_PUBLICATION_FAILED'
      }]);
      /** El estado por destino no se rellena: una publicación local no acredita entrega LAN. */
      expect(handle.sqlite.prepare('select count(*) from sync_delivery').pluck().get()).toBe(0);
      expect(handle.sqlite.prepare(
        'select payload, lease_until, next_attempt_at, occurred_at from outbox_event'
      ).get()).toEqual({
        payload: '{"a":1}', lease_until: 5000, next_attempt_at: 2000, occurred_at: 1000
      });
      expect(() => handle?.sqlite.prepare(
        "update outbox_event set status = 'BLOCKED'"
      ).run()).not.toThrow();
      expect(() => handle?.sqlite.prepare(
        "update outbox_event set status = 'DISCARDED'"
      ).run()).toThrow();
    } finally {
      if (handle?.sqlite.open) handle.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preserves pending, processing and published states when reopening the database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'supermarket-outbox-states-'));
    const databasePath = join(directory, 'node.sqlite');
    let handle: DatabaseHandle | undefined;
    try {
      handle = openDatabase(databasePath);
      applyMigrations(handle.sqlite);
      let store = new DrizzleOutboxStore(handle);
      let unitOfWork = new SqliteUnitOfWork(handle.sqlite);
      await unitOfWork.execute(() => store.enqueue([
        event({ eventId: 'published', aggregateId: 'sale-published', occurredAt: '2026-08-29T09:00:00Z' }),
        event({ eventId: 'processing', aggregateId: 'sale-processing', occurredAt: '2026-08-29T10:00:00Z' }),
        event({ eventId: 'pending', aggregateId: 'sale-pending', occurredAt: '2026-08-29T11:00:00Z' })
      ]));
      const published = (await unitOfWork.execute(() => store.claimAvailable(
        COORDINATOR, new Date('2026-08-29T12:00:00Z'), new Date('2026-08-29T12:00:30Z'), 1
      )))[0];
      await unitOfWork.execute(() => store.markPublished(
        'published', COORDINATOR, published?.attempts ?? 0, new Date('2026-08-29T12:00:00Z')
      ));
      await unitOfWork.execute(() => store.claimAvailable(
        COORDINATOR, new Date('2026-08-29T12:00:00Z'), new Date('2026-08-29T12:00:30Z'), 1
      ));
      handle.close();

      handle = openDatabase(databasePath);
      store = new DrizzleOutboxStore(handle);
      unitOfWork = new SqliteUnitOfWork(handle.sqlite);
      expect(handle.sqlite.prepare(
        'select event_id, status, attempts from sync_delivery order by event_id'
      ).all()).toEqual([
        { event_id: 'pending', status: 'PENDING', attempts: 0 },
        { event_id: 'processing', status: 'PROCESSING', attempts: 1 },
        { event_id: 'published', status: 'PUBLISHED', attempts: 1 }
      ]);
      expect((await unitOfWork.execute(() => store.claimAvailable(
        COORDINATOR, new Date('2026-08-29T12:00:29Z'), new Date('2026-08-29T12:00:59Z'), 10
      ))).map(({ eventId }) => eventId)).toEqual(['pending']);
      expect((await unitOfWork.execute(() => store.claimAvailable(
        COORDINATOR, new Date('2026-08-29T12:00:31Z'), new Date('2026-08-29T12:01:01Z'), 10
      ))).map(({ eventId }) => eventId)).toEqual(['processing']);
    } finally {
      if (handle?.sqlite.open) handle.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('redelivers the same use-case event after an ambiguous confirmation and applies it once', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'supermarket-outbox-recovery-'));
    const databasePath = join(directory, 'node.sqlite');
    let handle: DatabaseHandle | undefined;
    try {
      handle = openDatabase(databasePath);
      applyMigrations(handle.sqlite);
      let store = new DrizzleOutboxStore(handle);
      let unitOfWork = new SqliteUnitOfWork(handle.sqlite);
      const categories = new DrizzleCategoryRepository(handle);
      const units = new DrizzleUnitOfMeasureRepository(handle);
      await unitOfWork.execute(async () => {
        await categories.save(Category.create({ id: 'category-001', name: 'Food' }));
        await units.save(UnitOfMeasure.create({
          id: 'unit-001', code: 'UNIT', name: 'Unit', quantityScale: 0
        }));
      });
      const ids = [
        'product-001', 'barcode-001', 'history-001', 'event-created', 'event-published'
      ];
      const createProduct = new application.CreateProduct(
        { generate: () => ids.shift() ?? 'unexpected-id' },
        new DrizzleProductRepository(handle), categories, units,
        { now: () => new Date('2026-09-05T10:00:00Z') },
        { authorize: async () => true }, unitOfWork, undefined, store
      );
      await expect(createProduct.execute({
        name: 'Rice', description: 'Rice 1kg', categoryId: 'category-001', unitCode: 'UNIT',
        barcodes: ['1234'], priceMinorUnits: 250, currencyCode: 'USD',
        taxRateBasisPoints: 1600, reason: 'Initial catalog'
      }, {
        actorId: 'user-001', terminalId: 'terminal-001', originNodeId: 'node-001',
        correlationId: 'correlation-create'
      })).resolves.toMatchObject({ ok: true });

      let confirmationFails = true;
      const ambiguousStore: OutboxStore = {
        enqueue: (events) => store.enqueue(events),
        claimAvailable: (destination, now, leaseUntil, limit) =>
          store.claimAvailable(destination, now, leaseUntil, limit),
        isClaimActive: (eventId, destination, attempts, now) =>
          store.isClaimActive(eventId, destination, attempts, now),
        markFailed: (eventId, destination, attempts, nextAttemptAt, errorCode) =>
          store.markFailed(eventId, destination, attempts, nextAttemptAt, errorCode),
        markBlocked: (eventId, destination, attempts, errorCode) =>
          store.markBlocked(eventId, destination, attempts, errorCode),
        markPaused: (eventId, destination, attempts, errorCode) =>
          store.markPaused(eventId, destination, attempts, errorCode),
        resumeDelivery: (eventId, destination, now, resumedBy) =>
          store.resumeDelivery(eventId, destination, now, resumedBy),
        summarize: (destination) => store.summarize(destination),
        listPaused: (destination) => store.listPaused(destination),
        markPublished: async (eventId, destination, attempts, publishedAt) => {
          if (confirmationFails) {
            confirmationFails = false;
            throw new Error('confirmation unavailable');
          }
          return store.markPublished(eventId, destination, attempts, publishedAt);
        }
      };
      const received = new Set<string>();
      let deliveryCount = 0;
      const publisher = { publish: async (envelope: SyncEnvelopeV1) => {
        deliveryCount += 1;
        received.add(envelope.eventId);
        return receipt(envelope);
      } };
      await expect(relayFor(
        ambiguousStore, publisher, unitOfWork, () => new Date('2026-09-05T10:00:00Z')
      ).runBatch()).rejects.toMatchObject({ code: 'DATABASE_OPERATION_FAILED' });
      handle.close();

      handle = openDatabase(databasePath);
      store = new DrizzleOutboxStore(handle);
      unitOfWork = new SqliteUnitOfWork(handle.sqlite);
      expect(await relayFor(
        store, publisher, unitOfWork, () => new Date('2026-09-05T10:00:31Z')
      ).runBatch()).toBe(1);
      expect(deliveryCount).toBe(2);
      expect([...received]).toEqual(['event-published']);
      const persisted = handle.sqlite.prepare(`
        select outbox_event.status as status, delivery.attempts as attempts,
          event_type, contract_version, origin_node_id, correlation_id, actor_id, payload
        from outbox_event
        join sync_delivery delivery on delivery.event_id = outbox_event.event_id
      `).get() as Record<string, unknown>;
      expect({ ...persisted, payload: JSON.parse(String(persisted.payload)) }).toEqual({
        status: 'PUBLISHED', attempts: 2, event_type: 'ProductPublished',
        contract_version: 1, origin_node_id: 'node-001',
        correlation_id: 'correlation-create', actor_id: 'user-001',
        payload: {
          name: 'Rice', description: 'Rice 1kg', categoryId: 'category-001',
          unitId: 'unit-001', unitCode: 'UNIT', isActive: 'ACTIVE',
          barcodes: [{ barcodeId: 'barcode-001', code: '1234', isActive: 'ACTIVE' }],
          price: { minorUnits: 250, currencyCode: 'USD' }, taxRate: { basisPoints: 1600 }
        }
      });
    } finally {
      if (handle?.sqlite.open) handle.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
