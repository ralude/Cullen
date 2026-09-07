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
  /**
   * Saldo observado de cada ítem de stock. Un ítem sin movimientos publica cero
   * con versión cero: es un saldo conocido, distinto de la ausencia de dato.
   */
  listStockAvailability(): Promise<readonly StockAvailabilityReference[]>;
}

/**
 * Lectura de los operadores del coordinador para emitir sus concesiones.
 *
 * Enumera también los inactivos: una terminal que nunca supo de un operador
 * desactivado no podría aplicar su revocación.
 */
export interface OperatorGrantSource {
  listOperators(): Promise<readonly Omit<OperatorGrantReference, 'version'>[]>;
  /**
   * Avanza y devuelve la versión de concesión de un operador. Es monotónica y
   * avanza incluso cuando el conjunto de permisos no cambió, para que una
   * renovación no se descarte por atrasada.
   */
  nextGrantVersion(
    userId: string,
    issuedAt: Date,
    expiresAt: Date
  ): Promise<number>;
  /**
   * Vencimiento de la concesión vigente de cada operador, para decidir la
   * reemisión. `null` significa que nunca se emitió.
   */
  earliestGrantExpiry(): Promise<Date | null>;
}

/**
 * Concesión de autorización de un operador tal como la conoce el coordinador.
 * No transporta credenciales: el PIN y las sesiones son locales de cada nodo.
 */
export type OperatorGrantReference = {
  readonly userId: string;
  readonly operatorCode: string;
  readonly displayName: string;
  readonly roleCodes: readonly string[];
  readonly permissionCodes: readonly string[];
  readonly isActive: boolean;
  /** Versión propia de concesión, monotónica y distinta de `authorizationVersion`. */
  readonly version: number;
};

/**
 * Saldo observado de un ítem de stock del coordinador, identificado por su
 * producto. `version` es el número de movimientos del ítem más uno, porque el
 * sobre exige una versión positiva y un ítem sin movimientos también tiene un
 * saldo conocido.
 */
export type StockAvailabilityReference = {
  readonly productId: string;
  readonly quantityScaled: number;
  readonly quantityScale: number;
  /**
   * Costo unitario promedio observado. `null` es costo desconocido, nunca cero:
   * es lo que la terminal congelará al vender (ADR-0026 D4).
   */
  readonly unitCost: { readonly minorUnits: number; readonly currencyCode: string } | null;
  readonly version: number;
};
