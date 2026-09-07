import type { ExchangeRate } from '../../domain/currency/index.js';

/**
 * Puerto de repositorio para tasas de cambio. Persistencia real en Fase 3.
 */
export interface ExchangeRateRepository {
  /** Persiste la tasa y devuelve la versión monotónica asignada a su par. */
  save(rate: ExchangeRate): Promise<number>;
  findCurrentByPair(
    baseCurrency: string,
    quoteCurrency: string,
    at: Date
  ): Promise<ExchangeRate | null>;
  findById(rateId: string): Promise<ExchangeRate | null>;
}
