import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { application, type SyncSenderContext } from '@supermarket/core';
import type { SyncEnvelopeV1 } from '@supermarket/shared';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleAggregateAuthorityRegistry } from './sync-authority-registry.js';
import { DrizzleSyncReceptionStore } from './sync-reception-store.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

const clock = { now: (): Date => new Date('2026-09-06T12:00:00.000Z') };

const salePayload = {
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
  items: [{ itemId: 'item-001', productId: 'product-001', quantityScaled: 2, quantityScale: 0 }]
};

const saleEnvelope = (overrides: Partial<SyncEnvelopeV1> = {}): SyncEnvelopeV1 => ({
  protocolVersion: 1,
  eventId: 'event-001',
  eventType: 'SaleCompleted',
  contractVersion: 1,
  aggregateId: 'sale-001',
  aggregateType: 'Sale',
  aggregateVersion: 4,
  originNodeId: 'node-terminal',
  correlationId: 'correlation-001',
  actorId: 'user-001',
  occurredAt: '2026-09-06T10:00:00.000Z',
  payload: salePayload,
  ...overrides
});

const sender: SyncSenderContext = {
  verifiedNodeId: 'node-terminal',
  verifiedTerminalId: 'terminal-001',
  coordinatorNodeId: 'node-coordinator'
};

let issued = 0;
const ids = { generate: (): string => `quarantine-${(issued += 1)}` };

const receiverFor = (handle: DatabaseHandle): application.ReceiveSyncEvent =>
  new application.ReceiveSyncEvent(
    'node-coordinator',
    new DrizzleSyncReceptionStore(handle),
    new DrizzleAggregateAuthorityRegistry(handle),
    clock,
    new SqliteUnitOfWork(handle.sqlite),
    ids
  );

const grantAuthority = async (
  handle: DatabaseHandle,
  aggregateType: string,
  aggregateId: string,
  ownerNodeId = 'node-terminal'
): Promise<void> => {
  const registry = new DrizzleAggregateAuthorityRegistry(handle);
  await new SqliteUnitOfWork(handle.sqlite).execute(() => registry.register({
    aggregateType,
    aggregateId,
    ownerNodeId,
    source: 'MANUAL',
    evidenceFingerprint: `evidence-${aggregateId}`,
    registeredAt: clock.now(),
    registeredBy: 'operator-001'
  }));
};

const openMigrated = (path: string): DatabaseHandle => {
  const handle = openDatabase(path);
  applyMigrations(handle.sqlite);
  return handle;
};

describe('recepción durable de sincronización', () => {
  it('registra custodia y trabajo de aplicación en una sola transacción', async () => {
    const handle = openMigrated(':memory:');
    await grantAuthority(handle, 'Sale', 'sale-001');
    await grantAuthority(handle, 'Shift', 'shift-001');
    await receiverFor(handle).execute({
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
    }, sender);

    const receipt = await receiverFor(handle).execute(saleEnvelope(), sender);

    expect(receipt).toMatchObject({ status: 'ACCEPTED', application: 'PENDING_CONSUMER' });
    expect(handle.sqlite.prepare(
      'select consumer, state, attempts from sync_inbox_work where event_id = ? order by consumer'
    ).all('event-001')).toEqual([
      { consumer: 'COMMERCIAL_PROJECTION', state: 'PENDING', attempts: 0 },
      { consumer: 'INVENTORY_AUTHORITY', state: 'PENDING', attempts: 0 }
    ]);
    handle.close();
  });

  it('no deja custodia ni trabajo cuando la transacción falla', async () => {
    const handle = openMigrated(':memory:');
    await grantAuthority(handle, 'Sale', 'sale-001');
    const store = new DrizzleSyncReceptionStore(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);

    await expect(unitOfWork.execute(async () => {
      await store.record({
        envelope: saleEnvelope(),
        application: 'PENDING_CONSUMER',
        receivedAt: clock.now(),
        senderNodeId: 'node-terminal',
        consumers: ['INVENTORY_AUTHORITY']
      });
      throw new Error('reception interrupted before commit');
    })).rejects.toMatchObject({ code: 'DATABASE_OPERATION_FAILED' });

    expect(handle.sqlite.prepare('select count(*) from sync_inbox_event').pluck().get()).toBe(0);
    expect(handle.sqlite.prepare('select count(*) from sync_inbox_work').pluck().get()).toBe(0);
    handle.close();
  });

  it('no confirma custodia ni deja trabajo cuando SQLite está ocupado', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sync-reception-busy-'));
    const path = join(directory, 'coordinator.db');
    const handle = openMigrated(path);
    await grantAuthority(handle, 'Sale', 'sale-001');
    const blocker = new Database(path);
    handle.sqlite.pragma('busy_timeout = 0');
    blocker.pragma('busy_timeout = 0');
    blocker.exec('begin immediate');

    const receipt = await receiverFor(handle).execute(saleEnvelope(), sender);

    expect(receipt).toMatchObject({
      status: 'RETRYABLE',
      code: 'SYNC_RECEIVER_UNAVAILABLE'
    });
    expect(handle.sqlite.prepare('select count(*) from sync_inbox_event').pluck().get()).toBe(0);
    expect(handle.sqlite.prepare('select count(*) from sync_inbox_work').pluck().get()).toBe(0);

    blocker.exec('rollback');
    blocker.close();
    handle.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('arbitra dos entregas concurrentes idénticas con una sola custodia', async () => {
    const handle = openMigrated(':memory:');
    await grantAuthority(handle, 'Sale', 'sale-001');
    const first = receiverFor(handle);
    const second = receiverFor(handle);

    const receipts = [
      await first.execute(saleEnvelope(), sender),
      await second.execute(saleEnvelope(), sender)
    ];

    expect(receipts.map(({ status }) => status)).toEqual(['ACCEPTED', 'DUPLICATE']);
    expect(receipts.every((entry) => 'application' in entry &&
      entry.application === 'PENDING_DEPENDENCY')).toBe(true);
    expect(handle.sqlite.prepare('select count(*) from sync_inbox_event').pluck().get()).toBe(1);
    expect(handle.sqlite.prepare('select count(*) from sync_inbox_work').pluck().get()).toBe(2);
    handle.close();
  });

  it('rechaza el mismo ID con otro contenido y conserva el original en cuarentena', async () => {
    const handle = openMigrated(':memory:');
    await grantAuthority(handle, 'Sale', 'sale-001');
    const receiver = receiverFor(handle);
    await receiver.execute(saleEnvelope(), sender);

    const conflict = await receiver.execute(saleEnvelope({ actorId: 'user-002' }), sender);

    expect(conflict).toMatchObject({
      status: 'REJECTED',
      code: 'SYNC_EVENT_IDENTITY_CONFLICT'
    });
    expect(handle.sqlite.prepare('select actor_id from sync_inbox_event').pluck().get())
      .toBe('user-001');
    expect(handle.sqlite.prepare(
      'select declared_event_id, sender_node_id, reason_code from sync_quarantine'
    ).all()).toEqual([{
      declared_event_id: 'event-001',
      sender_node_id: 'node-terminal',
      reason_code: 'SYNC_EVENT_IDENTITY_CONFLICT'
    }]);
    handle.close();
  });

  it('conserva la custodia como inmutable', async () => {
    const handle = openMigrated(':memory:');
    await grantAuthority(handle, 'Sale', 'sale-001');
    await receiverFor(handle).execute(saleEnvelope(), sender);

    expect(() => handle.sqlite.exec(
      "update sync_inbox_event set application_state = 'PENDING_CONSUMER'"
    )).toThrow(/immutable/);
    expect(() => handle.sqlite.exec('delete from sync_inbox_event')).toThrow(/cannot be deleted/);
    handle.close();
  });

  it('no reasigna autoridad ante evidencia contradictoria', async () => {
    const handle = openMigrated(':memory:');
    const registry = new DrizzleAggregateAuthorityRegistry(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const registration = {
      aggregateType: 'Sale',
      aggregateId: 'sale-777',
      ownerNodeId: 'node-terminal',
      source: 'DELEGATED' as const,
      evidenceFingerprint: 'evidence-a',
      registeredAt: clock.now(),
      registeredBy: 'node-terminal'
    };

    const first = await unitOfWork.execute(() => registry.register(registration));
    const repeated = await unitOfWork.execute(() => registry.register(registration));
    const contradiction = await unitOfWork.execute(() => registry.register({
      ...registration, ownerNodeId: 'node-other', evidenceFingerprint: 'evidence-b'
    }));

    expect(first).toEqual({ outcome: 'REGISTERED', ownerNodeId: 'node-terminal' });
    expect(repeated).toEqual({ outcome: 'ALREADY_REGISTERED', ownerNodeId: 'node-terminal' });
    expect(contradiction).toEqual({ outcome: 'CONFLICT', ownerNodeId: 'node-terminal' });
    handle.close();
  });

  it('conserva custodia, autoridad y trabajo tras reabrir la base', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sync-reception-'));
    const path = join(directory, 'coordinator.db');
    const handle = openMigrated(path);
    await grantAuthority(handle, 'Sale', 'sale-001');
    const accepted = await receiverFor(handle).execute(saleEnvelope(), sender);
    handle.close();

    const reopened = openMigrated(path);
    const repeated = await receiverFor(reopened).execute(saleEnvelope(), sender);

    expect(accepted).toMatchObject({ status: 'ACCEPTED', application: 'PENDING_DEPENDENCY' });
    expect(repeated).toMatchObject({ status: 'DUPLICATE', application: 'PENDING_DEPENDENCY' });
    expect(reopened.sqlite.prepare('select count(*) from sync_inbox_work').pluck().get()).toBe(2);
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
