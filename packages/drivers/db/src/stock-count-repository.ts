import {
  StockCount,
  StockCountLine,
  type StockCountDifference,
  type StockCountRepository,
  type StockCountStatus
} from '@supermarket/core';
import { InfrastructureError, Quantity } from '@supermarket/shared';
import { and, eq } from 'drizzle-orm';
import type { DatabaseHandle } from './connection.js';
import { stockCountDifferences, stockCountLines, stockCounts } from './schema.js';
import { mapDatabaseError, requireTransaction } from './unit-of-work.js';

export class DrizzleStockCountRepository implements StockCountRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(count: StockCount): Promise<void> {
    requireTransaction(this.handle.sqlite);
    try {
      const existing = this.handle.db.select({
        version: stockCounts.version, status: stockCounts.status, originNodeId: stockCounts.originNodeId
      })
        .from(stockCounts).where(eq(stockCounts.id, count.id)).get();
      const values = {
        status: count.status,
        closedAt: count.closedAt,
        approvedBy: count.approvedBy,
        approvedAt: count.approvedAt,
        rejectedBy: count.rejectedBy,
        rejectedAt: count.rejectedAt,
        rejectionReason: count.rejectionReason,
        version: count.version
      };
      if (!existing) {
        this.handle.db.insert(stockCounts).values({
          id: count.id, openedBy: count.openedBy, originNodeId: count.originNodeId,
          openedAt: count.openedAt, ...values
        }).run();
      } else {
        if (existing.version !== count.version - 1) {
          throw new InfrastructureError('DATABASE_CONCURRENCY_CONFLICT', 'Stock count version is stale.');
        }
        if (existing.originNodeId !== count.originNodeId) {
          throw new InfrastructureError('AGGREGATE_OWNER_MISMATCH', 'Stock count owner cannot change.');
        }
        const changed = this.handle.db.update(stockCounts).set(values).where(and(
          eq(stockCounts.id, count.id), eq(stockCounts.version, existing.version)
        )).run();
        if (changed.changes !== 1) {
          throw new InfrastructureError('DATABASE_CONCURRENCY_CONFLICT', 'Stock count version is stale.');
        }
      }

      /**
       * Las líneas solo se reescriben mientras el conteo sigue `OPEN`:
       * `recordLine` reemplaza en memoria la línea previa del mismo
       * artículo/lote, así que persistir lo que existe hoy en el agregado
       * mantiene la tabla sincronizada sin dejar filas huérfanas. Una vez que
       * el conteo deja `OPEN`, sus líneas quedan congeladas por invariante de
       * dominio y el trigger de la migración bloquea su borrado; esta rama ni
       * siquiera se ejecuta entonces, porque no hay nada que resincronizar.
       */
      if (count.status === 'OPEN') {
        this.handle.db.delete(stockCountLines).where(eq(stockCountLines.stockCountId, count.id)).run();
        if (count.lines.length > 0) {
          this.handle.db.insert(stockCountLines).values(count.lines.map((line) => ({
            id: line.id, stockCountId: count.id, productId: line.productId, stockItemId: line.stockItemId,
            batchId: line.batchId, countedQuantityScaled: line.countedQuantity.scaledValue,
            countedQuantityScale: line.countedQuantity.scale
          }))).run();
        }
      }

      /**
       * Las diferencias se escriben una sola vez, al cerrar el conteo, y
       * nunca se borran ni se reescriben después: son la evidencia congelada
       * que usa la aprobación.
       */
      if (existing?.status === 'OPEN' && count.status === 'COUNTED' && count.differences) {
        this.handle.db.insert(stockCountDifferences).values(count.differences.map((difference) => ({
          lineId: difference.lineId, stockCountId: count.id, stockItemId: difference.stockItemId,
          batchId: difference.batchId, quantityScale: difference.quantityScale,
          expectedScaled: difference.expectedScaled, countedScaled: difference.countedScaled,
          differenceScaled: difference.differenceScaled
        }))).run();
      }
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findById(id: string): Promise<StockCount | null> {
    try {
      return this.restore(this.handle.db.select().from(stockCounts).where(eq(stockCounts.id, id)).get());
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findOpen(): Promise<StockCount | null> {
    try {
      return this.restore(this.handle.db.select().from(stockCounts)
        .where(eq(stockCounts.status, 'OPEN')).get());
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findAll(status?: StockCountStatus): Promise<readonly StockCount[]> {
    try {
      const rows = status === undefined
        ? this.handle.db.select().from(stockCounts).all()
        : this.handle.db.select().from(stockCounts).where(eq(stockCounts.status, status)).all();
      return rows.map((row) => this.restore(row)).filter((count): count is StockCount => count !== null);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  private restore(row: typeof stockCounts.$inferSelect | undefined): StockCount | null {
    if (!row) return null;
    if (row.originNodeId === null) {
      throw new InfrastructureError('AGGREGATE_OWNER_UNRESOLVED', 'Stock count owner is unresolved.');
    }
    const lineRows = this.handle.db.select().from(stockCountLines)
      .where(eq(stockCountLines.stockCountId, row.id)).all();
    const differenceRows = this.handle.db.select().from(stockCountDifferences)
      .where(eq(stockCountDifferences.stockCountId, row.id)).all();
    const differences: StockCountDifference[] = differenceRows.map((difference) => ({
      lineId: difference.lineId, stockItemId: difference.stockItemId, batchId: difference.batchId,
      quantityScale: difference.quantityScale, expectedScaled: difference.expectedScaled,
      countedScaled: difference.countedScaled, differenceScaled: difference.differenceScaled
    }));
    return StockCount.restore({
      id: row.id, openedBy: row.openedBy, originNodeId: row.originNodeId,
      openedAt: row.openedAt, status: row.status as StockCountStatus,
      lines: lineRows.map((line) => StockCountLine.create({
        id: line.id, productId: line.productId, stockItemId: line.stockItemId,
        countedQuantity: Quantity.fromScaled(line.countedQuantityScaled, line.countedQuantityScale),
        ...(line.batchId === null ? {} : { batchId: line.batchId })
      })),
      differences: row.status === 'OPEN' ? null : differences,
      closedAt: row.closedAt, approvedBy: row.approvedBy, approvedAt: row.approvedAt,
      rejectedBy: row.rejectedBy, rejectedAt: row.rejectedAt, rejectionReason: row.rejectionReason,
      version: row.version
    });
  }
}
