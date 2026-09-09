import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CashRegister, PaymentMethod } from '@supermarket/core';
import {
  DrizzleCashRegisterRepository,
  DrizzlePaymentMethodRepository,
  SqliteUnitOfWork
} from '@supermarket/driver-db';
import { buildApp } from './app.ts';
import { ADMIN_PERMISSIONS, createSecurityRuntime, type SecurityRuntime } from './runtime.ts';

type AuditRow = {
  readonly action: string;
  readonly actor_id: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly after_state: string | null;
  readonly reason: string;
  readonly terminal_id: string;
  readonly origin_node_id: string;
  readonly occurred_at: number;
  readonly correlation_id: string;
};

/**
 * La autorización decide antes de producir efectos y su denegación queda como
 * evidencia durable, no solo como un `FORBIDDEN` en la respuesta.
 */
describe('audited authorization decisions', () => {
  const runtimes: SecurityRuntime[] = [];
  const apps: ReturnType<typeof buildApp>[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const runtime of runtimes.splice(0)) if (runtime.handle.sqlite.open) runtime.handle.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  const without = (...denied: readonly string[]): readonly string[] =>
    ADMIN_PERMISSIONS.filter((permission) => !denied.includes(permission));

  const setup = async (permissions: readonly string[], databasePath = ':memory:') => {
    const runtime = createSecurityRuntime(databasePath, {
      terminalId: 'terminal-001', originNodeId: 'node-001'
    });
    runtimes.push(runtime);
    const provisioned = await runtime.provisionInitialAdmin.execute({
      operatorCode: 'OP001', displayName: 'Operador', pin: '123456', permissions
    });
    expect(provisioned.ok).toBe(true);
    const app = buildApp(runtime.dependencies);
    apps.push(app);
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/session',
      payload: { operatorCode: 'OP001', pin: '123456' }
    });
    expect(login.statusCode).toBe(200);
    const actorId = login.json<{ actorId: string }>().actorId;
    return { app, runtime, actorId, cookie: String(login.headers['set-cookie']).split(';')[0]! };
  };

  const auditRows = (runtime: SecurityRuntime): readonly AuditRow[] =>
    runtime.handle.sqlite.prepare('select * from audit_log order by occurred_at, audit_id')
      .all() as AuditRow[];

  it('records every denied pre-check with its actor, permission, node and correlation', async () => {
    const denied = [
      'sale.void', 'sale.return', 'inventory.adjust', 'inventory.waste.register',
      'catalog.price.update'
    ];
    const { app, runtime, actorId, cookie } = await setup(without(...denied));
    const headers = {
      cookie, 'idempotency-key': 'denied-001', 'x-correlation-id': 'correlation-denied-001'
    };

    const responses = await Promise.all([
      app.inject({
        method: 'POST', url: '/api/v1/sales/01920000-0000-7000-8000-000000000001/void',
        headers, payload: { reason: 'Cliente desistió' }
      }),
      app.inject({
        method: 'POST', url: '/api/v1/sales/01920000-0000-7000-8000-000000000001/return',
        headers, payload: { reason: 'Producto defectuoso' }
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/inventory/stock-items/01920000-0000-7000-8000-000000000002/adjustments',
        headers,
        payload: {
          type: 'ADJUSTMENT_OUT', quantityScaled: 1, quantityScale: 0,
          reason: 'Ajuste de conteo', referenceId: '01920000-0000-7000-8000-000000000003'
        }
      }),
      app.inject({
        method: 'PUT',
        url: '/api/v1/catalog/products/01920000-0000-7000-8000-000000000004/price',
        headers,
        payload: { priceMinorUnits: 1500, currencyCode: 'USD', reason: 'Ajuste de precio' }
      })
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
    }

    const rows = auditRows(runtime);
    expect(rows.map((row) => row.action)).toEqual(Array(4).fill('AUTHORIZATION_DENIED'));
    expect(rows.map((row) => row.entity_id).sort()).toEqual([
      'catalog.price.update', 'inventory.adjust', 'sale.return', 'sale.void'
    ]);
    for (const row of rows) {
      expect(row.entity_type).toBe('Permission');
      expect(row.actor_id).toBe(actorId);
      expect(row.terminal_id).toBe('terminal-001');
      expect(row.origin_node_id).toBe('node-001');
      expect(row.correlation_id).toBe('correlation-denied-001');
      expect(row.occurred_at).toBeGreaterThan(0);
      expect(row.reason).toContain(row.entity_id);
      expect(JSON.parse(row.after_state ?? 'null')).toEqual({ granted: false });
    }
  });

  it('records a denial decided inside the command transaction, without closing the shift', async () => {
    const { app, runtime, cookie } = await setup(without('cash.shift.close.difference'));
    await new SqliteUnitOfWork(runtime.handle.sqlite).execute(async () => {
      await new DrizzleCashRegisterRepository(runtime.handle).save(CashRegister.create({
        id: 'register-001', name: 'Caja 1',
        terminalId: 'terminal-001', originNodeId: 'node-001'
      }));
      await new DrizzlePaymentMethodRepository(runtime.handle).save(PaymentMethod.create({
        code: 'CASH_USD', name: 'Efectivo USD', kind: 'CASH', currencyCode: 'USD'
      }));
    });

    const opened = await app.inject({
      method: 'POST', url: '/api/v1/cash/shifts',
      headers: { cookie, 'idempotency-key': 'shift-open-001' },
      payload: {
        cashRegisterId: 'register-001',
        openingFunds: [{
          paymentMethodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: 1000
        }]
      }
    });
    expect(opened.statusCode).toBe(201);
    const shiftId = opened.json<{ id: string }>().id;

    const closed = await app.inject({
      method: 'POST', url: `/api/v1/cash/shifts/${shiftId}/close`,
      headers: {
        cookie, 'idempotency-key': 'shift-close-001',
        'x-correlation-id': 'correlation-close-001'
      },
      payload: {
        declaredBalances: [{
          paymentMethodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: 900
        }]
      }
    });
    expect(closed.statusCode).toBe(403);
    expect(closed.json()).toMatchObject({ code: 'FORBIDDEN' });

    const current = await app.inject({
      method: 'GET', url: '/api/v1/cash-registers/register-001/open-shift', headers: { cookie }
    });
    expect(current.json()).toMatchObject({ id: shiftId, status: 'OPEN' });

    const rows = auditRows(runtime);
    expect(rows.map((row) => row.action)).toEqual(['SHIFT_OPENED', 'AUTHORIZATION_DENIED']);
    expect(rows[1]).toMatchObject({
      entity_type: 'Permission',
      entity_id: 'cash.shift.close.difference',
      correlation_id: 'correlation-close-001'
    });
  });

  it('keeps the durable evidence after reopening the database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cullen-authz-'));
    directories.push(directory);
    const databasePath = join(directory, 'node.sqlite');
    const { app, runtime, cookie } = await setup(without('sale.void'), databasePath);
    const response = await app.inject({
      method: 'POST', url: '/api/v1/sales/01920000-0000-7000-8000-000000000001/void',
      headers: { cookie, 'idempotency-key': 'denied-002' },
      payload: { reason: 'Cliente desistió' }
    });
    expect(response.statusCode).toBe(403);
    await app.close();
    apps.splice(apps.indexOf(app), 1);
    runtime.handle.close();

    /** La evidencia vive en SQLite y sobrevive al proceso que la escribió. */
    const reopened = createSecurityRuntime(databasePath, {
      terminalId: 'terminal-001', originNodeId: 'node-001'
    });
    runtimes.push(reopened);
    const rows = auditRows(reopened);
    expect(rows.map((row) => row.entity_id)).toEqual(['sale.void']);
    expect(rows[0]?.action).toBe('AUTHORIZATION_DENIED');
  });

  it('does not audit a denial for a decision that another permission authorizes', async () => {
    /** Administra roles y no operadores: el directorio es suyo de todos modos. */
    const { app, runtime, cookie } = await setup(without('identity.user.manage'));

    const directory = await app.inject({
      method: 'GET', url: '/api/v1/identity', headers: { cookie }
    });

    expect(directory.statusCode, directory.body).toBe(200);
    /** El permiso que no tiene no es una decisión negada: nunca se le negó nada. */
    expect(auditRows(runtime)).toEqual([]);
  });

  it('records one denial when no permission of the decision authorizes it', async () => {
    const { app, runtime, cookie } = await setup(
      without('identity.user.manage', 'identity.role.manage')
    );

    const directory = await app.inject({
      method: 'GET', url: '/api/v1/identity',
      headers: { cookie, 'x-correlation-id': 'correlation-directory-001' }
    });

    expect(directory.statusCode).toBe(403);
    const rows = auditRows(runtime);
    /** Una decisión, una entrada, con las alternativas que habrían bastado. */
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'AUTHORIZATION_DENIED',
      entity_type: 'Permission',
      entity_id: 'identity.user.manage|identity.role.manage',
      correlation_id: 'correlation-directory-001'
    });
  });

  it('does not audit a granted decision', async () => {
    const { app, runtime, cookie } = await setup(ADMIN_PERMISSIONS);
    const response = await app.inject({
      method: 'GET', url: '/api/v1/reports/audit', headers: { cookie }
    });
    expect(response.statusCode).toBe(200);
    expect(auditRows(runtime)).toEqual([]);
  });
});
