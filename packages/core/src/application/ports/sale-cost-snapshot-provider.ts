import type { CostSnapshot } from '../../domain/catalog/index.js';

/**
 * Costo unitario conocido por este nodo al vender, con su procedencia.
 *
 * En una terminal procede de la disponibilidad publicada por el coordinador; en
 * un nodo standalone, del promedio ponderado de su propio inventario. En ambos
 * casos es evidencia del nodo, nunca un valor que llegue desde el renderer.
 *
 * `null` es costo **desconocido** y se conserva como tal: no se sustituye por
 * cero ni por un promedio obtenido después (ADR-0026 D4).
 */
export interface SaleCostSnapshotProvider {
  findByProductId(productId: string): Promise<CostSnapshot | null>;
}
