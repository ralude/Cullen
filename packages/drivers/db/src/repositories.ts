import {
  Barcode,
  Batch,
  CashMovement,
  CashRegister,
  Category,
  Discount,
  ExchangeRate,
  Payment,
  PaymentMethod,
  PriceHistory,
  Product,
  CostSnapshot,
  ProductSnapshot,
  Sale,
  SaleItem,
  Shift,
  StockItem,
  StockMovement,
  UnitOfMeasure,
  type CashRegisterRepository,
  type CategoryRepository,
  type ExchangeRateHistoryRepository,
  type ExchangeRateRepository,
  type PaymentMethodKind,
  type PaymentMethodRepository,
  type ProductRepository,
  type SaleRecipientSnapshot,
  type SaleRepository,
  type ShiftRepository,
  type StockItemRepository,
  type UnitOfMeasureRepository
} from '@supermarket/core';
import { InfrastructureError, Money, Percentage, Quantity, TaxRate } from '@supermarket/shared';
import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import type { DatabaseHandle } from './connection.js';
import {
  cashMovements,
  cashRegisters,
  categories,
  exchangeRates,
  paymentMethods,
  productBarcodes,
  productPriceHistory,
  products,
  saleDiscounts,
  saleItems,
  salePayments,
  sales,
  shiftClosingBalances,
  shifts,
  stockBatches,
  stockItems,
  stockMovements,
  unitsOfMeasure
} from './schema.js';
import { mapDatabaseError, requireTransaction } from './unit-of-work.js';

const read = async <T>(operation: () => T): Promise<T> => {
  try {
    return operation();
  } catch (error) {
    throw mapDatabaseError(error);
  }
};

export class DrizzleCategoryRepository implements CategoryRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  /**
   * Devuelve la versión persistida del maestro. La incrementa el propio
   * `insert`, así que dos escrituras concurrentes no pueden leer la misma
   * versión y publicar dos referencias indistinguibles.
   */
  async save(category: Category): Promise<number> {
    requireTransaction(this.handle.sqlite);
    return this.handle.sqlite.prepare(`
      insert into categories (id, name, is_active, version) values (?, ?, ?, 1)
      on conflict(id) do update
        set name = excluded.name, is_active = excluded.is_active, version = version + 1
      returning version
    `).pluck().get(category.id, category.name, category.isActive ? 1 : 0) as number;
  }

  findById(id: string): Promise<Category | null> {
    return read(() => {
      const row = this.handle.db.select().from(categories).where(eq(categories.id, id)).get();
      return row ? Category.create(row) : null;
    });
  }

  findAll(): Promise<readonly Category[]> {
    return read(() => this.handle.db.select().from(categories).all().map((row) => Category.create(row)));
  }
}

export class DrizzleUnitOfMeasureRepository implements UnitOfMeasureRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(unit: UnitOfMeasure): Promise<number> {
    requireTransaction(this.handle.sqlite);
    return this.handle.sqlite.prepare(`
      insert into units_of_measure (id, code, name, quantity_scale, is_active, version)
      values (?, ?, ?, ?, ?, 1)
      on conflict(id) do update
        set code = excluded.code, name = excluded.name,
          quantity_scale = excluded.quantity_scale, is_active = excluded.is_active,
          version = version + 1
      returning version
    `).pluck().get(
      unit.id, unit.code, unit.name, unit.quantityScale, unit.isActive ? 1 : 0
    ) as number;
  }

  findByCode(code: string): Promise<UnitOfMeasure | null> {
    return read(() => {
      const row = this.handle.db.select().from(unitsOfMeasure)
        .where(eq(unitsOfMeasure.code, code)).get();
      return row ? UnitOfMeasure.create(row) : null;
    });
  }

  findAll(): Promise<readonly UnitOfMeasure[]> {
    return read(() => this.handle.db.select().from(unitsOfMeasure).all().map((row) => UnitOfMeasure.create(row)));
  }
}

export class DrizzlePaymentMethodRepository implements PaymentMethodRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(method: PaymentMethod): Promise<void> {
    requireTransaction(this.handle.sqlite);
    this.handle.db.insert(paymentMethods).values({ ...method, version: 1 }).onConflictDoUpdate({
      target: paymentMethods.code,
      set: {
        name: method.name,
        kind: method.kind,
        currencyCode: method.currencyCode,
        isActive: method.isActive
      }
    }).run();
  }

  findByCode(code: string): Promise<PaymentMethod | null> {
    return read(() => {
      const row = this.handle.db.select().from(paymentMethods)
        .where(eq(paymentMethods.code, code)).get();
      return row ? PaymentMethod.create({ ...row, kind: row.kind as PaymentMethodKind }) : null;
    });
  }

  findAll(): Promise<readonly PaymentMethod[]> {
    return read(() => this.handle.db.select().from(paymentMethods).all()
      .map((row) => PaymentMethod.create({ ...row, kind: row.kind as PaymentMethodKind })));
  }
}

export class DrizzleCashRegisterRepository implements CashRegisterRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(register: CashRegister): Promise<void> {
    requireTransaction(this.handle.sqlite);
    this.handle.db.insert(cashRegisters).values(register).onConflictDoUpdate({
      target: cashRegisters.id,
      set: {
        name: register.name,
        terminalId: register.terminalId,
        originNodeId: register.originNodeId,
        isActive: register.isActive
      }
    }).run();
  }

  findById(id: string): Promise<CashRegister | null> {
    return read(() => {
      const row = this.handle.db.select().from(cashRegisters)
        .where(eq(cashRegisters.id, id)).get();
      return row ? CashRegister.create(row) : null;
    });
  }

  findAll(): Promise<readonly CashRegister[]> {
    return read(() => this.handle.db.select().from(cashRegisters).all().map((row) => CashRegister.create(row)));
  }
}

export class DrizzleExchangeRateRepository implements ExchangeRateRepository, ExchangeRateHistoryRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(rate: ExchangeRate): Promise<number> {
    requireTransaction(this.handle.sqlite);
    const version = ((this.handle.sqlite.prepare(`
      select max(version) from exchange_rates where base_currency = ? and quote_currency = ?
    `).pluck().get(rate.baseCurrency, rate.quoteCurrency) as number | null) ?? 0) + 1;
    this.handle.db.insert(exchangeRates).values({
      id: rate.id,
      baseCurrency: rate.baseCurrency,
      quoteCurrency: rate.quoteCurrency,
      rateValue: rate.rateValue,
      rateScale: rate.rateScale,
      source: rate.source,
      validFrom: rate.validFrom.getTime(),
      validUntil: rate.validUntil?.getTime() ?? null,
      registeredBy: rate.registeredBy,
      version
    }).run();
    return version;
  }

  findById(id: string): Promise<ExchangeRate | null> {
    return read(() => this.restore(this.handle.db.select().from(exchangeRates)
      .where(eq(exchangeRates.id, id)).get()));
  }

  findCurrentByPair(base: string, quote: string, at: Date): Promise<ExchangeRate | null> {
    return read(() => this.restore(this.handle.db.select().from(exchangeRates).where(and(
      eq(exchangeRates.baseCurrency, base),
      eq(exchangeRates.quoteCurrency, quote),
      lte(exchangeRates.validFrom, at.getTime()),
      or(isNull(exchangeRates.validUntil), gt(exchangeRates.validUntil, at.getTime()))
    )).orderBy(desc(exchangeRates.validFrom)).get()));
  }

  findHistoryByPair(base: string, quote: string, limit = 100): Promise<readonly ExchangeRate[]> {
    return read(() => this.handle.db.select().from(exchangeRates).where(and(
      eq(exchangeRates.baseCurrency, base), eq(exchangeRates.quoteCurrency, quote)
    )).orderBy(desc(exchangeRates.validFrom), desc(exchangeRates.id)).limit(limit).all()
      .map((row) => this.restore(row) as ExchangeRate));
  }

  private restore(row: typeof exchangeRates.$inferSelect | undefined): ExchangeRate | null {
    return row ? ExchangeRate.create({
      ...row,
      validFrom: new Date(row.validFrom),
      validUntil: row.validUntil === null ? null : new Date(row.validUntil)
    }) : null;
  }
}

export class DrizzleProductRepository implements ProductRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(product: Product): Promise<void> {
    requireTransaction(this.handle.sqlite);
    this.handle.db.insert(products).values({
      id: product.id,
      name: product.name,
      description: product.description,
      categoryId: product.categoryId,
      unitId: product.unitOfMeasure.id,
      priceMinorUnits: product.price.minorUnits,
      currencyCode: product.price.currency,
      taxRateBasisPoints: product.taxRate.basisPoints,
      isActive: product.isActive,
      version: product.version
    }).onConflictDoUpdate({
      target: products.id,
      set: {
        name: product.name,
        description: product.description,
        categoryId: product.categoryId,
        unitId: product.unitOfMeasure.id,
        priceMinorUnits: product.price.minorUnits,
        currencyCode: product.price.currency,
        taxRateBasisPoints: product.taxRate.basisPoints,
        isActive: product.isActive,
        version: product.version
      }
    }).run();
    this.handle.db.delete(productBarcodes).where(eq(productBarcodes.productId, product.id)).run();
    if (product.barcodes.length > 0) {
      this.handle.db.insert(productBarcodes).values(product.barcodes.map((barcode) => ({
        id: barcode.id,
        productId: product.id,
        value: barcode.value,
        isActive: barcode.isActive
      }))).run();
    }
    this.handle.db.delete(productPriceHistory)
      .where(eq(productPriceHistory.productId, product.id)).run();
    this.handle.db.insert(productPriceHistory).values(product.priceHistory.map((history) => ({
      id: history.id,
      productId: product.id,
      priceMinorUnits: history.price.minorUnits,
      currencyCode: history.price.currency,
      recordedAt: history.recordedAt.getTime(),
      recordedBy: history.recordedBy,
      reason: history.reason ?? ''
    }))).run();
  }

  findById(id: string): Promise<Product | null> {
    return read(() => this.restore(this.handle.db.select().from(products)
      .where(eq(products.id, id)).get()));
  }

  findByActiveBarcode(value: string): Promise<Product | null> {
    return read(() => {
      const barcode = this.handle.db.select().from(productBarcodes).where(and(
        eq(productBarcodes.value, value),
        eq(productBarcodes.isActive, true)
      )).get();
      return barcode ? this.restore(this.handle.db.select().from(products)
        .where(eq(products.id, barcode.productId)).get()) : null;
    });
  }

  private restore(row: typeof products.$inferSelect | undefined): Product | null {
    if (!row) return null;
    const unitRow = this.handle.db.select().from(unitsOfMeasure)
      .where(eq(unitsOfMeasure.id, row.unitId)).get();
    if (!unitRow) throw new Error('Persisted product unit is missing.');
    const barcodeRows = this.handle.db.select().from(productBarcodes)
      .where(eq(productBarcodes.productId, row.id)).all();
    const histories = this.handle.db.select().from(productPriceHistory)
      .where(eq(productPriceHistory.productId, row.id))
      .orderBy(productPriceHistory.recordedAt).all();
    return Product.restore({
      id: row.id,
      name: row.name,
      description: row.description,
      categoryId: row.categoryId,
      unitOfMeasure: UnitOfMeasure.create(unitRow),
      barcodes: barcodeRows.map((barcode) => Barcode.create(barcode)),
      price: Money.fromMinorUnits(row.priceMinorUnits, row.currencyCode),
      taxRate: TaxRate.fromBasisPoints(row.taxRateBasisPoints),
      priceHistory: histories.map((history) => PriceHistory.create({
        id: history.id,
        price: Money.fromMinorUnits(history.priceMinorUnits, history.currencyCode),
        recordedAt: new Date(history.recordedAt),
        recordedBy: history.recordedBy,
        reason: history.reason
      })),
      isActive: row.isActive,
      version: row.version
    });
  }
}

const recipientColumns = (sale: Sale) => ({
  recipientCountry: sale.recipient?.country ?? null,
  recipientType: sale.recipient?.type ?? null,
  recipientValue: sale.recipient?.value ?? null,
  recipientNormalizedValue: sale.recipient?.normalizedValue ?? null,
  recipientName: sale.recipient?.name ?? null,
  recipientAddress: sale.recipient?.address ?? null
});

const restoreRecipient = (
  row: typeof sales.$inferSelect
): SaleRecipientSnapshot | null => {
  if (row.recipientCountry === null) return null;
  if (row.recipientType === null || row.recipientValue === null ||
    row.recipientNormalizedValue === null) {
    throw new Error('Persisted sale recipient snapshot is incomplete.');
  }
  return {
    country: row.recipientCountry,
    type: row.recipientType,
    value: row.recipientValue,
    normalizedValue: row.recipientNormalizedValue,
    name: row.recipientName,
    address: row.recipientAddress
  };
};

export class DrizzleSaleRepository implements SaleRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(sale: Sale): Promise<void> {
    requireTransaction(this.handle.sqlite);
    const existing = this.handle.db.select({ status: sales.status, version: sales.version })
      .from(sales).where(eq(sales.id, sale.id)).get();
    if (existing && existing.status !== 'DRAFT') {
      throw new InfrastructureError(
        'SALE_FINAL_STATE_IMMUTABLE',
        'A completed or voided sale cannot be overwritten.'
      );
    }
    if (existing && sale.version < existing.version) {
      throw new InfrastructureError('DATABASE_CONCURRENCY_CONFLICT', 'Sale version is stale.');
    }

    this.handle.db.insert(sales).values({
      id: sale.id,
      shiftId: sale.shiftId,
      currencyCode: sale.currencyCode,
      terminalId: sale.terminalId,
      originNodeId: sale.originNodeId,
      startedBy: sale.startedBy,
      startedAt: sale.startedAt.getTime(),
      status: sale.status,
      version: sale.version,
      financialTransactionTaxMinorUnits: sale.financialTransactionTax.minorUnits,
      completedAt: sale.completedAt?.getTime() ?? null,
      voidedAt: sale.voidedAt?.getTime() ?? null,
      voidReason: sale.voidReason,
      voidedBy: sale.voidedBy,
      ...recipientColumns(sale)
    }).onConflictDoUpdate({
      target: sales.id,
      set: {
        status: sale.status,
        version: sale.version,
        financialTransactionTaxMinorUnits: sale.financialTransactionTax.minorUnits,
        completedAt: sale.completedAt?.getTime() ?? null,
        voidedAt: sale.voidedAt?.getTime() ?? null,
        voidReason: sale.voidReason,
        voidedBy: sale.voidedBy,
        ...recipientColumns(sale)
      }
    }).run();
    this.handle.db.delete(saleDiscounts).where(eq(saleDiscounts.saleId, sale.id)).run();
    this.handle.db.delete(saleItems).where(eq(saleItems.saleId, sale.id)).run();
    this.handle.db.delete(salePayments).where(eq(salePayments.saleId, sale.id)).run();

    if (sale.items.length > 0) {
      this.handle.db.insert(saleItems).values(sale.items.map((item) => ({
        id: item.id,
        saleId: sale.id,
        productId: item.snapshot.productId,
        description: item.snapshot.description,
        priceMinorUnits: item.snapshot.price.minorUnits,
        currencyCode: item.snapshot.price.currency,
        taxRateBasisPoints: item.snapshot.taxRate.basisPoints,
        unitCode: item.snapshot.unitCode,
        unitScale: item.snapshot.unitScale,
        quantityScaled: item.quantity.scaledValue,
        quantityScale: item.quantity.scale,
        costUnitMinorUnits: item.snapshot.costSnapshot?.unitCost.minorUnits ?? null,
        costCurrencyCode: item.snapshot.costSnapshot?.unitCost.currency ?? null,
        costVersion: item.snapshot.costSnapshot?.version ?? null,
        costSource: item.snapshot.costSnapshot?.source ?? null,
        costObservedAt: item.snapshot.costSnapshot?.observedAt.getTime() ?? null
      }))).run();
      const discounts = sale.items.flatMap((item) => item.discount ? [{
        id: item.discount.id,
        saleId: sale.id,
        itemId: item.id,
        percentageBasisPoints: item.discount.percentage.basisPoints,
        amountMinorUnits: item.discount.amount.minorUnits,
        currencyCode: item.discount.amount.currency,
        reason: item.discount.reason,
        appliedBy: item.discount.appliedBy,
        appliedAt: item.discount.appliedAt.getTime()
      }] : []);
      if (discounts.length > 0) this.handle.db.insert(saleDiscounts).values(discounts).run();
    }
    if (sale.payments.length > 0) {
      this.handle.db.insert(salePayments).values(sale.payments.map((payment) => ({
        id: payment.id,
        saleId: sale.id,
        paymentMethodCode: payment.method.code,
        paymentMethodName: payment.method.name,
        paymentMethodKind: payment.method.kind,
        amountMinorUnits: payment.amount.minorUnits,
        currencyCode: payment.amount.currency,
        amountInSaleCurrencyMinorUnits: payment.amountInSaleCurrency.minorUnits,
        saleCurrencyCode: payment.amountInSaleCurrency.currency,
        exchangeRateId: payment.exchangeRate?.id ?? null,
        exchangeRateBaseCurrency: payment.exchangeRate?.baseCurrency ?? null,
        exchangeRateQuoteCurrency: payment.exchangeRate?.quoteCurrency ?? null,
        exchangeRateValue: payment.exchangeRate?.rateValue ?? null,
        exchangeRateScale: payment.exchangeRate?.rateScale ?? null,
        exchangeRateSource: payment.exchangeRate?.source ?? null,
        exchangeRateValidFrom: payment.exchangeRate?.validFrom.getTime() ?? null,
        exchangeRateValidUntil: payment.exchangeRate?.validUntil?.getTime() ?? null,
        exchangeRateRegisteredBy: payment.exchangeRate?.registeredBy ?? null,
        registeredBy: payment.registeredBy,
        registeredAt: payment.registeredAt.getTime()
      }))).run();
    }
  }

  findById(id: string): Promise<Sale | null> {
    return read(() => {
      const row = this.handle.db.select().from(sales).where(eq(sales.id, id)).get();
      if (!row) return null;
      const itemRows = this.handle.db.select().from(saleItems)
        .where(eq(saleItems.saleId, id)).all();
      const discountRows = this.handle.db.select().from(saleDiscounts)
        .where(eq(saleDiscounts.saleId, id)).all();
      const discountsByItem = new Map(discountRows.map((discount) => [discount.itemId, discount]));
      const items = itemRows.map((item) => {
        const discount = discountsByItem.get(item.id);
        return SaleItem.restore({
          id: item.id,
          snapshot: ProductSnapshot.create({
            productId: item.productId,
            description: item.description,
            price: Money.fromMinorUnits(item.priceMinorUnits, item.currencyCode),
            taxRate: TaxRate.fromBasisPoints(item.taxRateBasisPoints),
            unitCode: item.unitCode,
            unitScale: item.unitScale,
            costSnapshot: item.costUnitMinorUnits === null || item.costCurrencyCode === null ||
              item.costVersion === null || item.costSource === null ||
              item.costObservedAt === null
              ? null
              : CostSnapshot.create({
                unitCost: Money.fromMinorUnits(item.costUnitMinorUnits, item.costCurrencyCode),
                version: item.costVersion,
                source: item.costSource,
                observedAt: new Date(item.costObservedAt)
              })
          }),
          quantity: Quantity.fromScaled(item.quantityScaled, item.quantityScale),
          discount: discount ? Discount.create({
            id: discount.id,
            lineItemId: item.id,
            percentage: Percentage.fromBasisPoints(discount.percentageBasisPoints),
            amount: Money.fromMinorUnits(discount.amountMinorUnits, discount.currencyCode),
            reason: discount.reason,
            appliedBy: discount.appliedBy,
            appliedAt: new Date(discount.appliedAt)
          }) : null
        });
      });
      const payments = this.handle.db.select().from(salePayments)
        .where(eq(salePayments.saleId, id)).all().map((payment) => Payment.create({
          id: payment.id,
          method: PaymentMethod.create({
            code: payment.paymentMethodCode,
            name: payment.paymentMethodName,
            kind: payment.paymentMethodKind as PaymentMethodKind,
            currencyCode: payment.currencyCode
          }),
          amount: Money.fromMinorUnits(payment.amountMinorUnits, payment.currencyCode),
          amountInSaleCurrency: Money.fromMinorUnits(
            payment.amountInSaleCurrencyMinorUnits,
            payment.saleCurrencyCode
          ),
          exchangeRate: this.restorePaymentRate(payment),
          registeredBy: payment.registeredBy,
          registeredAt: new Date(payment.registeredAt)
        }));
      return Sale.restore({
        id: row.id,
        shiftId: row.shiftId,
        currencyCode: row.currencyCode,
        terminalId: row.terminalId,
        originNodeId: row.originNodeId,
        startedBy: row.startedBy,
        startedAt: new Date(row.startedAt),
        status: row.status as Parameters<typeof Sale.restore>[0]['status'],
        version: row.version,
        items,
        payments,
        financialTransactionTax: Money.fromMinorUnits(
          row.financialTransactionTaxMinorUnits,
          row.currencyCode
        ),
        completedAt: row.completedAt === null ? null : new Date(row.completedAt),
        voidedAt: row.voidedAt === null ? null : new Date(row.voidedAt),
        voidReason: row.voidReason,
        voidedBy: row.voidedBy,
        recipient: restoreRecipient(row)
      });
    });
  }

  private restorePaymentRate(
    row: typeof salePayments.$inferSelect
  ): ExchangeRate | null {
    if (row.exchangeRateId === null) return null;
    if (
      row.exchangeRateBaseCurrency === null || row.exchangeRateQuoteCurrency === null ||
      row.exchangeRateValue === null || row.exchangeRateScale === null ||
      row.exchangeRateSource === null || row.exchangeRateValidFrom === null ||
      row.exchangeRateRegisteredBy === null
    ) throw new Error('Persisted payment exchange-rate snapshot is incomplete.');
    return ExchangeRate.create({
      id: row.exchangeRateId,
      baseCurrency: row.exchangeRateBaseCurrency,
      quoteCurrency: row.exchangeRateQuoteCurrency,
      rateValue: row.exchangeRateValue,
      rateScale: row.exchangeRateScale,
      source: row.exchangeRateSource,
      validFrom: new Date(row.exchangeRateValidFrom),
      validUntil: row.exchangeRateValidUntil === null
        ? null
        : new Date(row.exchangeRateValidUntil),
      registeredBy: row.exchangeRateRegisteredBy
    });
  }
}

export class DrizzleShiftRepository implements ShiftRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(shift: Shift): Promise<void> {
    requireTransaction(this.handle.sqlite);
    const existing = this.handle.db.select({ status: shifts.status, version: shifts.version })
      .from(shifts).where(eq(shifts.id, shift.id)).get();
    if (existing?.status === 'CLOSED') {
      throw new InfrastructureError(
        'SHIFT_FINAL_STATE_IMMUTABLE',
        'A closed shift cannot be overwritten.'
      );
    }
    if (existing && shift.version !== existing.version + 1) {
      throw new InfrastructureError('DATABASE_CONCURRENCY_CONFLICT', 'Shift version is stale.');
    }
    if (!existing && shift.version !== 1) {
      throw new InfrastructureError('DATABASE_CONCURRENCY_CONFLICT', 'New shift version must be one.');
    }
    this.handle.db.insert(shifts).values({
      id: shift.id,
      cashRegisterId: shift.cashRegisterId,
      terminalId: shift.terminalId,
      originNodeId: shift.originNodeId,
      openedBy: shift.openedBy,
      openedAt: shift.openedAt.getTime(),
      status: shift.status,
      version: shift.version,
      closedAt: shift.closedAt?.getTime() ?? null,
      closedBy: shift.closedBy
    }).onConflictDoUpdate({
      target: shifts.id,
      set: {
        status: shift.status,
        version: shift.version,
        closedAt: shift.closedAt?.getTime() ?? null,
        closedBy: shift.closedBy
      }
    }).run();
    const persistedMovementIds = new Set(this.handle.db.select({ id: cashMovements.id })
      .from(cashMovements).where(eq(cashMovements.shiftId, shift.id)).all().map(({ id }) => id));
    const newMovements = shift.movements.filter((movement) => !persistedMovementIds.has(movement.id));
    if (newMovements.length > 0) {
      this.handle.db.insert(cashMovements).values(newMovements.map((movement) => ({
        id: movement.id,
        shiftId: shift.id,
        type: movement.type,
        paymentMethodCode: movement.method.code,
        paymentMethodName: movement.method.name,
        paymentMethodKind: movement.method.kind,
        amountMinorUnits: movement.amount.minorUnits,
        currencyCode: movement.amount.currency,
        reason: movement.reason,
        registeredBy: movement.registeredBy,
        registeredAt: movement.registeredAt.getTime(),
        sourceId: movement.reference?.sourceId ?? null,
        sourceEventId: movement.reference?.sourceEventId ?? null
      }))).run();
    }
    if (shift.closingBalances && shift.closingBalances.length > 0) {
      this.handle.db.insert(shiftClosingBalances).values(shift.closingBalances.map((balance) => ({
        shiftId: shift.id,
        paymentMethodCode: balance.paymentMethodCode,
        currencyCode: balance.expected.currency,
        expectedMinorUnits: balance.expected.minorUnits,
        declaredMinorUnits: balance.declared.minorUnits,
        differenceMinorUnits: balance.difference.minorUnits
      }))).run();
    }
  }

  findById(id: string): Promise<Shift | null> {
    return read(() => this.restore(this.handle.db.select().from(shifts)
      .where(eq(shifts.id, id)).get()));
  }

  findOpenByCashRegisterId(id: string): Promise<Shift | null> {
    return read(() => this.restore(this.handle.db.select().from(shifts).where(and(
      eq(shifts.cashRegisterId, id), eq(shifts.status, 'OPEN')
    )).get()));
  }

  private restore(row: typeof shifts.$inferSelect | undefined): Shift | null {
    if (!row) return null;
    const movementRows = this.handle.db.select().from(cashMovements)
      .where(eq(cashMovements.shiftId, row.id)).orderBy(cashMovements.registeredAt).all();
    const balanceRows = this.handle.db.select().from(shiftClosingBalances)
      .where(eq(shiftClosingBalances.shiftId, row.id)).all();
    return Shift.restore({
      id: row.id,
      cashRegisterId: row.cashRegisterId,
      terminalId: row.terminalId,
      originNodeId: row.originNodeId,
      openedBy: row.openedBy,
      openedAt: new Date(row.openedAt),
      movements: movementRows.map((movement) => CashMovement.create({
        id: movement.id,
        type: movement.type as Parameters<typeof CashMovement.create>[0]['type'],
        method: PaymentMethod.create({
          code: movement.paymentMethodCode,
          name: movement.paymentMethodName,
          kind: movement.paymentMethodKind as PaymentMethodKind,
          currencyCode: movement.currencyCode
        }),
        amount: Money.fromMinorUnits(movement.amountMinorUnits, movement.currencyCode),
        reason: movement.reason,
        registeredBy: movement.registeredBy,
        registeredAt: new Date(movement.registeredAt),
        ...(movement.sourceId === null || movement.sourceEventId === null
          ? {}
          : { reference: { sourceId: movement.sourceId, sourceEventId: movement.sourceEventId } })
      })),
      status: row.status as Parameters<typeof Shift.restore>[0]['status'],
      version: row.version,
      closingBalances: balanceRows.length === 0 ? null : balanceRows.map((balance) => ({
        paymentMethodCode: balance.paymentMethodCode,
        expected: Money.fromMinorUnits(balance.expectedMinorUnits, balance.currencyCode),
        declared: Money.fromMinorUnits(balance.declaredMinorUnits, balance.currencyCode),
        difference: Money.fromMinorUnits(balance.differenceMinorUnits, balance.currencyCode)
      })),
      closedAt: row.closedAt === null ? null : new Date(row.closedAt),
      closedBy: row.closedBy
    });
  }
}

export class DrizzleStockItemRepository implements StockItemRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(item: StockItem): Promise<void> {
    requireTransaction(this.handle.sqlite);
    const existing = this.handle.db.select().from(stockItems)
      .where(eq(stockItems.id, item.id)).get();
    if (existing && (
      existing.productId !== item.productId ||
      existing.unitCode !== item.unitCode ||
      existing.quantityScale !== item.quantityScale ||
      existing.tracksBatches !== item.tracksBatches ||
      (existing.valuationCurrencyCode !== null &&
        existing.valuationCurrencyCode !== item.valuationCurrency)
    )) {
      throw new InfrastructureError(
        'STOCK_ITEM_CONFIGURATION_MISMATCH',
        'Persisted stock item configuration cannot be changed.'
      );
    }
    if (!existing) {
      this.handle.db.insert(stockItems).values({
        id: item.id,
        productId: item.productId,
        unitCode: item.unitCode,
        quantityScale: item.quantityScale,
        tracksBatches: item.tracksBatches,
        valuationCurrencyCode: item.valuationCurrency
      }).run();
    } else if (existing.valuationCurrencyCode === null && item.valuationCurrency !== null) {
      this.handle.db.update(stockItems)
        .set({ valuationCurrencyCode: item.valuationCurrency })
        .where(eq(stockItems.id, item.id)).run();
    }

    const batchIds = new Set(this.handle.db.select({ id: stockBatches.id })
      .from(stockBatches).where(eq(stockBatches.stockItemId, item.id)).all()
      .map(({ id }) => id));
    const newBatches = item.batches.filter((batch) => !batchIds.has(batch.id));
    if (newBatches.length > 0) {
      this.handle.db.insert(stockBatches).values(newBatches.map((batch) => ({
        id: batch.id,
        stockItemId: item.id,
        lotNumber: batch.lotNumber,
        expiresAt: batch.expiresAt
      }))).run();
    }

    const movementIds = new Set(this.handle.db.select({ id: stockMovements.id })
      .from(stockMovements).where(eq(stockMovements.stockItemId, item.id)).all()
      .map(({ id }) => id));
    const newMovements = item.movements.filter((movement) => !movementIds.has(movement.id));
    if (newMovements.length > 0) {
      this.handle.db.insert(stockMovements).values(newMovements.map((movement) => ({
        id: movement.id,
        stockItemId: item.id,
        eventId: movement.eventId,
        aggregateVersion: item.movements.findIndex(({ id }) => id === movement.id) + 1,
        type: movement.type,
        direction: movement.direction,
        quantityScaled: movement.quantity.scaledValue,
        quantityScale: movement.quantity.scale,
        batchId: movement.batchId,
        actorId: movement.actorId,
        reason: movement.reason,
        referenceId: movement.referenceId,
        occurredAt: movement.occurredAt,
        unitCostMinorUnits: movement.unitCost?.minorUnits ?? null,
        costCurrencyCode: movement.unitCost?.currency ?? null
      }))).run();
    }
  }

  findById(id: string): Promise<StockItem | null> {
    return read(() => this.restore(this.handle.db.select().from(stockItems)
      .where(eq(stockItems.id, id)).get()));
  }

  findByProductId(productId: string): Promise<StockItem | null> {
    return read(() => this.restore(this.handle.db.select().from(stockItems)
      .where(eq(stockItems.productId, productId)).get()));
  }

  private restore(row: typeof stockItems.$inferSelect | undefined): StockItem | null {
    if (!row) return null;
    const batchRows = this.handle.db.select().from(stockBatches)
      .where(eq(stockBatches.stockItemId, row.id)).all();
    const movementRows = this.handle.db.select().from(stockMovements)
      .where(eq(stockMovements.stockItemId, row.id))
      .orderBy(stockMovements.aggregateVersion).all();
    return StockItem.restore({
      id: row.id,
      productId: row.productId,
      unitCode: row.unitCode,
      quantityScale: row.quantityScale,
      tracksBatches: row.tracksBatches,
      valuationCurrency: row.valuationCurrencyCode,
      batches: batchRows.map((batch) => Batch.create({
        id: batch.id,
        lotNumber: batch.lotNumber,
        ...(batch.expiresAt === null ? {} : { expiresAt: batch.expiresAt })
      })),
      movements: movementRows.map((movement) => StockMovement.create({
        id: movement.id,
        type: movement.type as Parameters<typeof StockMovement.create>[0]['type'],
        quantity: Quantity.fromScaled(movement.quantityScaled, movement.quantityScale),
        ...(movement.batchId === null ? {} : { batchId: movement.batchId }),
        actorId: movement.actorId,
        reason: movement.reason,
        referenceId: movement.referenceId,
        occurredAt: movement.occurredAt,
        eventId: movement.eventId,
        unitCost: movement.unitCostMinorUnits === null || movement.costCurrencyCode === null
          ? null
          : Money.fromMinorUnits(movement.unitCostMinorUnits, movement.costCurrencyCode)
      }))
    });
  }
}
