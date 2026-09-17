/**
 * Operaciones de reportes del cliente HTTP.
 * Reportes de gestión y los dos reportes fiscales del día, que la misma
 * pantalla imprime.
 *
 * Grupo propio desde 12.05.04: cambiar una de estas operaciones se hace aquí y
 * no dentro de las noventa y dos de todas las features. `createDesktopApi` las
 * esparce, así que la superficie pública no cambia.
 */
import {
  getAuditReportContract,
  getCashClosureReportContract,
  getFiscalOperationsReportContract,
  getInventoryReportContract,
  getMarginReportContract,
  getSalesReportContract,
  printSimulatedXReportContract,
  printSimulatedZReportContract,
  type AuditReportResponse,
  type CashClosureReportResponse,
  type FiscalOperationsReportResponse,
  type InventoryReportResponse,
  type MarginReportResponse,
  type SalesReportResponse,
  type SimulatedFiscalReportRequest,
  type SimulatedFiscalReportResponse
} from '@supermarket/shared';
import { requestJson, search, withIdempotency, type ReportQuery } from './api-transport.js';

export const reportOperations = (fetcher: typeof fetch) => ({
  getCashClosureReport: (query: ReportQuery = {}): Promise<readonly CashClosureReportResponse[]> => requestJson(
    fetcher, getCashClosureReportContract.path + search(query),
    { method: getCashClosureReportContract.method }
  ),
  getAuditReport: (query: ReportQuery = {}): Promise<readonly AuditReportResponse[]> => requestJson(
    fetcher, getAuditReportContract.path + search(query),
    { method: getAuditReportContract.method }
  ),
  getFiscalOperationsReport: (query: ReportQuery = {}): Promise<FiscalOperationsReportResponse> => requestJson(
    fetcher, getFiscalOperationsReportContract.path + search(query),
    { method: getFiscalOperationsReportContract.method }
  ),
  getMarginReport: (query: ReportQuery = {}): Promise<readonly MarginReportResponse[]> => requestJson(
    fetcher, getMarginReportContract.path + search(query),
    { method: getMarginReportContract.method }
  ),
  getSalesReport: (query: ReportQuery = {}): Promise<readonly SalesReportResponse[]> => requestJson(
    fetcher, getSalesReportContract.path + search(query),
    { method: getSalesReportContract.method }
  ),
  getInventoryReport: (
    query: { readonly asOf: string; readonly expiringWithinDays?: number; readonly limit?: number }
  ): Promise<readonly InventoryReportResponse[]> => requestJson(
    fetcher, getInventoryReportContract.path + search(query),
    { method: getInventoryReportContract.method }
  ),
  printXReport: (input: SimulatedFiscalReportRequest, idempotencyKey: string): Promise<SimulatedFiscalReportResponse> => requestJson(
    fetcher, printSimulatedXReportContract.path,
    { method: printSimulatedXReportContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  printZReport: (input: SimulatedFiscalReportRequest, idempotencyKey: string): Promise<SimulatedFiscalReportResponse> => requestJson(
    fetcher, printSimulatedZReportContract.path,
    { method: printSimulatedZReportContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  /**
   * Administración de identidad. Ninguna de estas llamadas transporta un PIN
   * ajeno: el enrolamiento devuelve un ticket de un solo uso que el operador
   * canjea por su propio PIN en la terminal donde va a trabajar (ADR-0028).
   */
});