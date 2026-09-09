import { err, InfrastructureError, ok, type AppError, type Result } from '@supermarket/shared';
import type {
  ExchangeRateProvider,
  ExchangeRateSuggestionDto
} from '@supermarket/core';

export type ExchangeRateProviderConfig = {
  readonly endpoint: string | null;
  readonly source: string;
  readonly timeoutMs?: number;
  readonly fetcher?: typeof fetch;
};

type ProviderPayload = {
  readonly baseCurrency?: unknown;
  readonly quoteCurrency?: unknown;
  readonly rateValue?: unknown;
  readonly rateScale?: unknown;
  readonly rate?: unknown;
  readonly source?: unknown;
  readonly observedAt?: unknown;
  readonly validFrom?: unknown;
  readonly validUntil?: unknown;
};

const error = (code: string, message: string): Result<never, AppError> =>
  err(new InfrastructureError(code, message));

const decimalRate = (value: string): { value: number; scale: number } | null => {
  const match = /^([0-9]+)(?:\.([0-9]{1,8}))?$/.exec(value.trim());
  if (!match) return null;
  const fraction = match[2] ?? '';
  const digits = `${match[1]}${fraction}`;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? { value: parsed, scale: fraction.length }
    : null;
};

const isoOrNull = (value: unknown): Date | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export class HttpExchangeRateProvider implements ExchangeRateProvider {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: ExchangeRateProviderConfig) {
    this.fetcher = config.fetcher ?? globalThis.fetch;
    this.timeoutMs = config.timeoutMs ?? 5000;
  }

  async getSuggestedRate(
    baseCurrency: string,
    quoteCurrency: string
  ): Promise<Result<ExchangeRateSuggestionDto, AppError>> {
    if (!this.config.endpoint) {
      return error('EXCHANGE_RATE_PROVIDER_NOT_CONFIGURED', 'Exchange rate provider is not configured.');
    }
    const url = new URL(this.config.endpoint);
    url.searchParams.set('baseCurrency', baseCurrency);
    url.searchParams.set('quoteCurrency', quoteCurrency);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(url, { method: 'GET', headers: { accept: 'application/json' }, signal: controller.signal });
    } catch {
      return error('NETWORK_UNAVAILABLE', 'Exchange rate suggestion is unavailable.');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) return error('NETWORK_UNAVAILABLE', 'Exchange rate suggestion is unavailable.');
    let payload: ProviderPayload;
    try { payload = await response.json() as ProviderPayload; } catch {
      return error('EXCHANGE_RATE_PROVIDER_INVALID_RESPONSE', 'Exchange rate provider response is invalid.');
    }
    return this.toSuggestion(payload, baseCurrency, quoteCurrency);
  }

  private toSuggestion(
    payload: ProviderPayload,
    baseCurrency: string,
    quoteCurrency: string
  ): Result<ExchangeRateSuggestionDto, AppError> {
    if (payload.baseCurrency !== undefined && payload.baseCurrency !== baseCurrency) {
      return error('EXCHANGE_RATE_PAIR_UNSUPPORTED', 'Exchange rate provider returned a different currency pair.');
    }
    if (payload.quoteCurrency !== undefined && payload.quoteCurrency !== quoteCurrency) {
      return error('EXCHANGE_RATE_PAIR_UNSUPPORTED', 'Exchange rate provider returned a different currency pair.');
    }
    let rateValue: number;
    let rateScale: number;
    if (Number.isSafeInteger(payload.rateValue) && Number.isInteger(payload.rateScale)) {
      rateValue = payload.rateValue as number;
      rateScale = payload.rateScale as number;
    } else if (typeof payload.rate === 'string') {
      const parsed = decimalRate(payload.rate);
      if (!parsed) return error('EXCHANGE_RATE_PROVIDER_INVALID_RESPONSE', 'Exchange rate provider response is invalid.');
      rateValue = parsed.value;
      rateScale = parsed.scale;
    } else {
      return error('EXCHANGE_RATE_PROVIDER_INVALID_RESPONSE', 'Exchange rate provider response is invalid.');
    }
    if (rateValue <= 0 || rateScale < 0 || rateScale > 8) {
      return error('EXCHANGE_RATE_PROVIDER_INVALID_RESPONSE', 'Exchange rate provider response is invalid.');
    }
    const observedAt = isoOrNull(payload.observedAt) ?? new Date();
    const validFrom = isoOrNull(payload.validFrom);
    const validUntil = isoOrNull(payload.validUntil);
    if (validFrom && validUntil && validUntil <= validFrom) {
      return error('EXCHANGE_RATE_PROVIDER_INVALID_RESPONSE', 'Exchange rate provider response is invalid.');
    }
    return ok({
      baseCurrency,
      quoteCurrency,
      rateValue,
      rateScale,
      source: typeof payload.source === 'string' && payload.source.trim().length > 0
        ? payload.source.trim() : this.config.source,
      observedAt,
      validFrom,
      validUntil
    });
  }
}

export class UnavailableExchangeRateProvider implements ExchangeRateProvider {
  getSuggestedRate(
    baseCurrency: string,
    quoteCurrency: string
  ): Promise<Result<ExchangeRateSuggestionDto, AppError>> {
    return Promise.resolve(error(
      'EXCHANGE_RATE_PROVIDER_NOT_CONFIGURED',
      `Exchange rate provider is not configured for ${baseCurrency}/${quoteCurrency}.`
    ));
  }
}

/** Endpoint público del dólar oficial venezolano, el que publica el BCV. */
const BCV_ENDPOINT = 'https://ve.dolarapi.com/v1/dolares/oficial';
const BCV_SOURCE = 'BCV · dólar oficial';

export type BcvExchangeRateProviderConfig = {
  readonly endpoint?: string;
  readonly source?: string;
  readonly timeoutMs?: number;
  readonly fetcher?: typeof fetch;
};

/**
 * Tasa oficial del dólar publicada por el Banco Central de Venezuela.
 *
 * Solo **sugiere**: quien opera la revisa y la registra, porque una tasa que
 * entra sola a la base sería una regla de negocio tomada por un servicio
 * externo. El nodo no consulta nada por su cuenta; esto viaja únicamente
 * cuando alguien pide la sugerencia desde la pantalla de tasas.
 *
 * El valor **no se lee como número de JavaScript**. `JSON.parse` convierte
 * `820.1018` en un flotante, y una tasa en flotante contradice la invariante
 * que gobierna todo el dinero del sistema. Se extrae el literal del cuerpo tal
 * como viajó y se conserva como entero con su escala.
 */
export class BcvExchangeRateProvider implements ExchangeRateProvider {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly endpoint: string;
  private readonly source: string;

  constructor(config: BcvExchangeRateProviderConfig = {}) {
    this.fetcher = config.fetcher ?? globalThis.fetch;
    this.timeoutMs = config.timeoutMs ?? 5000;
    this.endpoint = config.endpoint ?? BCV_ENDPOINT;
    this.source = config.source ?? BCV_SOURCE;
  }

  async getSuggestedRate(
    baseCurrency: string,
    quoteCurrency: string
  ): Promise<Result<ExchangeRateSuggestionDto, AppError>> {
    if (baseCurrency !== 'USD' || quoteCurrency !== 'VES') {
      return error(
        'EXCHANGE_RATE_PAIR_UNSUPPORTED',
        'The central bank feed only publishes USD against VES.'
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let body: string;
    try {
      const response = await this.fetcher(this.endpoint, {
        method: 'GET', headers: { accept: 'application/json' }, signal: controller.signal
      });
      if (!response.ok) return error('NETWORK_UNAVAILABLE', 'The published rate is unavailable.');
      body = await response.text();
    } catch {
      return error('NETWORK_UNAVAILABLE', 'The published rate is unavailable.');
    } finally {
      clearTimeout(timer);
    }

    /** El literal, no el flotante que `JSON.parse` produciría. */
    const published = /"promedio"\s*:\s*([0-9]+(?:\.[0-9]+)?)/.exec(body);
    const rate = published?.[1] ? decimalRate(published[1]) : null;
    if (!rate) {
      return error('EXCHANGE_RATE_PROVIDER_INVALID_RESPONSE', 'The published rate is not usable.');
    }

    const updated = /"fechaActualizacion"\s*:\s*"([^"]+)"/.exec(body);
    const observedAt = isoOrNull(updated?.[1]) ?? new Date();

    return ok({
      baseCurrency,
      quoteCurrency,
      rateValue: rate.value,
      rateScale: rate.scale,
      source: this.source,
      observedAt,
      /** Vige desde que el banco la publicó, no desde que la terminal la pidió. */
      validFrom: observedAt,
      validUntil: null
    });
  }
}
