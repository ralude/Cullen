import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { application, type BusinessEventV1, type ExecutionContext } from '@supermarket/core';
import { DrizzleBusinessEventStore } from './business-event-store.js';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

const businessEvent = (
  version: number,
  eventType: string,
  payload: BusinessEventV1['payload']
): BusinessEventV1 => ({
  eventId: `event-${version}`, eventType, contractVersion: 1,
  aggregateId: 'sale-001', aggregateType: 'Sale', aggregateVersion: version,
  originNodeId: 'node-001', correlationId: 'correlation-001', actorId: 'user-001',
  occurredAt: new Date(`2026-08-29T10:0${version}:00Z`), payload
});

const context: ExecutionContext = {
  actorId: 'user-001', terminalId: 'terminal-001', originNodeId: 'node-001', correlationId: 'correlation-001'
};
const noReturns = { save: async () => {}, findById: async () => null, findBySaleId: async () => null };
const allowHistory = { authorize: async () => true };

describe('GetSaleHistory with persisted ledger', () => {
  it('projects every sale version after a database restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'supermarket-history-'));
    const databasePath = join(directory, 'node.sqlite');
    const first = openDatabase(databasePath);
    applyMigrations(first.sqlite);
    const events = [
      businessEvent(1, 'SaleStarted', { currencyCode: 'USD' }),
      businessEvent(2, 'SaleItemAdded', { itemId: 'item-001', productId: 'product-001' }),
      businessEvent(3, 'DiscountApplied', {
        itemId: 'item-001', amount: { minorUnits: 100, currencyCode: 'USD' }
      }),
      businessEvent(4, 'PaymentRegistered', {
        amountInSaleCurrency: { minorUnits: 1044, currencyCode: 'USD' }
      }),
      businessEvent(5, 'SaleCompleted', {
        total: { minorUnits: 1044, currencyCode: 'USD' }
      })
    ];
    await new SqliteUnitOfWork(first.sqlite).execute(() =>
      new DrizzleBusinessEventStore(first).append(events)
    );
    first.close();

    const restarted = openDatabase(databasePath);
    const result = await new application.GetSaleHistory(
      new DrizzleBusinessEventStore(restarted), noReturns, allowHistory
    ).execute({ saleId: 'sale-001' }, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((version) => version.version)).toEqual([1, 2, 3, 4, 5]);
      expect(result.value[1]?.itemIds).toEqual(['item-001']);
      expect(result.value[2]?.discountTotalMinorUnits).toBe(100);
      expect(result.value[3]?.paymentTotalMinorUnits).toBe(1044);
      expect(result.value[4]).toMatchObject({ status: 'COMPLETED', totalMinorUnits: 1044 });
    }
    restarted.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('returns a stable not-found error without consulting relational Sale state', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const result = await new application.GetSaleHistory(
      new DrizzleBusinessEventStore(handle), noReturns, allowHistory
    ).execute({ saleId: 'missing' }, context);
    expect(result).toMatchObject({ ok: false, error: { code: 'SALE_HISTORY_NOT_FOUND' } });
    handle.close();
  });
});
