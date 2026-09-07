import { describe, expect, it } from 'vitest';
import type { SyncEnvelopeV1 } from '@supermarket/shared';
import type { Clock, EventPublisher, OutboxEvent, OutboxStore, UnitOfWork } from '../ports/index.js';
import { OutboxRelay, OUTBOX_RETRY_POLICY_V1 } from './outbox-relay.js';

const DESTINATION = 'node-coordinator';

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

const event = (
  eventId: string,
  attempts = 1,
  overrides: Partial<OutboxEvent> = {}
): OutboxEvent => ({
  eventId,
  eventType: 'SaleCompleted',
  contractVersion: 1,
  aggregateId: `sale-${eventId}`,
  aggregateType: 'Sale',
  aggregateVersion: 1,
  originNodeId: 'node-001',
  correlationId: `correlation-${eventId}`,
  actorId: 'user-001',
  occurredAt: new Date('2026-09-05T10:00:00Z'),
  payload: salePayload,
  status: 'PROCESSING',
  attempts,
  cycleAttempts: attempts,
  ...overrides
});

const receipt = (envelope: SyncEnvelopeV1, receiverNodeId = DESTINATION): unknown => ({
  protocolVersion: 1,
  eventId: envelope.eventId,
  receiverNodeId,
  status: 'ACCEPTED',
  application: 'PENDING_CONSUMER'
});

class FakeUnitOfWork implements UnitOfWork {
  inTransaction = false;

  async execute<T>(work: () => Promise<T>): Promise<T> {
    this.inTransaction = true;
    try {
      return await work();
    } finally {
      this.inTransaction = false;
    }
  }
}

const clock: Clock = { now: () => new Date('2026-09-05T10:00:00Z') };

const storeWith = (overrides: Partial<OutboxStore>): OutboxStore => ({
  enqueue: async () => undefined,
  claimAvailable: async () => [],
  isClaimActive: async () => false,
  markPublished: async () => false,
  markFailed: async () => false,
  markBlocked: async () => false,
  markPaused: async () => false,
  resumeDelivery: async () => false,
  summarize: async (destinationNodeId) => ({
    destinationNodeId, pending: 0, paused: 0, blocked: 0, lastPublishedAt: null, lastError: null
  }),
  listPaused: async () => [],
  ...overrides
});

const confirmingPublisher: EventPublisher = { publish: async (envelope) => receipt(envelope) };

const relayFor = (
  store: OutboxStore,
  publisher: EventPublisher,
  unitOfWork: UnitOfWork = new FakeUnitOfWork()
): OutboxRelay => new OutboxRelay(DESTINATION, store, publisher, unitOfWork, clock, {
  jitter: () => 0
});

describe('OutboxRelay', () => {
  it('publishes only active claims and never holds the unit of work while publishing', async () => {
    const unitOfWork = new FakeUnitOfWork();
    const published: string[] = [];
    const store = storeWith({
      claimAvailable: async () => [event('001'), event('002')],
      isClaimActive: async (eventId) => eventId === '001',
      markPublished: async () => true
    });
    const publisher: EventPublisher = {
      publish: async (envelope) => {
        expect(unitOfWork.inTransaction).toBe(false);
        published.push(envelope.eventId);
        return receipt(envelope);
      }
    };

    await expect(relayFor(store, publisher, unitOfWork).runBatch()).resolves.toBe(1);
    expect(published).toEqual(['001']);
  });

  it('reclama y confirma solo el destino que le corresponde', async () => {
    const seen: string[] = [];
    const store = storeWith({
      claimAvailable: async (destinationNodeId) => {
        seen.push(`claim:${destinationNodeId}`);
        return [event('001')];
      },
      isClaimActive: async () => true,
      markPublished: async (_eventId, destinationNodeId) => {
        seen.push(`published:${destinationNodeId}`);
        return true;
      }
    });

    await new OutboxRelay('node-terminal-2', store, {
      publish: async (envelope) => receipt(envelope, 'node-terminal-2')
    }, new FakeUnitOfWork(), clock, { jitter: () => 0 }).runBatch();

    expect(seen).toEqual(['claim:node-terminal-2', 'published:node-terminal-2']);
  });

  it('sends the allowed envelope fields without outbox delivery state', async () => {
    let sent: SyncEnvelopeV1 | undefined;
    const store = storeWith({
      claimAvailable: async () => [event('001', 4)],
      isClaimActive: async () => true,
      markPublished: async () => true
    });

    await relayFor(store, {
      publish: async (envelope) => {
        sent = envelope;
        return receipt(envelope);
      }
    }).runBatch();

    expect(sent).toEqual({
      protocolVersion: 1,
      eventId: '001',
      eventType: 'SaleCompleted',
      contractVersion: 1,
      aggregateId: 'sale-001',
      aggregateType: 'Sale',
      aggregateVersion: 1,
      originNodeId: 'node-001',
      correlationId: 'correlation-001',
      actorId: 'user-001',
      occurredAt: '2026-09-05T10:00:00.000Z',
      payload: salePayload
    });
    expect(Object.keys(sent ?? {})).not.toContain('attempts');
    expect(Object.keys(sent ?? {})).not.toContain('status');
  });

  it('reprograms a publisher failure using the claimed generation', async () => {
    const failed: Array<{ eventId: string; attempts: number; errorCode: string }> = [];
    const store = storeWith({
      claimAvailable: async () => [event('001', 3)],
      isClaimActive: async () => true,
      markFailed: async (eventId, _destination, attempts, _nextAttemptAt, errorCode) => {
        failed.push({ eventId, attempts, errorCode });
        return true;
      }
    });

    const relay = relayFor(store, {
      publish: async () => { throw new Error('network details'); }
    });

    await expect(relay.runBatch()).resolves.toBe(1);
    expect(failed).toEqual([{
      eventId: '001', attempts: 3, errorCode: 'EVENT_PUBLICATION_FAILED'
    }]);
  });

  it('aplica backoff con base de un segundo y tope de sesenta', async () => {
    const delays: number[] = [];
    const store = storeWith({
      isClaimActive: async () => true,
      markFailed: async (_eventId, _destination, _attempts, nextAttemptAt) => {
        delays.push(nextAttemptAt.getTime() - clock.now().getTime());
        return true;
      }
    });

    for (const cycleAttempts of [1, 2, 3, 8]) {
      await new OutboxRelay(DESTINATION, storeWith({
        ...store,
        claimAvailable: async () => [event('001', cycleAttempts, { cycleAttempts })]
      }), { publish: async () => { throw new Error('offline'); } },
      new FakeUnitOfWork(), clock, { jitter: () => 0 }).runBatch();
    }

    expect(delays).toEqual([1_000, 2_000, 4_000, 60_000]);
  });

  it('pausa de forma durable al agotar el presupuesto del ciclo', async () => {
    const paused: Array<{ eventId: string; attempts: number; errorCode: string }> = [];
    let rescheduled = 0;
    const store = storeWith({
      claimAvailable: async () => [event('001', 12, {
        cycleAttempts: OUTBOX_RETRY_POLICY_V1.attemptsPerCycle
      })],
      isClaimActive: async () => true,
      markFailed: async () => { rescheduled += 1; return true; },
      markPaused: async (eventId, _destination, attempts, errorCode) => {
        paused.push({ eventId, attempts, errorCode });
        return true;
      }
    });

    await expect(relayFor(store, {
      publish: async () => { throw new Error('offline'); }
    }).runBatch()).resolves.toBe(1);

    expect(rescheduled).toBe(0);
    expect(paused).toEqual([{
      eventId: '001', attempts: 12, errorCode: 'EVENT_PUBLICATION_FAILED'
    }]);
  });

  it('isolates a local contract that the catalog cannot deliver, without publishing it', async () => {
    const blocked: Array<{ eventId: string; attempts: number; errorCode: string }> = [];
    let publishes = 0;
    const store = storeWith({
      claimAvailable: async () => [
        event('unknown-type', 2, { eventType: 'StockMovementRegistered' }),
        event('invalid-payload', 5, { payload: { shiftId: 'shift-001' } })
      ],
      isClaimActive: async () => true,
      markBlocked: async (eventId, _destination, attempts, errorCode) => {
        blocked.push({ eventId, attempts, errorCode });
        return true;
      }
    });

    const relay = relayFor(store, {
      publish: async (envelope) => {
        publishes += 1;
        return receipt(envelope);
      }
    });

    await expect(relay.runBatch()).resolves.toBe(2);
    expect(publishes).toBe(0);
    expect(blocked).toEqual([
      { eventId: 'unknown-type', attempts: 2, errorCode: 'SYNC_EVENT_TYPE_UNKNOWN' },
      { eventId: 'invalid-payload', attempts: 5, errorCode: 'SYNC_PAYLOAD_INVALID' }
    ]);
  });

  it.each([
    ['un ACK vacío', () => undefined],
    ['un ACK de otro evento', (envelope: SyncEnvelopeV1) => ({
      ...(receipt(envelope) as Record<string, unknown>), eventId: 'other-event'
    })],
    ['un ACK de otro destino', (envelope: SyncEnvelopeV1) => receipt(envelope, 'node-intruder')],
    ['un ACK con código inseguro', () => ({
      protocolVersion: 1,
      eventId: '001',
      receiverNodeId: DESTINATION,
      status: 'REJECTED',
      code: 'payload: 4111 1111 1111 1111'
    })]
  ])('does not confirm delivery with %s', async (_case, ack) => {
    let publishedRows = 0;
    const failed: string[] = [];
    const store = storeWith({
      claimAvailable: async () => [event('001')],
      isClaimActive: async () => true,
      markPublished: async () => { publishedRows += 1; return true; },
      markFailed: async (_eventId, _destination, _attempts, _nextAttemptAt, errorCode) => {
        failed.push(errorCode);
        return true;
      }
    });

    const relay = relayFor(store, { publish: async (envelope) => ack(envelope) });

    await expect(relay.runBatch()).resolves.toBe(1);
    expect(publishedRows).toBe(0);
    expect(failed).toEqual(['SYNC_ACK_INVALID']);
  });

  it('blocks a permanent remote rejection and retries a transient one', async () => {
    const outcomes: string[] = [];
    const store = storeWith({
      claimAvailable: async () => [event('rejected'), event('retryable')],
      isClaimActive: async () => true,
      markBlocked: async (eventId, _destination, _attempts, errorCode) => {
        outcomes.push(`blocked:${eventId}:${errorCode}`);
        return true;
      },
      markFailed: async (eventId, _destination, _attempts, _nextAttemptAt, errorCode) => {
        outcomes.push(`failed:${eventId}:${errorCode}`);
        return true;
      }
    });

    const relay = relayFor(store, {
      publish: async (envelope) => ({
        protocolVersion: 1,
        eventId: envelope.eventId,
        receiverNodeId: DESTINATION,
        status: envelope.eventId === 'rejected' ? 'REJECTED' : 'RETRYABLE',
        code: envelope.eventId === 'rejected'
          ? 'SYNC_SENDER_NOT_AUTHORIZED'
          : 'SYNC_RECEIVER_UNAVAILABLE'
      })
    });

    await expect(relay.runBatch()).resolves.toBe(2);
    expect(outcomes).toEqual([
      'blocked:rejected:SYNC_SENDER_NOT_AUTHORIZED',
      'failed:retryable:SYNC_RECEIVER_UNAVAILABLE'
    ]);
  });

  it('accepts a durable duplicate as a confirmed delivery', async () => {
    const store = storeWith({
      claimAvailable: async () => [event('001')],
      isClaimActive: async () => true,
      markPublished: async () => true
    });

    const relay = relayFor(store, {
      publish: async (envelope) => ({
        protocolVersion: 1,
        eventId: envelope.eventId,
        receiverNodeId: DESTINATION,
        status: 'DUPLICATE',
        application: 'PENDING_CONSUMER'
      })
    });

    await expect(relay.runBatch()).resolves.toBe(1);
  });

  it('does not disguise a confirmation persistence failure as a publisher failure', async () => {
    let markedFailed = false;
    const store = storeWith({
      claimAvailable: async () => [event('001')],
      isClaimActive: async () => true,
      markPublished: async () => { throw new Error('confirmation unavailable'); },
      markFailed: async () => { markedFailed = true; return true; }
    });

    const relay = relayFor(store, confirmingPublisher);

    await expect(relay.runBatch()).rejects.toThrow('confirmation unavailable');
    expect(markedFailed).toBe(false);
  });

  it.each([0, -1, 1.5, 101])('rejects an invalid batch limit: %s', async (limit) => {
    const relay = relayFor(storeWith({}), confirmingPublisher);

    await expect(relay.runBatch(limit)).rejects.toMatchObject({ code: 'OUTBOX_BATCH_LIMIT_INVALID' });
  });
});
