import { describe, expect, it } from 'vitest';
import { DomainError, Money, TaxRate } from './index.js';

describe('TaxRate', () => {
  it('is defined in basis points', () => {
    const vat = TaxRate.fromBasisPoints(1600);

    expect(vat.basisPoints).toBe(1600);
  });

  it('rejects fractional or negative rates', () => {
    expect(() => TaxRate.fromBasisPoints(15.5)).toThrowError(DomainError);
    expect(() => TaxRate.fromBasisPoints(15.5)).toThrowError(
      'Tax rate must be a non-negative safe integer in basis points.'
    );
    expect(() => TaxRate.fromBasisPoints(-100)).toThrowError(
      'Tax rate must be a non-negative safe integer in basis points.'
    );
  });

  it('computes IVA over a taxable amount with deterministic rounding', () => {
    const vat = TaxRate.fromBasisPoints(1600);
    const taxable = Money.fromMinorUnits(999, 'VES');

    const tax = vat.applyTo(taxable);

    expect(tax.minorUnits).toBe(160);
    expect(tax.currency).toBe('VES');
  });

  it('computes IGTF over a foreign currency amount', () => {
    const igtf = TaxRate.fromBasisPoints(300);
    const taxable = Money.fromMinorUnits(1000, 'USD');

    const tax = igtf.applyTo(taxable);

    expect(tax.minorUnits).toBe(30);
    expect(tax.currency).toBe('USD');
  });

  it('returns zero tax over a zero amount', () => {
    const vat = TaxRate.fromBasisPoints(1600);

    expect(vat.applyTo(Money.zero('VES')).minorUnits).toBe(0);
  });
});

describe('TaxRate.extractFrom', () => {
  /**
   * El IGTF que la caja cobra viaja **dentro** del importe entregado: el
   * cliente que paga 51,50 con tarjeta liquida 50,00 de la venta y 1,50 de
   * impuesto. Calcularlo sobre el bruto lo volvería recursivo.
   */
  it('extracts the tax already contained in a gross amount', () => {
    const igtf = TaxRate.fromBasisPoints(300);

    const tax = igtf.extractFrom(Money.fromMinorUnits(5150, 'USD'));

    expect(tax.minorUnits).toBe(150);
    expect(tax.currency).toBe('USD');
  });

  it('is exact: base plus extracted tax reconstructs the gross amount', () => {
    const igtf = TaxRate.fromBasisPoints(300);

    for (let gross = 0; gross <= 2000; gross += 1) {
      const money = Money.fromMinorUnits(gross, 'USD');
      const tax = igtf.extractFrom(money);
      expect(money.subtract(tax).add(tax).minorUnits).toBe(gross);
      expect(tax.minorUnits).toBeGreaterThanOrEqual(0);
      expect(tax.minorUnits).toBeLessThanOrEqual(gross);
    }
  });

  it('inverts applyTo whenever the gross amount is reachable', () => {
    const igtf = TaxRate.fromBasisPoints(300);
    const base = Money.fromMinorUnits(5000, 'USD');

    const gross = base.add(igtf.applyTo(base));

    expect(igtf.extractFrom(gross).minorUnits).toBe(igtf.applyTo(base).minorUnits);
  });

  it('extracts nothing when the rate is zero', () => {
    expect(TaxRate.fromBasisPoints(0).extractFrom(Money.fromMinorUnits(5150, 'USD')).minorUnits)
      .toBe(0);
  });

  it('returns zero over a zero amount', () => {
    expect(TaxRate.fromBasisPoints(300).extractFrom(Money.zero('USD')).minorUnits).toBe(0);
  });
});

/**
 * Inversa de `extractFrom`, para el caso en que el dato conocido es la porción
 * comercial y falta el bruto que la pantalla precarga. Ver la enmienda de
 * ADR-0031 del 2026-09-11: sugerir el bruto no convierte al renderer en
 * autoridad, pero tampoco puede reimplementar la fórmula del nodo.
 */
describe('TaxRate.includeIn', () => {
  it('includes the tax in a commercial portion', () => {
    const igtf = TaxRate.fromBasisPoints(300);

    const gross = igtf.includeIn(Money.fromMinorUnits(5000, 'USD'));

    expect(gross.minorUnits).toBe(5150);
    expect(gross.currency).toBe('USD');
  });

  it('produces a gross amount that extractFrom resolves back to the same base', () => {
    const igtf = TaxRate.fromBasisPoints(300);

    for (let base = 0; base <= 2000; base += 1) {
      const commercial = Money.fromMinorUnits(base, 'USD');
      const gross = igtf.includeIn(commercial);
      const tax = igtf.extractFrom(gross);

      expect(gross.subtract(tax).minorUnits).toBe(base);
      expect(tax.minorUnits).toBe(igtf.applyTo(commercial).minorUnits);
    }
  });

  it('holds the round trip for rates other than the IGTF', () => {
    for (const basisPoints of [0, 1, 250, 300, 1600, 9999]) {
      const rate = TaxRate.fromBasisPoints(basisPoints);

      for (const base of [0, 1, 7, 50, 333, 12345]) {
        const commercial = Money.fromMinorUnits(base, 'VES');
        const gross = rate.includeIn(commercial);

        expect(gross.subtract(rate.extractFrom(gross)).minorUnits).toBe(base);
      }
    }
  });

  it('changes nothing when the method is not taxed', () => {
    const gross = TaxRate.fromBasisPoints(0).includeIn(Money.fromMinorUnits(5000, 'USD'));

    expect(gross.minorUnits).toBe(5000);
  });

  it('returns zero over a zero base', () => {
    expect(TaxRate.fromBasisPoints(300).includeIn(Money.zero('USD')).minorUnits).toBe(0);
  });
});
