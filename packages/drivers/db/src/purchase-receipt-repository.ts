import {
  ExchangeRate, PurchaseReceipt, type PurchaseReceiptLine, type PurchaseReceiptRepository,
  type PurchaseSourceDocument
} from '@supermarket/core';
import { InfrastructureError, Money, Quantity } from '@supermarket/shared';
import { and, eq } from 'drizzle-orm';
import type { DatabaseHandle } from './connection.js';
import { purchaseReceiptLines, purchaseReceipts } from './schema.js';
import { mapDatabaseError, requireTransaction } from './unit-of-work.js';

export class DrizzlePurchaseReceiptRepository implements PurchaseReceiptRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(receipt: PurchaseReceipt): Promise<void> {
    requireTransaction(this.handle.sqlite);
    try {
      const existing = this.handle.db.select({
        version: purchaseReceipts.version, originNodeId: purchaseReceipts.originNodeId
      })
        .from(purchaseReceipts).where(eq(purchaseReceipts.id, receipt.id)).get();
      const mutable = {
        status: receipt.status,
        version: receipt.version,
        completedAt: receipt.completedAt,
        reversedAt: receipt.reversedAt,
        reversedBy: receipt.reversedBy,
        reversalReason: receipt.reversalReason
      };
      if (!existing) {
        this.handle.db.insert(purchaseReceipts).values({
          id: receipt.id,
          originNodeId: receipt.originNodeId,
          supplierId: receipt.supplierId,
          supplierLegalName: receipt.supplierSnapshot.legalName,
          supplierTradeName: receipt.supplierSnapshot.tradeName,
          supplierTaxCountry: receipt.supplierSnapshot.taxIdentity.country,
          supplierTaxType: receipt.supplierSnapshot.taxIdentity.type,
          supplierTaxValue: receipt.supplierSnapshot.taxIdentity.value,
          supplierTaxNormalizedValue: receipt.supplierSnapshot.taxIdentity.normalizedValue,
          supplierFiscalAddressCountry: receipt.supplierSnapshot.fiscalAddress?.countryCode ?? null,
          supplierFiscalAddressLine: receipt.supplierSnapshot.fiscalAddress?.addressLine ?? null,
          sourceType: receipt.sourceDocument.type,
          sourceNumber: receipt.sourceDocument.number,
          sourceSeries: receipt.sourceDocument.series,
          sourceControlNumber: receipt.sourceDocument.controlNumber,
          sourceIssuedAt: receipt.sourceDocument.issuedAt,
          effectiveAt: receipt.effectiveAt,
          createdBy: receipt.createdBy,
          createdAt: receipt.createdAt,
          replacesReceiptId: receipt.replacesReceiptId,
          ...mutable
        }).run();
        if (receipt.lines.length > 0) {
          this.handle.db.insert(purchaseReceiptLines).values(receipt.lines.map((line) => ({
            id: line.id,
            receiptId: receipt.id,
            productId: line.productId,
            stockItemId: line.stockItemId,
            unitCode: line.unitCode,
            tracksBatches: line.tracksBatches,
            quantityScaled: line.quantity.scaledValue,
            quantityScale: line.quantity.scale,
            batchId: line.batchId,
            batchLotNumber: line.batchLotNumber,
            batchExpiresAt: line.batchExpiresAt,
            purchaseUnitCostMinorUnits: line.purchaseUnitCost.minorUnits,
            purchaseCurrencyCode: line.purchaseUnitCost.currency,
            valuationUnitCostMinorUnits: line.valuationUnitCost.minorUnits,
            valuationCurrencyCode: line.valuationUnitCost.currency,
            exchangeRateId: line.exchangeRate?.id ?? null,
            exchangeRateBaseCurrency: line.exchangeRate?.baseCurrency ?? null,
            exchangeRateQuoteCurrency: line.exchangeRate?.quoteCurrency ?? null,
            exchangeRateValue: line.exchangeRate?.rateValue ?? null,
            exchangeRateScale: line.exchangeRate?.rateScale ?? null,
            exchangeRateSource: line.exchangeRate?.source ?? null,
            exchangeRateValidFrom: line.exchangeRate?.validFrom ?? null,
            exchangeRateValidUntil: line.exchangeRate?.validUntil ?? null,
            exchangeRateRegisteredBy: line.exchangeRate?.registeredBy ?? null
          }))).run();
        }
        return;
      }
      if (existing.version !== receipt.version - 1) {
        throw new InfrastructureError(
          'DATABASE_CONCURRENCY_CONFLICT', 'Purchase receipt version is stale.'
        );
      }
      if (existing.originNodeId !== receipt.originNodeId) {
        throw new InfrastructureError('AGGREGATE_OWNER_MISMATCH', 'Purchase receipt owner cannot change.');
      }
      const changed = this.handle.db.update(purchaseReceipts).set(mutable).where(and(
        eq(purchaseReceipts.id, receipt.id), eq(purchaseReceipts.version, existing.version)
      )).run();
      if (changed.changes !== 1) {
        throw new InfrastructureError(
          'DATABASE_CONCURRENCY_CONFLICT', 'Purchase receipt version is stale.'
        );
      }
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findById(id: string): Promise<PurchaseReceipt | null> {
    try {
      return this.restore(this.handle.db.select().from(purchaseReceipts)
        .where(eq(purchaseReceipts.id, id)).get());
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findCompletedBySource(
    supplierId: string,
    type: 'INVOICE' | 'DELIVERY_NOTE',
    series: string | null,
    number: string
  ): Promise<PurchaseReceipt | null> {
    try {
      const candidates = this.handle.db.select().from(purchaseReceipts).where(and(
        eq(purchaseReceipts.supplierId, supplierId),
        eq(purchaseReceipts.sourceType, type),
        eq(purchaseReceipts.status, 'COMPLETED')
      )).all();
      const normalizedSeries = (series ?? '').toUpperCase();
      const normalizedNumber = number.toUpperCase();
      const match = candidates.find((row) =>
        (row.sourceSeries ?? '').toUpperCase() === normalizedSeries &&
        row.sourceNumber.toUpperCase() === normalizedNumber);
      return this.restore(match);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findCompletedByControlNumber(
    supplierId: string,
    controlNumber: string
  ): Promise<PurchaseReceipt | null> {
    try {
      const candidates = this.handle.db.select().from(purchaseReceipts).where(and(
        eq(purchaseReceipts.supplierId, supplierId),
        eq(purchaseReceipts.status, 'COMPLETED')
      )).all();
      const normalizedControlNumber = controlNumber.toUpperCase();
      return this.restore(candidates.find((row) =>
        row.sourceControlNumber?.toUpperCase() === normalizedControlNumber));
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  private restore(row: typeof purchaseReceipts.$inferSelect | undefined): PurchaseReceipt | null {
    if (!row) return null;
    if (row.originNodeId === null) {
      throw new InfrastructureError('AGGREGATE_OWNER_UNRESOLVED', 'Purchase receipt owner is unresolved.');
    }
    const lineRows = this.handle.db.select().from(purchaseReceiptLines)
      .where(eq(purchaseReceiptLines.receiptId, row.id)).all();
    const sourceDocument: PurchaseSourceDocument = {
      type: row.sourceType as PurchaseSourceDocument['type'],
      number: row.sourceNumber,
      series: row.sourceSeries,
      controlNumber: row.sourceControlNumber,
      issuedAt: row.sourceIssuedAt
    };
    const lines: PurchaseReceiptLine[] = lineRows.map((line) => ({
      id: line.id,
      productId: line.productId,
      stockItemId: line.stockItemId,
      unitCode: line.unitCode,
      tracksBatches: line.tracksBatches,
      quantity: Quantity.fromScaled(line.quantityScaled, line.quantityScale),
      batchId: line.batchId,
      batchLotNumber: line.batchLotNumber,
      batchExpiresAt: line.batchExpiresAt,
      purchaseUnitCost: Money.fromMinorUnits(line.purchaseUnitCostMinorUnits, line.purchaseCurrencyCode),
      valuationUnitCost: Money.fromMinorUnits(line.valuationUnitCostMinorUnits, line.valuationCurrencyCode),
      exchangeRate: line.exchangeRateId === null
        || line.exchangeRateBaseCurrency === null
        || line.exchangeRateQuoteCurrency === null
        || line.exchangeRateValue === null
        || line.exchangeRateScale === null
        || line.exchangeRateSource === null
        || line.exchangeRateValidFrom === null
        || line.exchangeRateRegisteredBy === null
        ? null
        : ExchangeRate.create({
          id: line.exchangeRateId,
          baseCurrency: line.exchangeRateBaseCurrency,
          quoteCurrency: line.exchangeRateQuoteCurrency,
          rateValue: line.exchangeRateValue,
          rateScale: line.exchangeRateScale,
          source: line.exchangeRateSource,
          validFrom: line.exchangeRateValidFrom,
          validUntil: line.exchangeRateValidUntil,
          registeredBy: line.exchangeRateRegisteredBy
        })
    }));
    return PurchaseReceipt.restore({
      id: row.id,
      supplierId: row.supplierId,
      supplierSnapshot: {
        legalName: row.supplierLegalName,
        tradeName: row.supplierTradeName,
        taxIdentity: {
          country: row.supplierTaxCountry, type: row.supplierTaxType,
          value: row.supplierTaxValue, normalizedValue: row.supplierTaxNormalizedValue
        },
        fiscalAddress: row.supplierFiscalAddressCountry !== null && row.supplierFiscalAddressLine !== null
          ? { countryCode: row.supplierFiscalAddressCountry, addressLine: row.supplierFiscalAddressLine }
          : null
      },
      sourceDocument,
      effectiveAt: row.effectiveAt,
      createdBy: row.createdBy,
      originNodeId: row.originNodeId,
      createdAt: row.createdAt,
      replacesReceiptId: row.replacesReceiptId,
      lines,
      status: row.status as PurchaseReceipt['status'],
      version: row.version,
      completedAt: row.completedAt,
      reversedAt: row.reversedAt,
      reversedBy: row.reversedBy,
      reversalReason: row.reversalReason
    });
  }
}
