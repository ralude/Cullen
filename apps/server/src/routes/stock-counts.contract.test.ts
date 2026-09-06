import { afterEach, describe, expect, it } from 'vitest';
import { Category, UnitOfMeasure } from '@supermarket/core';
import {
  DrizzleCategoryRepository,
  DrizzleUnitOfMeasureRepository,
  SqliteUnitOfWork
} from '@supermarket/driver-db';
import { buildApp } from '../app.ts';
import { ADMIN_PERMISSIONS, createSecurityRuntime, type SecurityRuntime } from '../runtime.ts';

describe('stock count HTTP contracts', () => {
  const runtimes: SecurityRuntime[] = [];
  const apps: ReturnType<typeof buildApp>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const runtime of runtimes.splice(0)) if (runtime.handle.sqlite.open) runtime.handle.close();
  });

  const setup = async () => {
    const runtime = createSecurityRuntime(':memory:', {
      terminalId: 'terminal-001', originNodeId: 'node-001'
    });
    runtimes.push(runtime);
    await runtime.provisionInitialAdmin.execute({
      operatorCode: 'OP001', displayName: 'Operador', pin: '123456',
      permissions: ADMIN_PERMISSIONS
    });
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
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const product = await app.inject({
      method: 'POST', url: '/api/v1/catalog/products',
      headers: { cookie, 'idempotency-key': 'count-product-001' },
      payload: {
        name: 'Arroz', description: 'Arroz para conteo contractual',
        categoryId: 'category-grocery', unitCode: 'UNIT', barcodes: ['759000000100'],
        priceMinorUnits: 500, currencyCode: 'USD', taxRateBasisPoints: 1600,
        reason: 'Alta para conteo'
      }
    });
    expect(product.statusCode).toBe(201);
    const productId = product.json<{ id: string }>().id;
    const supplier = await app.inject({
      method: 'POST', url: '/api/v1/suppliers',
      headers: { cookie, 'idempotency-key': 'count-supplier-001' },
      payload: {
        legalName: 'Proveedor de arroz',
        taxIdentity: { type: 'RIF', value: 'J-12345678-9' },
        reason: 'Proveedor para conteo'
      }
    });
    expect(supplier.statusCode).toBe(201);
    const receipt = await app.inject({
      method: 'POST', url: '/api/v1/inventory/receipts',
      headers: { cookie, 'idempotency-key': 'count-receipt-001' },
      payload: {
        productId, quantity: '5', supplierId: supplier.json<{ id: string }>().id,
        receiptId: 'receipt-count-001', reason: 'Compra recibida'
      }
    });
    expect(receipt.statusCode).toBe(201);
    return { app, runtime, cookie, productId };
  };

  it('opens, counts, closes and approves a count, deriving the adjustment from the frozen difference', async () => {
    const { app, runtime, cookie, productId } = await setup();

    const opened = await app.inject({
      method: 'POST', url: '/api/v1/inventory/counts',
      headers: { cookie, 'idempotency-key': 'count-open-001' },
      payload: { reason: 'Conteo mensual de víveres' }
    });
    expect(opened.statusCode).toBe(201);
    expect(opened.json()).toMatchObject({ status: 'OPEN', lines: [], differences: null });
    const stockCountId = opened.json<{ id: string }>().id;

    const line = await app.inject({
      method: 'POST', url: `/api/v1/inventory/counts/${stockCountId}/lines`,
      headers: { cookie, 'idempotency-key': 'count-line-001' },
      payload: { productId, quantity: '8' }
    });
    expect(line.statusCode).toBe(200);
    expect(line.json()).toMatchObject({
      lines: [{ productId, batchId: null, countedQuantityScaled: 8, quantityScale: 0 }]
    });

    const closed = await app.inject({
      method: 'POST', url: `/api/v1/inventory/counts/${stockCountId}/close`,
      headers: { cookie, 'idempotency-key': 'count-close-001' },
      payload: { reason: 'Cierre de conteo' }
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({
      status: 'COUNTED',
      differences: [{ expectedScaled: 5, countedScaled: 8, differenceScaled: 3 }]
    });

    const approved = await app.inject({
      method: 'POST', url: `/api/v1/inventory/counts/${stockCountId}/approve`,
      headers: { cookie, 'idempotency-key': 'count-approve-001' },
      payload: { reason: 'Aprobado por supervisor' }
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: 'APPROVED', approvedBy: expect.any(String) });

    const kardex = await app.inject({
      method: 'GET', url: `/api/v1/inventory/products/${productId}/kardex`, headers: { cookie }
    });
    expect(kardex.json()).toMatchObject({
      currentBalanceScaled: 8,
      movements: [{ type: 'PURCHASE_RECEIPT' }, { type: 'ADJUSTMENT_IN' }]
    });

    const listed = await app.inject({
      method: 'GET', url: '/api/v1/inventory/counts?status=APPROVED', headers: { cookie }
    });
    expect(listed.json()).toMatchObject([{ id: stockCountId, status: 'APPROVED' }]);
    expect(runtime.handle.sqlite.prepare('select count(*) from stock_count_lines').pluck().get()).toBe(1);
    expect(runtime.handle.sqlite.prepare('select count(*) from stock_count_differences').pluck().get()).toBe(1);
  });

  it('rejects opening a second count while one is already open on the node', async () => {
    const { app, cookie } = await setup();
    const first = await app.inject({
      method: 'POST', url: '/api/v1/inventory/counts',
      headers: { cookie, 'idempotency-key': 'count-open-dup-1' },
      payload: { reason: 'Primer conteo' }
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST', url: '/api/v1/inventory/counts',
      headers: { cookie, 'idempotency-key': 'count-open-dup-2' },
      payload: { reason: 'Segundo conteo solapado' }
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: 'STOCK_COUNT_ALREADY_OPEN' });
  });

  it('rejects a closed count, leaving the balance untouched', async () => {
    const { app, cookie, productId } = await setup();
    const opened = await app.inject({
      method: 'POST', url: '/api/v1/inventory/counts',
      headers: { cookie, 'idempotency-key': 'count-open-002' },
      payload: { reason: 'Conteo con error' }
    });
    const stockCountId = opened.json<{ id: string }>().id;
    await app.inject({
      method: 'POST', url: `/api/v1/inventory/counts/${stockCountId}/lines`,
      headers: { cookie, 'idempotency-key': 'count-line-002' },
      payload: { productId, quantity: '1' }
    });
    await app.inject({
      method: 'POST', url: `/api/v1/inventory/counts/${stockCountId}/close`,
      headers: { cookie, 'idempotency-key': 'count-close-002' },
      payload: { reason: 'Cierre' }
    });

    const rejected = await app.inject({
      method: 'POST', url: `/api/v1/inventory/counts/${stockCountId}/reject`,
      headers: { cookie, 'idempotency-key': 'count-reject-001' },
      payload: { reason: 'Conteo con error de digitación' }
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({ status: 'REJECTED' });

    const kardex = await app.inject({
      method: 'GET', url: `/api/v1/inventory/products/${productId}/kardex`, headers: { cookie }
    });
    expect(kardex.json()).toMatchObject({ currentBalanceScaled: 5 });
  });

  it('denies opening a count without inventory.count.perform, creating no evidence', async () => {
    const noPermissions = ADMIN_PERMISSIONS.filter((permission) => permission !== 'inventory.count.perform');
    const runtime = createSecurityRuntime(':memory:', {
      terminalId: 'terminal-002', originNodeId: 'node-002'
    });
    runtimes.push(runtime);
    await runtime.provisionInitialAdmin.execute({
      operatorCode: 'OP002', displayName: 'Cajero', pin: '654321', permissions: noPermissions
    });
    const limitedApp = buildApp(runtime.dependencies);
    apps.push(limitedApp);
    const login = await limitedApp.inject({
      method: 'POST', url: '/api/v1/auth/session',
      payload: { operatorCode: 'OP002', pin: '654321' }
    });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;

    const denied = await limitedApp.inject({
      method: 'POST', url: '/api/v1/inventory/counts',
      headers: { cookie, 'idempotency-key': 'count-open-forbidden' },
      payload: { reason: 'Intento sin permiso' }
    });
    expect(denied.statusCode).toBe(403);
    expect(runtime.handle.sqlite.prepare('select count(*) from stock_counts').pluck().get()).toBe(0);
  });
});
