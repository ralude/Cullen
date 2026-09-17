import { and, desc, eq, gte, like, lte, sql } from 'drizzle-orm';
import type {
  KardexQuery, KardexReadRepository, KardexReadResult
} from '@supermarket/core';
import type { DatabaseHandle } from './connection.js';
import { stockBatches, stockItems, stockMovements } from './schema.js';
import { mapDatabaseError } from './unit-of-work.js';

const read = async <T>(operation: () => T): Promise<T> => {
  try {
    return operation();
  } catch (error) {
    throw mapDatabaseError(error);
  }
};

/**
 * Kardex por consulta, no por agregado.
 *
 * Devuelve la misma página que devolvía `StockItem` —los movimientos más
 * recientes del período, en orden ascendente— pero sin traer la historia que
 * no entra en ella. El saldo se suma en SQLite con la misma regla del dominio:
 * una entrada suma su cantidad y una salida la resta, sobre la escala del
 * artículo. El filtro de lote afecta al saldo; los de período y motivo, no.
 */
export class DrizzleKardexReadRepository implements KardexReadRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  findKardex(query: KardexQuery): Promise<KardexReadResult | null> {
    return read(() => {
      const item = this.handle.db.select().from(stockItems)
        .where(eq(stockItems.productId, query.productId)).get();
      if (!item) return null;

      const batches = this.handle.db.select().from(stockBatches)
        .where(eq(stockBatches.stockItemId, item.id)).all();

      const balanceScaled = Number(this.handle.db.select({
        balance: sql<number>`coalesce(sum(case ${stockMovements.direction} when 'IN'
          then ${stockMovements.quantityScaled} else -${stockMovements.quantityScaled} end), 0)`
      }).from(stockMovements).where(and(
        eq(stockMovements.stockItemId, item.id),
        ...(query.batchId === undefined ? [] : [eq(stockMovements.batchId, query.batchId)])
      )).get()?.balance ?? 0);

      /**
       * Los últimos por fecha y, ante empate, por versión del agregado: es el
       * mismo desempate que daba recorrer la historia en su orden. Se piden al
       * revés para que el límite corte por el extremo reciente y se devuelven
       * en ascendente, como los devolvía el agregado.
       */
      const rows = this.handle.db.select().from(stockMovements).where(and(
        eq(stockMovements.stockItemId, item.id),
        ...(query.batchId === undefined ? [] : [eq(stockMovements.batchId, query.batchId)]),
        ...(query.from === undefined ? [] : [gte(stockMovements.occurredAt, query.from)]),
        ...(query.to === undefined ? [] : [lte(stockMovements.occurredAt, query.to)]),
        ...(query.reason === undefined
          ? []
          : [like(sql`lower(${stockMovements.reason})`, '%' + query.reason + '%')])
      )).orderBy(desc(stockMovements.occurredAt), desc(stockMovements.aggregateVersion))
        .limit(query.limit).all();

      return {
        id: item.id,
        productId: item.productId,
        unitCode: item.unitCode,
        quantityScale: item.quantityScale,
        tracksBatches: item.tracksBatches,
        balanceScaled,
        batches: batches.map((batch) => ({
          id: batch.id, lotNumber: batch.lotNumber, expiresAt: batch.expiresAt
        })),
        movements: rows.reverse().map((movement) => ({
          id: movement.id,
          type: movement.type,
          /** La columna es texto y el dominio sólo escribe estos dos valores. */
          direction: movement.direction as 'IN' | 'OUT',
          quantityScaled: movement.quantityScaled,
          quantityScale: movement.quantityScale,
          batchId: movement.batchId,
          actorId: movement.actorId,
          reason: movement.reason,
          referenceId: movement.referenceId,
          occurredAt: movement.occurredAt
        }))
      };
    });
  }
}
