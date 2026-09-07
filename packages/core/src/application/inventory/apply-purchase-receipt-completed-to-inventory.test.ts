import { describe, expect, it } from 'vitest';
import type { BusinessEventV1 } from '../events/index.js';
import type {
  AuditEntry, AuditWriter, BusinessEventStore, IdGenerator, OutboxStore,
  StockItemRepository, UnitOfWork
} from '../ports/index.js';
import { StockItem } from '../../domain/inventory/index.js';
import { ApplyPurchaseReceiptCompletedToInventory } from './apply-purchase-receipt-completed-to-inventory.js';

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
const event = (overrides: Partial<BusinessEventV1> = {}): BusinessEventV1 => ({
  eventId: 'purchase-completed-001', eventType: 'PurchaseReceiptCompleted', contractVersion: 1,
  aggregateId: 'receipt-001', aggregateType: 'PurchaseReceipt', aggregateVersion: 2,
  originNodeId: 'node-terminal-001', correlationId: 'correlation-001', actorId: 'user-001',
  occurredAt: new Date('2026-09-07T10:00:00.000Z'),
  payload: {
    supplierId: 'supplier-001', sourceType: 'INVOICE', sourceNumber: 'FAC-001',
    terminalId: 'terminal-001', reason: 'Recepción confirmada', lineCount: 1,
    lines: [{
      lineId: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
      unitCode: 'UNIT', quantityScaled: 5, quantityScale: 0,
      batchTracking: 'TRACKED',
      batch: { batchId: 'batch-001', lotNumber: 'LOT-001', expiresAt: '2027-01-01T00:00:00.000Z' },
      valuationUnitCost: { minorUnits: 125, currencyCode: 'USD' }
    }]
  },
  ...overrides
});

const outbox = (events: Parameters<OutboxStore['enqueue']>[0][number][]): OutboxStore => ({
  enqueue: async (enqueued) => { events.push(...enqueued); }, claimAvailable: async () => [],
  isClaimActive: async () => false, markPublished: async () => false,
  markFailed: async () => false, markBlocked: async () => false,
  markPaused: async () => false, resumeDelivery: async () => false,
  summarize: async (destinationNodeId) => ({ destinationNodeId, pending: 0, paused: 0,
    blocked: 0, lastPublishedAt: null, lastError: null }),
  listPaused: async () => []
});

describe('ApplyPurchaseReceiptCompletedToInventory', () => {
  it('aplica lote y costo una vez y publica la disponibilidad autoritativa', async () => {
    const repository = new StockItems();
    const ledger: string[] = [];
    const audits: AuditEntry[] = [];
    const publications: Parameters<OutboxStore['enqueue']>[0][number][] = [];
    const service = new ApplyPurchaseReceiptCompletedToInventory(
      repository, sequence('movement'), sequence('event'), sequence('audit'), unitOfWork,
      { append: async (events) => { ledger.push(...events.map(({ eventType }) => eventType)); },
        findByAggregate: async () => [] } satisfies BusinessEventStore,
      { append: async (entries) => { audits.push(...entries); } } satisfies AuditWriter,
      outbox(publications)
    );

    await expect(service.execute(event())).resolves.toMatchObject({ ok: true });
    await expect(service.execute(event())).resolves.toMatchObject({ ok: true });

    const item = repository.values.get('stock-001');
    expect(item).toMatchObject({
      productId: 'product-001', unitCode: 'UNIT', quantityScale: 0, tracksBatches: true
    });
    expect(item?.batches).toMatchObject([{
      id: 'batch-001', lotNumber: 'LOT-001', expiresAt: new Date('2027-01-01T00:00:00.000Z')
    }]);
    expect(item?.balance.scaledValue).toBe(5);
    expect(item?.averageUnitCost?.minorUnits).toBe(125);
    expect(item?.movements).toMatchObject([{
      type: 'PURCHASE_RECEIPT', referenceId: 'purchase-completed-001:line-001',
      batchId: 'batch-001', unitCost: { minorUnits: 125, currency: 'USD' }
    }]);
    expect(ledger).toEqual(['StockMovementRegistered']);
    expect(audits).toMatchObject([{ action: 'PURCHASE_STOCK_RECEIVED' }]);
    expect(publications).toHaveLength(1);
    expect(publications[0]).toMatchObject({
      eventType: 'StockAvailabilityPublished', contractVersion: 2,
      payload: { stockItemId: 'stock-001', quantityScaled: 5 }
    });
  });

  it('reconoce la reentrega de una línea sin lote como el mismo movimiento', async () => {
    const repository = new StockItems();
    const audits: AuditEntry[] = [];
    const base = event();
    const payload = base.payload as Record<string, unknown>;
    const service = new ApplyPurchaseReceiptCompletedToInventory(
      repository, sequence('movement'), sequence('event'), sequence('audit'), unitOfWork,
      { append: async () => {}, findByAggregate: async () => [] },
      { append: async (entries) => { audits.push(...entries); } }
    );
    const untracked = event({ payload: {
      ...payload,
      lines: [{
        lineId: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
        unitCode: 'UNIT', quantityScaled: 2, quantityScale: 0,
        batchTracking: 'NOT_TRACKED', batch: null,
        valuationUnitCost: { minorUnits: 125, currencyCode: 'USD' }
      }]
    } });

    await service.execute(untracked);
    await expect(service.execute(untracked)).resolves.toMatchObject({ ok: true });

    expect(repository.values.get('stock-001')?.movements).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  it('rechaza evidencia incompatible con el artículo existente', async () => {
    const repository = new StockItems();
    await repository.save(StockItem.create({
      id: 'stock-other', productId: 'product-001', unitCode: 'UNIT',
      quantityScale: 0, tracksBatches: false
    }));
    const service = new ApplyPurchaseReceiptCompletedToInventory(
      repository, sequence('movement'), sequence('event'), sequence('audit'), unitOfWork,
      { append: async () => {}, findByAggregate: async () => [] }, { append: async () => {} }
    );

    await expect(service.execute(event())).resolves.toMatchObject({
      ok: false, error: { code: 'STOCK_PURCHASE_ITEM_CONFLICT' }
    });
  });
});
