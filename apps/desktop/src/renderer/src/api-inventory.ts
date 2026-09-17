/**
 * Operaciones de inventario del cliente HTTP.
 * Inventario: kardex, recepción, ajustes y el ciclo del conteo físico.
 *
 * Grupo propio desde 12.05.04: cambiar una de estas operaciones se hace aquí y
 * no dentro de las noventa y dos de todas las features. `createDesktopApi` las
 * esparce, así que la superficie pública no cambia.
 */
import {
  getKardexContract,
  receivePurchaseContract,
  registerStockAdjustmentContract,
  openStockCountContract,
  recordStockCountLineContract,
  closeStockCountContract,
  approveStockCountContract,
  rejectStockCountContract,
  getStockCountContract,
  listStockCountsContract,
  type RegisterStockAdjustmentRequest,
  type ReceivePurchaseRequest,
  type KardexDto,
  type OpenStockCountRequest,
  type RecordStockCountLineRequest,
  type CloseStockCountRequest,
  type ApproveStockCountRequest,
  type RejectStockCountRequest,
  type StockCountResponse,
  type StockCountStatusResponse
} from '@supermarket/shared';
import { path, requestJson, search, withIdempotency } from './api-transport.js';

export const inventoryOperations = (fetcher: typeof fetch) => ({
  openStockCount: (input: OpenStockCountRequest, idempotencyKey: string): Promise<StockCountResponse> => requestJson(
    fetcher, openStockCountContract.path,
    { method: openStockCountContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  recordStockCountLine: (stockCountId: string, input: RecordStockCountLineRequest, idempotencyKey: string): Promise<StockCountResponse> => requestJson(
    fetcher, path(recordStockCountLineContract.path, stockCountId),
    { method: recordStockCountLineContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  closeStockCount: (stockCountId: string, input: CloseStockCountRequest, idempotencyKey: string): Promise<StockCountResponse> => requestJson(
    fetcher, path(closeStockCountContract.path, stockCountId),
    { method: closeStockCountContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  approveStockCount: (stockCountId: string, input: ApproveStockCountRequest, idempotencyKey: string): Promise<StockCountResponse> => requestJson(
    fetcher, path(approveStockCountContract.path, stockCountId),
    { method: approveStockCountContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  rejectStockCount: (stockCountId: string, input: RejectStockCountRequest, idempotencyKey: string): Promise<StockCountResponse> => requestJson(
    fetcher, path(rejectStockCountContract.path, stockCountId),
    { method: rejectStockCountContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  getStockCount: (stockCountId: string): Promise<StockCountResponse> => requestJson(
    fetcher, path(getStockCountContract.path, stockCountId), { method: getStockCountContract.method }
  ),
  listStockCounts: (status?: StockCountStatusResponse): Promise<readonly StockCountResponse[]> => requestJson(
    fetcher, listStockCountsContract.path + search({ status }),
    { method: listStockCountsContract.method }
  ),
  getKardex: (productId: string, query: {
    readonly batchId?: string; readonly from?: string; readonly to?: string;
    readonly reason?: string; readonly limit?: number;
  } = {}): Promise<KardexDto> => requestJson(
    fetcher, path(getKardexContract.path, productId) + search(query), { method: getKardexContract.method }
  ),
  receivePurchase: (input: ReceivePurchaseRequest, idempotencyKey: string): Promise<KardexDto> => requestJson(
    fetcher, receivePurchaseContract.path,
    { method: receivePurchaseContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  registerStockAdjustment: (stockItemId: string, input: RegisterStockAdjustmentRequest, idempotencyKey: string): Promise<KardexDto> => requestJson(
    fetcher, path(registerStockAdjustmentContract.path, stockItemId),
    { method: registerStockAdjustmentContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  )
});