import type { PaymentMethodKind } from '../../domain/currency/index.js';
import type {
  OperationalPolicyReference,
  OperatorGrantReference
} from './catalog-reference-source.js';

export type CategoryReference = {
  readonly categoryId: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly version: number;
};

export type UnitOfMeasureReference = {
  readonly unitId: string;
  readonly code: string;
  readonly name: string;
  readonly quantityScale: number;
  readonly isActive: boolean;
  readonly version: number;
};

export type ProductReference = {
  readonly productId: string;
  readonly name: string;
  readonly description: string;
  readonly categoryId: string;
  readonly unitId: string;
  readonly barcodes: readonly {
    readonly barcodeId: string;
    readonly code: string;
    readonly isActive: boolean;
  }[];
  readonly priceMinorUnits: number;
  readonly currencyCode: string;
  readonly taxRateBasisPoints: number;
  readonly isActive: boolean;
  readonly version: number;
  /** Nodo que publicó la referencia; queda como procedencia del precio vigente. */
  readonly publishedBy: string;
  readonly publishedAt: Date;
};

export type PaymentMethodReference = {
  readonly code: string;
  readonly name: string;
  readonly kind: PaymentMethodKind;
  readonly currencyCode: string;
  readonly isActive: boolean;
  readonly version: number;
};

export type ProjectedOperationalPolicyReference = OperationalPolicyReference & {
  readonly publishedBy: string;
  readonly publishedAt: Date;
};

export type ExchangeRateReference = {
  readonly rateId: string;
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly rateValue: number;
  readonly rateScale: number;
  readonly source: string;
  readonly validFrom: Date;
  readonly validUntil: Date | null;
  readonly registeredBy: string;
  readonly version: number;
};

/**
 * Concesión proyectada en la terminal. `expiresAt` es la vigencia declarada por
 * el coordinador, ya acotada al tope de la política: reentregarla no la renueva.
 */
export type ProjectedOperatorGrantReference = OperatorGrantReference & {
  readonly expiresAt: Date;
  readonly publishedBy: string;
  readonly publishedAt: Date;
};

/**
 * Disponibilidad proyectada. Vive en su propia tabla y nunca participa de un
 * saldo local: es un dato informativo con antigüedad, no una reserva.
 */
export type ProjectedStockAvailabilityReference = {
  readonly productId: string;
  readonly quantityScaled: number;
  readonly quantityScale: number;
  readonly version: number;
  readonly publishedBy: string;
  readonly publishedAt: Date;
};

/**
 * Resultado de aplicar una referencia. `STALE` no es un fallo: significa que la
 * proyección ya conserva una versión igual o posterior, así que la publicación
 * no tiene nada que aplicar y no debe reintentarse.
 */
export type ReferenceApplication = 'APPLIED' | 'STALE';

/**
 * Proyección local de catálogo de una terminal.
 *
 * La escribe el consumidor de referencias, nunca los casos de uso de
 * administración: un POS no muta el maestro del coordinador aunque conserve
 * permisos locales. La escritura no encola nada en la salida local, de modo que
 * la terminal no reenvía como propio el catálogo que recibió.
 */
export interface CatalogReferenceProjection {
  applyCategory(reference: CategoryReference): Promise<ReferenceApplication>;
  applyUnitOfMeasure(reference: UnitOfMeasureReference): Promise<ReferenceApplication>;
  applyProduct(reference: ProductReference): Promise<ReferenceApplication>;
  applyPaymentMethod(reference: PaymentMethodReference): Promise<ReferenceApplication>;
  applyOperationalPolicy(
    reference: ProjectedOperationalPolicyReference
  ): Promise<ReferenceApplication>;
  applyExchangeRate(reference: ExchangeRateReference): Promise<ReferenceApplication>;
  applyOperatorGrant(reference: ProjectedOperatorGrantReference): Promise<ReferenceApplication>;
  applyStockAvailability(
    reference: ProjectedStockAvailabilityReference
  ): Promise<ReferenceApplication>;
  /**
   * Referencias ya aplicadas. Distingue una terminal a la que nunca se le
   * publicó el catálogo de una que ya lo tiene: sin publicaciones pendientes,
   * cero aplicadas no significa que la referencia sea utilizable.
   */
  countApplied(): Promise<number>;
}
