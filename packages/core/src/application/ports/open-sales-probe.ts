/**
 * Ventas todavía sin cerrar en un turno.
 *
 * Es una **precondición del arqueo**, no una derivación del saldo: caja sigue
 * calculando sus balances desde sus propios movimientos y nunca reconstruye
 * dinero leyendo ventas. Una venta en `DRAFT` conserva pagos provisionales que
 * aún no entraron al turno y, una vez cerrado, ya no puede completarse: el
 * cierre debe encontrarla antes de congelar el conteo.
 */
export interface OpenSalesProbe {
  countOpenByShiftId(shiftId: string): Promise<number>;
}
