import { DomainError } from './errors/app-error.js';
import type { Percentage } from './percentage.js';
import type { Quantity } from './quantity.js';

export type CurrencyCode = string;

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
const BASIS_POINTS_DENOMINATOR = 10_000n;

/**
 * Divide redondeando la mitad alejandose de cero (half-up comercial).
 * El denominador debe ser positivo.
 */
function divideRoundingHalfAwayFromZero(
  numerator: bigint,
  denominator: bigint
): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const doubleRemainder = remainder * 2n;
  const absoluteDoubleRemainder =
    doubleRemainder < 0n ? -doubleRemainder : doubleRemainder;

  if (absoluteDoubleRemainder >= denominator) {
    return quotient + (numerator < 0n ? -1n : 1n);
  }

  return quotient;
}

export class Money {
  private constructor(
    readonly minorUnits: number,
    readonly currency: CurrencyCode
  ) {}

  static fromMinorUnits(minorUnits: number, currency: CurrencyCode): Money {
    if (!Number.isSafeInteger(minorUnits)) {
      throw new DomainError(
        'MONEY_INVALID_AMOUNT',
        'Money amount must be a safe integer in minor units.'
      );
    }

    if (!CURRENCY_CODE_PATTERN.test(currency)) {
      throw new DomainError(
        'MONEY_INVALID_CURRENCY',
        'Currency must be an uppercase three-letter code.'
      );
    }

    return new Money(minorUnits, currency);
  }

  static zero(currency: CurrencyCode): Money {
    return Money.fromMinorUnits(0, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromMinorUnits(this.minorUnits + other.minorUnits, this.currency);
  }

  multiply(factor: number): Money {
    if (!Number.isSafeInteger(factor)) {
      throw new DomainError(
        'MONEY_INVALID_FACTOR',
        'Money multiplication factor must be a safe integer.'
      );
    }

    return Money.fromSafeBigInt(
      BigInt(this.minorUnits) * BigInt(factor),
      this.currency
    );
  }

  /**
   * Aplica un porcentaje en puntos base. Las fracciones de unidad menor se
   * redondean half-up comercial (mitad alejandose de cero).
   */
  applyPercentage(percentage: Percentage): Money {
    const numerator =
      BigInt(this.minorUnits) * BigInt(percentage.basisPoints);

    return Money.fromSafeBigInt(
      divideRoundingHalfAwayFromZero(numerator, BASIS_POINTS_DENOMINATOR),
      this.currency
    );
  }

  /**
   * Separa el porcentaje que **ya viene contenido** en este importe: si `this`
   * es base + porcentaje, devuelve el porcentaje. Es la inversa de
   * `applyPercentage` para el caso en que el bruto es el dato conocido.
   *
   * La base se redondea half-up comercial y el resultado se obtiene restandola,
   * de modo que base + resultado reconstruye el bruto exactamente: un impuesto
   * incluido nunca puede dejar una unidad menor descuadrada.
   */
  extractIncludedPercentage(percentage: Percentage): Money {
    const denominator = BASIS_POINTS_DENOMINATOR + BigInt(percentage.basisPoints);
    const base = divideRoundingHalfAwayFromZero(
      BigInt(this.minorUnits) * BASIS_POINTS_DENOMINATOR,
      denominator
    );

    return Money.fromSafeBigInt(BigInt(this.minorUnits) - base, this.currency);
  }

  /**
   * Multiplica por una cantidad escalada. Las fracciones de unidad menor se
   * redondean half-up comercial (mitad alejandose de cero).
   */
  multiplyByQuantity(quantity: Quantity): Money {
    const numerator =
      BigInt(this.minorUnits) * BigInt(quantity.scaledValue);
    const denominator = 10n ** BigInt(quantity.scale);

    return Money.fromSafeBigInt(
      divideRoundingHalfAwayFromZero(numerator, denominator),
      this.currency
    );
  }

  /**
   * Divide por una cantidad escalada. Las fracciones de unidad menor se
   * redondean half-up comercial (mitad alejandose de cero).
   */
  divideByQuantity(quantity: Quantity): Money {
    if (quantity.scaledValue === 0) {
      throw new DomainError(
        'MONEY_DIVISION_BY_ZERO',
        'Cannot divide money by a zero quantity.'
      );
    }

    const numerator =
      BigInt(this.minorUnits) * 10n ** BigInt(quantity.scale);

    return Money.fromSafeBigInt(
      divideRoundingHalfAwayFromZero(numerator, BigInt(quantity.scaledValue)),
      this.currency
    );
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromMinorUnits(this.minorUnits - other.minorUnits, this.currency);
  }

  isZero(): boolean {
    return this.minorUnits === 0;
  }

  private static fromSafeBigInt(
    minorUnits: bigint,
    currency: CurrencyCode
  ): Money {
    if (
      minorUnits > BigInt(Number.MAX_SAFE_INTEGER) ||
      minorUnits < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      throw new DomainError(
        'MONEY_OVERFLOW',
        'Money operation result exceeds the safe integer range.'
      );
    }

    return new Money(Number(minorUnits), currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new DomainError(
        'MONEY_CURRENCY_MISMATCH',
        'Money values must use the same currency for arithmetic.'
      );
    }
  }
}
