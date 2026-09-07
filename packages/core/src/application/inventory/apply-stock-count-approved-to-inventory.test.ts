import { describe, expect, it } from 'vitest';
import { Quantity } from '@supermarket/shared';
import { StockItem } from '../../domain/inventory/index.js';
import type { BusinessEventV1 } from '../events/index.js';
import type {
  AuditEntry, AuditWriter, BusinessEventStore, IdGenerator, OutboxStore,
  StockItemRepository, UnitOfWork
} from '../ports/index.js';
import { ApplyStockCountApprovedToInventory } from './apply-stock-count-approved-to-inventory.js';

class StockItems implements StockItemRepository {
  readonly values = new Map<string, StockItem>();
  saves = 0;
  async save(item: StockItem): Promise<void> { this.values.set(item.id, item); this.saves += 1; }
  async findById(id: string): Promise<StockItem | null> { return this.values.get(id) ?? null; }
  async findByProductId(productId: string): Promise<StockItem | null> {
    return [...this.values.values()].find((item) => item.productId === productId) ?? null;
  }
}

const sequence = (prefix: string): IdGenerator => {
  let next = 0;
  return { generate: () => `${prefix}-${++next}` };
};
const unitOfWork: UnitOfWork = { execute: (work) => work() };
const event = (differenceScaled = 3, countedScaled = 8): BusinessEventV1 => ({
  eventId: 'count-approved-001', eventType: 'StockCountApproved', contractVersion: 1,
  aggregateId: 'count-001', aggregateType: 'StockCount', aggregateVersion: 4,
  originNodeId: 'node-terminal-001', correlationId: 'correlation-001', actorId: 'user-001',
  occurredAt: new Date('2026-09-07T10:00:00.000Z'),
  payload: {
    terminalId: 'terminal-001', reason: 'Conteo aprobado', lineCount: 1,
    lines: [{
      lineId: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
      batchId: null, quantityScale: 0, expectedScaled: 5, countedScaled,
      differenceScaled, stockAvailabilityVersion: 7
    }]
  }
});
const outbox = (events: BusinessEventV1[]): OutboxStore => ({
  enqueue: async (enqueued) => { events.push(...enqueued); }, claimAvailable: async () => [],
  isClaimActive: async () => false, markPublished: async () => false,
  markFailed: async () => false, markBlocked: async () => false,
  markPaused: async () => false, resumeDelivery: async () => false,
  summarize: async (destinationNodeId) => ({ destinationNodeId, pending: 0, paused: 0,
    blocked: 0, lastPublishedAt: null, lastError: null }), listPaused: async () => []
});

const stockWithBalance = (scaled: number): StockItem => {
  const item = StockItem.create({
    id: 'stock-001', productId: 'product-001', unitCode: 'UNIT',
    quantityScale: 0, tracksBatches: false
  });
  item.registerMovement({
    id: 'seed-movement', eventId: 'seed-event', type: 'ADJUSTMENT_IN',
    quantity: Quantity.fromScaled(scaled, 0), actorId: 'seed-user',
    reason: 'Saldo inicial', referenceId: 'seed',
    occurredAt: new Date('2026-09-07T09:00:00.000Z')
  });
  return item;
};

describe('ApplyStockCountApprovedToInventory', () => {
  it('aplica el delta congelado una sola vez sobre el saldo autoritativo actual', async () => {
    const repository = new StockItems();
    repository.values.set('stock-001', stockWithBalance(3));
    const ledger: BusinessEventV1[] = [];
    const audits: AuditEntry[] = [];
    const publications: BusinessEventV1[] = [];
    const events: BusinessEventStore = {
      append: async (appended) => { ledger.push(...appended); },
      findByAggregate: async () => []
    };
    const audit: AuditWriter = { append: async (entries) => { audits.push(...entries); } };
    const service = new ApplyStockCountApprovedToInventory(
      repository, sequence('movement'), sequence('event'), sequence('audit'), unitOfWork,
      events, audit, outbox(publications), 'node-coordinator'
    );

    await expect(service.execute(event())).resolves.toMatchObject({ ok: true });
    await expect(service.execute(event())).resolves.toMatchObject({ ok: true });

    const item = repository.values.get('stock-001');
    expect(item?.balance.scaledValue).toBe(6);
    expect(item?.movements).toMatchObject([{}, {
      type: 'ADJUSTMENT_IN', referenceId: 'count-approved-001:line-001',
      quantity: { scaledValue: 3, scale: 0 }
    }]);
    expect(repository.saves).toBe(1);
    expect(ledger).toMatchObject([{
      eventType: 'StockMovementRegistered', originNodeId: 'node-coordinator'
    }]);
    expect(audits).toMatchObject([{
      action: 'STOCK_COUNT_ADJUSTMENT_APPLIED',
      after: { expectedScaled: 5, countedScaled: 8, differenceScaled: 3,
        stockAvailabilityVersion: 7 }
    }]);
    expect(publications).toMatchObject([{
      eventType: 'StockAvailabilityPublished', payload: { quantityScaled: 6 }
    }]);
  });

  it('rechaza un delta que no coincide con contado menos esperado', async () => {
    const repository = new StockItems();
    repository.values.set('stock-001', stockWithBalance(3));
    const service = new ApplyStockCountApprovedToInventory(
      repository, sequence('movement'), sequence('event'), sequence('audit'), unitOfWork,
      { append: async () => {}, findByAggregate: async () => [] }, { append: async () => {} }
    );

    await expect(service.execute(event(2, 8))).resolves.toMatchObject({
      ok: false, error: { code: 'INVENTORY_STOCK_COUNT_EVENT_INVALID' }
    });
    expect(repository.saves).toBe(0);
  });

  it('no inventa saldo cuando el delta negativo excede la existencia actual', async () => {
    const repository = new StockItems();
    repository.values.set('stock-001', stockWithBalance(3));
    const service = new ApplyStockCountApprovedToInventory(
      repository, sequence('movement'), sequence('event'), sequence('audit'), unitOfWork,
      { append: async () => {}, findByAggregate: async () => [] }, { append: async () => {} }
    );

    await expect(service.execute(event(-4, 1))).resolves.toMatchObject({
      ok: false, error: { code: 'STOCK_INSUFFICIENT' }
    });
    expect(repository.saves).toBe(0);
  });
});
