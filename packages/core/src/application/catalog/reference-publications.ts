import type { Category, Product, UnitOfMeasure } from '../../domain/catalog/index.js';
import type { ExchangeRate, PaymentMethod } from '../../domain/currency/index.js';
import type { DomainEventLike } from '../events/index.js';
import type { OperationalPolicyReference } from '../ports/index.js';

export const PRODUCT_PUBLISHED = 'ProductPublished';
export const CATEGORY_PUBLISHED = 'CategoryPublished';
export const UNIT_OF_MEASURE_PUBLISHED = 'UnitOfMeasurePublished';
export const PAYMENT_METHOD_PUBLISHED = 'PaymentMethodPublished';
export const DISCOUNT_POLICY_PUBLISHED = 'DiscountPolicyPublished';
export const FINANCIAL_TRANSACTION_TAX_POLICY_PUBLISHED =
  'FinancialTransactionTaxPolicyPublished';
export const EXCHANGE_RATE_UPDATED = 'ExchangeRateUpdated';

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
