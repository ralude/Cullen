import type { Category, Product, UnitOfMeasure } from '../../domain/catalog/index.js';
import type { ExchangeRate, PaymentMethod } from '../../domain/currency/index.js';

export type VersionedMaster<T> = {
  readonly value: T;
  readonly version: number;
};

export type OperationalPolicyReference =
  | {
    readonly policyType: 'DISCOUNT';
    readonly policyId: string;
    readonly version: number;
    readonly maximumBasisPoints: number;
  }
  | {
    readonly policyType: 'FINANCIAL_TRANSACTION_TAX';
    readonly policyId: string;
    readonly version: number;
    readonly rateBasisPoints: number;
    readonly eligiblePaymentMethodCodes: readonly string[];
    readonly eligibleCurrencies: readonly string[];
  };

/**
 * Lectura del catálogo vigente del coordinador para publicarlo como referencia.
 *
 * Las tres listas se leen dentro de una sola transacción del caso de uso, de
 * modo que el corte inicial es consistente: no mezcla un producto de antes de
 * un cambio con la categoría de después.
 */
export interface CatalogReferenceSource {
  listCategories(): Promise<readonly VersionedMaster<Category>[]>;
  listUnitsOfMeasure(): Promise<readonly VersionedMaster<UnitOfMeasure>[]>;
  listPaymentMethods(): Promise<readonly VersionedMaster<PaymentMethod>[]>;
  listOperationalPolicies(): Promise<readonly OperationalPolicyReference[]>;
  listExchangeRates(at: Date): Promise<readonly VersionedMaster<ExchangeRate>[]>;
  /** `Product` ya transporta su propia versión. */
  listProducts(): Promise<readonly Product[]>;
}
