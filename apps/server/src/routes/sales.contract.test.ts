import { afterEach, describe, expect, it } from 'vitest';
import {
  CashRegister,
  Barcode,
  Category,
  FiscalDocument,
  PaymentMethod,
  Product,
  Shift,
  StockItem,
  UnitOfMeasure
} from '@supermarket/core';
import { Money, Quantity, TaxRate, type SaleResponse, type StartSaleRequest } from '@supermarket/shared';
import {
  DrizzleCashRegisterRepository,
  DrizzleCategoryRepository,
  DrizzlePaymentMethodRepository,
  DrizzleProductRepository,
  DrizzleFiscalDocumentRepository,
  DrizzleStockItemRepository,
  DrizzleShiftRepository,
  DrizzleUnitOfMeasureRepository,
  SqliteUnitOfWork
} from '@supermarket/driver-db';
import { buildApp } from '../app.ts';
import { ADMIN_PERMISSIONS, createSecurityRuntime, type SecurityRuntime } from '../runtime.ts';

describe('sales HTTP contracts', () => {
  const runtimes: SecurityRuntime[] = [];
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const runtime of runtimes.splice(0)) {
      if (runtime.handle.sqlite.open) runtime.handle.close();
    }
  });

  const setup = async (seedPolicies = true) => {
    const runtime = createSecurityRuntime(':memory:', {
      terminalId: 'terminal-001', originNodeId: 'node-001'
    });
    runtimes.push(runtime);
    const provisioned = await runtime.provisionInitialAdmin.execute({
      operatorCode: 'OP001', displayName: 'Operador', pin: '123456',
      permissions: ADMIN_PERMISSIONS
    });
    expect(provisioned.ok).toBe(true);

    const category = Category.create({ id: 'category-grocery', name: 'Víveres' });
    const unit = UnitOfMeasure.create({
      id: 'unit-each', code: 'UNIT', name: 'Unidad', quantityScale: 0
    });
    const cash = PaymentMethod.create({
      code: 'CASH_USD', name: 'Efectivo USD', kind: 'CASH', currencyCode: 'USD'
    });
    const register = CashRegister.create({
      id: 'register-001', name: 'Caja 1', terminalId: 'terminal-001', originNodeId: 'node-001'
    });
    const shift = Shift.open({
      id: 'shift-001', cashRegister: register, openingFunds: [], openedBy: 'seed-user',
      openedAt: new Date('2026-09-01T08:00:00.000Z'), eventId: 'shift-event-001'
    });
    const product = Product.create({
      id: 'product-coffee', name: 'Café', description: 'Café molido',
      categoryId: category.id, unitOfMeasure: unit,
      barcodes: [], price: Money.fromMinorUnits(1250, 'USD'),
      taxRate: TaxRate.fromBasisPoints(1600), priceHistoryId: 'price-coffee-001',
      recordedBy: 'seed-user', occurredAt: new Date('2026-09-01T08:00:00.000Z'),
      eventId: 'product-event-001'
    });
    product.updateDetails({
      barcodes: [Barcode.create({ id: 'barcode-coffee', value: '759000000001' })]
    });

    const unitOfWork = new SqliteUnitOfWork(runtime.handle.sqlite);
    await unitOfWork.execute(async () => {
      await new DrizzleCategoryRepository(runtime.handle).save(category);
      await new DrizzleUnitOfMeasureRepository(runtime.handle).save(unit);
      await new DrizzlePaymentMethodRepository(runtime.handle).save(cash);
      await new DrizzleCashRegisterRepository(runtime.handle).save(register);
      await new DrizzleShiftRepository(runtime.handle).save(shift);
      await new DrizzleProductRepository(runtime.handle).save(product);
    });
    if (seedPolicies) runtime.handle.sqlite.exec(`
      insert into operational_policy_versions
        (id, policy_type, version, is_active, valid_from, created_by, created_at, reason)
      values
        ('discount-v1', 'DISCOUNT', 1, 1, 1, 'seed-user', 1, 'Test fixture'),
        ('igtf-v1', 'FINANCIAL_TRANSACTION_TAX', 1, 1, 1, 'seed-user', 1, 'Test fixture');
      insert into discount_policy_configuration (policy_id, maximum_basis_points)
        values ('discount-v1', 1000);
      insert into financial_transaction_tax_policy_configuration (policy_id, rate_basis_points)
        values ('igtf-v1', 0);
    `);

    const app = buildApp(runtime.dependencies);
    apps.push(app);
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/session',
      payload: { operatorCode: 'OP001', pin: '123456' }
    });
    expect(login.statusCode).toBe(200);
    return { app, runtime, cookie: String(login.headers['set-cookie']).split(';')[0]! };
  };

  it('starts, recovers and adds an item to a sale through SQLite', async () => {
    const { app, cookie } = await setup();
    const payload: StartSaleRequest = { currencyCode: 'USD', shiftId: 'shift-001' };
    const started = await app.inject({
      method: 'POST', url: '/api/v1/sales',
      headers: { cookie, 'idempotency-key': 'sale-start-001' }, payload
    });
    expect(started.statusCode).toBe(201);
    const saleId = started.json<{ id: string }>().id;

    const recovered = await app.inject({
      method: 'GET', url: `/api/v1/sales/${saleId}`, headers: { cookie }
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({ id: saleId, status: 'DRAFT', items: [] });

    const item = await app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/items`,
      headers: { cookie, 'idempotency-key': 'sale-item-001' },
      payload: { barcode: '759000000001', quantityScaled: 2, quantityScale: 0 }
    });
    expect(item.statusCode).toBe(200);
    const itemBody = item.json<{ totalMinorUnits: number }>();
    expect(itemBody).toMatchObject({
      id: saleId,
      items: [{ productId: 'product-coffee', quantityScaled: 2 }]
    });

    const paid = await app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/payments`,
      headers: { cookie, 'idempotency-key': 'sale-payment-001' },
      payload: {
        payments: [{
          methodCode: 'CASH_USD', amountMinorUnits: itemBody.totalMinorUnits,
          currencyCode: 'USD'
        }]
      }
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({ balanceMinorUnits: 0, payments: [{ methodCode: 'CASH_USD' }] });

    const completionHeaders = { cookie, 'idempotency-key': 'sale-complete-001' };
    const completed = await app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/complete`, headers: completionHeaders
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ id: saleId, status: 'COMPLETED' });
    const replay = await app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/complete`, headers: completionHeaders
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(completed.json());
  });

  it('issues the sold stock when the node owns the inventory', async () => {
    const { app, runtime, cookie } = await setup();
    const stock = StockItem.create({
      id: 'stock-coffee', productId: 'product-coffee', unitCode: 'UNIT',
      quantityScale: 0, tracksBatches: false
    });
    stock.registerMovement({
      id: 'stock-coffee-receipt', type: 'PURCHASE_RECEIPT', quantity: Quantity.fromScaled(20, 0),
      actorId: 'seed-user', reason: 'Fixture', referenceId: 'receipt-coffee',
      occurredAt: new Date('2026-09-01T08:00:00.000Z'), eventId: 'stock-coffee-receipt-event',
      unitCost: Money.fromMinorUnits(500, 'USD')
    });
    await new SqliteUnitOfWork(runtime.handle.sqlite).execute(async () => {
      await new DrizzleStockItemRepository(runtime.handle).save(stock);
    });

    const started = await app.inject({
      method: 'POST', url: '/api/v1/sales',
      headers: { cookie, 'idempotency-key': 'issue-sale-start' },
      payload: { currencyCode: 'USD', shiftId: 'shift-001' }
    });
    expect(started.statusCode).toBe(201);
    const saleId = started.json<{ id: string }>().id;
    const item = await app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/items`,
      headers: { cookie, 'idempotency-key': 'issue-sale-item' },
      payload: { barcode: '759000000001', quantityScaled: 2, quantityScale: 0 }
    });
    expect(item.statusCode).toBe(200);
    const paid = await app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/payments`,
      headers: { cookie, 'idempotency-key': 'issue-sale-payment' },
      payload: {
        payments: [{
          methodCode: 'CASH_USD', currencyCode: 'USD',
          amountMinorUnits: item.json<SaleResponse>().totalMinorUnits
        }]
      }
    });
    expect(paid.statusCode).toBe(200);

    const completionHeaders = { cookie, 'idempotency-key': 'issue-sale-complete' };
    const completed = await app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/complete`, headers: completionHeaders
    });
    expect(completed.statusCode).toBe(200);

    const kardex = await app.inject({
      method: 'GET', url: '/api/v1/inventory/products/product-coffee/kardex', headers: { cookie }
    });
    expect(kardex.statusCode).toBe(200);
    const balance = kardex.json<{
      currentBalanceScaled: number;
      movements: readonly { type: string; direction: string; quantityScaled: number }[];
    }>();
    expect(balance.currentBalanceScaled).toBe(18);
    expect(balance.movements).toContainEqual(expect.objectContaining({
      type: 'SALE_ISSUE', direction: 'OUT', quantityScaled: 2
    }));

    // La repetición de la misma intención no vuelve a descontar.
    const replay = await app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/complete`, headers: completionHeaders
    });
    expect(replay.statusCode).toBe(200);
    const afterReplay = await app.inject({
      method: 'GET', url: '/api/v1/inventory/products/product-coffee/kardex', headers: { cookie }
    });
    expect(afterReplay.json<{ currentBalanceScaled: number }>().currentBalanceScaled).toBe(18);
  });

  /**
   * FS-005: un rechazo de inventario no revierte la venta comercial. El
   * producto vendido no tiene artículo de inventario y aun así la venta cierra.
   */
  it('keeps the completed sale when the sold product has no stock item', async () => {
    const { app, cookie } = await setup();
    const started = await app.inject({
      method: 'POST', url: '/api/v1/sales',
      headers: { cookie, 'idempotency-key': 'no-stock-start' },
      payload: { currencyCode: 'USD', shiftId: 'shift-001' }
    });
    const saleId = started.json<{ id: string }>().id;
    const item = await app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/items`,
      headers: { cookie, 'idempotency-key': 'no-stock-item' },
      payload: { barcode: '759000000001', quantityScaled: 1, quantityScale: 0 }
    });
    await app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/payments`,
      headers: { cookie, 'idempotency-key': 'no-stock-payment' },
      payload: {
        payments: [{
          methodCode: 'CASH_USD', currencyCode: 'USD',
          amountMinorUnits: item.json<SaleResponse>().totalMinorUnits
        }]
      }
    });

    const completed = await app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/complete`,
      headers: { cookie, 'idempotency-key': 'no-stock-complete' }
    });

    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ id: saleId, status: 'COMPLETED' });
  });

  it('does not expose sale recovery without a session', async () => {
    const { app } = await setup();
    const response = await app.inject({ method: 'GET', url: '/api/v1/sales/sale-unknown' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('publishes the total return contract and validates its sensitive reason', async () => {
    const { app, cookie } = await setup();
    const response = await app.inject({
      method: 'POST', url: '/api/v1/sales/sale-unknown/return',
      headers: { cookie, 'idempotency-key': 'sale-return-001' }, payload: {}
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'HTTP_VALIDATION_FAILED' });
  });

  it('returns a completed sale through SQLite and replays the same evidence', async () => {
    const { app, runtime, cookie } = await setup();
    const started = await app.inject({
      method: 'POST', url: '/api/v1/sales',
      headers: { cookie, 'idempotency-key': 'return-sale-start' },
      payload: { currencyCode: 'USD', shiftId: 'shift-001' }
    });
    expect(started.statusCode).toBe(201);
    const saleId = started.json<{ id: string }>().id;
    const itemResponse = await app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/items`,
      headers: { cookie, 'idempotency-key': 'return-sale-item' },
      payload: { barcode: '759000000001', quantityScaled: 1, quantityScale: 0 }
    });
    expect(itemResponse.statusCode).toBe(200);
    const item = itemResponse.json<SaleResponse>().items[0]!;
    const paid = await app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/payments`,
      headers: { cookie, 'idempotency-key': 'return-sale-payment' },
      payload: { payments: [{ methodCode: 'CASH_USD', amountMinorUnits: item.totalMinorUnits, currencyCode: 'USD' }] }
    });
    expect(paid.statusCode).toBe(200);
    const completed = await app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/complete`,
      headers: { cookie, 'idempotency-key': 'return-sale-complete' }
    });
    expect(completed.statusCode).toBe(200);

    const stock = StockItem.create({ id: 'stock-return', productId: item.productId, unitCode: 'UNIT', quantityScale: 0, tracksBatches: false });
    stock.registerMovement({ id: 'return-purchase', type: 'PURCHASE_RECEIPT', quantity: Quantity.fromScaled(1, 0), actorId: 'seed-user', reason: 'Fixture', referenceId: 'receipt-return', occurredAt: new Date('2026-09-01T08:00:00.000Z'), eventId: 'return-purchase-event', unitCost: Money.fromMinorUnits(500, 'USD') });
    stock.registerMovement({ id: 'return-sale-issue', type: 'SALE_ISSUE', quantity: Quantity.fromScaled(1, 0), actorId: 'seed-user', reason: 'Fixture', referenceId: `event:${item.id}`, occurredAt: new Date('2026-09-01T08:00:00.000Z'), eventId: 'return-sale-issue-event', unitCost: Money.fromMinorUnits(500, 'USD') });
    const completedBody = completed.json<SaleResponse>();
    const invoice = FiscalDocument.create({
      id: 'invoice-return', idempotencyKey: 'invoice-return-key', requestFingerprint: 'invoice-return-fingerprint',
      terminalId: 'terminal-001', originNodeId: 'node-001', createdBy: 'seed-user', createdAt: new Date('2026-09-01T08:00:00.000Z'), eventId: 'invoice-return-pending',
      content: { referenceId: saleId, type: 'INVOICE', currencyCode: completedBody.currencyCode, totalMinorUnits: completedBody.totalMinorUnits,
        lines: [{ id: item.id, description: item.description, quantityScaled: item.quantityScaled, quantityScale: item.quantityScale, unitPriceMinorUnits: item.grossMinorUnits, taxRateBasisPoints: 1600, totalMinorUnits: item.totalMinorUnits }],
        payments: [{ methodCode: completedBody.payments[0]!.methodCode, amountMinorUnits: completedBody.payments[0]!.amountMinorUnits }] }
    });
    invoice.startPrinting({ actorId: 'seed-user', occurredAt: new Date('2026-09-01T08:00:00.000Z'), eventId: 'invoice-return-printing' });
    invoice.markIssued({ actorId: 'seed-user', occurredAt: new Date('2026-09-01T08:00:00.000Z'), eventId: 'invoice-return-issued', fiscalNumber: 'F-RETURN-001', evidence: { dispatchState: 'RESULT_RECEIVED', commandEffect: 'APPLIED', fiscalCommit: 'COMMITTED', printDelivery: 'COMPLETE' } });
    const seed = new SqliteUnitOfWork(runtime.handle.sqlite);
    await seed.execute(async () => {
      await new DrizzleStockItemRepository(runtime.handle).save(stock);
      await new DrizzleFiscalDocumentRepository(runtime.handle).save(invoice);
    });

    const headers = { cookie, 'idempotency-key': 'return-sale-command' };
    const returned = await app.inject({ method: 'POST', url: `/api/v1/sales/${saleId}/return`, headers, payload: { reason: 'Devolución de prueba' } });
    expect(returned.statusCode).toBe(201);
    expect(returned.json()).toMatchObject({ saleId, refundMinorUnits: item.totalMinorUnits, creditNoteStatus: 'ISSUED' });
    const replay = await app.inject({ method: 'POST', url: `/api/v1/sales/${saleId}/return`, headers, payload: { reason: 'Devolución de prueba' } });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(returned.json());

    const history = await app.inject({ method: 'GET', url: `/api/v1/sales/${saleId}/history`, headers: { cookie } });
    expect(history.statusCode).toBe(200);
    const versions = history.json<Array<{ eventType: string; status: string; refundMinorUnits: number | null }>>();
    expect(versions.at(-1)).toMatchObject({
      eventType: 'SaleReturned', status: 'RETURNED', refundMinorUnits: item.totalMinorUnits
    });

    const anonymous = await app.inject({ method: 'GET', url: `/api/v1/sales/${saleId}/history` });
    expect(anonymous.statusCode).toBe(401);
  });

  it('fails closed when the IGTF policy is not configured', async () => {
    const { app, cookie } = await setup(false);
    const started = await app.inject({
      method: 'POST', url: '/api/v1/sales',
      headers: { cookie, 'idempotency-key': 'sale-start-no-policy' },
      payload: { currencyCode: 'USD', shiftId: 'shift-001' }
    });
    const saleId = started.json<{ id: string }>().id;
    const item = await app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/items`,
      headers: { cookie, 'idempotency-key': 'sale-item-no-policy' },
      payload: { barcode: '759000000001', quantityScaled: 1, quantityScale: 0 }
    });
    const payment = await app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/payments`,
      headers: { cookie, 'idempotency-key': 'sale-payment-no-policy' },
      payload: {
        payments: [{
          methodCode: 'CASH_USD',
          amountMinorUnits: item.json<{ totalMinorUnits: number }>().totalMinorUnits,
          currencyCode: 'USD'
        }]
      }
    });
    expect(payment.statusCode).toBe(409);
    expect(payment.json()).toMatchObject({ code: 'POLICY_NOT_CONFIGURED' });
  });

  it('applies an authorized discount, removes another item and audits a void', async () => {
    const { app, cookie, runtime } = await setup();
    const started = await app.inject({
      method: 'POST', url: '/api/v1/sales',
      headers: { cookie, 'idempotency-key': 'sale-start-edits' },
      payload: { currencyCode: 'USD', shiftId: 'shift-001' }
    });
    const saleId = started.json<{ id: string }>().id;
    const add = async (key: string) => app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/items`,
      headers: { cookie, 'idempotency-key': key },
      payload: { barcode: '759000000001', quantityScaled: 1, quantityScale: 0 }
    });
    const first = await add('sale-edit-item-1');
    const firstItemId = first.json<{ items: Array<{ id: string }> }>().items[0]!.id;
    const second = await add('sale-edit-item-2');
    const secondItemId = second.json<{ items: Array<{ id: string }> }>().items[1]!.id;

    const discounted = await app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/discounts`,
      headers: { cookie, 'idempotency-key': 'sale-discount-001' },
      payload: { itemId: firstItemId, basisPoints: 500, reason: 'Promoción aprobada' }
    });
    expect(discounted.statusCode).toBe(200);
    expect(discounted.json<{ discountTotalMinorUnits: number }>().discountTotalMinorUnits)
      .toBeGreaterThan(0);

    const removed = await app.inject({
      method: 'DELETE', url: `/api/v1/sales/${saleId}/items/${secondItemId}`,
      headers: { cookie, 'idempotency-key': 'sale-remove-001' }
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json<{ items: unknown[] }>().items).toHaveLength(1);

    const voided = await app.inject({
      method: 'POST', url: `/api/v1/sales/${saleId}/void`,
      headers: { cookie, 'idempotency-key': 'sale-void-001' },
      payload: { reason: 'Cliente canceló la operación' }
    });
    expect(voided.statusCode).toBe(200);
    expect(voided.json()).toMatchObject({ status: 'VOIDED' });
    expect(runtime.handle.sqlite.prepare(
      'select action from audit_log order by occurred_at'
    ).pluck().all()).toEqual(['SALE_DISCOUNT_OVERRIDE_APPLIED', 'SALE_VOIDED']);
  });

  it('attaches, corrects and removes an optional recipient without auditing its data', async () => {
    const { app, cookie, runtime } = await setup();
    const started = await app.inject({
      method: 'POST', url: '/api/v1/sales',
      headers: { cookie, 'idempotency-key': 'sale-start-recipient' },
      payload: { currencyCode: 'USD', shiftId: 'shift-001' }
    });
    const saleId = started.json<{ id: string }>().id;
    expect(started.json<{ recipient: unknown }>().recipient).toBeNull();

    const attached = await app.inject({
      method: 'PUT', url: `/api/v1/sales/${saleId}/recipient`,
      headers: { cookie, 'idempotency-key': 'sale-recipient-001' },
      payload: {
        recipient: {
          country: 'VE', type: 'RIF', value: 'J-12.345.678-9', name: 'Bodega Central',
          address: 'Av. Urdaneta'
        }
      }
    });
    expect(attached.statusCode).toBe(200);
    expect(attached.json()).toMatchObject({
      recipient: {
        country: 'VE', type: 'RIF', normalizedValue: 'J123456789', name: 'Bodega Central'
      }
    });

    const malformed = await app.inject({
      method: 'PUT', url: `/api/v1/sales/${saleId}/recipient`,
      headers: { cookie, 'idempotency-key': 'sale-recipient-002' },
      payload: { recipient: { country: 'VE', type: 'RIF', value: 'J-123' } }
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ code: 'SALE_RECIPIENT_IDENTIFICATION_INVALID' });

    const removed = await app.inject({
      method: 'PUT', url: `/api/v1/sales/${saleId}/recipient`,
      headers: { cookie, 'idempotency-key': 'sale-recipient-003' },
      payload: { recipient: null }
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json<{ recipient: unknown }>().recipient).toBeNull();

    /**
     * ADR-0018: la identificación no se acumula en auditoría ni en el ledger;
     * el hecho registrado explica la acción sin copiar datos personales.
     */
    expect(runtime.handle.sqlite.prepare(
      'select action from audit_log'
    ).pluck().all()).toEqual([]);
    const payloads = runtime.handle.sqlite.prepare(
      "select payload from business_event where event_type = 'SaleRecipientChanged'"
    ).pluck().all().join('');
    expect(payloads).not.toContain('J123456789');
    expect(payloads).not.toContain('Bodega Central');
    expect(payloads).not.toContain('Urdaneta');
    expect(JSON.parse(payloads.slice(0, payloads.indexOf('}') + 1) || '{}'))
      .toMatchObject({ attached: true, country: 'VE', type: 'RIF' });
  });
});
