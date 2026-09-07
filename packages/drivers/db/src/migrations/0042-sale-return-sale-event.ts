/**
 * Conserva el `eventId` de la `SaleCompleted` que cada devolución restituye.
 *
 * Es la identidad con la que el coordinador reconoce qué salió realmente y
 * valida la restitución contra sus propios movimientos `SALE_ISSUE`
 * (ADR-0026 D3). Las devoluciones anteriores conservan su historia con la
 * cadena vacía: no se les inventa una salida que nadie registró.
 */
export const saleReturnSaleEventSql = `
  alter table sale_returns
    add column sale_event_id text not null default '';
`;
