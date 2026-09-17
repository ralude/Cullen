/**
 * Operaciones de venta del cliente HTTP.
 *
 * Primer grupo que 12.05.04 saca del cliente plano: agregar o cambiar una
 * operación de venta se hace aquí, no dentro de noventa y dos métodos de todas
 * las features. La superficie pública no cambia —`createDesktopApi` esparce el
 * grupo—, así que ninguna pantalla ni mock se entera del corte.
 */
import {
  addSaleItemContract,
  applySaleDiscountContract,
  completeSaleContract,
  returnSaleContract,
  getSaleHistoryContract,
  issueSaleInvoiceContract,
  getSaleContract,
  registerSalePaymentsContract,
  removeSaleItemContract,
  setSaleRecipientContract,
  startSaleContract,
  voidSaleContract,
  type RegisterSalePaymentsRequest,
  type SetSaleRecipientRequest,
  type SaleResponse,
  type SaleHistoryVersionResponse,
  type StartSaleRequest,
  type AddSaleItemRequest,
  type ApplySaleDiscountRequest,
  type VoidSaleRequest,
  type ReturnSaleRequest,
  type SaleReturnResponse,
  type SimulatedFiscalDocumentResponse
} from '@supermarket/shared';
import { path, requestJson, search, withIdempotency } from './api-transport.js';

export const salesOperations = (fetcher: typeof fetch) => ({
  getSale: (saleId: string): Promise<SaleResponse> => requestJson(
    fetcher, path(getSaleContract.path, saleId), { method: getSaleContract.method }
  ),
  startSale: (input: StartSaleRequest, idempotencyKey: string): Promise<SaleResponse> => requestJson(
    fetcher, startSaleContract.path,
    { method: startSaleContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  addSaleItem: (saleId: string, input: AddSaleItemRequest, idempotencyKey: string): Promise<SaleResponse> => requestJson(
    fetcher, path(addSaleItemContract.path, saleId),
    { method: addSaleItemContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  removeSaleItem: (saleId: string, itemId: string, idempotencyKey: string): Promise<SaleResponse> => requestJson(
    fetcher, path(removeSaleItemContract.path, saleId, itemId),
    { method: removeSaleItemContract.method, headers: withIdempotency(idempotencyKey) }
  ),
  applySaleDiscount: (saleId: string, input: ApplySaleDiscountRequest, idempotencyKey: string): Promise<SaleResponse> => requestJson(
    fetcher, path(applySaleDiscountContract.path, saleId),
    { method: applySaleDiscountContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  registerSalePayments: (saleId: string, input: RegisterSalePaymentsRequest, idempotencyKey: string): Promise<SaleResponse> => requestJson(
    fetcher, path(registerSalePaymentsContract.path, saleId),
    { method: registerSalePaymentsContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  completeSale: (saleId: string, idempotencyKey: string): Promise<SaleResponse> => requestJson(
    fetcher, path(completeSaleContract.path, saleId),
    { method: completeSaleContract.method, headers: withIdempotency(idempotencyKey) }
  ),
  issueSaleInvoice: (saleId: string, reason: string, idempotencyKey: string): Promise<SimulatedFiscalDocumentResponse> => requestJson(
    fetcher, path(issueSaleInvoiceContract.path, saleId),
    {
      method: issueSaleInvoiceContract.method, headers: withIdempotency(idempotencyKey),
      body: JSON.stringify({ reason })
    }
  ),
  returnSale: (saleId: string, input: ReturnSaleRequest, idempotencyKey: string): Promise<SaleReturnResponse> => requestJson(
    fetcher, path(returnSaleContract.path, saleId),
    { method: returnSaleContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  setSaleRecipient: (saleId: string, input: SetSaleRecipientRequest, idempotencyKey: string): Promise<SaleResponse> => requestJson(
    fetcher, path(setSaleRecipientContract.path, saleId),
    { method: setSaleRecipientContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  voidSale: (saleId: string, input: VoidSaleRequest, idempotencyKey: string): Promise<SaleResponse> => requestJson(
    fetcher, path(voidSaleContract.path, saleId),
    { method: voidSaleContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  getSaleHistory: (
    saleId: string, query: { readonly limit?: number } = {}
  ): Promise<readonly SaleHistoryVersionResponse[]> => requestJson(
    fetcher, path(getSaleHistoryContract.path, saleId) + search(query),
    { method: getSaleHistoryContract.method }
  )
});