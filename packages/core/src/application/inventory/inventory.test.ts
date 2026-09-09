import { describe, expect, it } from 'vitest';
import { Money, Quantity, TaxRate } from '@supermarket/shared';
import { Barcode, Product, UnitOfMeasure } from '../../domain/catalog/index.js';
import { StockItem } from '../../domain/inventory/index.js';
import { Supplier, type SupplierStatus } from '../../domain/purchasing/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type { BusinessEventV1 } from '../events/index.js';
import type {
  AuditEntry,
  AuditWriter,
  BusinessEventStore,
  IdGenerator,
  ProductRepository,
  StockItemRepository,
  SupplierRepository,
  UnitOfWork
} from '../ports/index.js';
import { permissionAlternatives } from '../ports/index.js';
import { ApplySaleCompletedToInventory } from './apply-sale-completed-to-inventory.js';
import { GetKardex } from './get-kardex.js';
import { ReceivePurchase } from './receive-purchase.js';
import { RegisterStockAdjustment } from './register-stock-adjustment.js';

const context: ExecutionContext = {
  actorId: 'user-001',
  actorRoleCodes: ['inventory-manager'],
  terminalId: 'terminal-001',
  originNodeId: 'node-001',
  correlationId: 'correlation-001'
};

class FakeStockItemRepository implements StockItemRepository {
  saves = 0;
  constructor(public stored: StockItem | null = null) {}
  async save(item: StockItem): Promise<void> { this.stored = item; this.saves += 1; }
  async findById(id: string): Promise<StockItem | null> {
    return this.stored?.id === id ? this.stored : null;
  }
  async findByProductId(productId: string): Promise<StockItem | null> {
    return this.stored?.productId === productId ? this.stored : null;
  }
}

const supplierFixture = (status: SupplierStatus = 'ACTIVE'): Supplier => Supplier.create({
  id: 'supplier-001', code: 'SUP-000001', legalName: 'Proveedor Uno',
  taxIdentity: { country: 'VE', type: 'RIF', value: 'J-12345678-9' },
  status, createdAt: new Date('2026-08-01T00:00:00.000Z')
});

class FakeSupplierRepository implements SupplierRepository {
  constructor(private readonly supplier: Supplier | null = supplierFixture()) {}
  async nextCode(): Promise<string> { return 'SUP-000001'; }
  async save(): Promise<void> {}
  async findById(id: string): Promise<Supplier | null> {
    return this.supplier?.id === id ? this.supplier : null;
  }
  async findByTaxIdentity(): Promise<Supplier | null> { return null; }
  async findAll(status?: SupplierStatus): Promise<readonly Supplier[]> {
    return this.supplier && (status === undefined || this.supplier.status === status) ? [this.supplier] : [];
  }
}

const productFixture = (quantityScale = 0): Product => Product.create({
  id: 'product-001', name: 'Café molido', description: 'Café de prueba',
  categoryId: 'category-001',
  unitOfMeasure: UnitOfMeasure.create({
    id: 'unit-001', code: 'KG', name: 'Kilogramo', quantityScale
  }),
  barcodes: [Barcode.create({ id: 'barcode-001', value: '759000000001' })],
  price: Money.fromMinorUnits(1250, 'USD'), taxRate: TaxRate.fromBasisPoints(1600),
  priceHistoryId: 'price-001', recordedBy: 'user-001',
  occurredAt: new Date('2026-08-15T10:00:00.000Z'), eventId: 'product-event-001'
});

class FakeProductRepository implements ProductRepository {
  constructor(private readonly product: Product | null = productFixture(3)) {}
  async save(): Promise<void> {}
  async findById(productId: string): Promise<Product | null> {
    return this.product?.id === productId ? this.product : null;
  }
  async findByActiveBarcode(): Promise<Product | null> { return null; }
}

const sequence = (prefix: string): IdGenerator => {
  let value = 0;
  return { generate: () => `${prefix}-${++value}` };
};

const evidence = () => ({ ledger: [] as string[], audit: [] as AuditEntry[] });
const unitOfWork: UnitOfWork = { execute: async (work) => work() };
const eventStore = (ledger: string[]): BusinessEventStore => ({
  append: async (events) => { ledger.push(...events.map((event) => event.eventType)); },
  findByAggregate: async () => []
});
const auditWriter = (audit: AuditEntry[]): AuditWriter => ({
  append: async (entries) => { audit.push(...entries); }
});

const stockedBatches = (): StockItem => {
  const item = StockItem.create({
    id: 'stock-001', productId: 'product-001', unitCode: 'UNIT',
    quantityScale: 0, tracksBatches: true
  });
  item.registerBatch({
    id: 'batch-late', lotNumber: 'LATE', expiresAt: new Date('2027-02-01T00:00:00.000Z')
  });
  item.registerBatch({
    id: 'batch-first', lotNumber: 'FIRST', expiresAt: new Date('2027-01-01T00:00:00.000Z')
  });
  item.registerMovement({
    id: 'receipt-late', eventId: 'receipt-event-late', type: 'PURCHASE_RECEIPT',
    quantity: Quantity.fromScaled(5, 0), batchId: 'batch-late', actorId: 'user-001',
    reason: 'Purchase', referenceId: 'receipt-001', occurredAt: new Date('2026-08-01T10:00:00.000Z')
  });
  item.registerMovement({
    id: 'receipt-first', eventId: 'receipt-event-first', type: 'PURCHASE_RECEIPT',
    quantity: Quantity.fromScaled(2, 0), batchId: 'batch-first', actorId: 'user-001',
    reason: 'Purchase', referenceId: 'receipt-002', occurredAt: new Date('2026-08-02T10:00:00.000Z')
  });
  return item;
};

const receivePurchase = (
  repository: FakeStockItemRepository,
  recorded: ReturnType<typeof evidence>,
  options: {
    readonly suppliers?: FakeSupplierRepository;
    readonly products?: FakeProductRepository;
    readonly authorize?: (context: ExecutionContext, permission: string) => Promise<boolean>;
  } = {}
): ReceivePurchase => new ReceivePurchase(
  repository,
  options.suppliers ?? new FakeSupplierRepository(),
  options.products ?? new FakeProductRepository(),
  { authorize: options.authorize ?? (async () => true) },
  sequence('stock'), sequence('movement'), sequence('batch'), sequence('event'), sequence('audit'),
  { now: () => new Date('2026-08-20T10:00:00.000Z') }, unitOfWork,
  eventStore(recorded.ledger), auditWriter(recorded.audit)
);

describe('inventory application', () => {
  it('creates the stock item from the catalog on the first receipt of a product', async () => {
    const repository = new FakeStockItemRepository();
    const recorded = evidence();
    const permissions: string[] = [];
    const service = receivePurchase(repository, recorded, {
      authorize: async (_context, permission) => {
        permissions.push(permission);
        return permission === 'inventory.purchase.receive';
      }
    });

    const result = await service.execute({
      productId: 'product-001', quantity: '10,5',
      supplierId: 'supplier-001', receiptId: 'receipt-001', reason: 'Supplier delivery',
      lot: { lotNumber: 'lot-001', expiresAt: new Date('2027-08-20T00:00:00.000Z') }
    }, context);

    expect(result.ok).toBe(true);
    expect(permissions).toEqual(['inventory.purchase.receive']);
    expect(repository.stored?.id).toBe('stock-1');
    expect(repository.stored?.unitCode).toBe('KG');
    expect(repository.stored?.quantityScale).toBe(3);
    expect(repository.stored?.tracksBatches).toBe(true);
    expect(repository.stored?.balance.scaledValue).toBe(10500);
    expect(repository.stored?.batches[0]?.lotNumber).toBe('LOT-001');
    expect(recorded.ledger).toEqual(['StockMovementRegistered']);
    expect(recorded.audit).toMatchObject([{
      action: 'PURCHASE_RECEIPT_REGISTERED',
      after: { supplierId: 'supplier-001', receiptId: 'receipt-001', quantityScale: 3 }
    }]);
  });

  it('keeps the configuration of the stock item that already exists', async () => {
    const repository = new FakeStockItemRepository(stockedBatches());
    const recorded = evidence();

    const result = await receivePurchase(repository, recorded).execute({
      productId: 'product-001', quantity: '3',
      supplierId: 'supplier-001', receiptId: 'receipt-003', reason: 'Supplier delivery',
      lot: { lotNumber: 'FIRST' }
    }, context);

    expect(result.ok).toBe(true);
    expect(repository.stored?.id).toBe('stock-001');
    expect(repository.stored?.unitCode).toBe('UNIT');
    expect(repository.stored?.quantityScale).toBe(0);
    expect(repository.stored?.balance.scaledValue).toBe(10);
  });

  it('rejects a receipt for a product that the catalog does not know', async () => {
    const repository = new FakeStockItemRepository();
    const recorded = evidence();

    const result = await receivePurchase(repository, recorded, {
      products: new FakeProductRepository(null)
    }).execute({
      productId: 'product-001', quantity: '10',
      supplierId: 'supplier-001', receiptId: 'receipt-001', reason: 'Supplier delivery'
    }, context);

    expect(result).toMatchObject({ ok: false, error: { code: 'PRODUCT_NOT_FOUND' } });
    expect(repository.saves).toBe(0);
    expect(recorded).toEqual({ ledger: [], audit: [] });
  });

  it('rejects a quantity with more decimals than the unit of measure allows', async () => {
    const repository = new FakeStockItemRepository();
    const recorded = evidence();

    const result = await receivePurchase(repository, recorded, {
      products: new FakeProductRepository(productFixture(0))
    }).execute({
      productId: 'product-001', quantity: '1.5',
      supplierId: 'supplier-001', receiptId: 'receipt-001', reason: 'Supplier delivery'
    }, context);

    expect(result).toMatchObject({ ok: false, error: { code: 'QUANTITY_SCALE_EXCEEDED' } });
    expect(repository.saves).toBe(0);
    expect(recorded).toEqual({ ledger: [], audit: [] });
  });

  it.each(['BLOCKED', 'INACTIVE'] as const)(
    'rejects a %s supplier before creating inventory evidence',
    async (status) => {
      const repository = new FakeStockItemRepository();
      const recorded = evidence();
      const service = receivePurchase(repository, recorded, {
        suppliers: new FakeSupplierRepository(supplierFixture(status))
      });

      const result = await service.execute({
        productId: 'product-001', quantity: '10',
        supplierId: 'supplier-001', receiptId: 'receipt-001', reason: 'Supplier delivery'
      }, context);

      expect(result).toMatchObject({ ok: false, error: { code: 'SUPPLIER_NOT_ACTIVE' } });
      expect(repository.saves).toBe(0);
      expect(recorded).toEqual({ ledger: [], audit: [] });
    }
  );

  it('rejects an unknown supplier before creating inventory evidence', async () => {
    const repository = new FakeStockItemRepository();
    const recorded = evidence();
    const service = receivePurchase(repository, recorded, {
      suppliers: new FakeSupplierRepository(null)
    });

    const result = await service.execute({
      productId: 'product-001', quantity: '10',
      supplierId: 'missing', receiptId: 'receipt-001', reason: 'Supplier delivery'
    }, context);

    expect(result).toMatchObject({ ok: false, error: { code: 'SUPPLIER_NOT_FOUND' } });
    expect(repository.saves).toBe(0);
    expect(recorded).toEqual({ ledger: [], audit: [] });
  });

  it('applies SaleCompleted with FEFO and ignores an identical redelivery', async () => {
    const repository = new FakeStockItemRepository(stockedBatches());
    const recorded = evidence();
    const service = new ApplySaleCompletedToInventory(
      repository, sequence('stock-event'), sequence('audit'), unitOfWork,
      eventStore(recorded.ledger), auditWriter(recorded.audit)
    );
    const sale: BusinessEventV1 = {
      eventId: 'sale-event-001', eventType: 'SaleCompleted', contractVersion: 1,
      aggregateId: 'sale-001', aggregateType: 'Sale', aggregateVersion: 5,
      originNodeId: 'node-001', correlationId: 'correlation-001', actorId: 'user-001',
      occurredAt: new Date('2026-08-20T11:00:00.000Z'),
      payload: {
        terminalId: 'terminal-001',
        items: [{ itemId: 'line-001', productId: 'product-001', quantityScaled: 3, quantityScale: 0 }]
      }
    };

    expect((await service.execute(sale)).ok).toBe(true);
    expect(repository.stored?.balance.scaledValue).toBe(4);
    expect(repository.stored?.balanceForBatch('batch-first').scaledValue).toBe(0);
    expect(repository.stored?.balanceForBatch('batch-late').scaledValue).toBe(4);
    expect(repository.stored?.movements.filter((movement) => movement.type === 'SALE_ISSUE'))
      .toHaveLength(2);
    expect((await service.execute(sale)).ok).toBe(true);
    expect(repository.saves).toBe(1);
    expect(recorded.ledger).toEqual(['StockMovementRegistered', 'StockMovementRegistered']);
    expect(recorded.audit).toMatchObject([{ action: 'SALE_STOCK_ISSUED' }]);
  });

  it('freezes the sale issue cost at the average vigente when the sale is applied', async () => {
    const item = StockItem.create({
      id: 'stock-002', productId: 'product-002', unitCode: 'UNIT', quantityScale: 0, tracksBatches: false
    });
    item.registerMovement({
      id: 'receipt-1', eventId: 'receipt-event-1', type: 'PURCHASE_RECEIPT',
      quantity: Quantity.fromScaled(10, 0), actorId: 'user-001', reason: 'Purchase', referenceId: 'r-1',
      occurredAt: new Date('2026-08-01T10:00:00.000Z'), unitCost: Money.fromMinorUnits(100, 'USD')
    });
    item.registerMovement({
      id: 'receipt-2', eventId: 'receipt-event-2', type: 'PURCHASE_RECEIPT',
      quantity: Quantity.fromScaled(10, 0), actorId: 'user-001', reason: 'Purchase', referenceId: 'r-2',
      occurredAt: new Date('2026-08-02T10:00:00.000Z'), unitCost: Money.fromMinorUnits(200, 'USD')
    });
    const repository = new FakeStockItemRepository(item);
    const recorded = evidence();
    const service = new ApplySaleCompletedToInventory(
      repository, sequence('stock-event'), sequence('audit'), unitOfWork,
      eventStore(recorded.ledger), auditWriter(recorded.audit)
    );
    const sale: BusinessEventV1 = {
      eventId: 'sale-event-002', eventType: 'SaleCompleted', contractVersion: 1,
      aggregateId: 'sale-002', aggregateType: 'Sale', aggregateVersion: 1,
      originNodeId: 'node-001', correlationId: 'correlation-001', actorId: 'user-001',
      occurredAt: new Date('2026-08-20T11:00:00.000Z'),
      payload: {
        terminalId: 'terminal-001',
        items: [{ itemId: 'line-001', productId: 'product-002', quantityScaled: 4, quantityScale: 0 }]
      }
    };

    expect((await service.execute(sale)).ok).toBe(true);
    const saleIssue = repository.stored?.movements.find((movement) => movement.type === 'SALE_ISSUE');
    expect(saleIssue?.unitCost?.minorUnits).toBe(150);
    expect(repository.stored?.averageUnitCost?.minorUnits).toBe(150);

    item.registerMovement({
      id: 'receipt-3', eventId: 'receipt-event-3', type: 'PURCHASE_RECEIPT',
      quantity: Quantity.fromScaled(10, 0), actorId: 'user-001', reason: 'Purchase', referenceId: 'r-3',
      occurredAt: new Date('2026-08-25T10:00:00.000Z'), unitCost: Money.fromMinorUnits(1000, 'USD')
    });
    expect(saleIssue?.unitCost?.minorUnits).toBe(150);
  });

  it('authorizes waste and records the balance before and after the adjustment', async () => {
    const repository = new FakeStockItemRepository(stockedBatches());
    const recorded = evidence();
    const requestedPermissions: string[] = [];
    const service = new RegisterStockAdjustment(
      repository,
      { authorize: async (_context, permission) => {
        requestedPermissions.push(...permissionAlternatives(permission));
        return true;
      } },
      sequence('movement'), sequence('event'), sequence('audit'),
      { now: () => new Date('2026-08-20T12:00:00.000Z') }, unitOfWork,
      eventStore(recorded.ledger), auditWriter(recorded.audit)
    );

    const result = await service.execute({
      stockItemId: 'stock-001', type: 'WASTE', quantityScaled: 1, quantityScale: 0,
      batchId: 'batch-first', reason: 'Damaged package', referenceId: 'waste-001'
    }, context);

    expect(result.ok).toBe(true);
    expect(requestedPermissions).toEqual(['inventory.waste.register']);
    expect(recorded.audit).toMatchObject([{
      action: 'STOCK_WASTE_REGISTERED',
      before: { balanceScaled: 7 }, after: { balanceScaled: 6 }, reason: 'Damaged package'
    }]);
  });

  it('queries kardex by batch, date and reason while deriving its current balance', async () => {
    const repository = new FakeStockItemRepository(stockedBatches());
    const result = await new GetKardex(repository, { authorize: async () => true }).execute({
      productId: 'product-001', batchId: 'batch-first',
      from: new Date('2026-08-02T00:00:00.000Z'),
      to: new Date('2026-08-03T00:00:00.000Z'), reason: 'purchase'
    }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe('stock-001');
    expect(result.value.currentBalanceScaled).toBe(2);
    expect(result.value.movements).toMatchObject([{
      id: 'receipt-first', batchId: 'batch-first', reason: 'Purchase'
    }]);
  });

  it('denies reading the kardex without the kardex read permission', async () => {
    const repository = new FakeStockItemRepository(stockedBatches());
    let repositoryTouched = false;
    const guardedRepository = {
      ...repository,
      findByProductId: async (productId: string) => {
        repositoryTouched = true;
        return repository.findByProductId(productId);
      }
    } as typeof repository;
    const result = await new GetKardex(guardedRepository, { authorize: async () => false })
      .execute({ productId: 'product-001' }, context);

    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(repositoryTouched).toBe(false);
  });

  it('limits the kardex and returns the newest matching movements first', async () => {
    const repository = new FakeStockItemRepository(stockedBatches());
    const result = await new GetKardex(repository, { authorize: async () => true })
      .execute({ productId: 'product-001', limit: 1 }, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.movements).toHaveLength(1);
    expect(result.value.movements[0]?.occurredAt.getTime()).toBe(
      Math.max(...(repository.stored?.movements ?? []).map((movement) => movement.occurredAt.getTime()))
    );
    expect(await new GetKardex(repository, { authorize: async () => true })
      .execute({ productId: 'product-001', limit: 501 }, context))
      .toMatchObject({ ok: false, error: { code: 'KARDEX_LIMIT_INVALID' } });
  });
});
