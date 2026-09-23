import { useEffect, useState } from 'react';
import {
  isSupportedCurrency, minorUnitExponentOf, Money, type ExchangeRateResponse
} from '@supermarket/shared';
import { formatScaledDecimal } from '../amount-input.js';
import type { OperationApi } from '../api-client.js';
import { ApiProblemError } from '../api-transport.js';
import { money } from './shared.js';

/**
 * Par con el que la caja cobra en bolívares: el único que publica el
 * proveedor BCV del nodo. Configurarlo queda para cuando otro par lo pida.
 */
export const REFERENCE_RATE_PAIR = { baseCurrency: 'USD', quoteCurrency: 'VES' } as const;

/** `unavailable` no es «sin tasa»: la consulta falló y no se sabe qué hay. */
export type ReferenceRate =
  | { readonly kind: 'loading' }
  | { readonly kind: 'current'; readonly rate: ExchangeRateResponse }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unavailable' };

export type CurrencyPair = { readonly baseCurrency: string; readonly quoteCurrency: string };

const isMissing = (error: unknown): boolean =>
  error instanceof ApiProblemError && error.problem.code === 'CURRENCY_RATE_MISSING';

/**
 * Lee la tasa vigente de un par, que el nodo publica sin permiso. Si el par no
 * tiene tasa se prueba el inverso: el nodo convierte en los dos sentidos con
 * cualquiera de ellos. Un fallo que no sea «no hay tasa» se informa como
 * consulta fallida, nunca como tasa ausente. Sin par, no consulta nada.
 */
export const useExchangeRate = (
  api: Pick<OperationApi, 'getCurrentExchangeRate'>,
  pair: CurrencyPair | null,
  refreshKey: unknown = null
): ReferenceRate => {
  const [state, setState] = useState<ReferenceRate>({ kind: 'loading' });
  const baseCurrency = pair?.baseCurrency ?? null;
  const quoteCurrency = pair?.quoteCurrency ?? null;
  useEffect(() => {
    if (baseCurrency === null || quoteCurrency === null) return;
    let active = true;
    setState({ kind: 'loading' });
    void Promise.resolve()
      .then(() => api.getCurrentExchangeRate({ baseCurrency, quoteCurrency }))
      .catch((error: unknown) => {
        if (!isMissing(error)) throw error;
        return api.getCurrentExchangeRate({ baseCurrency: quoteCurrency, quoteCurrency: baseCurrency });
      })
      .then((rate) => { if (active) setState({ kind: 'current', rate }); })
      .catch((error: unknown) => {
        if (active) setState(isMissing(error) ? { kind: 'missing' } : { kind: 'unavailable' });
      });
    return () => { active = false; };
  }, [api, baseCurrency, quoteCurrency, refreshKey]);
  return state;
};

/** La tasa USD/VES con la que la caja cobra en bolívares. */
export const useReferenceRate = (
  api: Pick<OperationApi, 'getCurrentExchangeRate'>,
  refreshKey: unknown = null
): ReferenceRate => useExchangeRate(api, REFERENCE_RATE_PAIR, refreshKey);

/**
 * El proyecto no define «día hábil» y Cullen no tiene calendario bancario:
 * se compara el día de calendario local, y por eso el aviso nunca bloquea.
 */
export const isFromEarlierDay = (validFromIso: string, now: Date = new Date()): boolean => {
  const validFrom = new Date(validFromIso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return validFrom < startOfToday;
};

/**
 * Convierte de dólares a bolívares con `Money.convertAtRate`, la misma
 * conversión que usa `CurrencyConverter` en el nodo (ADR-0033): no hay una
 * segunda fórmula que pueda separarse.
 */
export const convertAtReferenceRate = (
  minorUnits: number,
  rate: Pick<ExchangeRateResponse, 'rateValue' | 'rateScale'>
): number => Money.fromMinorUnits(minorUnits, REFERENCE_RATE_PAIR.baseCurrency)
  .convertAtRate({ ...REFERENCE_RATE_PAIR, rateValue: rate.rateValue, rateScale: rate.rateScale })
  .minorUnits;

/** Exponente de la moneda para mostrarla; una moneda fuera del registro se muestra con 2. */
export const displayExponent = (currencyCode: string): number =>
  isSupportedCurrency(currencyCode) ? minorUnitExponentOf(currencyCode) : 2;

/** La tasa exacta con miles y decimales de es-VE, sin pasar por un flotante. */
export const rateLabel = (rate: ExchangeRateResponse): string => {
  const [integer = '', fraction] = formatScaledDecimal(rate.rateValue, rate.rateScale).split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return fraction === undefined ? grouped : grouped + ',' + fraction;
};
export const dayLabel = (iso: string): string => new Date(iso).toLocaleDateString('es-VE');
const PAIR_LABEL = REFERENCE_RATE_PAIR.baseCurrency + '/' + REFERENCE_RATE_PAIR.quoteCurrency;

/** Aviso de Caja: informa con qué tasa se cobrará en bolívares; no bloquea nada. */
export const ReferenceRateNotice = ({ state }: { readonly state: ReferenceRate }): React.JSX.Element | null => {
  if (state.kind === 'loading') return null;
  if (state.kind === 'current' && !isFromEarlierDay(state.rate.validFrom)) return null;
  const message = state.kind === 'current'
    ? 'Tasa ' + PAIR_LABEL + ' del ' + dayLabel(state.rate.validFrom) + ': ' + rateLabel(state.rate) +
      ' · ' + state.rate.source + '. Si ya hay una tasa nueva, regístrala en '
    : state.kind === 'missing'
      ? 'No hay tasa ' + PAIR_LABEL + ' registrada. Regístrala en '
      : 'No se pudo comprobar la tasa ' + PAIR_LABEL + '. Revísala en ';
  return (
    <p className="inline-status is-warning" role="status" data-testid="reference-rate-notice">
      <span aria-hidden="true">!</span> {message}<a href="#/rates">Tasas</a>
      {state.kind === 'unavailable' ? '.' : ' antes de cobrar en bolívares.'}
    </p>
  );
};

/** Línea informativa bajo el total: no entra al lote ni decide el cobro. */
export const ReferenceEquivalent = (
  { state, totalMinorUnits, saleCurrencyCode }: {
    readonly state: ReferenceRate;
    readonly totalMinorUnits: number;
    readonly saleCurrencyCode: string;
  }
): React.JSX.Element | null => {
  if (saleCurrencyCode !== REFERENCE_RATE_PAIR.baseCurrency || state.kind === 'loading') return null;
  const text = state.kind === 'current'
    ? '≈ ' + money(convertAtReferenceRate(totalMinorUnits, state.rate), REFERENCE_RATE_PAIR.quoteCurrency,
      displayExponent(REFERENCE_RATE_PAIR.quoteCurrency)) +
      ' · tasa ' + rateLabel(state.rate) + ' · ' + state.rate.source + ' · desde ' + dayLabel(state.rate.validFrom)
    : state.kind === 'missing'
      ? 'Sin tasa ' + PAIR_LABEL + ': el equivalente en bolívares no está disponible.'
      : 'Equivalente en bolívares no disponible: no se pudo consultar la tasa.';
  return <span className="checkout-equivalent" data-testid="reference-equivalent">{text}</span>;
};

/**
 * La tasa con la que se cobrará el método elegido cuando liquida en otra
 * moneda. Sin tasa vigente el pago no se puede agregar, y esta línea dice por
 * qué: la pantalla nunca envía un lote que el nodo rechazaría por falta de tasa.
 */
export const PaymentRateNote = (
  { state, pair }: { readonly state: ReferenceRate; readonly pair: CurrencyPair }
): React.JSX.Element | null => {
  if (state.kind === 'loading') return null;
  const label = pair.baseCurrency + '/' + pair.quoteCurrency;
  const text = state.kind === 'current'
    ? 'Tasa ' + state.rate.baseCurrency + '/' + state.rate.quoteCurrency + ' ' + rateLabel(state.rate) +
      ' · ' + state.rate.source + ' · desde ' + dayLabel(state.rate.validFrom)
    : state.kind === 'missing'
      ? 'No hay tasa ' + label + ': no se puede cobrar en ' + pair.quoteCurrency + '.'
      : 'No se pudo consultar la tasa ' + label + ': no se puede cobrar en ' + pair.quoteCurrency + '.';
  return (
    <span className={state.kind === 'current' ? 'payment-rate' : 'payment-rate is-warning'} data-testid="payment-rate">
      {text}
    </span>
  );
};
