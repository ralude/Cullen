import {
  ApplicationError,
  err,
  ok,
  type AppError,
  type JsonObject,
  type JsonValue,
  type Result,
  type SyncEnvelopeV1
} from '@supermarket/shared';
import {
  CATEGORY_PUBLISHED,
  DISCOUNT_POLICY_PUBLISHED,
  EXCHANGE_RATE_UPDATED,
  FINANCIAL_TRANSACTION_TAX_POLICY_PUBLISHED,
  PAYMENT_METHOD_PUBLISHED,
  PRODUCT_PUBLISHED,
  UNIT_OF_MEASURE_PUBLISHED
} from '../catalog/reference-publications.js';
import { PAYMENT_METHOD_KINDS, type PaymentMethodKind } from '../../domain/currency/index.js';
import type {
  CatalogReferenceProjection,
  ExchangeRateReference,
  PaymentMethodReference,
  ProductReference,
  ReferenceApplication
} from '../ports/index.js';
import type { SyncConsumer } from './process-sync-inbox.js';

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: JsonValue | undefined): string | null =>
  typeof value === 'string' ? value : null;

const integer = (value: JsonValue | undefined): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;

const activity = (value: JsonValue | undefined): boolean | null =>
  value === 'ACTIVE' ? true : value === 'INACTIVE' ? false : null;

const textArray = (value: JsonValue | undefined): readonly string[] | null =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? value as string[]
    : null;

const instant = (value: string | null): Date | null => {
  if (value === null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const barcodes = (
  value: JsonValue | undefined
): ProductReference['barcodes'] | null => {
  if (!Array.isArray(value)) return null;
  const parsed: { barcodeId: string; code: string; isActive: boolean }[] = [];
  for (const entry of value) {
    if (!isObject(entry)) return null;
    const barcodeId = text(entry.barcodeId);
    const code = text(entry.code);
    const isActive = activity(entry.isActive);
    if (barcodeId === null || code === null || isActive === null) return null;
    parsed.push({ barcodeId, code, isActive });
  }
  return parsed;
};

/**
 * Aplica las referencias de catálogo que publica el coordinador.
 *
 * El sobre ya se validó contra su contrato al aceptarlo, así que esta lectura
 * solo traduce; una forma inesperada se trata como incompatibilidad permanente
 * y no como fallo transitorio, para que quede visible en lugar de reintentarse
 * indefinidamente.
 *
 * La versión del maestro es `aggregateVersion` del sobre, no un campo del
 * payload: la proyección la usa para descartar una publicación atrasada sin
 * retroceder lo ya aplicado.
 */
export class CatalogReferenceConsumer implements SyncConsumer {
  constructor(private readonly projection: CatalogReferenceProjection) {}

  async apply(envelope: SyncEnvelopeV1): Promise<Result<ReferenceApplication, AppError>> {
    const payload = envelope.payload;
    const version = envelope.aggregateVersion;

    if (envelope.eventType === CATEGORY_PUBLISHED) {
      const name = text(payload.name);
      const isActive = activity(payload.isActive);
      if (name === null || isActive === null) return this.invalid(envelope);
      return ok(await this.projection.applyCategory({
        categoryId: envelope.aggregateId, name, isActive, version
      }));
    }

    if (envelope.eventType === UNIT_OF_MEASURE_PUBLISHED) {
      const code = text(payload.code);
      const name = text(payload.name);
      const quantityScale = integer(payload.quantityScale);
      const isActive = activity(payload.isActive);
      if (code === null || name === null || quantityScale === null || isActive === null) {
        return this.invalid(envelope);
      }
      return ok(await this.projection.applyUnitOfMeasure({
        unitId: envelope.aggregateId, code, name, quantityScale, isActive, version
      }));
    }

    if (envelope.eventType === PAYMENT_METHOD_PUBLISHED) {
      const name = text(payload.name);
      const kind = text(payload.kind);
      const currencyCode = text(payload.currencyCode);
      const isActive = activity(payload.isActive);
      if (name === null || kind === null ||
        !PAYMENT_METHOD_KINDS.includes(kind as PaymentMethodKind) ||
        currencyCode === null || !/^[A-Z]{3}$/.test(currencyCode) || isActive === null) {
        return this.invalid(envelope);
      }
      return ok(await this.projection.applyPaymentMethod({
        code: envelope.aggregateId,
        name,
        kind: kind as PaymentMethodReference['kind'],
        currencyCode,
        isActive,
        version
      }));
    }

    if (envelope.eventType === DISCOUNT_POLICY_PUBLISHED) {
      const policyId = text(payload.policyId);
      const maximumBasisPoints = integer(payload.maximumBasisPoints);
      if (policyId === null || maximumBasisPoints === null || maximumBasisPoints > 10_000) {
        return this.invalid(envelope);
      }
      return ok(await this.projection.applyOperationalPolicy({
        policyType: 'DISCOUNT',
        policyId,
        version,
        maximumBasisPoints,
        publishedBy: envelope.originNodeId,
        publishedAt: new Date(envelope.occurredAt)
      }));
    }

    if (envelope.eventType === FINANCIAL_TRANSACTION_TAX_POLICY_PUBLISHED) {
      const policyId = text(payload.policyId);
      const rateBasisPoints = integer(payload.rateBasisPoints);
      const eligiblePaymentMethodCodes = textArray(payload.eligiblePaymentMethodCodes);
      const eligibleCurrencies = textArray(payload.eligibleCurrencies);
      if (policyId === null || rateBasisPoints === null || rateBasisPoints > 10_000 ||
        eligiblePaymentMethodCodes === null || eligibleCurrencies === null) {
        return this.invalid(envelope);
      }
      return ok(await this.projection.applyOperationalPolicy({
        policyType: 'FINANCIAL_TRANSACTION_TAX',
        policyId,
        version,
        rateBasisPoints,
        eligiblePaymentMethodCodes,
        eligibleCurrencies,
        publishedBy: envelope.originNodeId,
        publishedAt: new Date(envelope.occurredAt)
      }));
    }

    if (envelope.eventType === EXCHANGE_RATE_UPDATED) {
      const rateId = text(payload.rateId);
      const baseCurrency = text(payload.baseCurrency);
      const quoteCurrency = text(payload.quoteCurrency);
      const rateValue = integer(payload.rateValue);
      const rateScale = integer(payload.rateScale);
      const source = text(payload.source);
      const validFromText = text(payload.validFrom);
      const validUntilText = payload.validUntil === null ? null : text(payload.validUntil);
      const registeredBy = text(payload.registeredBy);
      const validFrom = instant(validFromText);
      const validUntil = instant(validUntilText);
      if (rateId === null || baseCurrency === null || quoteCurrency === null ||
        !/^[A-Z]{3}$/.test(baseCurrency) || !/^[A-Z]{3}$/.test(quoteCurrency) ||
        baseCurrency === quoteCurrency || envelope.aggregateId !== `${baseCurrency}/${quoteCurrency}` ||
        rateValue === null || rateValue <= 0 || rateScale === null || rateScale < 0 ||
        rateScale > 8 || source === null || source.trim().length === 0 ||
        validFrom === null || (payload.validUntil !== null && validUntil === null) ||
        (validUntil !== null && validUntil <= validFrom) ||
        registeredBy === null || registeredBy.trim().length === 0) {
        return this.invalid(envelope);
      }
      return ok(await this.projection.applyExchangeRate({
        rateId, baseCurrency, quoteCurrency, rateValue, rateScale,
        source: source.trim(), validFrom, validUntil, registeredBy, version
      } satisfies ExchangeRateReference));
    }

    if (envelope.eventType !== PRODUCT_PUBLISHED) {
      return err(new ApplicationError(
        'CATALOG_REFERENCE_EVENT_UNSUPPORTED',
        'The catalog projection only consumes reference publications.'
      ));
    }

    const price = isObject(payload.price) ? payload.price : null;
    const taxRate = isObject(payload.taxRate) ? payload.taxRate : null;
    const reference = {
      name: text(payload.name),
      description: text(payload.description),
      categoryId: text(payload.categoryId),
      unitId: text(payload.unitId),
      barcodes: barcodes(payload.barcodes),
      priceMinorUnits: price === null ? null : integer(price.minorUnits),
      currencyCode: price === null ? null : text(price.currencyCode),
      taxRateBasisPoints: taxRate === null ? null : integer(taxRate.basisPoints),
      isActive: activity(payload.isActive)
    };
    if (Object.values(reference).some((value) => value === null)) return this.invalid(envelope);

    return ok(await this.projection.applyProduct({
      productId: envelope.aggregateId,
      name: reference.name as string,
      description: reference.description as string,
      categoryId: reference.categoryId as string,
      unitId: reference.unitId as string,
      barcodes: reference.barcodes as ProductReference['barcodes'],
      priceMinorUnits: reference.priceMinorUnits as number,
      currencyCode: reference.currencyCode as string,
      taxRateBasisPoints: reference.taxRateBasisPoints as number,
      isActive: reference.isActive as boolean,
      version,
      publishedBy: envelope.originNodeId,
      publishedAt: new Date(envelope.occurredAt)
    }));
  }

  private invalid(envelope: SyncEnvelopeV1): Result<ReferenceApplication, AppError> {
    return err(new ApplicationError(
      'CATALOG_REFERENCE_PAYLOAD_INVALID',
      'The reference publication payload does not match its contract.',
      { details: { eventType: envelope.eventType } }
    ));
  }
}
