import { describe, expect, it } from 'vitest';
import { DomainError, Money, Quantity, minorUnitExponentOf, SUPPORTED_CURRENCIES } from './index.js';

/** ADR-0033: una sola tabla de exponentes y una sola conversión para nodo y pantalla. */
describe('currency registry', () => {
  it('returns the ISO 4217 exponent of every supported currency', () => {
    expect(SUPPORTED_CURRENCIES).toEqual({ USD: 2, VES: 2, EUR: 2, COP: 2, CLP: 0 });
    expect(minorUnitExponentOf('VES')).toBe(2);
    expect(minorUnitExponentOf('CLP')).toBe(0);
  });

  it.each(['XYZ', 'usd', 'BRL', ''])('rejects %j with a stable code', (code) => {
    expect(() => minorUnitExponentOf(code)).toThrowError(
      expect.objectContaining({ code: 'CURRENCY_UNSUPPORTED' })
    );
    expect(() => minorUnitExponentOf(code)).toThrowError(DomainError);
  });
});

const usdVes = (rateValue: number, rateScale: number) =>
  ({ baseCurrency: 'USD', quoteCurrency: 'VES', rateValue, rateScale });

describe('Money.convertAtRate', () => {
  it.each([
    [10000, 40000, 2],
    [360, 47858, 2],
    [1, 8201018, 4],
    [99_999, 1_234_567, 4],
    [12_345, 47_858, 2]
  ])('matches the former same-exponent conversion for %i at %i/10^%i', (minorUnits, rateValue, rateScale) => {
    const rate = Quantity.fromScaled(rateValue, rateScale);
    const usd = Money.fromMinorUnits(minorUnits, 'USD');
    const ves = Money.fromMinorUnits(minorUnits, 'VES');

    expect(usd.convertAtRate(usdVes(rateValue, rateScale)))
      .toEqual(Money.fromMinorUnits(usd.multiplyByQuantity(rate).minorUnits, 'VES'));
    expect(ves.convertAtRate(usdVes(rateValue, rateScale)))
      .toEqual(Money.fromMinorUnits(ves.divideByQuantity(rate).minorUnits, 'USD'));
  });

  it('respects the major unit across different exponents', () => {
    const usdClp = { baseCurrency: 'USD', quoteCurrency: 'CLP', rateValue: 900, rateScale: 0 };

    expect(Money.fromMinorUnits(100, 'USD').convertAtRate(usdClp)).toEqual(Money.fromMinorUnits(900, 'CLP'));
    expect(Money.fromMinorUnits(900, 'CLP').convertAtRate(usdClp)).toEqual(Money.fromMinorUnits(100, 'USD'));
    /** 1 CLP son 0,111… centavos: se redondea una sola vez, al final. */
    expect(Money.fromMinorUnits(1, 'CLP').convertAtRate(usdClp)).toEqual(Money.fromMinorUnits(0, 'USD'));
    expect(Money.fromMinorUnits(5, 'CLP').convertAtRate(usdClp)).toEqual(Money.fromMinorUnits(1, 'USD'));
  });

  it('accepts the eight rate decimals that ExchangeRate allows', () => {
    expect(Money.fromMinorUnits(100, 'USD').convertAtRate(usdVes(47_858_000_001, 8)))
      .toEqual(Money.fromMinorUnits(47858, 'VES'));
  });

  it('rejects a rate that does not involve the amount currency', () => {
    expect(() => Money.fromMinorUnits(100, 'EUR').convertAtRate(usdVes(47858, 2)))
      .toThrowError(expect.objectContaining({ code: 'CURRENCY_RATE_MISMATCH' }));
  });

  it('rejects a currency outside the registry', () => {
    const rate = { baseCurrency: 'USD', quoteCurrency: 'BRL', rateValue: 5, rateScale: 0 };

    expect(() => Money.fromMinorUnits(100, 'USD').convertAtRate(rate))
      .toThrowError(expect.objectContaining({ code: 'CURRENCY_UNSUPPORTED' }));
  });

  it('keeps the round trip exact for a USD sale paid in VES', () => {
    for (const cents of [1, 99, 320, 12_345, 1_000_000]) {
      const rate = usdVes(47858, 2);
      const ves = Money.fromMinorUnits(cents, 'USD').convertAtRate(rate);
      expect(ves.convertAtRate(rate).minorUnits).toBe(cents);
    }
  });
});
