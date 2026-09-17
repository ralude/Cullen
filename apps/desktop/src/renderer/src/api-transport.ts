/**
 * Transporte del cliente HTTP: una petición JSON con su sesión, su error
 * público, su clave de idempotencia y la construcción de rutas y consultas.
 *
 * Separado de las operaciones por 12.05.04. Cambiar cómo viaja una petición
 * —cookies, 204, cabeceras, problema— se hace aquí, sin pasar por las
 * operaciones de ninguna feature.
 */
import type { ProblemDetails } from '@supermarket/shared';

export class ApiProblemError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.title);
    this.name = 'ApiProblemError';
  }
}

export const requestJson = async <T>(
  fetcher: typeof fetch,
  path: string,
  init: RequestInit
): Promise<T> => {
  const response = await fetcher(path, {
    ...init,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.headers ?? {})
    }
  });
  if (response.status === 204) return undefined as T;

  const body = await response.json() as T | ProblemDetails;
  if (!response.ok) throw new ApiProblemError(body as ProblemDetails);
  return body as T;
};

export const withIdempotency = (key: string): HeadersInit => ({ 'idempotency-key': key });

export const createIdempotencyKey = (): string => {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  return cryptoApi?.randomUUID?.() ?? `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export type ReportQuery = {
  readonly from?: string; readonly to?: string; readonly limit?: number;
  readonly cashRegisterId?: string; readonly actorId?: string;
  readonly action?: string; readonly entityType?: string;
  readonly currencyCode?: string;
};

export type ExchangeRateHistoryQuery = {
  readonly baseCurrency: string; readonly quoteCurrency: string; readonly limit?: number;
};

export type ExchangeRatePairQuery = { readonly baseCurrency: string; readonly quoteCurrency: string };

export const search = (query: Readonly<Record<string, string | number | undefined>>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? '?' + serialized : '';
};

/**
 * Convierte un texto decimal a un entero escalado sin `float`, infiriendo la
 * escala de los dígitos escritos. No admite más de 8 decimales: el dominio de
 * `ExchangeRate` rechaza una escala mayor.
 */

export const path = (template: string, ...parts: string[]): string =>
  parts.reduce((value, part) => value.replace(/:[A-Za-z]+/, encodeURIComponent(part)), template);