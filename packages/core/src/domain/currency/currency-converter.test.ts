import { describe, expect, it } from 'vitest';
import { Money } from '@supermarket/shared';
import { CurrencyConverter } from './currency-converter.js';
import { ExchangeRate } from './exchange-rate.js';

describe('CurrencyConverter', () => {
  const usdToVes = ExchangeRate.create({
    id: 'rate-usd-ves',
    baseCurrency: 'USD',
    quoteCurrency: 'VES',
    rateValue: 36500,
    rateScale: 3,
    source: 'BCV',
    validFrom: new Date('2026-08-01T00:00:00Z'),
    registeredBy: 'user-001'
  });

  const at = new Date('2026-08-10T12:00:00Z');

  it('converts base currency to quote currency by multiplying the rate', () => {
    const converter = new CurrencyConverter();
    const amount = Money.fromMinorUnits(1000, 'USD'); // 10.00 USD

    const result = converter.convert(amount, usdToVes, at);

    expect(result.currency).toBe('VES');
    expect(result.minorUnits).toBe(36500); // 365.00 VES
  });

  it('converts quote currency to base currency by dividing the rate', () => {
    const converter = new CurrencyConverter();
    const amount = Money.fromMinorUnits(36500, 'VES'); // 365.00 VES

    const result = converter.convert(amount, usdToVes, at);

    expect(result.currency).toBe('USD');
    expect(result.minorUnits).toBe(1000); // 10.00 USD
  });

  it('rounds fractional minor units half away from zero', () => {
    const converter = new CurrencyConverter();
    const amount = Money.fromMinorUnits(1, 'USD'); // 0.01 USD

    const result = converter.convert(amount, usdToVes, at);

    expect(result.minorUnits).toBe(37); // 0.365 VES -> 0.37 VES
  });

  it('rejects a rate that does not involve the money currency', () => {
    const converter = new CurrencyConverter();
    const amount = Money.fromMinorUnits(1000, 'EUR');

    expect(() => converter.convert(amount, usdToVes, at)).toThrowError(
      'Exchange rate does not apply to the given currency.'
    );
  });

  /** ADR-0033: la diferencia de exponentes entra en la misma división. */
  it('converts between currencies with different minor unit exponents', () => {
    const usdToClp = ExchangeRate.create({
      id: 'rate-usd-clp', baseCurrency: 'USD', quoteCurrency: 'CLP', rateValue: 900, rateScale: 0,
      source: 'Prueba', validFrom: new Date('2026-08-01T00:00:00Z'), registeredBy: 'user-001'
    });

    expect(new CurrencyConverter().convert(Money.fromMinorUnits(100, 'USD'), usdToClp, at).minorUnits)
      .toBe(900);
    expect(new CurrencyConverter().convert(Money.fromMinorUnits(900, 'CLP'), usdToClp, at).minorUnits)
      .toBe(100);
  });

  it('accepts a rate with the eight decimals ExchangeRate allows', () => {
    const precise = ExchangeRate.create({
      id: 'rate-precise', baseCurrency: 'USD', quoteCurrency: 'VES', rateValue: 47_858_000_001,
      rateScale: 8, source: 'Prueba', validFrom: new Date('2026-08-01T00:00:00Z'), registeredBy: 'user-001'
    });

    expect(new CurrencyConverter().convert(Money.fromMinorUnits(100, 'USD'), precise, at).minorUnits)
      .toBe(47858);
  });

  it('rejects an expired rate', () => {
    const converter = new CurrencyConverter();
    const expiredRate = ExchangeRate.create({
      id: 'rate-expired',
      baseCurrency: 'USD',
      quoteCurrency: 'VES',
      rateValue: 36000,
      rateScale: 3,
      source: 'BCV',
      validFrom: new Date('2026-07-01T00:00:00Z'),
      validUntil: new Date('2026-07-31T23:59:59Z'),
      registeredBy: 'user-001'
    });

    expect(() => converter.convert(Money.fromMinorUnits(1000, 'USD'), expiredRate, at)).toThrowError(
      'Exchange rate is not valid at the requested time.'
    );
  });
});
