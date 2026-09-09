import { DomainError } from './errors/app-error.js';
import type { Money } from './money.js';
import { Percentage } from './percentage.js';

/**
 * Tasa de impuesto configurable (IVA, IGTF, etc.) expresada en puntos base
 * enteros (1600 equivale a 16.00%). Nunca se representa con floats.
 */
export class TaxRate {
  private constructor(private readonly percentage: Percentage) {}

  static fromBasisPoints(basisPoints: number): TaxRate {
    if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) {
      throw new DomainError(
        'TAX_RATE_INVALID_BASIS_POINTS',
        'Tax rate must be a non-negative safe integer in basis points.'
      );
    }

    return new TaxRate(Percentage.fromBasisPoints(basisPoints));
  }

  get basisPoints(): number {
    return this.percentage.basisPoints;
  }

  /**
   * Calcula el impuesto sobre un monto con redondeo half-up comercial
   * (mitad alejandose de cero), determinista para IVA e IGTF.
   */
  applyTo(money: Money): Money {
    return money.applyPercentage(this.percentage);
  }

  /**
   * Separa el impuesto que ya viaja **dentro** de un importe bruto. Se usa
   * cuando el dato conocido es lo que se cobro y no la base: quien entrega
   * 51,50 con un metodo gravado al 3% liquida 50,00 de la operacion y 1,50 de
   * impuesto.
   *
   * Calcular el impuesto sobre el bruto en ese caso lo volveria recursivo,
   * porque el bruto ya lo contiene.
   */
  extractFrom(money: Money): Money {
    return money.extractIncludedPercentage(this.percentage);
  }
}
