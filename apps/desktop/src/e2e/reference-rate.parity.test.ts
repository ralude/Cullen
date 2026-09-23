import { describe, expect, it } from 'vitest';
import { CurrencyConverter, ExchangeRate } from '@supermarket/core';
import { Money } from '@supermarket/shared';
import { convertAtReferenceRate } from '../renderer/src/screens/reference-rate.js';

/**
 * El equivalente en bolívares de la barra de cobro es informativo, pero no
 * puede diferir del que el nodo calcularía: se prueba contra el convertidor
 * del dominio con los mismos importes y la misma tasa, incluidos los que
 * obligan a redondear.
 */
describe('paridad del equivalente en bolívares con el nodo', () => {
  const validFrom = new Date('2026-09-23T00:00:00.000Z');
  const at = new Date('2026-09-23T12:00:00.000Z');

  it.each([
    [10000, 40000, 2],
    [360, 40000, 2],
    [1, 820_1018, 4],
    [12_345, 478_58, 2],
    [99_999, 1_234_567, 4]
  ])('convierte %i unidades menores de USD a la tasa %i con escala %i', (minorUnits, rateValue, rateScale) => {
    const rate = ExchangeRate.create({
      id: 'rate-001', baseCurrency: 'USD', quoteCurrency: 'VES', rateValue, rateScale,
      source: 'Prueba', validFrom, registeredBy: 'user-001'
    });
    const node = new CurrencyConverter().convert(Money.fromMinorUnits(minorUnits, 'USD'), rate, at);

    expect(convertAtReferenceRate(minorUnits, { rateValue, rateScale })).toBe(node.minorUnits);
  });
});
