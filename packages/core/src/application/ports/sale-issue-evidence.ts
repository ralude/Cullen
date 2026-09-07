/**
 * Salida de venta ya aplicada por el inventario autoritativo del coordinador.
 *
 * Es la evidencia que una devolución LAN necesita antes de tocar nada: la
 * restitución conserva el lote y el costo que realmente salieron, no un
 * promedio posterior (ADR-0026 D3 y D4). `unitCost` en `null` es costo
 * desconocido explícito y se conserva como tal.
 */
export type AppliedSaleIssueLine = {
  readonly saleItemId: string;
  readonly productId: string;
  readonly stockItemId: string;
  readonly batchId: string | null;
  readonly quantityScaled: number;
  readonly quantityScale: number;
  readonly unitCost: { readonly minorUnits: number; readonly currencyCode: string } | null;
};

/**
 * Estado de la salida consultada. `NONE` significa que el coordinador no tiene
 * custodia del hecho y `DISCREPANCY` que su aplicación quedó abierta a
 * revisión; `UNKNOWN` es la respuesta cuando no se pudo preguntar y solo puede
 * producirlo la consulta remota. Ninguno de los cuatro habilita una
 * restitución: solo `APPLIED` la habilita.
 */
export type SaleIssueApplicationState =
  'APPLIED' | 'PENDING' | 'DISCREPANCY' | 'NONE' | 'UNKNOWN';

/**
 * Evidencia completa de la salida. Solo `APPLIED` transporta líneas: mientras
 * el efecto no esté confirmado no hay nada que restituir.
 */
export type SaleIssueEvidence = {
  readonly state: SaleIssueApplicationState;
  readonly lines: readonly AppliedSaleIssueLine[];
};

/**
 * Lectura local del coordinador sobre sus propios movimientos `SALE_ISSUE`.
 * No aplica nada ni reenvía el hecho: responde por lo que ya está persistido y
 * nunca devuelve `UNKNOWN`, porque consultar su propia base no es una promesa
 * de red.
 */
export interface SaleIssueEvidenceReader {
  findBySaleEventId(saleEventId: string): Promise<SaleIssueEvidence>;
}

/**
 * Consulta remota de esa misma evidencia desde la terminal que devuelve.
 *
 * Falla cerrada: un timeout, una respuesta no contractual o un estado
 * desconocido valen `UNKNOWN`, nunca `APPLIED`. Sin salida aplicada no se crea
 * devolución local ni stock.
 */
export interface RemoteSaleIssueProbe {
  saleIssuesOf(saleEventId: string): Promise<SaleIssueEvidence>;
}
