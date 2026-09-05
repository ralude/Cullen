import { describe, expect, it } from 'vitest';
import { Money, Quantity, TaxRate } from '@supermarket/shared';
import { Barcode, Product, UnitOfMeasure } from '../../domain/catalog/index.js';
import { ExchangeRate } from '../../domain/currency/index.js';
import { StockItem } from '../../domain/inventory/index.js';
import { PurchaseReceipt, Supplier, type SupplierStatus } from '../../domain/purchasing/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuditEntry, AuditWriter, BusinessEventStore, ExchangeRateRepository, IdGenerator, ProductRepository,
  PurchaseReceiptRepository, StockItemRepository, SupplierRepository, UnitOfWork
} from '../ports/index.js';
import { CompletePurchaseReceipt } from './purchase-receipt-use-cases.js';
import { ReversePurchaseReceipt } from './purchase-receipt-use-cases.js';
import { StartPurchaseReceipt } from './purchase-receipt-use-cases.js';
import { PURCHASE_RECEIPT_PERMISSIONS } from './permissions.js';

const context: ExecutionContext = {
  actorId: 'user-001', actorRoleCodes: ['inventory-manager'], terminalId: 'terminal-001',
  originNodeId: 'node-001', correlationId: 'correlation-001'
};

class FakePurchaseReceipts implements PurchaseReceiptRepository {
  readonly values = new Map<string, PurchaseReceipt>();
  saves = 0;
  save = async (receipt: PurchaseReceipt): Promise<void> => { this.values.set(receipt.id, receipt); this.saves += 1; };
  findById = async (id: string): Promise<PurchaseReceipt | null> => this.values.get(id) ?? null;
  findCompletedBySource = async (
    supplierId: string, type: 'INVOICE' | 'DELIVERY_NOTE', series: string | null, number: string
  ): Promise<PurchaseReceipt | null> => [...this.values.values()].find((receipt) =>
    receipt.status === 'COMPLETED' && receipt.supplierId === supplierId &&
    receipt.sourceDocument.type === type && (receipt.sourceDocument.series ?? '') === (series ?? '') &&
    receipt.sourceDocument.number.toUpperCase() === number.toUpperCase()) ?? null;
  findCompletedByControlNumber = async (
    supplierId: string, controlNumber: string
  ): Promise<PurchaseReceipt | null> => [...this.values.values()].find((receipt) =>
    receipt.status === 'COMPLETED' && receipt.supplierId === supplierId &&
    receipt.sourceDocument.controlNumber?.toUpperCase() === controlNumber.toUpperCase()) ?? null;
}

const supplierFixture = (status: SupplierStatus = 'ACTIVE'): Supplier => Supplier.create({
  id: 'supplier-001', code: 'SUP-000001', legalName: 'Proveedor Uno',
  fiscalAddress: { countryCode: 'VE', addressLine: 'Caracas' },
  taxIdentity: { country: 'VE', type: 'RIF', value: 'J-12345678-9' },
  status, createdAt: new Date('2026-08-01T00:00:00.000Z')
});

class FakeSuppliers implements SupplierRepository {
  constructor(private supplier: Supplier | null = supplierFixture()) {}
  nextCode = async (): Promise<string> => 'SUP-000001';
  save = async (supplier: Supplier): Promise<void> => { this.supplier = supplier; };
  findById = async (id: string): Promise<Supplier | null> => this.supplier?.id === id ? this.supplier : null;
  findByTaxIdentity = async (): Promise<Supplier | null> => null;
  findAll = async (): Promise<readonly Supplier[]> => this.supplier ? [this.supplier] : [];
}

const productFixture = (): Product => Product.create({
  id: 'product-001', name: 'Café molido', description: 'Café de prueba', categoryId: 'category-001',
  unitOfMeasure: UnitOfMeasure.create({ id: 'unit-001', code: 'KG', name: 'Kilogramo', quantityScale: 0 }),
  barcodes: [Barcode.create({ id: 'barcode-001', value: '759000000001' })],
  price: Money.fromMinorUnits(1250, 'USD'), taxRate: TaxRate.fromBasisPoints(1600),
  priceHistoryId: 'price-001', recordedBy: 'user-001',
  occurredAt: new Date('2026-08-15T10:00:00.000Z'), eventId: 'product-event-001'
});

class FakeProducts implements ProductRepository {
  constructor(private readonly product: Product | null = productFixture()) {}
  save = async (): Promise<void> => {};
  findById = async (productId: string): Promise<Product | null> =>
    this.product?.id === productId ? this.product : null;
  findByActiveBarcode = async (): Promise<Product | null> => null;
}

class FakeStockItems implements StockItemRepository {
  readonly values = new Map<string, StockItem>();
  save = async (item: StockItem): Promise<void> => { this.values.set(item.id, item); };
  findById = async (id: string): Promise<StockItem | null> => this.values.get(id) ?? null;
  findByProductId = async (productId: string): Promise<StockItem | null> =>
    [...this.values.values()].find((item) => item.productId === productId) ?? null;
}

class FakeExchangeRates implements ExchangeRateRepository {
  constructor(private readonly rates: ExchangeRate[] = []) {}
  save = async (): Promise<void> => {};
  findCurrentByPair = async (): Promise<ExchangeRate | null> => null;
  findById = async (id: string): Promise<ExchangeRate | null> =>
    this.rates.find((rate) => rate.id === id) ?? null;
}

const sequence = (prefix: string): IdGenerator => {
  let value = 0;
  return { generate: () => `${prefix}-${++value}` };
};
const clock = { now: () => new Date('2026-09-04T10:00:00.000Z') };
const unitOfWork: UnitOfWork = { execute: async (work) => work() };
const evidence = () => ({ ledger: [] as string[], audit: [] as AuditEntry[] });
const eventStore = (ledger: string[]): BusinessEventStore => ({
  append: async (events) => { ledger.push(...events.map((event) => event.eventType)); },
  findByAggregate: async () => []
});
const auditWriter = (audit: AuditEntry[]): AuditWriter => ({
  append: async (entries) => { audit.push(...entries); }
});
const allow = (...permissions: string[]) => ({
  authorize: async (_context: ExecutionContext, permission: string) => permissions.includes(permission)
});

const startService = (options: {
  receipts?: FakePurchaseReceipts; suppliers?: FakeSuppliers; products?: FakeProducts;
  stockItems?: FakeStockItems; exchangeRates?: FakeExchangeRates;
  authorize?: (context: ExecutionContext, permission: string) => Promise<boolean>;
} = {}): StartPurchaseReceipt => new StartPurchaseReceipt(
  options.receipts ?? new FakePurchaseReceipts(), options.suppliers ?? new FakeSuppliers(),
  options.products ?? new FakeProducts(), options.stockItems ?? new FakeStockItems(),
  options.exchangeRates ?? new FakeExchangeRates(),
  { authorize: options.authorize ?? (async () => true) },
  sequence('receipt'), sequence('line'), sequence('stock'), sequence('batch'), sequence('audit'),
  clock, unitOfWork, auditWriter([])
);

describe('purchase receipt use cases', () => {
  it('starts a draft, completes it and derives the moving weighted cost on a second receipt', async () => {
    const receipts = new FakePurchaseReceipts();
    const suppliers = new FakeSuppliers();
    const products = new FakeProducts();
    const stockItems = new FakeStockItems();
    const recorded = evidence();
    const start = startService({ receipts, suppliers, products, stockItems });
    const complete = new CompletePurchaseReceipt(
      receipts, suppliers, stockItems, allow(PURCHASE_RECEIPT_PERMISSIONS.COMPLETE),
      sequence('movement'), sequence('event'), sequence('audit'), clock, unitOfWork,
      eventStore(recorded.ledger), auditWriter(recorded.audit)
    );

    const draft = await start.execute({
      supplierId: 'supplier-001', reason: 'Compra inicial',
      sourceDocument: { type: 'INVOICE', number: 'FAC-001' }, effectiveAt: new Date('2026-09-04T09:00:00Z'),
      lines: [{ productId: 'product-001', quantity: '10', purchaseUnitCostMinorUnits: 100, purchaseCurrency: 'USD' }]
    }, context);
    expect(draft).toMatchObject({ ok: true, value: { status: 'DRAFT', id: 'receipt-1' } });
    expect(stockItems.values.size).toBe(0);

    const completed = await complete.execute({ receiptId: 'receipt-1', reason: 'Recepción confirmada' }, context);
    expect(completed).toMatchObject({ ok: true, value: { status: 'COMPLETED' } });
    const item = stockItems.values.get('stock-1');
    expect(item?.balance.scaledValue).toBe(10);
    expect(item?.averageUnitCost?.minorUnits).toBe(100);
    expect(recorded.ledger).toEqual(['StockMovementRegistered', 'PurchaseReceiptCompleted']);
    expect(recorded.audit).toMatchObject([{ action: 'PURCHASE_RECEIPT_COMPLETED' }]);

    const secondDraft = await start.execute({
      supplierId: 'supplier-001', reason: 'Segunda compra',
      sourceDocument: { type: 'INVOICE', number: 'FAC-002' }, effectiveAt: new Date('2026-09-05T09:00:00Z'),
      lines: [{ productId: 'product-001', quantity: '10', purchaseUnitCostMinorUnits: 200, purchaseCurrency: 'USD' }]
    }, context);
    expect(secondDraft.ok).toBe(true);
    await complete.execute({ receiptId: 'receipt-2', reason: 'Segunda recepción' }, context);
    expect(stockItems.values.get('stock-1')?.averageUnitCost?.minorUnits).toBe(150);

    const duplicate = await complete.execute({ receiptId: 'receipt-2', reason: 'Reintento' }, context);
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'PURCHASE_RECEIPT_INVALID_STATE' } });
  });

  it('rejects starting a draft for a Venezuelan supplier without a fiscal address', async () => {
    const supplierWithoutAddress = Supplier.create({
      id: 'supplier-002', code: 'SUP-000002', legalName: 'Proveedor Sin Domicilio',
      taxIdentity: { country: 'VE', type: 'RIF', value: 'J-99999999-0' },
      createdAt: new Date('2026-08-01T00:00:00.000Z')
    });
    const start = startService({ suppliers: new FakeSuppliers(supplierWithoutAddress) });
    const noAddress = await start.execute({
      supplierId: 'supplier-002', reason: 'Compra',
      sourceDocument: { type: 'INVOICE', number: 'FAC-010' }, effectiveAt: new Date('2026-09-04T09:00:00Z'),
      lines: [{ productId: 'product-001', quantity: '1', purchaseUnitCostMinorUnits: 100, purchaseCurrency: 'USD' }]
    }, context);
    expect(noAddress).toMatchObject({ ok: false, error: { code: 'PURCHASE_RECEIPT_FISCAL_ADDRESS_REQUIRED' } });
  });

  it('returns the stable duplicate-source error for a repeated control number', async () => {
    const receipts = new FakePurchaseReceipts();
    const suppliers = new FakeSuppliers();
    const stockItems = new FakeStockItems();
    const start = startService({ receipts, suppliers, stockItems });
    const complete = new CompletePurchaseReceipt(
      receipts, suppliers, stockItems, allow(PURCHASE_RECEIPT_PERMISSIONS.COMPLETE),
      sequence('movement'), sequence('event'), sequence('audit'), clock, unitOfWork,
      eventStore([]), auditWriter([])
    );
    for (const number of ['FAC-020', 'FAC-021']) {
      await start.execute({
        supplierId: 'supplier-001', reason: 'Compra',
        sourceDocument: { type: 'INVOICE', number, controlNumber: '00-000123' },
        effectiveAt: new Date('2026-09-04T09:00:00Z'),
        lines: [{ productId: 'product-001', quantity: '1', purchaseUnitCostMinorUnits: 100, purchaseCurrency: 'USD' }]
      }, context);
    }

    expect((await complete.execute({ receiptId: 'receipt-1', reason: 'Recepción' }, context)).ok).toBe(true);
    expect(await complete.execute({ receiptId: 'receipt-2', reason: 'Recepción' }, context))
      .toMatchObject({ ok: false, error: { code: 'PURCHASE_RECEIPT_SOURCE_DUPLICATED' } });
  });

  it('rejects completing a receipt once its supplier is no longer active', async () => {
    const receipts = new FakePurchaseReceipts();
    const suppliers = new FakeSuppliers();
    const stockItems = new FakeStockItems();
    await startService({ receipts, suppliers, stockItems }).execute({
      supplierId: 'supplier-001', reason: 'Compra',
      sourceDocument: { type: 'INVOICE', number: 'FAC-011' }, effectiveAt: new Date('2026-09-04T09:00:00Z'),
      lines: [{ productId: 'product-001', quantity: '1', purchaseUnitCostMinorUnits: 100, purchaseCurrency: 'USD' }]
    }, context);
    await suppliers.save(supplierFixture('BLOCKED'));
    const complete = new CompletePurchaseReceipt(
      receipts, suppliers, stockItems, allow(PURCHASE_RECEIPT_PERMISSIONS.COMPLETE),
      sequence('movement'), sequence('event'), sequence('audit'), clock, unitOfWork,
      eventStore([]), auditWriter([])
    );
    const result = await complete.execute({ receiptId: 'receipt-1', reason: 'Recepción' }, context);
    expect(result).toMatchObject({ ok: false, error: { code: 'SUPPLIER_NOT_ACTIVE' } });
  });

  it('rejects completing the same source document twice for a supplier', async () => {
    const receipts = new FakePurchaseReceipts();
    const suppliers = new FakeSuppliers();
    const stockItems = new FakeStockItems();
    const start = startService({ receipts, suppliers, stockItems });
    const complete = new CompletePurchaseReceipt(
      receipts, suppliers, stockItems, allow(PURCHASE_RECEIPT_PERMISSIONS.COMPLETE),
      sequence('movement'), sequence('event'), sequence('audit'), clock, unitOfWork,
      eventStore([]), auditWriter([])
    );
    for (const number of ['FAC-100', 'FAC-101']) {
      await start.execute({
        supplierId: 'supplier-001', reason: 'Compra', sourceDocument: { type: 'INVOICE', number },
        effectiveAt: new Date('2026-09-04T09:00:00Z'),
        lines: [{ productId: 'product-001', quantity: '1', purchaseUnitCostMinorUnits: 100, purchaseCurrency: 'USD' }]
      }, context);
    }
    expect((await complete.execute({ receiptId: 'receipt-1', reason: 'Primera' }, context)).ok).toBe(true);

    const secondDraft = await start.execute({
      supplierId: 'supplier-001', reason: 'Compra duplicada', sourceDocument: { type: 'INVOICE', number: 'fac-100' },
      effectiveAt: new Date('2026-09-04T09:00:00Z'),
      lines: [{ productId: 'product-001', quantity: '1', purchaseUnitCostMinorUnits: 100, purchaseCurrency: 'USD' }]
    }, context);
    expect(secondDraft.ok).toBe(true);
    const result = await complete.execute(
      { receiptId: secondDraft.ok ? secondDraft.value.id : '', reason: 'Reintento duplicado' }, context
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'PURCHASE_RECEIPT_SOURCE_DUPLICATED' } });
  });

  it('requires an exchange rate snapshot to convert a line into the item valuation currency', async () => {
    const receipts = new FakePurchaseReceipts();
    const suppliers = new FakeSuppliers();
    const stockItems = new FakeStockItems();
    const start = startService({ receipts, suppliers, stockItems });
    await start.execute({
      supplierId: 'supplier-001', reason: 'Compra base', sourceDocument: { type: 'INVOICE', number: 'FAC-200' },
      effectiveAt: new Date('2026-09-04T09:00:00Z'),
      lines: [{ productId: 'product-001', quantity: '1', purchaseUnitCostMinorUnits: 100, purchaseCurrency: 'USD' }]
    }, context);
    await new CompletePurchaseReceipt(
      receipts, suppliers, stockItems, allow(PURCHASE_RECEIPT_PERMISSIONS.COMPLETE),
      sequence('movement'), sequence('event'), sequence('audit'), clock, unitOfWork,
      eventStore([]), auditWriter([])
    ).execute({ receiptId: 'receipt-1', reason: 'Primera recepción' }, context);

    const missingRate = await start.execute({
      supplierId: 'supplier-001', reason: 'Compra en euros', sourceDocument: { type: 'INVOICE', number: 'FAC-201' },
      effectiveAt: new Date('2026-09-05T09:00:00Z'),
      lines: [{ productId: 'product-001', quantity: '1', purchaseUnitCostMinorUnits: 100, purchaseCurrency: 'EUR' }]
    }, context);
    expect(missingRate).toMatchObject({ ok: false, error: { code: 'PURCHASE_RECEIPT_EXCHANGE_RATE_REQUIRED' } });

    const rate = ExchangeRate.create({
      id: 'rate-1', baseCurrency: 'USD', quoteCurrency: 'EUR', rateValue: 110, rateScale: 2,
      source: 'BCV', validFrom: new Date('2026-09-01T00:00:00Z'), registeredBy: 'user-001'
    });
    const withRate = await startService({
      receipts, suppliers, stockItems, exchangeRates: new FakeExchangeRates([rate])
    }).execute({
      supplierId: 'supplier-001', reason: 'Compra en euros', sourceDocument: { type: 'INVOICE', number: 'FAC-201' },
      effectiveAt: new Date('2026-09-05T09:00:00Z'),
      lines: [{
        productId: 'product-001', quantity: '1', purchaseUnitCostMinorUnits: 100,
        purchaseCurrency: 'EUR', exchangeRateId: 'rate-1'
      }]
    }, context);
    expect(withRate.ok).toBe(true);
    if (withRate.ok) {
      expect(withRate.value.lines[0]).toMatchObject({
        purchaseCurrency: 'EUR', valuationCurrency: 'USD', exchangeRateId: 'rate-1'
      });
    }
  });

  it('reverses a completed receipt with the frozen original cost and blocks it when stock was already sold', async () => {
    const receipts = new FakePurchaseReceipts();
    const suppliers = new FakeSuppliers();
    const stockItems = new FakeStockItems();
    const recorded = evidence();
    await startService({ receipts, suppliers, stockItems }).execute({
      supplierId: 'supplier-001', reason: 'Compra', sourceDocument: { type: 'INVOICE', number: 'FAC-300' },
      effectiveAt: new Date('2026-09-04T09:00:00Z'),
      lines: [{ productId: 'product-001', quantity: '10', purchaseUnitCostMinorUnits: 100, purchaseCurrency: 'USD' }]
    }, context);
    await new CompletePurchaseReceipt(
      receipts, suppliers, stockItems, allow(PURCHASE_RECEIPT_PERMISSIONS.COMPLETE),
      sequence('movement'), sequence('event'), sequence('audit'), clock, unitOfWork,
      eventStore(recorded.ledger), auditWriter(recorded.audit)
    ).execute({ receiptId: 'receipt-1', reason: 'Recepción' }, context);

    const reverse = new ReversePurchaseReceipt(
      receipts, stockItems, allow(PURCHASE_RECEIPT_PERMISSIONS.REVERSE),
      sequence('reversal-movement'), sequence('reversal-event'), sequence('reversal-audit'),
      clock, unitOfWork, eventStore(recorded.ledger), auditWriter(recorded.audit)
    );
    const reversed = await reverse.execute({ receiptId: 'receipt-1', reason: 'Documento duplicado' }, context);
    expect(reversed).toMatchObject({ ok: true, value: { status: 'REVERSED' } });
    const item = stockItems.values.get('stock-1');
    expect(item?.balance.scaledValue).toBe(0);
    expect(item?.movements.at(-1)).toMatchObject({ type: 'ADJUSTMENT_OUT', unitCost: { minorUnits: 100 } });
    const movementCount = item?.movements.length;
    const repeated = await reverse.execute({ receiptId: 'receipt-1', reason: 'Otro intento' }, context);
    expect(repeated).toMatchObject({ ok: false, error: { code: 'PURCHASE_RECEIPT_INVALID_STATE' } });
    expect(item?.movements).toHaveLength(movementCount ?? 0);

    const overSold = new FakePurchaseReceipts();
    const overSoldStock = new FakeStockItems();
    await startService({ receipts: overSold, suppliers, stockItems: overSoldStock }).execute({
      supplierId: 'supplier-001', reason: 'Compra', sourceDocument: { type: 'INVOICE', number: 'FAC-301' },
      effectiveAt: new Date('2026-09-04T09:00:00Z'),
      lines: [{ productId: 'product-001', quantity: '5', purchaseUnitCostMinorUnits: 100, purchaseCurrency: 'USD' }]
    }, context);
    await new CompletePurchaseReceipt(
      overSold, suppliers, overSoldStock, allow(PURCHASE_RECEIPT_PERMISSIONS.COMPLETE),
      sequence('movement-2'), sequence('event-2'), sequence('audit-2'), clock, unitOfWork,
      eventStore([]), auditWriter([])
    ).execute({ receiptId: 'receipt-1', reason: 'Recepción' }, context);
    const soldOutItem = overSoldStock.values.get('stock-1')!;
    soldOutItem.registerMovement({
      id: 'sale-1', type: 'SALE_ISSUE', quantity: Quantity.fromScaled(5, 0), actorId: 'user-001',
      reason: 'Venta', referenceId: 'sale-ref-1', occurredAt: new Date('2026-09-05T09:00:00Z'),
      eventId: 'sale-event-1'
    });
    await overSoldStock.save(soldOutItem);
    const blocked = await new ReversePurchaseReceipt(
      overSold, overSoldStock, allow(PURCHASE_RECEIPT_PERMISSIONS.REVERSE),
      sequence('blocked-movement'), sequence('blocked-event'), sequence('blocked-audit'),
      clock, unitOfWork, eventStore([]), auditWriter([])
    ).execute({ receiptId: 'receipt-1', reason: 'Documento duplicado' }, context);
    expect(blocked).toMatchObject({ ok: false, error: { code: 'STOCK_INSUFFICIENT' } });
  });
});
