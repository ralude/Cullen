/**
 * Persistencia de la venta: líneas, pagos, descuentos y snapshots de costo y
 * destinatario.
 */
import {
  Discount,
  ExchangeRate,
  Payment,
  PaymentMethod,
  CostSnapshot,
  ProductSnapshot,
  Sale,
  SaleItem,
  type PaymentMethodKind,
  type SaleRecipientSnapshot,
  type SaleRepository
} from '@supermarket/core';
import { InfrastructureError, Money, Percentage, Quantity, TaxRate } from '@supermarket/shared';
import { eq } from 'drizzle-orm';
import type { DatabaseHandle } from './connection.js';
import { saleDiscounts, saleItems, salePayments, sales } from './schema.js';
import { read, requireTransaction } from './unit-of-work.js';

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
