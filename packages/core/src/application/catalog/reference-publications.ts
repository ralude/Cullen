import type { Category, Product, UnitOfMeasure } from '../../domain/catalog/index.js';
import type { ExchangeRate, PaymentMethod } from '../../domain/currency/index.js';
import type { DomainEventLike } from '../events/index.js';
import type {
  OperationalPolicyReference,
  OperatorGrantReference,
  StockAvailabilityReference
} from '../ports/index.js';

export const PRODUCT_PUBLISHED = 'ProductPublished';
export const CATEGORY_PUBLISHED = 'CategoryPublished';
export const UNIT_OF_MEASURE_PUBLISHED = 'UnitOfMeasurePublished';
export const PAYMENT_METHOD_PUBLISHED = 'PaymentMethodPublished';
export const DISCOUNT_POLICY_PUBLISHED = 'DiscountPolicyPublished';
export const FINANCIAL_TRANSACTION_TAX_POLICY_PUBLISHED =
  'FinancialTransactionTaxPolicyPublished';
export const EXCHANGE_RATE_UPDATED = 'ExchangeRateUpdated';
export const OPERATOR_GRANT_PUBLISHED = 'OperatorGrantPublished';
export const STOCK_AVAILABILITY_PUBLISHED = 'StockAvailabilityPublished';

/**
 * Vigencia de una concesión de operador: ocho horas desde su emisión por el
 * coordinador, conforme ADR-0026 D6. Reentregarla no la renueva, porque el
 * instante de emisión es `occurredAt` del sobre y ya es inmutable.
 */
export const OPERATOR_GRANT_VALIDITY_MS = 8 * 60 * 60 * 1000;

/**
 * Margen de reemisión: mientras hay LAN, el coordinador vuelve a emitir la
 * concesión cuando le queda menos de la mitad de su ventana, de modo que una
 * terminal conectada siempre conserva ocho horas completas por delante.
 */
export const OPERATOR_GRANT_RENEWAL_MS = OPERATOR_GRANT_VALIDITY_MS / 2;

/**
 * Los contratos de referencia no transportan booleanos: una desactivación es un
 * cambio de estado explícito y nombrado, no la ausencia de una bandera.
 */
const activity = (isActive: boolean): 'ACTIVE' | 'INACTIVE' => isActive ? 'ACTIVE' : 'INACTIVE';

type PublicationProps = {
  readonly eventId: string;
  readonly occurredAt: Date;
};

/**
 * Construye la publicación de una referencia a partir del estado vigente del
 * agregado, después de la mutación que la origina.
 *
 * Es un hecho de integración derivado, no un evento de dominio: el dominio no
 * carga con la distribución. `aggregateVersion` es la versión del maestro en el
 * coordinador y es la única fuente de orden; el payload no la repite para que
 * las dos copias no puedan separarse.
 */
export const toProductPublication = (
  product: Product,
  props: PublicationProps
): DomainEventLike => ({
  type: PRODUCT_PUBLISHED,
  eventId: props.eventId,
  aggregateId: product.id,
  aggregateType: 'Product',
  aggregateVersion: product.version,
  occurredAt: props.occurredAt,
  payload: {
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    unitId: product.unitOfMeasure.id,
    unitCode: product.unitOfMeasure.code,
    /** Conjunto vigente completo: un código retirado viaja como `INACTIVE`. */
    barcodes: product.barcodes.map((barcode) => ({
      barcodeId: barcode.id,
      code: barcode.value,
      isActive: activity(barcode.isActive)
    })),
    price: product.price,
    taxRate: product.taxRate,
    isActive: activity(product.isActive)
  }
});

export const toCategoryPublication = (
  category: Category,
  props: PublicationProps & { readonly version: number }
): DomainEventLike => ({
  type: CATEGORY_PUBLISHED,
  eventId: props.eventId,
  aggregateId: category.id,
  aggregateType: 'Category',
  aggregateVersion: props.version,
  occurredAt: props.occurredAt,
  payload: { name: category.name, isActive: activity(category.isActive) }
});

export const toUnitOfMeasurePublication = (
  unit: UnitOfMeasure,
  props: PublicationProps & { readonly version: number }
): DomainEventLike => ({
  type: UNIT_OF_MEASURE_PUBLISHED,
  eventId: props.eventId,
  aggregateId: unit.id,
  aggregateType: 'UnitOfMeasure',
  aggregateVersion: props.version,
  occurredAt: props.occurredAt,
  payload: {
    code: unit.code,
    name: unit.name,
    quantityScale: unit.quantityScale,
    isActive: activity(unit.isActive)
  }
});

export const toPaymentMethodPublication = (
  method: PaymentMethod,
  props: PublicationProps & { readonly version: number }
): DomainEventLike => ({
  type: PAYMENT_METHOD_PUBLISHED,
  eventId: props.eventId,
  aggregateId: method.code,
  aggregateType: 'PaymentMethod',
  aggregateVersion: props.version,
  occurredAt: props.occurredAt,
  payload: {
    name: method.name,
    kind: method.kind,
    currencyCode: method.currencyCode,
    isActive: activity(method.isActive)
  }
});

export const toOperationalPolicyPublication = (
  policy: OperationalPolicyReference,
  props: PublicationProps
): DomainEventLike => ({
  type: policy.policyType === 'DISCOUNT'
    ? DISCOUNT_POLICY_PUBLISHED
    : FINANCIAL_TRANSACTION_TAX_POLICY_PUBLISHED,
  eventId: props.eventId,
  aggregateId: policy.policyType,
  aggregateType: 'OperationalPolicy',
  aggregateVersion: policy.version,
  occurredAt: props.occurredAt,
  payload: policy.policyType === 'DISCOUNT'
    ? {
      policyId: policy.policyId,
      maximumBasisPoints: policy.maximumBasisPoints
    }
    : {
      policyId: policy.policyId,
      rateBasisPoints: policy.rateBasisPoints,
      eligiblePaymentMethodCodes: policy.eligiblePaymentMethodCodes,
      eligibleCurrencies: policy.eligibleCurrencies
    }
});

export const toExchangeRatePublication = (
  rate: ExchangeRate,
  props: PublicationProps & { readonly version: number }
): DomainEventLike => ({
  type: EXCHANGE_RATE_UPDATED,
  eventId: props.eventId,
  aggregateId: `${rate.baseCurrency}/${rate.quoteCurrency}`,
  aggregateType: 'ExchangeRate',
  aggregateVersion: props.version,
  occurredAt: props.occurredAt,
  payload: {
    rateId: rate.id,
    baseCurrency: rate.baseCurrency,
    quoteCurrency: rate.quoteCurrency,
    rateValue: rate.rateValue,
    rateScale: rate.rateScale,
    source: rate.source,
    validFrom: rate.validFrom.toISOString(),
    validUntil: rate.validUntil?.toISOString() ?? null,
    registeredBy: rate.registeredBy
  }
});

/**
 * Concesión de autorización de un operador. Transporta lo que puede hacer, no
 * cómo se autentica: ADR-0026 D5 prohíbe sincronizar PINs, tokens o sesiones.
 *
 * `aggregateVersion` es una versión propia de concesión y no la
 * `authorization_version` del usuario: una renovación con los mismos permisos
 * debe avanzar, o el consumidor la descartaría por atrasada.
 */
export const toOperatorGrantPublication = (
  grant: OperatorGrantReference,
  props: PublicationProps
): DomainEventLike => ({
  type: OPERATOR_GRANT_PUBLISHED,
  eventId: props.eventId,
  aggregateId: grant.userId,
  aggregateType: 'OperatorGrant',
  aggregateVersion: grant.version,
  occurredAt: props.occurredAt,
  payload: {
    operatorCode: grant.operatorCode,
    displayName: grant.displayName,
    roleCodes: [...grant.roleCodes],
    permissionCodes: [...grant.permissionCodes],
    isActive: activity(grant.isActive),
    expiresAt: new Date(
      props.occurredAt.getTime() + OPERATOR_GRANT_VALIDITY_MS
    ).toISOString()
  }
});

/**
 * Saldo observado de un ítem de stock del coordinador. Es informativo: no
 * reserva existencias ni participa en ningún saldo local de la terminal.
 *
 * `aggregateVersion` es el número de movimientos del ítem, ya monotónico, y la
 * identidad es el producto, que es lo que la terminal conoce.
 */
export const toStockAvailabilityPublication = (
  availability: StockAvailabilityReference,
  props: PublicationProps
): DomainEventLike => ({
  type: STOCK_AVAILABILITY_PUBLISHED,
  eventId: props.eventId,
  aggregateId: availability.productId,
  aggregateType: 'StockAvailability',
  aggregateVersion: availability.version,
  occurredAt: props.occurredAt,
  payload: {
    quantityScaled: availability.quantityScaled,
    quantityScale: availability.quantityScale
  }
});
