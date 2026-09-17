/**
 * Operaciones de moneda del cliente HTTP.
 * Moneda: tasa vigente, su historia, la sugerida y su actualización.
 *
 * Grupo propio desde 12.05.04: cambiar una de estas operaciones se hace aquí y
 * no dentro de las noventa y dos de todas las features. `createDesktopApi` las
 * esparce, así que la superficie pública no cambia.
 */
import {
  getCurrentExchangeRateContract,
  getExchangeRateHistoryContract,
  getSuggestedExchangeRateContract,
  updateExchangeRateContract,
  type ExchangeRateResponse,
  type ExchangeRateSuggestionResponse,
  type UpdateExchangeRateRequest
} from '@supermarket/shared';
import {
  requestJson,
  search,
  withIdempotency,
  type ExchangeRateHistoryQuery,
  type ExchangeRatePairQuery
} from './api-transport.js';

export const currencyOperations = (fetcher: typeof fetch) => ({
  getCurrentExchangeRate: (query: ExchangeRatePairQuery): Promise<ExchangeRateResponse> => requestJson(
    fetcher, getCurrentExchangeRateContract.path + search(query),
    { method: getCurrentExchangeRateContract.method }
  ),
  getExchangeRateHistory: (query: ExchangeRateHistoryQuery): Promise<readonly ExchangeRateResponse[]> => requestJson(
    fetcher, getExchangeRateHistoryContract.path + search(query),
    { method: getExchangeRateHistoryContract.method }
  ),
  getSuggestedExchangeRate: (query: ExchangeRatePairQuery): Promise<{ suggestion: ExchangeRateSuggestionResponse }> => requestJson(
    fetcher, getSuggestedExchangeRateContract.path + search(query),
    { method: getSuggestedExchangeRateContract.method }
  ),
  updateExchangeRate: (input: UpdateExchangeRateRequest, idempotencyKey: string): Promise<ExchangeRateResponse> => requestJson(
    fetcher, updateExchangeRateContract.path,
    { method: updateExchangeRateContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  )
});