import { useEffect, useState } from 'react';
import { Money, Quantity, type ExchangeRateResponse } from '@supermarket/shared';
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

/**
 * Lee la tasa vigente que el nodo publica sin permiso. Cualquier fallo que no
 * sea «no hay tasa» se informa como consulta fallida, nunca como tasa ausente.
 */
export const useReferenceRate = (
  api: Pick<OperationApi, 'getCurrentExchangeRate'>,
  refreshKey: unknown = null
): ReferenceRate => {
  const [state, setState] = useState<ReferenceRate>({ kind: 'loading' });
  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => api.getCurrentExchangeRate(REFERENCE_RATE_PAIR))
      .then((rate) => { if (active) setState({ kind: 'current', rate }); })
      .catch((error: unknown) => {
        if (!active) return;
        setState(error instanceof ApiProblemError && error.problem.code === 'CURRENCY_RATE_MISSING'
          ? { kind: 'missing' }
          : { kind: 'unavailable' });
      });
    return () => { active = false; };
  }, [api, refreshKey]);
  return state;
};

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
 * Convierte de la moneda base a la cotizada con las mismas dos primitivas de
 * `@supermarket/shared` que usa `CurrencyConverter` en el nodo, así que no hay
 * una segunda fórmula que pueda separarse (criterio de la enmienda de
 * ADR-0031). Hereda D-002: supone la misma escala de unidad menor.
 */
export const convertAtReferenceRate = (
  minorUnits: number,
  rate: Pick<ExchangeRateResponse, 'rateValue' | 'rateScale'>
): number => Money.fromMinorUnits(minorUnits, REFERENCE_RATE_PAIR.baseCurrency)
  .multiplyByQuantity(Quantity.fromScaled(rate.rateValue, rate.rateScale))
  .minorUnits;

/** La tasa exacta con miles y decimales de es-VE, sin pasar por un flotante. */
const rateLabel = (rate: ExchangeRateResponse): string => {
  const [integer = '', fraction] = formatScaledDecimal(rate.rateValue, rate.rateScale).split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return fraction === undefined ? grouped : grouped + ',' + fraction;
};
const dayLabel = (iso: string): string => new Date(iso).toLocaleDateString('es-VE');
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
  { state, totalMinorUnits, saleCurrencyCode, scale }: {
    readonly state: ReferenceRate;
    readonly totalMinorUnits: number;
    readonly saleCurrencyCode: string;
    readonly scale: number;
  }
): React.JSX.Element | null => {
  if (saleCurrencyCode !== REFERENCE_RATE_PAIR.baseCurrency || state.kind === 'loading') return null;
  const text = state.kind === 'current'
    ? '≈ ' + money(convertAtReferenceRate(totalMinorUnits, state.rate), REFERENCE_RATE_PAIR.quoteCurrency, scale) +
      ' · tasa ' + rateLabel(state.rate) + ' · ' + state.rate.source + ' · desde ' + dayLabel(state.rate.validFrom)
    : state.kind === 'missing'
      ? 'Sin tasa ' + PAIR_LABEL + ': el equivalente en bolívares no está disponible.'
      : 'Equivalente en bolívares no disponible: no se pudo consultar la tasa.';
  return <span className="checkout-equivalent" data-testid="reference-equivalent">{text}</span>;
};
