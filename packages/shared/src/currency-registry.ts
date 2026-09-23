import { DomainError } from './errors/app-error.js';

/**
 * Monedas que el sistema acepta y su exponente ISO 4217: cuántas unidades
 * menores tiene la unidad mayor, como potencia de diez (ADR-0033). Es la única
 * fuente: el nodo y el renderer leen esta misma tabla.
 *
 * Agregar una moneda es una versión nueva, con su fila y sus pruebas.
 */
export const SUPPORTED_CURRENCIES: Readonly<Record<string, number>> = Object.freeze({
  USD: 2,
  VES: 2,
  EUR: 2,
  COP: 2,
  CLP: 0
});

export const isSupportedCurrency = (code: string): boolean =>
  Object.hasOwn(SUPPORTED_CURRENCIES, code);

/** Exponente de la moneda, o `CURRENCY_UNSUPPORTED` si no está en el registro. */
export const minorUnitExponentOf = (code: string): number => {
  if (!isSupportedCurrency(code)) {
    throw new DomainError(
      'CURRENCY_UNSUPPORTED',
      'Currency is not supported by this system.'
    );
  }
  return SUPPORTED_CURRENCIES[code]!;
};
