import { describe, expect, it } from 'vitest';
import type { SyncEnvelopeV1 } from '@supermarket/shared';
import type {
  CatalogReferenceProjection,
  CategoryReference,
  PaymentMethodReference,
  ProjectedOperationalPolicyReference,
  ProjectedOperatorGrantReference,
  ProjectedStockAvailabilityReference,
  ProductReference,
  ReferenceApplication,
  UnitOfMeasureReference
} from '../ports/index.js';
import { CatalogReferenceConsumer } from './catalog-reference-consumer.js';

class RecordingProjection implements CatalogReferenceProjection {
  readonly categories: CategoryReference[] = [];
  readonly units: UnitOfMeasureReference[] = [];
  readonly products: ProductReference[] = [];
  readonly paymentMethods: PaymentMethodReference[] = [];
  readonly operationalPolicies: ProjectedOperationalPolicyReference[] = [];
  readonly exchangeRates: Array<{
    rateId: string; baseCurrency: string; quoteCurrency: string; rateValue: number;
    rateScale: number; source: string; validFrom: Date; validUntil: Date | null;
    registeredBy: string; version: number;
  }> = [];
  readonly operatorGrants: ProjectedOperatorGrantReference[] = [];
  readonly stockAvailability: ProjectedStockAvailabilityReference[] = [];
  outcome: ReferenceApplication = 'APPLIED';

  async applyCategory(reference: CategoryReference): Promise<ReferenceApplication> {
    this.categories.push(reference);
    return this.outcome;
  }

  async applyUnitOfMeasure(reference: UnitOfMeasureReference): Promise<ReferenceApplication> {
    this.units.push(reference);
    return this.outcome;
  }

  async applyProduct(reference: ProductReference): Promise<ReferenceApplication> {
    this.products.push(reference);
    return this.outcome;
  }

  async applyPaymentMethod(reference: PaymentMethodReference): Promise<ReferenceApplication> {
    this.paymentMethods.push(reference);
    return this.outcome;
  }

  async applyOperationalPolicy(
    reference: ProjectedOperationalPolicyReference
  ): Promise<ReferenceApplication> {
    this.operationalPolicies.push(reference);
    return this.outcome;
  }

  async applyExchangeRate(reference: typeof this.exchangeRates[number]): Promise<ReferenceApplication> {
    this.exchangeRates.push(reference);
    return this.outcome;
  }

  async applyOperatorGrant(
    reference: ProjectedOperatorGrantReference
  ): Promise<ReferenceApplication> {
    this.operatorGrants.push(reference);
    return this.outcome;
  }

  async applyStockAvailability(
    reference: ProjectedStockAvailabilityReference
  ): Promise<ReferenceApplication> {
    this.stockAvailability.push(reference);
    return this.outcome;
  }

  async countApplied(): Promise<number> {
    return this.categories.length + this.units.length + this.products.length +
      this.paymentMethods.length + this.operationalPolicies.length + this.exchangeRates.length;
  }
}

const envelope = (overrides: Partial<SyncEnvelopeV1>): SyncEnvelopeV1 => ({
  protocolVersion: 1,
  eventId: 'event-001',
  eventType: 'ProductPublished',
  contractVersion: 1,
  aggregateId: 'product-001',
  aggregateType: 'Product',
  aggregateVersion: 4,
  originNodeId: 'node-coordinator',
  correlationId: 'correlation-001',
  actorId: 'user-001',
  occurredAt: '2026-09-06T10:00:00.000Z',
  payload: {},
  ...overrides
});

const productEnvelope = (
  payload: Partial<SyncEnvelopeV1['payload']> = {}
): SyncEnvelopeV1 => envelope({
  payload: {
    name: 'Arroz',
    description: 'Arroz 1kg',
    categoryId: 'category-001',
    unitId: 'unit-001',
    unitCode: 'UNIT',
    barcodes: [{ barcodeId: 'barcode-001', code: '1234', isActive: 'ACTIVE' }],
    price: { minorUnits: 1200, currencyCode: 'USD' },
    taxRate: { basisPoints: 1600 },
    isActive: 'ACTIVE',
    ...payload
  }
});

describe('CatalogReferenceConsumer', () => {
  it('aplica el producto con la versión del sobre, no del payload', async () => {
    const projection = new RecordingProjection();

    const result = await new CatalogReferenceConsumer(projection).apply(productEnvelope());

    expect(result).toEqual({ ok: true, value: 'APPLIED' });
    expect(projection.products).toEqual([{
      productId: 'product-001',
      name: 'Arroz',
      description: 'Arroz 1kg',
      categoryId: 'category-001',
      unitId: 'unit-001',
      barcodes: [{ barcodeId: 'barcode-001', code: '1234', isActive: true }],
      priceMinorUnits: 1200,
      currencyCode: 'USD',
      taxRateBasisPoints: 1600,
      isActive: true,
      version: 4,
      publishedBy: 'node-coordinator',
      publishedAt: new Date('2026-09-06T10:00:00.000Z')
    }]);
  });

  it('traduce la desactivación como cambio de estado, no como borrado', async () => {
    const projection = new RecordingProjection();

    await new CatalogReferenceConsumer(projection).apply(productEnvelope({
      isActive: 'INACTIVE',
      barcodes: [{ barcodeId: 'barcode-001', code: '1234', isActive: 'INACTIVE' }]
    }));

    expect(projection.products[0]).toMatchObject({
      isActive: false,
      barcodes: [{ barcodeId: 'barcode-001', code: '1234', isActive: false }]
    });
  });

  it('aplica categorías y unidades', async () => {
    const projection = new RecordingProjection();
    const consumer = new CatalogReferenceConsumer(projection);

    await consumer.apply(envelope({
      eventType: 'CategoryPublished',
      aggregateType: 'Category',
      aggregateId: 'category-001',
      aggregateVersion: 2,
      payload: { name: 'Granos', isActive: 'ACTIVE' }
    }));
    await consumer.apply(envelope({
      eventType: 'UnitOfMeasurePublished',
      aggregateType: 'UnitOfMeasure',
      aggregateId: 'unit-001',
      aggregateVersion: 7,
      payload: { code: 'KG', name: 'Kilogramo', quantityScale: 3, isActive: 'ACTIVE' }
    }));

    expect(projection.categories).toEqual([
      { categoryId: 'category-001', name: 'Granos', isActive: true, version: 2 }
    ]);
    expect(projection.units).toEqual([{
      unitId: 'unit-001', code: 'KG', name: 'Kilogramo',
      quantityScale: 3, isActive: true, version: 7
    }]);
  });

  it('aplica métodos de pago con la versión del sobre', async () => {
    const projection = new RecordingProjection();

    await new CatalogReferenceConsumer(projection).apply(envelope({
      eventType: 'PaymentMethodPublished',
      aggregateType: 'PaymentMethod',
      aggregateId: 'CASH_USD',
      aggregateVersion: 3,
      payload: {
        name: 'Efectivo USD',
        kind: 'CASH',
        currencyCode: 'USD',
        isActive: 'INACTIVE'
      }
    }));

    expect(projection.paymentMethods).toEqual([{
      code: 'CASH_USD',
      name: 'Efectivo USD',
      kind: 'CASH',
      currencyCode: 'USD',
      isActive: false,
      version: 3
    }]);
  });

  it('aplica las políticas operativas completas con procedencia y versión del sobre', async () => {
    const projection = new RecordingProjection();
    const consumer = new CatalogReferenceConsumer(projection);

    await consumer.apply(envelope({
      eventType: 'DiscountPolicyPublished',
      aggregateType: 'OperationalPolicy',
      aggregateId: 'DISCOUNT',
      aggregateVersion: 2,
      payload: { policyId: 'discount-policy-2', maximumBasisPoints: 1500 }
    }));
    await consumer.apply(envelope({
      eventType: 'FinancialTransactionTaxPolicyPublished',
      aggregateType: 'OperationalPolicy',
      aggregateId: 'FINANCIAL_TRANSACTION_TAX',
      aggregateVersion: 3,
      payload: {
        policyId: 'tax-policy-3',
        rateBasisPoints: 300,
        eligiblePaymentMethodCodes: ['CARD_USD'],
        eligibleCurrencies: ['USD']
      }
    }));

    expect(projection.operationalPolicies).toEqual([{
      policyType: 'DISCOUNT',
      policyId: 'discount-policy-2',
      version: 2,
      maximumBasisPoints: 1500,
      publishedBy: 'node-coordinator',
      publishedAt: new Date('2026-09-06T10:00:00.000Z')
    }, {
      policyType: 'FINANCIAL_TRANSACTION_TAX',
      policyId: 'tax-policy-3',
      version: 3,
      rateBasisPoints: 300,
      eligiblePaymentMethodCodes: ['CARD_USD'],
      eligibleCurrencies: ['USD'],
      publishedBy: 'node-coordinator',
      publishedAt: new Date('2026-09-06T10:00:00.000Z')
    }]);
  });

  it('aplica una tasa confirmada con su vigencia y versión del par', async () => {
    const projection = new RecordingProjection();

    await new CatalogReferenceConsumer(projection).apply(envelope({
      eventType: 'ExchangeRateUpdated',
      aggregateType: 'ExchangeRate',
      aggregateId: 'USD/VES',
      aggregateVersion: 4,
      payload: {
        rateId: 'rate-004', baseCurrency: 'USD', quoteCurrency: 'VES',
        rateValue: 36500, rateScale: 3, source: 'BCV',
        validFrom: '2026-09-06T00:00:00.000Z', validUntil: null,
        registeredBy: 'operator-001'
      }
    }));

    expect(projection.exchangeRates).toEqual([{
      rateId: 'rate-004', baseCurrency: 'USD', quoteCurrency: 'VES',
      rateValue: 36500, rateScale: 3, source: 'BCV',
      validFrom: new Date('2026-09-06T00:00:00.000Z'), validUntil: null,
      registeredBy: 'operator-001', version: 4
    }]);
  });

  it('devuelve la publicación atrasada como aplicada sin efecto', async () => {
    const projection = new RecordingProjection();
    projection.outcome = 'STALE';

    await expect(new CatalogReferenceConsumer(projection).apply(productEnvelope()))
      .resolves.toEqual({ ok: true, value: 'STALE' });
  });

  it.each([
    ['un precio ausente', { price: null }],
    ['un estado desconocido', { isActive: 'ARCHIVED' }],
    ['un código de barras sin identidad', { barcodes: [{ code: '1234', isActive: 'ACTIVE' }] }],
    ['una escala fraccionaria', { taxRate: { basisPoints: 16.5 } }]
  ])('trata %s como incompatibilidad permanente', async (_case, payload) => {
    const projection = new RecordingProjection();

    await expect(new CatalogReferenceConsumer(projection)
      .apply(productEnvelope(payload as Partial<SyncEnvelopeV1['payload']>)))
      .resolves.toMatchObject({
        ok: false, error: { code: 'CATALOG_REFERENCE_PAYLOAD_INVALID' }
      });
    expect(projection.products).toEqual([]);
  });

  it('rechaza un hecho que no es una publicación de referencia', async () => {
    const projection = new RecordingProjection();

    await expect(new CatalogReferenceConsumer(projection).apply(envelope({
      eventType: 'SaleCompleted', aggregateType: 'Sale'
    }))).resolves.toMatchObject({
      ok: false, error: { code: 'CATALOG_REFERENCE_EVENT_UNSUPPORTED' }
    });
  });
});
