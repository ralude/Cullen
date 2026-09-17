/**
 * Operaciones de catálogo del cliente HTTP.
 * Catálogo: productos, precios, categorías y unidades de medida.
 *
 * Grupo propio desde 12.05.04: cambiar una de estas operaciones se hace aquí y
 * no dentro de las noventa y dos de todas las features. `createDesktopApi` las
 * esparce, así que la superficie pública no cambia.
 */
import {
  findProductByBarcodeContract,
  listCategoriesContract,
  listUnitsOfMeasureContract,
  listProductsContract,
  saveCategoryContract,
  saveUnitContract,
  createProductContract,
  updatePriceContract,
  getPriceHistoryContract,
  type CreateProductRequest,
  type ProductResponse,
  type PriceHistoryResponse,
  type OperationalMasterDataResponse,
  type SaveCategoryRequest,
  type SaveUnitRequest,
  type CategoryResponse,
  type UnitOfMeasureResponse
} from '@supermarket/shared';
import { path, requestJson, withIdempotency } from './api-transport.js';

export const catalogOperations = (fetcher: typeof fetch) => ({
  findProductByBarcode: (barcode: string): Promise<{ product: ProductResponse; snapshot: ProductResponse['snapshot'] }> => requestJson(
    fetcher, path(findProductByBarcodeContract.path, barcode), { method: findProductByBarcodeContract.method }
  ),
  updatePrice: (productId: string, input: { priceMinorUnits: number; currencyCode: string; reason: string }, idempotencyKey: string): Promise<ProductResponse> => requestJson(
    fetcher, path(updatePriceContract.path, productId),
    { method: updatePriceContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  listProducts: (query = ''): Promise<readonly ProductResponse[]> => requestJson(
    fetcher, listProductsContract.path + (query ? '?query=' + encodeURIComponent(query) : ''),
    { method: listProductsContract.method }
  ),
  saveCategory: (input: SaveCategoryRequest, idempotencyKey: string): Promise<OperationalMasterDataResponse['categories'][number]> => requestJson(
    fetcher, saveCategoryContract.path,
    { method: saveCategoryContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  saveUnit: (input: SaveUnitRequest, idempotencyKey: string): Promise<OperationalMasterDataResponse['units'][number]> => requestJson(
    fetcher, saveUnitContract.path,
    { method: saveUnitContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  getPriceHistory: (productId: string): Promise<readonly PriceHistoryResponse[]> => requestJson(
    fetcher, path(getPriceHistoryContract.path, productId), { method: getPriceHistoryContract.method }
  ),
  createProduct: (input: CreateProductRequest, idempotencyKey: string): Promise<ProductResponse> => requestJson(
    fetcher, createProductContract.path,
    { method: createProductContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  listCategories: (): Promise<readonly CategoryResponse[]> => requestJson(
    fetcher, listCategoriesContract.path, { method: listCategoriesContract.method }
  ),
  listUnitsOfMeasure: (): Promise<readonly UnitOfMeasureResponse[]> => requestJson(
    fetcher, listUnitsOfMeasureContract.path, { method: listUnitsOfMeasureContract.method }
  )
});