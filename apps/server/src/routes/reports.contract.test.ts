import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { ADMIN_PERMISSIONS, createSecurityRuntime, type SecurityRuntime } from '../runtime.ts';

describe('reporting HTTP contracts', () => {
  const runtimes: SecurityRuntime[] = [];
  const apps: ReturnType<typeof buildApp>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const runtime of runtimes.splice(0)) if (runtime.handle.sqlite.open) runtime.handle.close();
  });

  const setup = async (permissions: readonly string[] = ADMIN_PERMISSIONS) => {
    const runtime = createSecurityRuntime(':memory:', {
      terminalId: 'terminal-001', originNodeId: 'node-001'
    });
    runtimes.push(runtime);
    await runtime.provisionInitialAdmin.execute({
      operatorCode: 'OP001', displayName: 'Operador', pin: '123456', permissions
    });
    const app = buildApp(runtime.dependencies);
    apps.push(app);
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/session',
      payload: { operatorCode: 'OP001', pin: '123456' }
    });
    return { app, runtime, cookie: String(login.headers['set-cookie']).split(';')[0]! };
  };

  const paths = [
    '/api/v1/reports/cash-closures',
    '/api/v1/reports/audit',
    '/api/v1/reports/fiscal-operations',
    '/api/v1/reports/margin?from=2025-08-01T00%3A00%3A00.000Z&to=2025-09-01T00%3A00%3A00.000Z',
    '/api/v1/reports/sales?from=2025-08-01T00%3A00%3A00.000Z&to=2025-09-01T00%3A00%3A00.000Z',
    '/api/v1/reports/inventory?asOf=2025-09-01T00%3A00%3A00.000Z'
  ];

  it('projects cash closures and audit entries from SQLite for an authorized reader', async () => {
    const { app, runtime, cookie } = await setup();
    runtime.handle.sqlite.exec(`
      insert into cash_registers (id, name, terminal_id, origin_node_id, is_active)
      values ('register-1', 'Caja 1', 'terminal-001', 'node-001', 1);
      insert into shifts (id, cash_register_id, terminal_id, origin_node_id, opened_by, opened_at, status, version, closed_at, closed_by)
      values ('shift-1', 'register-1', 'terminal-001', 'node-001', 'user-1', 1756000000000, 'CLOSED', 2, 1756030000000, 'user-2');
      insert into shift_closing_balances (shift_id, payment_method_code, currency_code, expected_minor_units, declared_minor_units, difference_minor_units)
      values ('shift-1', 'CASH', 'USD', 5000, 4900, -100);
      insert into audit_log (audit_id, actor_id, actor_role_codes, action, entity_type, entity_id,
        before_state, after_state, reason, terminal_id, origin_node_id, occurred_at, correlation_id)
      values ('audit-1', 'user-1', '["supervisor"]', 'sale.void', 'Sale', 'sale-1',
        '{"pin":"[REDACTED]"}', '{"status":"VOIDED"}', 'Cliente desistió', 'terminal-001',
        'node-001', 1756020000000, 'correlation-1');
    `);

    const closures = await app.inject({
      method: 'GET', url: '/api/v1/reports/cash-closures?cashRegisterId=register-1',
      headers: { cookie }
    });
    expect(closures.statusCode).toBe(200);
    expect(closures.json()).toEqual([expect.objectContaining({
      shiftId: 'shift-1', closedBy: 'user-2', closedAt: '2025-08-24T10:06:40.000Z',
      movementCount: 0,
      balances: [{
        paymentMethodCode: 'CASH', currencyCode: 'USD', expectedMinorUnits: 5000,
        declaredMinorUnits: 4900, differenceMinorUnits: -100
      }]
    })]);

    const audit = await app.inject({ method: 'GET', url: '/api/v1/reports/audit', headers: { cookie } });
    expect(audit.statusCode).toBe(200);
    expect(audit.json()).toEqual([{
      auditId: 'audit-1', actorId: 'user-1', actorRoleCodes: ['supervisor'], action: 'sale.void',
      entityType: 'Sale', entityId: 'sale-1', reason: 'Cliente desistió', terminalId: 'terminal-001',
      originNodeId: 'node-001', occurredAt: '2025-08-24T07:20:00.000Z', correlationId: 'correlation-1'
    }]);
    expect(audit.body).not.toContain('beforeState');
    expect(audit.body).not.toContain('VOIDED');
  });

  it('labels the fiscal operations projection as a simulation', async () => {
    const { app, cookie } = await setup();

    const response = await app.inject({
      method: 'GET', url: '/api/v1/reports/fiscal-operations', headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ fiscalMode: 'SIMULATION', operations: [] });
  });

  it('rejects an anonymous read of every report', async () => {
    const { app } = await setup();
    for (const url of paths) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'UNAUTHORIZED' });
    }
  });

  it('denies a reader without the report permission before exposing content', async () => {
    const { app, runtime, cookie } = await setup([]);
    runtime.handle.sqlite.exec(`
      insert into audit_log (audit_id, actor_id, actor_role_codes, action, entity_type, entity_id,
        before_state, after_state, reason, terminal_id, origin_node_id, occurred_at, correlation_id)
      values ('audit-secret', 'user-1', '["supervisor"]', 'sale.void', 'Sale', 'sale-secret',
        null, null, 'Motivo reservado', 'terminal-001', 'node-001', 1756020000000, 'correlation-2');
    `);

    for (const url of paths) {
      const response = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
      expect(response.body).not.toContain('audit-secret');
      expect(response.body).not.toContain('Motivo reservado');
    }
  });

  it('aggregates margin by product and currency for an authorized reader', async () => {
    const { app, runtime, cookie } = await setup();
    runtime.handle.sqlite.exec(`
      insert into stock_items (id, product_id, unit_code, quantity_scale, tracks_batches)
      values ('stock-1', 'product-1', 'UND', 0, 0);
      insert into stock_movements (id, stock_item_id, event_id, aggregate_version, type, direction,
        quantity_scaled, quantity_scale, actor_id, reason, reference_id, occurred_at,
        unit_cost_minor_units, cost_currency_code)
      values ('movement-1', 'stock-1', 'event-1', 1, 'SALE_ISSUE', 'OUT', 4, 0, 'user-1', 'Venta',
        'ref-1', 1756400000000, 100, 'USD');
      insert into sales (id, shift_id, currency_code, terminal_id, origin_node_id, started_by, started_at,
        status, version, financial_transaction_tax_minor_units, completed_at)
      values ('sale-1', 'shift-1', 'USD', 'terminal-001', 'node-001', 'user-1', 1756399000000,
        'COMPLETED', 3, 0, 1756400000000);
      insert into sale_items (id, sale_id, product_id, description, price_minor_units, currency_code,
        tax_rate_basis_points, unit_code, unit_scale, quantity_scaled, quantity_scale)
      values ('sale-item-1', 'sale-1', 'product-1', 'Producto uno', 150, 'USD', 1600, 'UND', 0, 4, 0);
    `);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/margin?from=2025-08-01T00%3A00%3A00.000Z&to=2025-09-01T00%3A00%3A00.000Z',
      headers: { cookie }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{
      productId: 'product-1', currencyCode: 'USD', quantitySoldScaled: 4,
      quantityReturnedScaled: 0, quantityScale: 0, discountMinorUnits: 0,
      returnRevenueMinorUnits: 0, returnCostMinorUnits: 0,
      revenueMinorUnits: 600, costMinorUnits: 400, marginMinorUnits: 200
    }]);
  });

  it('rejects a row limit outside the approved range without querying', async () => {
    const { app, cookie } = await setup();

    const response = await app.inject({
      method: 'GET', url: '/api/v1/reports/audit?limit=5000', headers: { cookie }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'HTTP_VALIDATION_FAILED' });
  });

  it('summarizes completed sales by currency and scale, net of discounts', async () => {
    const { app, runtime, cookie } = await setup();
    runtime.handle.sqlite.exec(`
      insert into sales (id, shift_id, currency_code, terminal_id, origin_node_id, started_by, started_at,
        status, version, financial_transaction_tax_minor_units, completed_at)
      values
        ('sale-1', 'shift-1', 'USD', 'terminal-001', 'node-001', 'user-1', 1756399000000, 'COMPLETED', 3, 0, 1756400000000),
        ('sale-2', 'shift-1', 'USD', 'terminal-001', 'node-001', 'user-1', 1756399000000, 'VOIDED', 3, 0, 1756400000000);
      insert into sale_items (id, sale_id, product_id, description, price_minor_units, currency_code,
        tax_rate_basis_points, unit_code, unit_scale, quantity_scaled, quantity_scale)
      values
        ('item-1', 'sale-1', 'product-1', 'Uno', 150, 'USD', 1600, 'UND', 0, 4, 0),
        ('item-2', 'sale-2', 'product-1', 'Anulada', 150, 'USD', 1600, 'UND', 0, 9, 0);
      insert into sale_discounts (id, sale_id, item_id, percentage_basis_points, amount_minor_units,
        currency_code, reason, applied_by, applied_at)
      values ('disc-1', 'sale-1', 'item-1', 667, 40, 'USD', 'Promo', 'user-1', 1756399500000);
    `);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/sales?from=2025-08-01T00%3A00%3A00.000Z&to=2025-09-01T00%3A00%3A00.000Z',
      headers: { cookie }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{
      currencyCode: 'USD', quantityScale: 0, salesCount: 1, lineCount: 1,
      quantitySoldScaled: 4, grossMinorUnits: 600, discountMinorUnits: 40, netMinorUnits: 560
    }]);
  });

  it('projects on-hand inventory by batch with the expiry status at a cutoff', async () => {
    const { app, runtime, cookie } = await setup();
    runtime.handle.sqlite.exec(`
      insert into stock_items (id, product_id, unit_code, quantity_scale, tracks_batches)
      values ('stock-1', 'product-1', 'UND', 0, 1);
      insert into stock_batches (id, stock_item_id, lot_number, expires_at)
      values ('batch-1', 'stock-1', 'L-1', 1757894400000);
      insert into stock_movements (id, stock_item_id, event_id, aggregate_version, type, direction,
        quantity_scaled, quantity_scale, batch_id, actor_id, reason, reference_id, occurred_at)
      values
        ('m-in', 'stock-1', 'e-in', 1, 'PURCHASE_RECEIPT', 'IN', 10, 0, 'batch-1', 'user-1', 'Compra', 'r-1', 1756000000000),
        ('m-out', 'stock-1', 'e-out', 2, 'SALE_ISSUE', 'OUT', 4, 0, 'batch-1', 'user-1', 'Venta', 'r-2', 1756500000000);
    `);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/inventory?asOf=2025-09-01T00%3A00%3A00.000Z&expiringWithinDays=30',
      headers: { cookie }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{
      stockItemId: 'stock-1', productId: 'product-1', batchId: 'batch-1', lotNumber: 'L-1',
      unitCode: 'UND', quantityScale: 0, onHandScaled: 6,
      expiresAt: new Date(1757894400000).toISOString(), expiryStatus: 'EXPIRING'
    }]);
  });
});
