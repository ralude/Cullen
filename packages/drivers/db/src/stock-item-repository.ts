/**
 * Persistencia del inventario: el artículo con sus lotes y su historia de
 * movimientos.
 *
 * La lectura paginada del kardex no vive aquí: la resuelve
 * `kardex-read-repository.ts` sin rehidratar el agregado (12.03).
 */
import { Batch, StockItem, StockMovement, type StockItemRepository } from '@supermarket/core';
import { InfrastructureError, Money, Quantity } from '@supermarket/shared';
import { eq } from 'drizzle-orm';
import type { DatabaseHandle } from './connection.js';
import { stockBatches, stockItems, stockMovements } from './schema.js';
import { read, requireTransaction } from './unit-of-work.js';

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
