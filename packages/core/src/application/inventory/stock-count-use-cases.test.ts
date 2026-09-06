import { describe, expect, it } from 'vitest';
import { Quantity } from '@supermarket/shared';
import { StockItem, type StockCountStatus } from '../../domain/inventory/index.js';
import { StockCount } from '../../domain/inventory/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type { BusinessEventV1 } from '../events/index.js';
import type {
  AuditEntry,
  AuditWriter,
  BusinessEventStore,
  IdGenerator,
  StockCountRepository,
  StockItemRepository,
  UnitOfWork
} from '../ports/index.js';
import {
  ApproveStockCount,
  CloseStockCount,
  OpenStockCount,
  RecordStockCountLine,
  RejectStockCount
} from './stock-count-use-cases.js';

const context: ExecutionContext = {
  actorId: 'user-001',
  actorRoleCodes: ['inventory-clerk'],
  terminalId: 'terminal-001',
  originNodeId: 'node-001',
  correlationId: 'correlation-001'
};

class FakeStockItemRepository implements StockItemRepository {
  private readonly byId = new Map<string, StockItem>();
  saves = 0;
  constructor(items: readonly StockItem[] = []) {
    for (const item of items) this.byId.set(item.id, item);
  }
  async save(item: StockItem): Promise<void> { this.byId.set(item.id, item); this.saves += 1; }
  async findById(id: string): Promise<StockItem | null> { return this.byId.get(id) ?? null; }
  async findByProductId(productId: string): Promise<StockItem | null> {
    return [...this.byId.values()].find((item) => item.productId === productId) ?? null;
  }
}

class FakeStockCountRepository implements StockCountRepository {
  saves = 0;
  stored: StockCount | null = null;
  async save(count: StockCount): Promise<void> { this.stored = count; this.saves += 1; }
  async findById(id: string): Promise<StockCount | null> { return this.stored?.id === id ? this.stored : null; }
  async findOpen(): Promise<StockCount | null> { return this.stored?.status === 'OPEN' ? this.stored : null; }
  async findAll(status?: StockCountStatus): Promise<readonly StockCount[]> {
    return this.stored && (status === undefined || this.stored.status === status) ? [this.stored] : [];
  }
}

const sequence = (prefix: string): IdGenerator => {
  let value = 0;
  return { generate: () => `${prefix}-${++value}` };
};

const evidence = (): { ledger: string[]; audit: AuditEntry[] } => ({ ledger: [], audit: [] });
const unitOfWork: UnitOfWork = { execute: async (work) => work() };
const eventStore = (ledger: string[]): BusinessEventStore => ({
  append: async (events: readonly BusinessEventV1[]) => { ledger.push(...events.map((event) => event.eventType)); },
  findByAggregate: async () => []
});
const auditWriter = (audit: AuditEntry[]): AuditWriter => ({
  append: async (entries) => { audit.push(...entries); }
});

const stockItem = (overrides: {
  id?: string; productId?: string; tracksBatches?: boolean; quantityScale?: number
} = {}): StockItem => StockItem.create({
  id: overrides.id ?? 'stock-001', productId: overrides.productId ?? 'product-001', unitCode: 'UNIT',
  quantityScale: overrides.quantityScale ?? 0, tracksBatches: overrides.tracksBatches ?? false
});

const withBalance = (item: StockItem, scaledValue: number): StockItem => {
  if (scaledValue === 0) return item;
  item.registerMovement({
    id: 'seed-movement', type: 'ADJUSTMENT_IN', quantity: Quantity.fromScaled(scaledValue, item.quantityScale),
    actorId: 'user-seed', reason: 'Saldo inicial de prueba', referenceId: 'seed',
    occurredAt: new Date('2026-09-01T00:00:00.000Z'), eventId: 'seed-event'
  });
  return item;
};

const allow = (permission: string) => ({
  authorize: async (_context: ExecutionContext, requested: string) => requested === permission
});

const openedCount = (): StockCount => StockCount.open({
  id: 'count-001', openedBy: 'user-001', originNodeId: 'node-001',
  openedAt: new Date('2026-09-05T10:00:00.000Z')
});

describe('stock count application', () => {
  it('opens a count only with the perform permission and audits it', async () => {
    const repository = new FakeStockCountRepository();
    const recorded = evidence();
    const useCase = new OpenStockCount(
      repository, allow('inventory.count.perform'), sequence('count'), sequence('audit'),
      { now: () => new Date('2026-09-05T10:00:00.000Z') }, unitOfWork, auditWriter(recorded.audit)
    );

    const result = await useCase.execute({ reason: 'Conteo mensual de víveres' }, context);

    expect(result).toMatchObject({ ok: true, value: { status: 'OPEN', id: 'count-1' } });
    expect(repository.saves).toBe(1);
    expect(recorded.audit).toMatchObject([{ action: 'STOCK_COUNT_OPENED', reason: 'Conteo mensual de víveres' }]);
    expect(await useCase.execute({ reason: 'Conteo solapado' }, context))
      .toMatchObject({ ok: false, error: { code: 'STOCK_COUNT_ALREADY_OPEN' } });
    expect(repository.saves).toBe(1);
  });

  it('denies opening a count without the permission and creates no evidence', async () => {
    const repository = new FakeStockCountRepository();
    const recorded = evidence();
    const useCase = new OpenStockCount(
      repository, allow('nothing'), sequence('count'), sequence('audit'),
      { now: () => new Date('2026-09-05T10:00:00.000Z') }, unitOfWork, auditWriter(recorded.audit)
    );

    const result = await useCase.execute({ reason: 'Conteo' }, context);

    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(repository.saves).toBe(0);
  });

  it('records a line deriving the stock item, requires no reason and rejects a mismatched batch', async () => {
    const item = stockItem();
    const stockRepository = new FakeStockItemRepository([item]);
    const countRepository = new FakeStockCountRepository();
    countRepository.stored = openedCount();
    const useCase = new RecordStockCountLine(
      countRepository, stockRepository, allow('inventory.count.perform'),
      sequence('line'), sequence('audit'),
      { now: () => new Date('2026-09-05T10:05:00.000Z') }, unitOfWork, auditWriter(evidence().audit)
    );

    const result = await useCase.execute(
      { stockCountId: 'count-001', productId: 'product-001', quantity: '8' }, context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines).toEqual([{
      id: 'line-1', productId: 'product-001', stockItemId: 'stock-001', batchId: null,
      countedQuantityScaled: 8, quantityScale: 0
    }]);

    const withBatch = await useCase.execute(
      { stockCountId: 'count-001', productId: 'product-001', quantity: '8', batchId: 'batch-x' }, context
    );
    expect(withBatch).toMatchObject({ ok: false, error: { code: 'STOCK_BATCH_NOT_ACCEPTED' } });
  });

  it('requires a batch to count an item that tracks batches', async () => {
    const item = stockItem({ tracksBatches: true });
    item.registerBatch({ id: 'batch-001', lotNumber: 'lot-001' });
    const stockRepository = new FakeStockItemRepository([item]);
    const countRepository = new FakeStockCountRepository();
    countRepository.stored = openedCount();
    const useCase = new RecordStockCountLine(
      countRepository, stockRepository, allow('inventory.count.perform'),
      sequence('line'), sequence('audit'),
      { now: () => new Date('2026-09-05T10:05:00.000Z') }, unitOfWork, auditWriter(evidence().audit)
    );

    const withoutBatch = await useCase.execute(
      { stockCountId: 'count-001', productId: 'product-001', quantity: '3' }, context
    );
    expect(withoutBatch).toMatchObject({ ok: false, error: { code: 'STOCK_BATCH_REQUIRED' } });

    const withBatch = await useCase.execute(
      { stockCountId: 'count-001', productId: 'product-001', quantity: '3', batchId: 'batch-001' }, context
    );
    expect(withBatch.ok).toBe(true);
  });

  it('closes a count deriving the difference from the current balance and freezing it', async () => {
    const item = withBalance(stockItem(), 5);
    const stockRepository = new FakeStockItemRepository([item]);
    const countRepository = new FakeStockCountRepository();
    const opened = openedCount();
    opened.recordLine({
      id: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(8, 0)
    });
    countRepository.stored = opened;
    const recorded = evidence();
    const useCase = new CloseStockCount(
      countRepository, stockRepository, allow('inventory.count.perform'), sequence('audit'),
      { now: () => new Date('2026-09-05T11:00:00.000Z') }, unitOfWork, auditWriter(recorded.audit)
    );

    const result = await useCase.execute({ stockCountId: 'count-001', reason: 'Cierre de conteo' }, context);

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'COUNTED',
        differences: [{
          lineId: 'line-001', stockItemId: 'stock-001', expectedScaled: 5, countedScaled: 8, differenceScaled: 3
        }]
      }
    });
    expect(recorded.audit).toMatchObject([{
      action: 'STOCK_COUNT_CLOSED', after: { lineCount: 1, differingLineCount: 1 }
    }]);
  });

  it('approves a count with a positive difference, registers an ADJUSTMENT_IN and updates the balance', async () => {
    const item = withBalance(stockItem(), 5);
    const stockRepository = new FakeStockItemRepository([item]);
    const countRepository = new FakeStockCountRepository();
    const closed = openedCount();
    closed.recordLine({
      id: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(8, 0)
    });
    closed.close([{
      lineId: 'line-001', stockItemId: 'stock-001', batchId: null, quantityScale: 0,
      expectedScaled: 5, countedScaled: 8, differenceScaled: 3
    }], new Date('2026-09-05T11:00:00.000Z'));
    countRepository.stored = closed;
    const recorded = evidence();
    const useCase = new ApproveStockCount(
      countRepository, stockRepository, allow('inventory.count.approve'),
      sequence('movement'), sequence('event'), sequence('audit'),
      { now: () => new Date('2026-09-05T12:00:00.000Z') }, unitOfWork,
      eventStore(recorded.ledger), auditWriter(recorded.audit)
    );

    const result = await useCase.execute({ stockCountId: 'count-001', reason: 'Aprobado por supervisor' }, context);

    expect(result).toMatchObject({ ok: true, value: { status: 'APPROVED', approvedBy: 'user-001' } });
    expect(stockRepository.saves).toBe(1);
    const stored = await stockRepository.findById('stock-001');
    expect(stored?.balance.scaledValue).toBe(8);
    expect(stored?.movements.some((movement) => movement.type === 'ADJUSTMENT_IN')).toBe(true);
    expect(recorded.ledger).toEqual(['StockMovementRegistered']);
    expect(recorded.audit).toMatchObject([
      { action: 'STOCK_COUNT_ADJUSTMENT_REGISTERED' },
      { action: 'STOCK_COUNT_APPROVED', after: { adjustmentsCreated: 1 } }
    ]);
  });

  it('approves a count with a negative difference registering an ADJUSTMENT_OUT', async () => {
    const item = withBalance(stockItem(), 8);
    const stockRepository = new FakeStockItemRepository([item]);
    const countRepository = new FakeStockCountRepository();
    const closed = openedCount();
    closed.recordLine({
      id: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(5, 0)
    });
    closed.close([{
      lineId: 'line-001', stockItemId: 'stock-001', batchId: null, quantityScale: 0,
      expectedScaled: 8, countedScaled: 5, differenceScaled: -3
    }], new Date('2026-09-05T11:00:00.000Z'));
    countRepository.stored = closed;
    const recorded = evidence();
    const useCase = new ApproveStockCount(
      countRepository, stockRepository, allow('inventory.count.approve'),
      sequence('movement'), sequence('event'), sequence('audit'),
      { now: () => new Date('2026-09-05T12:00:00.000Z') }, unitOfWork,
      eventStore(recorded.ledger), auditWriter(recorded.audit)
    );

    const result = await useCase.execute({ stockCountId: 'count-001', reason: 'Aprobado' }, context);

    expect(result.ok).toBe(true);
    const stored = await stockRepository.findById('stock-001');
    expect(stored?.balance.scaledValue).toBe(5);
    expect(stored?.movements.some((movement) => movement.type === 'ADJUSTMENT_OUT')).toBe(true);
  });

  it('applies the frozen difference as a signed delta over movements booked after the close', async () => {
    const item = withBalance(stockItem(), 5);
    const stockRepository = new FakeStockItemRepository([item]);
    const countRepository = new FakeStockCountRepository();
    const closed = openedCount();
    closed.recordLine({
      id: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(8, 0)
    });
    closed.close([{
      lineId: 'line-001', stockItemId: 'stock-001', batchId: null, quantityScale: 0,
      expectedScaled: 5, countedScaled: 8, differenceScaled: 3
    }], new Date('2026-09-05T11:00:00.000Z'));
    countRepository.stored = closed;

    // A sale is booked between CLOSE and APPROVE: balance drops from 5 to 3.
    item.registerMovement({
      id: 'post-close-sale', type: 'SALE_ISSUE', quantity: Quantity.fromScaled(2, 0),
      actorId: 'user-001', reason: 'Venta posterior al cierre', referenceId: 'event:sale-x',
      occurredAt: new Date('2026-09-05T11:30:00.000Z'), eventId: 'post-close-sale-event'
    });

    const recorded = evidence();
    const useCase = new ApproveStockCount(
      countRepository, stockRepository, allow('inventory.count.approve'),
      sequence('movement'), sequence('event'), sequence('audit'),
      { now: () => new Date('2026-09-05T12:00:00.000Z') }, unitOfWork,
      eventStore(recorded.ledger), auditWriter(recorded.audit)
    );

    const result = await useCase.execute({ stockCountId: 'count-001', reason: 'Aprobado' }, context);

    expect(result.ok).toBe(true);
    const stored = await stockRepository.findById('stock-001');
    // counted (8) + movements booked after the close (-2) = 6, not the counted 8.
    expect(stored?.balance.scaledValue).toBe(6);
    // The adjustment audit records the balance at approval time (3) so the drift is visible.
    expect(recorded.audit).toMatchObject([
      { action: 'STOCK_COUNT_ADJUSTMENT_REGISTERED', before: { balanceScaled: 3 } },
      { action: 'STOCK_COUNT_APPROVED' }
    ]);
  });

  it('approves a count with no difference and creates no adjustment', async () => {
    const item = withBalance(stockItem(), 5);
    const stockRepository = new FakeStockItemRepository([item]);
    const countRepository = new FakeStockCountRepository();
    const closed = openedCount();
    closed.recordLine({
      id: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(5, 0)
    });
    closed.close([{
      lineId: 'line-001', stockItemId: 'stock-001', batchId: null, quantityScale: 0,
      expectedScaled: 5, countedScaled: 5, differenceScaled: 0
    }], new Date('2026-09-05T11:00:00.000Z'));
    countRepository.stored = closed;
    const recorded = evidence();
    const useCase = new ApproveStockCount(
      countRepository, stockRepository, allow('inventory.count.approve'),
      sequence('movement'), sequence('event'), sequence('audit'),
      { now: () => new Date('2026-09-05T12:00:00.000Z') }, unitOfWork,
      eventStore(recorded.ledger), auditWriter(recorded.audit)
    );

    const result = await useCase.execute({ stockCountId: 'count-001', reason: 'Sin diferencias' }, context);

    expect(result).toMatchObject({ ok: true, value: { status: 'APPROVED' } });
    expect(stockRepository.saves).toBe(0);
    expect(recorded.ledger).toEqual([]);
    expect(recorded.audit).toMatchObject([{ action: 'STOCK_COUNT_APPROVED', after: { adjustmentsCreated: 0 } }]);
  });

  it('denies approval without the approve permission, leaving the count COUNTED', async () => {
    const stockRepository = new FakeStockItemRepository([withBalance(stockItem(), 5)]);
    const countRepository = new FakeStockCountRepository();
    const closed = openedCount();
    closed.recordLine({
      id: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(8, 0)
    });
    closed.close([{
      lineId: 'line-001', stockItemId: 'stock-001', batchId: null, quantityScale: 0,
      expectedScaled: 5, countedScaled: 8, differenceScaled: 3
    }], new Date('2026-09-05T11:00:00.000Z'));
    countRepository.stored = closed;
    const useCase = new ApproveStockCount(
      countRepository, stockRepository, allow('inventory.count.perform'),
      sequence('movement'), sequence('event'), sequence('audit'),
      { now: () => new Date('2026-09-05T12:00:00.000Z') }, unitOfWork,
      eventStore([]), auditWriter([])
    );

    const result = await useCase.execute({ stockCountId: 'count-001', reason: 'Intento' }, context);

    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(countRepository.stored?.status).toBe('COUNTED');
    expect(stockRepository.saves).toBe(0);
  });

  it('rejects a closed count with a reason and leaves inventory untouched', async () => {
    const stockRepository = new FakeStockItemRepository([withBalance(stockItem(), 5)]);
    const countRepository = new FakeStockCountRepository();
    const closed = openedCount();
    closed.recordLine({
      id: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(8, 0)
    });
    closed.close([{
      lineId: 'line-001', stockItemId: 'stock-001', batchId: null, quantityScale: 0,
      expectedScaled: 5, countedScaled: 8, differenceScaled: 3
    }], new Date('2026-09-05T11:00:00.000Z'));
    countRepository.stored = closed;
    const recorded = evidence();
    const useCase = new RejectStockCount(
      countRepository, allow('inventory.count.approve'), sequence('audit'),
      { now: () => new Date('2026-09-05T12:00:00.000Z') }, unitOfWork, auditWriter(recorded.audit)
    );

    const result = await useCase.execute(
      { stockCountId: 'count-001', reason: 'Conteo con error de digitación' }, context
    );

    expect(result).toMatchObject({ ok: true, value: { status: 'REJECTED', rejectionReason: 'Conteo con error de digitación' } });
    expect(stockRepository.saves).toBe(0);
    expect(recorded.audit).toMatchObject([{ action: 'STOCK_COUNT_REJECTED' }]);
  });
});
