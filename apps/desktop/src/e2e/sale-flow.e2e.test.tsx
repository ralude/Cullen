import { afterEach, describe, expect, it } from 'vitest';
import {
  Barcode,
  CashRegister,
  Category,
  PaymentMethod,
  Product,
  Shift,
  UnitOfMeasure
} from '@supermarket/core';
import {
  DrizzleCashRegisterRepository,
  DrizzleCategoryRepository,
  DrizzlePaymentMethodRepository,
  DrizzleProductRepository,
  DrizzleShiftRepository,
  DrizzleUnitOfMeasureRepository,
  SqliteUnitOfWork
} from '@supermarket/driver-db';
import { Money, TaxRate } from '@supermarket/shared';
import {
  ADMIN_PERMISSIONS,
  buildApp,
  createSecurityRuntime,
  type SecurityRuntime
} from '@supermarket/server/testing';
import { App } from '../renderer/src/App.js';
import { createDesktopApi } from '../renderer/src/api-client.js';
import { click, mount, settle, submit, type, unmountAll } from '../renderer/src/testing/dom.js';

type RunningApp = ReturnType<typeof buildApp>;

const runtimes: SecurityRuntime[] = [];
const apps: RunningApp[] = [];

afterEach(async () => {
  unmountAll();
  window.localStorage.clear();
  window.location.hash = '';
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const runtime of runtimes.splice(0)) {
    if (runtime.handle.sqlite.open) runtime.handle.close();
  }
});

const eventually = async (assertion: () => void): Promise<void> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await settle();
    }
  }
  throw lastError;
};

const seedNode = async (): Promise<SecurityRuntime> => {
  const runtime = createSecurityRuntime(':memory:', {
    terminalId: 'terminal-001', originNodeId: 'node-001'
  });
  runtimes.push(runtime);

  const provisioned = await runtime.provisionInitialAdmin.execute({
    operatorCode: 'OP001', displayName: 'Operador E2E', pin: '123456',
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
    openedAt: new Date('2026-09-07T12:00:00.000Z'), eventId: 'shift-event-001'
  });
  const product = Product.create({
    id: 'product-coffee', name: 'Café', description: 'Café molido',
    categoryId: category.id, unitOfMeasure: unit, barcodes: [],
    price: Money.fromMinorUnits(1250, 'USD'),
    taxRate: TaxRate.fromBasisPoints(1600), priceHistoryId: 'price-coffee-001',
    recordedBy: 'seed-user', occurredAt: new Date('2026-09-07T12:00:00.000Z'),
    eventId: 'product-event-001'
  });
  product.updateDetails({
    barcodes: [Barcode.create({ id: 'barcode-coffee', value: '759000000001' })]
  });

  await new SqliteUnitOfWork(runtime.handle.sqlite).execute(async () => {
    await new DrizzleCategoryRepository(runtime.handle).save(category);
    await new DrizzleUnitOfMeasureRepository(runtime.handle).save(unit);
    await new DrizzlePaymentMethodRepository(runtime.handle).save(cash);
    await new DrizzleCashRegisterRepository(runtime.handle).save(register);
    await new DrizzleShiftRepository(runtime.handle).save(shift);
    await new DrizzleProductRepository(runtime.handle).save(product);
  });
  runtime.handle.sqlite.exec(`
    insert into operational_policy_versions
      (id, policy_type, version, is_active, valid_from, created_by, created_at, reason)
    values
      ('discount-v1', 'DISCOUNT', 1, 1, 1, 'seed-user', 1, 'E2E fixture'),
      ('igtf-v1', 'FINANCIAL_TRANSACTION_TAX', 1, 1, 1, 'seed-user', 1, 'E2E fixture');
    insert into discount_policy_configuration (policy_id, maximum_basis_points)
      values ('discount-v1', 1000);
    insert into financial_transaction_tax_policy_configuration (policy_id, rate_basis_points)
      values ('igtf-v1', 0);
  `);
  return runtime;
};

const browserSession = (baseUrl: string): typeof fetch => {
  let cookie = '';
  return async (input, init = {}) => {
    const rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    const headers = new Headers(init.headers);
    if (cookie) headers.set('cookie', cookie);
    const response = await fetch(new URL(rawUrl, baseUrl), { ...init, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';', 1)[0] ?? '';
    return response;
  };
};

describe('venta E2E sobre el nodo real', () => {
  it('recorre UI, HTTP/Fastify y SQLite desde el ingreso hasta la venta completada', async () => {
    window.localStorage.clear();
    window.location.hash = '#/sales';
    const runtime = await seedNode();
    const app = buildApp(runtime.dependencies);
    apps.push(app);
    const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
    const screen = await mount(<App api={createDesktopApi(browserSession(baseUrl))} />);

    await eventually(() => expect(screen.text()).toContain('Identificación'));
    await type(screen.get<HTMLInputElement>('input[name="operatorCode"]'), 'OP001');
    await type(screen.get<HTMLInputElement>('input[name="pin"]'), '123456');
    await submit(screen.get<HTMLFormElement>('form.login-card'));

    await eventually(() => {
      expect(screen.text()).toContain('Caja 1 · turno abierto');
      expect(screen.text()).toContain('Operador E2E');
    });
    await click(screen.button('Iniciar venta'));
    await eventually(() => expect(screen.text()).toContain('Venta iniciada.'));

    const barcode = screen.findByText<HTMLLabelElement>('label', 'Barcode')
      ?.querySelector<HTMLInputElement>('input');
    expect(barcode).toBeTruthy();
    await type(barcode!, '759000000001');
    await submit(barcode!.closest('form')!);
    await eventually(() => expect(screen.text()).toContain('Producto agregado al carrito.'));
    expect(screen.text()).toContain('Café');

    const paymentButton = screen.button('Registrar lote de pagos');
    await eventually(() => expect(paymentButton.disabled).toBe(false));
    await submit(paymentButton.closest('form')!);
    await eventually(() => expect(screen.text()).toContain('Pago registrado.'));

    const completeButton = screen.button('Completar venta');
    await eventually(() => expect(completeButton.disabled).toBe(false));
    await click(completeButton);
    await eventually(() => expect(screen.text()).toContain('Venta completada'));

    const persisted = runtime.handle.sqlite.prepare(
      'select status, shift_id as shiftId from sales limit 1'
    ).get() as { readonly status: string; readonly shiftId: string } | undefined;
    expect(persisted).toEqual({ status: 'COMPLETED', shiftId: 'shift-001' });
  }, 20_000);
});
