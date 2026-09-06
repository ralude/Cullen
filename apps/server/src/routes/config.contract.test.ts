import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { ADMIN_PERMISSIONS, createSecurityRuntime, type SecurityRuntime } from '../runtime.ts';

describe('config (branches and devices) HTTP contracts', () => {
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
      operatorCode: 'OP001', displayName: 'Operador', pin: '123456', permissions: ADMIN_PERMISSIONS
    });
    const app = buildApp(runtime.dependencies);
    apps.push(app);
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/session',
      payload: { operatorCode: 'OP001', pin: '123456' }
    });
    return { app, runtime, cookie: String(login.headers['set-cookie']).split(';')[0]! };
  };

  it('creates, reads, updates and changes status of a branch atomically', async () => {
    const { app, runtime, cookie } = await setup();
    const created = await app.inject({
      method: 'POST', url: '/api/v1/config/branches',
      headers: { cookie, 'idempotency-key': 'branch-create-001' },
      payload: { code: 'ccs-centro', name: 'Sucursal Centro', reason: 'Alta' }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ code: 'CCS-CENTRO', status: 'ACTIVE' });
    const branchId = created.json<{ id: string }>().id;

    const duplicate = await app.inject({
      method: 'POST', url: '/api/v1/config/branches',
      headers: { cookie, 'idempotency-key': 'branch-create-002' },
      payload: { code: 'CCS-CENTRO', name: 'Otra', reason: 'Alta' }
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'BRANCH_CODE_CONFLICT' });

    const updated = await app.inject({
      method: 'PATCH', url: `/api/v1/config/branches/${branchId}`,
      headers: { cookie, 'idempotency-key': 'branch-update-001' },
      payload: { name: 'Sucursal Centro Ampliada', reason: 'Corrección' }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: 'Sucursal Centro Ampliada', version: 2 });

    const deactivated = await app.inject({
      method: 'PUT', url: `/api/v1/config/branches/${branchId}/status`,
      headers: { cookie, 'idempotency-key': 'branch-status-001' },
      payload: { status: 'INACTIVE', reason: 'Cierre temporal' }
    });
    expect(deactivated.statusCode).toBe(200);

    const activeOnly = await app.inject({
      method: 'GET', url: '/api/v1/config/branches?status=ACTIVE', headers: { cookie }
    });
    expect(activeOnly.json()).toEqual([]);
    expect(runtime.handle.sqlite.prepare('select count(*) from audit_log where entity_type = ?').pluck().get('Branch')).toBe(3);
  });

  it('declares a device tagged with a branch without changing the fiscal mode', async () => {
    const { app, cookie } = await setup();
    const branch = await app.inject({
      method: 'POST', url: '/api/v1/config/branches',
      headers: { cookie, 'idempotency-key': 'branch-for-device' },
      payload: { code: 'CCS', name: 'Sucursal', reason: 'Alta' }
    });
    const branchId = branch.json<{ id: string }>().id;

    const capabilitiesBefore = await app.inject({ method: 'GET', url: '/api/v1/system/capabilities', headers: { cookie } });

    const declared = await app.inject({
      method: 'POST', url: '/api/v1/config/devices',
      headers: { cookie, 'idempotency-key': 'device-declare-001' },
      payload: { type: 'FISCAL_PRINTER', identifier: 'SN-0001', terminalId: 'terminal-001', branchId, reason: 'Alta de impresora' }
    });
    expect(declared.statusCode).toBe(201);
    expect(declared.json()).toMatchObject({ type: 'FISCAL_PRINTER', branchId, status: 'ACTIVE' });

    const capabilitiesAfter = await app.inject({ method: 'GET', url: '/api/v1/system/capabilities', headers: { cookie } });
    expect(capabilitiesAfter.json()).toEqual(capabilitiesBefore.json());
    expect(capabilitiesAfter.json()).toMatchObject({ fiscalMode: 'SIMULATION' });

    const listed = await app.inject({
      method: 'GET', url: '/api/v1/config/devices?terminalId=terminal-001', headers: { cookie }
    });
    expect(listed.json()).toMatchObject([{ identifier: 'SN-0001' }]);
  });

  it('denies branch creation and device declaration without their permissions', async () => {
    const runtime = createSecurityRuntime(':memory:', {
      terminalId: 'terminal-002', originNodeId: 'node-002'
    });
    runtimes.push(runtime);
    const noPermissions = ADMIN_PERMISSIONS.filter(
      (permission) => permission !== 'config.branch.manage' && permission !== 'config.device.manage'
    );
    await runtime.provisionInitialAdmin.execute({
      operatorCode: 'OP002', displayName: 'Cajero', pin: '654321', permissions: noPermissions
    });
    const app = buildApp(runtime.dependencies);
    apps.push(app);
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/session', payload: { operatorCode: 'OP002', pin: '654321' }
    });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;

    const branchDenied = await app.inject({
      method: 'POST', url: '/api/v1/config/branches',
      headers: { cookie, 'idempotency-key': 'branch-forbidden' },
      payload: { code: 'CCS', name: 'Sucursal', reason: 'Alta' }
    });
    expect(branchDenied.statusCode).toBe(403);

    const deviceDenied = await app.inject({
      method: 'POST', url: '/api/v1/config/devices',
      headers: { cookie, 'idempotency-key': 'device-forbidden' },
      payload: { type: 'SCALE', identifier: 'SN-1', terminalId: 'terminal-002', reason: 'Alta' }
    });
    expect(deviceDenied.statusCode).toBe(403);
    expect(runtime.handle.sqlite.prepare('select count(*) from branches').pluck().get()).toBe(0);
    expect(runtime.handle.sqlite.prepare('select count(*) from devices').pluck().get()).toBe(0);
  });

  it('administers operational masters and preserves policy versions through HTTP', async () => {
    const { app, runtime, cookie } = await setup();
    const category = await app.inject({
      method: 'PUT', url: '/api/v1/config/categories',
      headers: { cookie, 'idempotency-key': 'category-001' },
      payload: { name: 'Víveres', isActive: true, reason: 'Alta de catálogo' }
    });
    expect(category.statusCode).toBe(200);
    const categoryId = category.json<{ id: string }>().id;
    const unit = await app.inject({
      method: 'PUT', url: '/api/v1/config/units',
      headers: { cookie, 'idempotency-key': 'unit-001' },
      payload: { code: 'UND', name: 'Unidad', quantityScale: 0, isActive: true, reason: 'Alta de catálogo' }
    });
    expect(unit.statusCode).toBe(200);
    const unitId = unit.json<{ id: string }>().id;
    const method = await app.inject({
      method: 'PUT', url: '/api/v1/config/payment-methods',
      headers: { cookie, 'idempotency-key': 'payment-001' },
      payload: { code: 'CASH', name: 'Efectivo', kind: 'CASH', currencyCode: 'VES', isActive: true, reason: 'Alta' }
    });
    expect(method.statusCode).toBe(200);

    const listed = await app.inject({ method: 'GET', url: '/api/v1/config/operational-master-data', headers: { cookie } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      categories: [{ id: categoryId, isActive: true }],
      units: [{ id: unitId, code: 'UND' }], paymentMethods: [{ code: 'CASH' }]
    });

    for (const [key, maximumBasisPoints] of [['discount-001', 1000], ['discount-002', 1500]] as const) {
      const response = await app.inject({
        method: 'POST', url: '/api/v1/config/policies/discount',
        headers: { cookie, 'idempotency-key': key }, payload: { maximumBasisPoints, reason: 'Ajuste gerencial' }
      });
      expect(response.statusCode).toBe(200);
    }
    expect(runtime.handle.sqlite.prepare(
      "select count(*) from operational_policy_versions where policy_type = 'DISCOUNT'"
    ).pluck().get()).toBe(2);
    expect(runtime.handle.sqlite.prepare(
      "select count(*) from operational_policy_versions where policy_type = 'DISCOUNT' and is_active = 1"
    ).pluck().get()).toBe(1);
    expect(runtime.handle.sqlite.prepare(
      "select count(*) from audit_log where entity_type in ('Category', 'UnitOfMeasure', 'PaymentMethod', 'OperationalPolicy')"
    ).pluck().get()).toBe(5);
  });

  it('blocks deactivation and scale changes when an active product uses the master', async () => {
    const { app, runtime, cookie } = await setup();
    const category = await app.inject({ method: 'PUT', url: '/api/v1/config/categories',
      headers: { cookie, 'idempotency-key': 'category-live' }, payload: { name: 'Activa', isActive: true, reason: 'Alta' } });
    const unit = await app.inject({ method: 'PUT', url: '/api/v1/config/units',
      headers: { cookie, 'idempotency-key': 'unit-live' }, payload: { code: 'KG', name: 'Kilogramo', quantityScale: 3, isActive: true, reason: 'Alta' } });
    const categoryId = category.json<{ id: string }>().id;
    const unitId = unit.json<{ id: string }>().id;
    runtime.handle.sqlite.prepare(`insert into products
      (id, name, description, category_id, unit_id, price_minor_units, currency_code, tax_rate_basis_points, is_active, version)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('product-1', 'Arroz', '', categoryId, unitId, 100, 'VES', 1600, 1, 1);

    const categoryDenied = await app.inject({ method: 'PUT', url: '/api/v1/config/categories',
      headers: { cookie, 'idempotency-key': 'category-disable' }, payload: { id: categoryId, name: 'Activa', isActive: false, reason: 'Baja' } });
    expect(categoryDenied.statusCode).toBe(409);
    expect(categoryDenied.json()).toMatchObject({ code: 'CATEGORY_IN_USE' });
    const scaleDenied = await app.inject({ method: 'PUT', url: '/api/v1/config/units',
      headers: { cookie, 'idempotency-key': 'unit-scale' }, payload: { code: 'KG', name: 'Kilogramo', quantityScale: 2, isActive: true, reason: 'Cambio' } });
    expect(scaleDenied.statusCode).toBe(409);
    expect(scaleDenied.json()).toMatchObject({ code: 'UNIT_OF_MEASURE_SCALE_IN_USE' });
  });
});
