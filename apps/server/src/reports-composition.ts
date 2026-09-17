/**
 * Composición local de los reportes de gestión.
 *
 * Es el primer grupo que 12.05.02 saca del runtime, y el que mejor lo permite:
 * cada reporte necesita el archivo del nodo y el servicio de autorización, y
 * nada más. Ni transacción, ni relojes, ni generadores de identificadores, ni
 * el emisor fiscal. Recibe esas dos piezas concretas en vez del runtime entero,
 * así que agregar un reporte no obliga a leer cómo se compone una venta.
 */
import { application, type AuthorizationService } from '@supermarket/core';
import {
  DrizzleAuditReportRepository,
  DrizzleCashClosureReportRepository,
  DrizzleFiscalOperationsReportRepository,
  DrizzleInventoryReportRepository,
  DrizzleMarginReportRepository,
  DrizzleSalesReportRepository,
  type DatabaseHandle
} from '@supermarket/driver-db';
import type { ServerDependencies } from './server-dependencies.ts';

export const composeReports = (
  handle: DatabaseHandle,
  authorization: AuthorizationService
): NonNullable<ServerDependencies['reports']> => ({
  getCashClosureReport: new application.GetCashClosureReport(
    new DrizzleCashClosureReportRepository(handle), authorization
  ),
  getAuditReport: new application.GetAuditReport(
    new DrizzleAuditReportRepository(handle), authorization
  ),
  getFiscalOperationsReport: new application.GetFiscalOperationsReport(
    new DrizzleFiscalOperationsReportRepository(handle), authorization
  ),
  getMarginReport: new application.GetMarginReport(
    new DrizzleMarginReportRepository(handle), authorization
  ),
  getSalesReport: new application.GetSalesReport(
    new DrizzleSalesReportRepository(handle), authorization
  ),
  getInventoryReport: new application.GetInventoryReport(
    new DrizzleInventoryReportRepository(handle), authorization
  )
});
