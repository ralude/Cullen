import { describe, expect, it } from 'vitest';
import {
  application,
  Barcode,
  Category,
  ExchangeRate,
  PaymentMethod,
  Product,
  UnitOfMeasure
} from '@supermarket/core';
import { Money, TaxRate } from '@supermarket/shared';
import { SqliteCatalogReferenceSource } from './catalog-reference-source.js';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleOutboxStore } from './outbox-store.js';
import {
  DrizzleCategoryRepository,
  DrizzleExchangeRateRepository,
  DrizzlePaymentMethodRepository,
  DrizzleProductRepository,
  DrizzleUnitOfMeasureRepository
} from './repositories.js';
import { SqliteUnitOfWork } from './unit-of-work.js';
import { SqliteOperationalPolicyWriter } from './operational-policy-writer.js';

const clock = { now: (): Date => new Date('2026-09-06T12:00:00.000Z') };
let issued = 0;
const ids = { generate: (): string => `generated-${(issued += 1)}` };
const authorization = { authorize: async (): Promise<boolean> => true };

const context = {
  actorId: 'operator-001',
  actorRoleCodes: ['ADMIN'],
  terminalId: 'terminal-coordinator',
  originNodeId: 'node-coordinator',
  correlationId: 'correlation-bootstrap'
};

const unit = UnitOfMeasure.create({
  id: 'unit-001', code: 'UNIT', name: 'Unidad', quantityScale: 0
});

const product = (id: string, name: string, barcode: string): Product => Product.create({
  id,
  name,
  description: `${name} 1kg`,
  categoryId: 'category-001',
  unitOfMeasure: unit,
  barcodes: [Barcode.create({ id: `barcode-${id}`, value: barcode })],
  price: Money.fromMinorUnits(1000, 'USD'),
  taxRate: TaxRate.fromBasisPoints(1600),
  priceHistoryId: `history-${id}`,
  recordedBy: 'operator-001',
  occurredAt: clock.now(),
  eventId: `event-${id}`
});

const seed = async (handle: DatabaseHandle): Promise<void> => {
  const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
  await unitOfWork.execute(() =>
    new DrizzleCategoryRepository(handle).save(Category.create({
      id: 'category-001', name: 'Granos'
    })));
  await unitOfWork.execute(() => new DrizzleUnitOfMeasureRepository(handle).save(unit));
  await unitOfWork.execute(() => new DrizzlePaymentMethodRepository(handle).save(
    PaymentMethod.create({
      code: 'CASH_USD', name: 'Efectivo USD', kind: 'CASH', currencyCode: 'USD'
    })
  ));
  const policies = new SqliteOperationalPolicyWriter(handle);
  await unitOfWork.execute(async () => policies.activateDiscountPolicy(
    { maximumBasisPoints: 1500 },
    { policyId: 'discount-policy-1', createdBy: 'operator-001', reason: 'Inicial', now: clock.now() }
  ));
  await unitOfWork.execute(async () => policies.activateFinancialTransactionTaxPolicy({
    rateBasisPoints: 300,
    eligiblePaymentMethodCodes: ['CASH_USD'],
    eligibleCurrencies: ['USD']
  }, {
    policyId: 'tax-policy-1', createdBy: 'operator-001', reason: 'Inicial', now: clock.now()
  }));
  const rates = new DrizzleExchangeRateRepository(handle);
  for (const rate of [
    ExchangeRate.create({
      id: 'rate-expired', baseCurrency: 'USD', quoteCurrency: 'VES',
      rateValue: 34_000, rateScale: 3, source: 'BCV',
      validFrom: new Date('2026-09-04T00:00:00.000Z'),
      validUntil: new Date('2026-09-05T00:00:00.000Z'), registeredBy: 'operator-001'
    }),
    ExchangeRate.create({
      id: 'rate-current', baseCurrency: 'USD', quoteCurrency: 'VES',
      rateValue: 36_500, rateScale: 3, source: 'BCV',
      validFrom: new Date('2026-09-06T00:00:00.000Z'), registeredBy: 'operator-001'
    }),
    ExchangeRate.create({
      id: 'rate-future', baseCurrency: 'USD', quoteCurrency: 'VES',
      rateValue: 37_000, rateScale: 3, source: 'BCV',
      validFrom: new Date('2026-09-07T00:00:00.000Z'), registeredBy: 'operator-001'
    })
  ]) {
    await unitOfWork.execute(() => rates.save(rate));
  }
  const products = new DrizzleProductRepository(handle);
  await unitOfWork.execute(() => products.save(product('product-001', 'Arroz', '1234')));
  await unitOfWork.execute(() => products.save(product('product-002', 'Azúcar', '5678')));
};

const bootstrapFor = (handle: DatabaseHandle): application.PublishCatalogBootstrap =>
  new application.PublishCatalogBootstrap(
    new SqliteCatalogReferenceSource(handle),
    new DrizzleOutboxStore(handle),
    authorization,
    clock,
    new SqliteUnitOfWork(handle.sqlite),
    ids
  );

const outbox = (handle: DatabaseHandle): unknown[] => handle.sqlite.prepare(`
  select event_type, aggregate_id, aggregate_version from outbox_event
  order by event_type, aggregate_id
`).all();

const migrated = (): DatabaseHandle => {
  const handle = openDatabase(':memory:');
  applyMigrations(handle.sqlite);
  return handle;
};

describe('corte inicial del catálogo', () => {
  it('publica el estado vigente de cada maestro con su versión', async () => {
    const handle = migrated();
    await seed(handle);

    const result = await bootstrapFor(handle).execute({ reason: 'Alta de terminal' }, context);

    expect(result).toMatchObject({
      ok: true,
      value: {
        categories: 1, unitsOfMeasure: 1, paymentMethods: 1,
        operationalPolicies: 2, exchangeRates: 2, products: 2
      }
    });
    expect(outbox(handle)).toEqual([
      { event_type: 'CategoryPublished', aggregate_id: 'category-001', aggregate_version: 1 },
      { event_type: 'DiscountPolicyPublished', aggregate_id: 'DISCOUNT', aggregate_version: 1 },
      { event_type: 'ExchangeRateUpdated', aggregate_id: 'USD/VES', aggregate_version: 2 },
      { event_type: 'ExchangeRateUpdated', aggregate_id: 'USD/VES', aggregate_version: 3 },
      {
        event_type: 'FinancialTransactionTaxPolicyPublished',
        aggregate_id: 'FINANCIAL_TRANSACTION_TAX',
        aggregate_version: 1
      },
      { event_type: 'PaymentMethodPublished', aggregate_id: 'CASH_USD', aggregate_version: 1 },
      { event_type: 'ProductPublished', aggregate_id: 'product-001', aggregate_version: 1 },
      { event_type: 'ProductPublished', aggregate_id: 'product-002', aggregate_version: 1 },
      { event_type: 'UnitOfMeasurePublished', aggregate_id: 'unit-001', aggregate_version: 1 }
    ]);
    handle.close();
  });

  it('no deja publicaciones parciales si el corte se interrumpe antes del commit', async () => {
    const handle = migrated();
    await seed(handle);
    const source = new SqliteCatalogReferenceSource(handle);
    const store = new DrizzleOutboxStore(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);

    await expect(unitOfWork.execute(async () => {
      const categories = await source.listCategories();
      await store.enqueue(categories.map(({ value, version }) => ({
        eventId: 'event-partial',
        eventType: 'CategoryPublished',
        contractVersion: 1 as const,
        aggregateId: value.id,
        aggregateType: 'Category',
        aggregateVersion: version,
        originNodeId: 'node-coordinator',
        correlationId: 'correlation-partial',
        actorId: 'operator-001',
        occurredAt: clock.now(),
        payload: { name: value.name, isActive: 'ACTIVE' }
      })));
      throw new Error('bootstrap interrupted before commit');
    })).rejects.toMatchObject({ code: 'DATABASE_OPERATION_FAILED' });

    expect(outbox(handle)).toEqual([]);
    handle.close();
  });

  it('repetirlo publica el mismo estado sin duplicar identidades de evento', async () => {
    const handle = migrated();
    await seed(handle);
    const bootstrap = bootstrapFor(handle);
    await bootstrap.execute({ reason: 'Primera alta' }, context);

    await bootstrap.execute({ reason: 'Segunda alta' }, context);

    const rows = handle.sqlite.prepare(
      'select event_id, aggregate_id, aggregate_version from outbox_event'
    ).all() as { event_id: string; aggregate_id: string; aggregate_version: number }[];
    expect(rows).toHaveLength(18);
    expect(new Set(rows.map((row) => row.event_id)).size).toBe(18);
    /** Las dieciocho transportan el mismo estado: el consumidor descarta las repetidas. */
    expect(new Set(rows.map((row) => `${row.aggregate_id}:${row.aggregate_version}`)).size)
      .toBe(9);
    handle.close();
  });

  it('incluye en el corte un cambio confirmado antes de publicarlo', async () => {
    const handle = migrated();
    await seed(handle);
    const products = new DrizzleProductRepository(handle);
    const changed = await products.findById('product-001');
    changed?.updateDetails({ isActive: false });
    await new SqliteUnitOfWork(handle.sqlite).execute(() => products.save(changed as Product));

    await bootstrapFor(handle).execute({ reason: 'Alta posterior' }, context);

    expect(handle.sqlite.prepare(
      "select aggregate_version, payload from outbox_event where aggregate_id = 'product-001'"
    ).get()).toMatchObject({ aggregate_version: 2 });
    const payload = JSON.parse(handle.sqlite.prepare(
      "select payload from outbox_event where aggregate_id = 'product-001'"
    ).pluck().get() as string) as { isActive: string };
    expect(payload.isActive).toBe('INACTIVE');
    handle.close();
  });

  it('exige permiso y motivo', async () => {
    const handle = migrated();
    await seed(handle);

    await expect(new application.PublishCatalogBootstrap(
      new SqliteCatalogReferenceSource(handle),
      new DrizzleOutboxStore(handle),
      { authorize: async () => false },
      clock,
      new SqliteUnitOfWork(handle.sqlite),
      ids
    ).execute({ reason: 'Sin permiso' }, context))
      .resolves.toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    await expect(bootstrapFor(handle).execute({ reason: '   ' }, context))
      .resolves.toMatchObject({ ok: false, error: { code: 'SYNC_BOOTSTRAP_REASON_REQUIRED' } });
    expect(outbox(handle)).toEqual([]);
    handle.close();
  });
});
