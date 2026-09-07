import { afterEach, describe, expect, it } from 'vitest';
import { Category, PaymentMethod, UnitOfMeasure } from '@supermarket/core';
import {
  DrizzleCategoryRepository,
  DrizzlePaymentMethodRepository,
  DrizzleUnitOfMeasureRepository,
  SqliteUnitOfWork
} from '@supermarket/driver-db';
import type {
  CreateProductRequest,
  MixedPaymentRequest,
  UpdateExchangeRateRequest,
  UpdatePriceRequest,
  UpdateProductRequest
} from '@supermarket/shared';
import { buildApp } from '../app.ts';
import { ADMIN_PERMISSIONS, createSecurityRuntime, type SecurityRuntime } from '../runtime.ts';

const createProduct: CreateProductRequest = {
  name: 'Café molido',
  description: 'Café de prueba contractual',
  categoryId: 'category-grocery',
  unitCode: 'UNIT',
  barcodes: ['759000000001'],
  priceMinorUnits: 1250,
  currencyCode: 'USD',
  taxRateBasisPoints: 1600,
  reason: 'Alta contractual'
};

const updateProduct: UpdateProductRequest = {
  name: 'Café premium',
  reason: 'Corrección de descripción comercial'
};

const updatePrice: UpdatePriceRequest = {
  priceMinorUnits: 1500,
  currencyCode: 'USD',
  reason: 'Actualización de proveedor'
};

const updateRate: UpdateExchangeRateRequest = {
  baseCurrency: 'USD',
  quoteCurrency: 'VES',
  rateValue: 36500,
  rateScale: 3,
  source: 'Carga manual confirmada',
  validFrom: '2026-09-01T00:00:00.000Z',
  validUntil: null,
  reason: 'Tasa confirmada por supervisor'
};

const mixedPayment: MixedPaymentRequest = {
  targetCurrency: 'VES',
  payments: [
    { amountMinorUnits: 100000, currencyCode: 'VES' },
    { amountMinorUnits: 1000, currencyCode: 'USD' }
  ]
};

describe('catalog and currency HTTP contracts', () => {
  const runtimes: SecurityRuntime[] = [];
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const runtime of runtimes.splice(0)) {
      if (runtime.handle.sqlite.open) runtime.handle.close();
    }
  });

  const setup = async (permissions: readonly string[] = ADMIN_PERMISSIONS) => {
    const runtime = createSecurityRuntime(':memory:', {
      terminalId: 'terminal-001', originNodeId: 'node-001'
    });
    runtimes.push(runtime);
    const provisioned = await runtime.provisionInitialAdmin.execute({
      operatorCode: 'OP001', displayName: 'Operador', pin: '123456', permissions
    });
    expect(provisioned.ok).toBe(true);
    const unitOfWork = new SqliteUnitOfWork(runtime.handle.sqlite);
    await unitOfWork.execute(async () => {
      await new DrizzleCategoryRepository(runtime.handle).save(Category.create({
        id: 'category-grocery', name: 'Víveres'
      }));
      await new DrizzleUnitOfMeasureRepository(runtime.handle).save(UnitOfMeasure.create({
        id: 'unit-each', code: 'UNIT', name: 'Unidad', quantityScale: 0
      }));
    });
    const app = buildApp(runtime.dependencies);
    apps.push(app);
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/session',
      payload: { operatorCode: 'OP001', pin: '123456' }
    });
    expect(login.statusCode).toBe(200);
    return {
      app,
      runtime,
      cookie: String(login.headers['set-cookie']).split(';')[0]!
    };
  };

  it('runs the catalog flow through HTTP, application and SQLite with idempotency', async () => {
    const { app, cookie, runtime } = await setup();
    const headers = { cookie, 'idempotency-key': 'product-create-001' };
    const created = await app.inject({
      method: 'POST', url: '/api/v1/catalog/products', headers, payload: createProduct
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json<{ id: string }>();

    const replay = await app.inject({
      method: 'POST', url: '/api/v1/catalog/products', headers, payload: createProduct
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json<{ id: string }>().id).toBe(createdBody.id);

    const conflict = await app.inject({
      method: 'POST', url: '/api/v1/catalog/products', headers,
      payload: { ...createProduct, name: 'Otro producto' }
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });

    const edited = await app.inject({
      method: 'PATCH', url: `/api/v1/catalog/products/${createdBody.id}`,
      headers: { cookie, 'idempotency-key': 'product-update-001' }, payload: updateProduct
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ name: 'Café premium' });

    const repriced = await app.inject({
      method: 'PUT', url: `/api/v1/catalog/products/${createdBody.id}/price`,
      headers: { cookie, 'idempotency-key': 'product-price-001' }, payload: updatePrice
    });
    expect(repriced.statusCode).toBe(200);
    expect(repriced.json()).toMatchObject({ price: { amountMinorUnits: 1500 } });

    const found = await app.inject({
      method: 'GET', url: '/api/v1/catalog/products/by-barcode/759000000001',
      headers: { cookie }
    });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({
      product: { id: createdBody.id, name: 'Café premium' },
      snapshot: { priceMinorUnits: 1500 }
    });

    const audit = runtime.handle.sqlite.prepare(
      'select action, actor_id, terminal_id, origin_node_id from audit_log order by occurred_at'
    ).all() as Array<Record<string, unknown>>;
    expect(audit).toHaveLength(3);
    expect(audit.map((entry) => entry.action)).toEqual([
      'CATALOG_PRODUCT_CREATED', 'CATALOG_PRODUCT_UPDATED', 'CATALOG_PRICE_UPDATED'
    ]);
    expect(audit).toEqual(expect.arrayContaining([expect.objectContaining({
      actor_id: expect.any(String), terminal_id: 'terminal-001', origin_node_id: 'node-001'
    })]));
    /**
     * El ledger conserva los hechos de dominio; la salida distribuye el estado
     * vigente del catálogo, así que también la actualización de detalles, que
     * no produce evento de dominio, publica una referencia.
     */
    expect(runtime.handle.sqlite.prepare(
      'select event_type from business_event order by occurred_at'
    ).pluck().all()).toEqual(['ProductCreated', 'PriceChanged']);
    expect(runtime.handle.sqlite.prepare(
      'select event_type, aggregate_version from outbox_event order by aggregate_version'
    ).all()).toEqual([
      { event_type: 'ProductPublished', aggregate_version: 1 },
      { event_type: 'ProductPublished', aggregate_version: 2 },
      { event_type: 'ProductPublished', aggregate_version: 3 }
    ]);
    expect(runtime.handle.sqlite.prepare('select count(*) from idempotency_key').pluck().get()).toBe(3);
  });

  it('runs exchange-rate writes and reads without accepting floating values', async () => {
    const { app, cookie } = await setup();
    const created = await app.inject({
      method: 'POST', url: '/api/v1/currency/exchange-rates',
      headers: { cookie, 'idempotency-key': 'rate-create-001' }, payload: updateRate
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ rateValue: 36500, rateScale: 3 });

    const current = await app.inject({
      method: 'GET',
      url: '/api/v1/currency/exchange-rates/current?baseCurrency=USD&quoteCurrency=VES',
      headers: { cookie }
    });
    expect(current.statusCode).toBe(200);
    expect(current.json()).toMatchObject({ source: 'Carga manual confirmada' });

    const total = await app.inject({
      method: 'POST', url: '/api/v1/currency/mixed-payment-totals',
      headers: { cookie }, payload: mixedPayment
    });
    expect(total.statusCode).toBe(200);
    expect(total.json()).toEqual({ totalMinorUnits: 136500, totalCurrency: 'VES' });

    const decimal = await app.inject({
      method: 'POST', url: '/api/v1/currency/exchange-rates',
      headers: { cookie, 'idempotency-key': 'rate-create-002' },
      payload: { ...updateRate, rateValue: 36.5 }
    });
    expect(decimal.statusCode).toBe(400);
    expect(decimal.json()).toMatchObject({ code: 'HTTP_VALIDATION_FAILED' });
  });

  it('denies a catalog command before persistence when permission is absent', async () => {
    const { app, cookie, runtime } = await setup([]);
    const response = await app.inject({
      method: 'POST', url: '/api/v1/catalog/products',
      headers: { cookie, 'idempotency-key': 'forbidden-product-001' }, payload: createProduct
    });
    expect(response.statusCode).toBe(403);
    expect(runtime.handle.sqlite.prepare('select count(*) from products').pluck().get()).toBe(0);
  });

  it('lists reference data for selectors, requiring a session and hiding inactive rows', async () => {
    const { app, cookie, runtime } = await setup();
    await new SqliteUnitOfWork(runtime.handle.sqlite).execute(async () => {
      await new DrizzlePaymentMethodRepository(runtime.handle).save(PaymentMethod.create({
        code: 'CASH_USD', name: 'Efectivo USD', kind: 'CASH', currencyCode: 'USD'
      }));
      await new DrizzlePaymentMethodRepository(runtime.handle).save(PaymentMethod.create({
        code: 'RETIRED', name: 'Retirado', kind: 'OTHER', currencyCode: 'USD', isActive: false
      }));
      await new DrizzleCategoryRepository(runtime.handle).save(Category.create({
        id: 'category-retired', name: 'Retirada', isActive: false
      }));
    });

    const categories = await app.inject({ method: 'GET', url: '/api/v1/catalog/categories', headers: { cookie } });
    expect(categories.statusCode).toBe(200);
    expect(categories.json()).toEqual([{ id: 'category-grocery', name: 'Víveres' }]);

    const units = await app.inject({ method: 'GET', url: '/api/v1/catalog/units', headers: { cookie } });
    expect(units.statusCode).toBe(200);
    expect(units.json()).toEqual([{ code: 'UNIT', name: 'Unidad', quantityScale: 0 }]);

    const methods = await app.inject({ method: 'GET', url: '/api/v1/currency/payment-methods', headers: { cookie } });
    expect(methods.statusCode).toBe(200);
    expect(methods.json()).toEqual([
      { code: 'CASH_USD', name: 'Efectivo USD', kind: 'CASH', currencyCode: 'USD' }
    ]);

    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/catalog/categories' });
    expect(anonymous.statusCode).toBe(401);
  });
});
