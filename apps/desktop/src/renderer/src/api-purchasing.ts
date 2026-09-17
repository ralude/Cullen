/**
 * Operaciones de compras del cliente HTTP.
 * Compras: proveedores y el ciclo de la recepción de compra.
 *
 * Grupo propio desde 12.05.04: cambiar una de estas operaciones se hace aquí y
 * no dentro de las noventa y dos de todas las features. `createDesktopApi` las
 * esparce, así que la superficie pública no cambia.
 */
import {
  startPurchaseReceiptContract,
  completePurchaseReceiptContract,
  reversePurchaseReceiptContract,
  listSuppliersContract,
  createSupplierContract,
  updateSupplierContract,
  changeSupplierStatusContract,
  correctSupplierTaxIdentityContract,
  type PurchaseReceiptResponse,
  type StartPurchaseReceiptRequest,
  type CompletePurchaseReceiptRequest,
  type ReversePurchaseReceiptRequest,
  type SupplierResponse,
  type SupplierStatusResponse,
  type CreateSupplierRequest,
  type UpdateSupplierRequest,
  type ChangeSupplierStatusRequest,
  type CorrectSupplierTaxIdentityRequest
} from '@supermarket/shared';
import { path, requestJson, search, withIdempotency } from './api-transport.js';

export const purchasingOperations = (fetcher: typeof fetch) => ({
  listSuppliers: (status?: SupplierStatusResponse): Promise<readonly SupplierResponse[]> => requestJson(
    fetcher, listSuppliersContract.path + search({ status }),
    { method: listSuppliersContract.method }
  ),
  createSupplier: (input: CreateSupplierRequest, idempotencyKey: string): Promise<SupplierResponse> => requestJson(
    fetcher, createSupplierContract.path,
    { method: createSupplierContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  updateSupplier: (supplierId: string, input: UpdateSupplierRequest, idempotencyKey: string): Promise<SupplierResponse> => requestJson(
    fetcher, path(updateSupplierContract.path, supplierId),
    { method: updateSupplierContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  changeSupplierStatus: (supplierId: string, input: ChangeSupplierStatusRequest, idempotencyKey: string): Promise<SupplierResponse> => requestJson(
    fetcher, path(changeSupplierStatusContract.path, supplierId),
    { method: changeSupplierStatusContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  correctSupplierTaxIdentity: (supplierId: string, input: CorrectSupplierTaxIdentityRequest, idempotencyKey: string): Promise<SupplierResponse> => requestJson(
    fetcher, path(correctSupplierTaxIdentityContract.path, supplierId),
    { method: correctSupplierTaxIdentityContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  startPurchaseReceipt: (input: StartPurchaseReceiptRequest, idempotencyKey: string): Promise<PurchaseReceiptResponse> => requestJson(
    fetcher, startPurchaseReceiptContract.path,
    {
      method: startPurchaseReceiptContract.method,
      headers: withIdempotency(idempotencyKey), body: JSON.stringify(input)
    }
  ),
  completePurchaseReceipt: (receiptId: string, input: CompletePurchaseReceiptRequest, idempotencyKey: string): Promise<PurchaseReceiptResponse> => requestJson(
    fetcher, path(completePurchaseReceiptContract.path, receiptId),
    {
      method: completePurchaseReceiptContract.method,
      headers: withIdempotency(idempotencyKey), body: JSON.stringify(input)
    }
  ),
  reversePurchaseReceipt: (receiptId: string, input: ReversePurchaseReceiptRequest, idempotencyKey: string): Promise<PurchaseReceiptResponse> => requestJson(
    fetcher, path(reversePurchaseReceiptContract.path, receiptId),
    {
      method: reversePurchaseReceiptContract.method,
      headers: withIdempotency(idempotencyKey), body: JSON.stringify(input)
    }
  )
});