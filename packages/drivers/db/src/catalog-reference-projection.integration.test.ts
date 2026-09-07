import { describe, expect, it } from 'vitest';
import { application, type SyncSenderContext } from '@supermarket/core';
import type { SyncEnvelopeV1 } from '@supermarket/shared';
import { SqliteCatalogReferenceProjection } from './catalog-reference-projection.js';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleExchangeRateRepository, DrizzleProductRepository } from './repositories.js';
import {
  SqliteDiscountPolicyProvider,
  SqliteFinancialTransactionTaxPolicyProvider
} from './operational-policy-providers.js';
import { DrizzleAggregateAuthorityRegistry } from './sync-authority-registry.js';
import { DrizzleSyncInboxWorkStore } from './sync-inbox-work-store.js';
import { DrizzleSyncReceptionStore } from './sync-reception-store.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

let moment = new Date('2026-09-06T12:00:00.000Z');
const clock = { now: (): Date => moment };
let issued = 0;
const ids = { generate: (): string => `generated-${(issued += 1)}` };

/** En la terminal el emisor verificado es el coordinador de su tienda. */
const coordinator: SyncSenderContext = {
  verifiedNodeId: 'node-coordinator',
  verifiedTerminalId: null,
  coordinatorNodeId: 'node-coordinator'
};

const envelope = (overrides: Partial<SyncEnvelopeV1>): SyncEnvelopeV1 => ({
  protocolVersion: 1,
  eventId: 'event-product-1',
  eventType: 'ProductPublished',
  contractVersion: 1,
  aggregateId: 'product-001',
  aggregateType: 'Product',
  aggregateVersion: 1,
  originNodeId: 'node-coordinator',
  correlationId: 'correlation-001',
  actorId: 'user-001',
  occurredAt: '2026-09-06T10:00:00.000Z',
  payload: {},
  ...overrides
});

const categoryEnvelope = (version = 1): SyncEnvelopeV1 => envelope({
  eventId: `event-category-${version}`,
  eventType: 'CategoryPublished',
  aggregateId: 'category-001',
  aggregateType: 'Category',
  aggregateVersion: version,
  payload: { name: 'Granos', isActive: 'ACTIVE' }
});

const unitEnvelope = (version = 1): SyncEnvelopeV1 => envelope({
  eventId: `event-unit-${version}`,
  eventType: 'UnitOfMeasurePublished',
  aggregateId: 'unit-001',
  aggregateType: 'UnitOfMeasure',
  aggregateVersion: version,
  payload: { code: 'UNIT', name: 'Unidad', quantityScale: 0, isActive: 'ACTIVE' }
});

const paymentMethodEnvelope = (
  version: number,
  payload: Partial<SyncEnvelopeV1['payload']> = {}
): SyncEnvelopeV1 => envelope({
  eventId: `event-payment-method-${version}`,
  eventType: 'PaymentMethodPublished',
  aggregateId: 'CASH_USD',
  aggregateType: 'PaymentMethod',
  aggregateVersion: version,
  payload: {
    name: 'Efectivo USD',
    kind: 'CASH',
    currencyCode: 'USD',
    isActive: 'ACTIVE',
    ...payload
  }
});

const discountPolicyEnvelope = (version: number): SyncEnvelopeV1 => envelope({
  eventId: `event-discount-policy-${version}`,
  eventType: 'DiscountPolicyPublished',
  aggregateId: 'DISCOUNT',
  aggregateType: 'OperationalPolicy',
  aggregateVersion: version,
  payload: { policyId: `discount-policy-${version}`, maximumBasisPoints: version * 500 }
});

const taxPolicyEnvelope = (version: number): SyncEnvelopeV1 => envelope({
  eventId: `event-tax-policy-${version}`,
  eventType: 'FinancialTransactionTaxPolicyPublished',
  aggregateId: 'FINANCIAL_TRANSACTION_TAX',
  aggregateType: 'OperationalPolicy',
  aggregateVersion: version,
  payload: {
    policyId: `tax-policy-${version}`,
    rateBasisPoints: version * 100,
    eligiblePaymentMethodCodes: ['CARD_USD'],
    eligibleCurrencies: ['USD']
  }
});

const exchangeRateEnvelope = (
  version: number,
  validFrom: string,
  validUntil: string | null = null
): SyncEnvelopeV1 => envelope({
  eventId: `event-exchange-rate-${version}`,
  eventType: 'ExchangeRateUpdated',
  aggregateId: 'USD/VES',
  aggregateType: 'ExchangeRate',
  aggregateVersion: version,
  payload: {
    rateId: `rate-${version}`, baseCurrency: 'USD', quoteCurrency: 'VES',
    rateValue: version * 10_000, rateScale: 3, source: 'BCV',
    validFrom, validUntil, registeredBy: 'operator-001'
  }
});

const productEnvelope = (
  version: number,
  payload: Partial<SyncEnvelopeV1['payload']> = {}
): SyncEnvelopeV1 => envelope({
  eventId: `event-product-${version}`,
  aggregateVersion: version,
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

type Terminal = {
  readonly handle: DatabaseHandle;
  readonly receive: application.ReceiveSyncEvent;
  readonly processor: application.ProcessSyncInbox;
};

const terminal = (): Terminal => {
  const handle = openDatabase(':memory:');
  applyMigrations(handle.sqlite);
  const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
  const workStore = new DrizzleSyncInboxWorkStore(handle);
  return {
    handle,
    receive: new application.ReceiveSyncEvent(
      'node-terminal-1',
      new DrizzleSyncReceptionStore(handle),
      new DrizzleAggregateAuthorityRegistry(handle),
      clock,
      unitOfWork,
      ids
    ),
    processor: new application.ProcessSyncInbox(
      workStore,
      new Map([['CATALOG_REFERENCE', new application.CatalogReferenceConsumer(
        new SqliteCatalogReferenceProjection(handle)
      )]]),
      unitOfWork,
      clock,
      ids
    )
  };
};

const product = (handle: DatabaseHandle): unknown => handle.sqlite.prepare(
  'select name, price_minor_units, is_active, version from products'
).get();

/**
 * Un ciclo deja en espera con retry futuro el trabajo cuya dependencia todavía
 * no está aplicada, así que el reloj avanza entre ciclos como haría el worker.
 */
const drain = async (node: Terminal, cycles = 3): Promise<void> => {
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    await node.processor.runBatch();
    moment = new Date(moment.getTime() + 120_000);
  }
};

const work = (handle: DatabaseHandle): unknown[] => handle.sqlite.prepare(
  'select event_id, state from sync_inbox_work order by event_id'
).all();

describe('proyección de catálogo en la terminal', () => {
  it('aplica maestros y producto en orden de dependencia', async () => {
    const node = terminal();
    await node.receive.execute(categoryEnvelope(), coordinator);
    await node.receive.execute(unitEnvelope(), coordinator);
    await node.receive.execute(productEnvelope(1), coordinator);

    /** El producto espera un ciclo: sus maestros aún no estaban aplicados. */
    await drain(node);

    expect(product(node.handle)).toEqual({
      name: 'Arroz', price_minor_units: 1200, is_active: 1, version: 1
    });
    expect(node.handle.sqlite.prepare('select value from product_barcodes').pluck().all())
      .toEqual(['1234']);
    expect(work(node.handle).every((entry) =>
      (entry as { state: string }).state === 'APPLIED')).toBe(true);
    node.handle.close();
  });

  it('deja el producto pendiente mientras falte un maestro aplicado', async () => {
    const node = terminal();
    await node.receive.execute(categoryEnvelope(), coordinator);
    await node.receive.execute(productEnvelope(1), coordinator);

    await drain(node);

    expect(product(node.handle)).toBeUndefined();
    expect(node.handle.sqlite.prepare(
      "select state, last_error from sync_inbox_work where event_id = 'event-product-1'"
    ).get()).toEqual({ state: 'PENDING', last_error: 'SYNC_DEPENDENCY_NOT_APPLIED' });
    node.handle.close();
  });

  it('aplica un cambio posterior y descarta una publicación atrasada', async () => {
    const node = terminal();
    await node.receive.execute(categoryEnvelope(), coordinator);
    await node.receive.execute(unitEnvelope(), coordinator);
    await node.receive.execute(productEnvelope(2, {
      name: 'Arroz blanco', price: { minorUnits: 1500, currencyCode: 'USD' }
    }), coordinator);
    await drain(node);

    await node.receive.execute(productEnvelope(1), coordinator);
    await drain(node);

    expect(product(node.handle)).toEqual({
      name: 'Arroz blanco', price_minor_units: 1500, is_active: 1, version: 2
    });
    expect(node.handle.sqlite.prepare(
      "select state from sync_inbox_work where event_id = 'event-product-1'"
    ).pluck().get()).toBe('APPLIED');
    node.handle.close();
  });

  it('aplica el método de pago y no lo retrocede con una publicación atrasada', async () => {
    const node = terminal();
    await node.receive.execute(paymentMethodEnvelope(2, {
      name: 'Efectivo en dólares', isActive: 'INACTIVE'
    }), coordinator);
    await drain(node, 1);
    await node.receive.execute(paymentMethodEnvelope(1), coordinator);
    await drain(node, 1);

    expect(node.handle.sqlite.prepare(`
      select code, name, kind, currency_code, is_active, version from payment_methods
    `).get()).toEqual({
      code: 'CASH_USD',
      name: 'Efectivo en dólares',
      kind: 'CASH',
      currency_code: 'USD',
      is_active: 0,
      version: 2
    });
    node.handle.close();
  });

  it('aplica políticas operativas y no retrocede sus versiones locales', async () => {
    const node = terminal();
    await node.receive.execute(discountPolicyEnvelope(2), coordinator);
    await node.receive.execute(taxPolicyEnvelope(3), coordinator);
    await drain(node, 1);
    await node.receive.execute(discountPolicyEnvelope(1), coordinator);
    await node.receive.execute(taxPolicyEnvelope(1), coordinator);
    await drain(node, 1);

    await expect(new SqliteDiscountPolicyProvider(node.handle).getPolicy()).resolves.toEqual({
      id: 'discount-policy-2', maximumBasisPoints: 1000
    });
    await expect(new SqliteFinancialTransactionTaxPolicyProvider(node.handle).getPolicy())
      .resolves.toMatchObject({
        id: 'tax-policy-3',
        rate: { basisPoints: 300 },
        eligiblePaymentMethodCodes: ['CARD_USD'],
        eligibleCurrencies: ['USD']
      });
    expect(node.handle.sqlite.prepare(`
      select policy_type, version, is_active from operational_policy_versions
      order by policy_type
    `).all()).toEqual([
      { policy_type: 'DISCOUNT', version: 2, is_active: 1 },
      { policy_type: 'FINANCIAL_TRANSACTION_TAX', version: 3, is_active: 1 }
    ]);
    node.handle.close();
  });

  it('conserva tasas ordenadas y descarta una versión atrasada del par', async () => {
    const node = terminal();
    await node.receive.execute(exchangeRateEnvelope(2, '2026-09-06T00:00:00.000Z'), coordinator);
    await node.receive.execute(exchangeRateEnvelope(3, '2026-09-07T00:00:00.000Z'), coordinator);
    await drain(node, 2);
    await node.receive.execute(exchangeRateEnvelope(1, '2026-09-05T00:00:00.000Z'), coordinator);
    await drain(node, 1);

    expect(node.handle.sqlite.prepare(`
      select id, version from exchange_rates order by version
    `).all()).toEqual([{ id: 'rate-2', version: 2 }, { id: 'rate-3', version: 3 }]);
    const current = await new DrizzleExchangeRateRepository(node.handle)
      .findCurrentByPair('USD', 'VES', new Date('2026-09-06T12:00:00.000Z'));
    expect(current).toMatchObject({ id: 'rate-2', rateValue: 20_000, source: 'BCV' });
    node.handle.close();
  });

  it('no duplica efectos al reprocesar la misma publicación', async () => {
    const node = terminal();
    await node.receive.execute(categoryEnvelope(), coordinator);
    await node.receive.execute(unitEnvelope(), coordinator);
    await node.receive.execute(productEnvelope(1), coordinator);
    await drain(node);

    await node.receive.execute(productEnvelope(1), coordinator);
    await drain(node);

    expect(node.handle.sqlite.prepare('select count(*) from products').pluck().get()).toBe(1);
    expect(node.handle.sqlite.prepare('select count(*) from product_barcodes').pluck().get())
      .toBe(1);
    expect(node.handle.sqlite.prepare('select count(*) from product_price_history')
      .pluck().get()).toBe(1);
    node.handle.close();
  });

  it('conserva la desactivación como cambio y deja el producto legible por el POS', async () => {
    const node = terminal();
    await node.receive.execute(categoryEnvelope(), coordinator);
    await node.receive.execute(unitEnvelope(), coordinator);
    await node.receive.execute(productEnvelope(1), coordinator);
    await drain(node);

    await node.receive.execute(productEnvelope(2, {
      isActive: 'INACTIVE',
      barcodes: [{ barcodeId: 'barcode-001', code: '1234', isActive: 'INACTIVE' }]
    }), coordinator);
    await drain(node);

    expect(product(node.handle)).toMatchObject({ is_active: 0, version: 2 });
    const rehydrated = await new DrizzleProductRepository(node.handle).findById('product-001');
    expect(rehydrated).toMatchObject({ isActive: false, version: 2 });
    expect(rehydrated?.price.minorUnits).toBe(1200);
    node.handle.close();
  });

  it('no encola nada en la salida local de la terminal', async () => {
    const node = terminal();
    await node.receive.execute(categoryEnvelope(), coordinator);
    await node.receive.execute(unitEnvelope(), coordinator);
    await node.receive.execute(productEnvelope(1), coordinator);
    await drain(node);

    expect(node.handle.sqlite.prepare('select count(*) from outbox_event').pluck().get()).toBe(0);
    expect(node.handle.sqlite.prepare('select count(*) from business_event').pluck().get())
      .toBe(0);
    node.handle.close();
  });

  it('no toma custodia de una publicación que el contrato rechaza', async () => {
    const node = terminal();

    const rejected = await node.receive.execute(envelope({
      eventId: 'event-invalid',
      eventType: 'CategoryPublished',
      aggregateId: 'category-002',
      aggregateType: 'Category',
      payload: { name: 'Granos', isActive: 'ARCHIVED' }
    }), coordinator);

    expect(rejected).toMatchObject({ status: 'REJECTED', code: 'SYNC_PAYLOAD_INVALID' });
    expect(node.handle.sqlite.prepare('select count(*) from sync_inbox_event').pluck().get())
      .toBe(0);
    expect(node.handle.sqlite.prepare('select count(*) from sync_inbox_work').pluck().get())
      .toBe(0);
    expect(node.handle.sqlite.prepare('select count(*) from categories').pluck().get()).toBe(0);
    node.handle.close();
  });
});
