import {
  Money,
  Quantity
} from '@supermarket/shared';
import {
  SaleReturn,
  type SaleReturnLine,
  type SaleReturnRepository
} from '@supermarket/core';
import { eq } from 'drizzle-orm';
import type { DatabaseHandle } from './connection.js';
import { saleReturnLines, saleReturns } from './schema.js';
import { mapDatabaseError, requireTransaction } from './unit-of-work.js';

export class DrizzleSaleReturnRepository implements SaleReturnRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(saleReturn: SaleReturn): Promise<void> {
    requireTransaction(this.handle.sqlite);
    try {
      this.handle.db.insert(saleReturns).values({
        id: saleReturn.id,
        saleId: saleReturn.saleId,
        saleEventId: saleReturn.saleEventId,
        originalDocumentId: saleReturn.originalDocumentId,
        creditNoteId: saleReturn.creditNoteId,
        shiftId: saleReturn.shiftId,
        refundMinorUnits: saleReturn.refund.minorUnits,
        currencyCode: saleReturn.refund.currency,
        paymentMethodCode: saleReturn.paymentMethodCode,
        reason: saleReturn.reason,
        actorId: saleReturn.actorId,
        terminalId: saleReturn.terminalId,
        originNodeId: saleReturn.originNodeId,
        occurredAt: saleReturn.occurredAt
      }).run();
      this.handle.db.insert(saleReturnLines).values(saleReturn.lines.map((line) => ({
        id: line.id,
        saleReturnId: saleReturn.id,
        saleItemId: line.saleItemId,
        productId: line.productId,
        stockItemId: line.stockItemId,
        batchId: line.batchId,
        quantityScaled: line.quantity.scaledValue,
        quantityScale: line.quantity.scale,
        unitCostMinorUnits: line.unitCost?.minorUnits ?? null,
        costCurrencyCode: line.unitCost?.currency ?? null
      }))).run();
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findById(id: string): Promise<SaleReturn | null> {
    try {
      return this.restore(this.handle.db.select().from(saleReturns)
        .where(eq(saleReturns.id, id)).get());
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findBySaleId(saleId: string): Promise<SaleReturn | null> {
    try {
      return this.restore(this.handle.db.select().from(saleReturns)
        .where(eq(saleReturns.saleId, saleId)).get());
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  private restore(row: typeof saleReturns.$inferSelect | undefined): SaleReturn | null {
    if (!row) return null;
    const lines: SaleReturnLine[] = this.handle.db.select().from(saleReturnLines)
      .where(eq(saleReturnLines.saleReturnId, row.id))
      .all()
      .map((line) => ({
        id: line.id,
        saleItemId: line.saleItemId,
        productId: line.productId,
        stockItemId: line.stockItemId,
        batchId: line.batchId,
        quantity: Quantity.fromScaled(line.quantityScaled, line.quantityScale),
        unitCost: line.unitCostMinorUnits === null || line.costCurrencyCode === null
          ? null
          : Money.fromMinorUnits(line.unitCostMinorUnits, line.costCurrencyCode)
      }));
    return SaleReturn.restore({
      id: row.id,
      saleId: row.saleId,
      saleEventId: row.saleEventId,
      originalDocumentId: row.originalDocumentId,
      creditNoteId: row.creditNoteId,
      shiftId: row.shiftId,
      refund: Money.fromMinorUnits(row.refundMinorUnits, row.currencyCode),
      paymentMethodCode: row.paymentMethodCode,
      reason: row.reason,
      actorId: row.actorId,
      terminalId: row.terminalId,
      originNodeId: row.originNodeId,
      occurredAt: row.occurredAt,
      lines
    });
  }
}
