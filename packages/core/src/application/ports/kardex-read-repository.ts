import type { StockMovementDto } from '../inventory/dtos.js';

/**
 * Lectura del kardex sin rehidratar el agregado.
 *
 * El kardex es una consulta: devuelve una página de movimientos y el saldo
 * vigente, y no decide nada sobre el inventario. Rehidratar `StockItem` para
 * responderla obliga a reconstruir toda la historia —12.03 lo midió en 2,66 s
 * con 10.000 movimientos— para devolver como mucho quinientos. El agregado
 * sigue siendo el único camino de escritura.
 */
export type KardexQuery = {
  readonly productId: string;
  /** Movimientos más recientes del período que se devuelven, ya validado. */
  readonly limit: number;
  readonly batchId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly reason?: string;
};

/**
 * Lo que el artículo responde a una consulta de kardex. `balanceScaled` es el
 * saldo del lote pedido cuando la consulta nombra uno, y el del artículo
 * cuando no; los filtros de período y motivo paginan movimientos y no alteran
 * existencias. `tracksBatches` y `batches` viajan para que el caso de uso
 * conserve los errores de lote que antes levantaba el agregado.
 */
export type KardexReadResult = {
  readonly id: string;
  readonly productId: string;
  readonly unitCode: string;
  readonly quantityScale: number;
  readonly tracksBatches: boolean;
  readonly balanceScaled: number;
  readonly batches: readonly { id: string; lotNumber: string; expiresAt: Date | null }[];
  readonly movements: readonly StockMovementDto[];
};

export interface KardexReadRepository {
  findKardex(query: KardexQuery): Promise<KardexReadResult | null>;
}
