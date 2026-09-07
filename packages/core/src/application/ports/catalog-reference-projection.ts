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
  /** Ausente solo al recibir el contrato histórico v1. */
  readonly stockItemId: string | null;
  /** Ausente solo al recibir el contrato histórico v1. */
  readonly unitCode: string | null;
  readonly quantityScaled: number;
  readonly quantityScale: number;
  /** Ausente solo al recibir el contrato histórico v1. */
  readonly tracksBatches: boolean | null;
  /** Ausente solo al recibir el contrato histórico v1. */
  readonly batches: readonly {
    readonly batchId: string;
    readonly lotNumber: string;
    readonly expiresAt: Date | null;
    readonly quantityScaled: number;
  }[] | null;
  /** Costo unitario observado; `null` es desconocido, nunca cero. */
  readonly unitCost: { readonly minorUnits: number; readonly currencyCode: string } | null;
  readonly version: number;
  readonly publishedBy: string;
  readonly publishedAt: Date;
};

/**
 * Antigüedad de una referencia proyectada. `null` en cualquier campo significa
 * que nunca se recibió una publicación de ese tipo; un cero sería un dato
 * conocido y no es lo mismo.
 */
export type ReferenceEntryFreshness = {
  /** Nodo que la publicó; identifica su fuente sin repetir la configuración. */
  readonly publishedBy: string | null;
  /** Momento de emisión del coordinador, no el de aplicación local. */
  readonly publishedAt: Date | null;
  readonly version: number | null;
  readonly count: number;
};

export type ReferenceFreshness = {
  readonly catalog: ReferenceEntryFreshness;
  readonly exchangeRate: ReferenceEntryFreshness & {
    /**
     * Vigencia de la tasa aplicable. Una tasa vencida no se presenta como
     * vigente porque el nodo haya vuelto a conectarse.
     */
    readonly validUntil: Date | null;
  };
  readonly operatorGrants: ReferenceEntryFreshness & {
    /** Vencimiento más próximo entre las concesiones proyectadas. */
    readonly expiresAt: Date | null;
  };
  readonly stockAvailability: ReferenceEntryFreshness;
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
  /** Lectura local de la proyección; nunca consulta `stock_items` del POS. */
  findStockAvailability(productId: string): Promise<ProjectedStockAvailabilityReference | null>;
  /**
   * Referencias ya aplicadas. Distingue una terminal a la que nunca se le
   * publicó el catálogo de una que ya lo tiene: sin publicaciones pendientes,
   * cero aplicadas no significa que la referencia sea utilizable.
   */
  countApplied(): Promise<number>;
  /**
   * Antigüedad de cada referencia aplicada, para presentarla al operador.
   * `null` significa **nunca recibida**, no vacía ni cero: la lectura no
   * convierte un dato ausente en uno vigente.
   */
  referenceFreshness(): Promise<ReferenceFreshness>;
}
