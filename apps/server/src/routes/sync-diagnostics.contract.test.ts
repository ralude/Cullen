import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { ADMIN_PERMISSIONS, createSecurityRuntime, type SecurityRuntime } from '../runtime.ts';

describe('diagnóstico operativo HTTP', () => {
  const runtimes: SecurityRuntime[] = [];
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const runtime of runtimes.splice(0)) {
      if (runtime.handle.sqlite.open) runtime.handle.close();
    }
  });

  it('expone estado durable allowlist sin filtrar payloads ni auditoría arbitraria', async () => {
    const runtime = createSecurityRuntime(':memory:', {
      terminalId: 'terminal-001', originNodeId: 'node-001'
    });
    runtimes.push(runtime);
    expect((await runtime.provisionInitialAdmin.execute({
      operatorCode: 'OP001', displayName: 'Operador', pin: '123456',
      permissions: ADMIN_PERMISSIONS
    })).ok).toBe(true);
    const app = buildApp(runtime.dependencies);
    apps.push(app);
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/session',
      payload: { operatorCode: 'OP001', pin: '123456' }
    });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const at = new Date('2026-09-08T12:00:00.000Z').getTime();
    runtime.handle.sqlite.prepare(`
      insert into outbox_event (
        event_id, event_type, contract_version, aggregate_id, aggregate_type,
        aggregate_version, origin_node_id, correlation_id, actor_id, occurred_at,
        payload, status, attempts, next_attempt_at, lease_until, last_error,
        published_at, created_at
      ) values (?, 'SaleCompleted', 2, 'sale-001', 'Sale', 4, 'node-001', ?,
        'operator-001', ?, ?, 'PROCESSING', 3, ?, ?, 'SYNC_TEMPORARY', null, ?)
    `).run(
      'event-sale-001', 'correlation-sale-001', at,
      JSON.stringify({ payments: [{ card: '4111111111111111' }], terminalId: 'terminal-001' }),
      at + 60_000, at + 30_000, at
    );
    runtime.handle.sqlite.prepare(`
      insert into sync_delivery (
        event_id, destination_node_id, status, attempts, cycle_attempts,
        next_attempt_at, lease_until, last_error, published_at, created_at
      ) values ('event-sale-001', 'coordinator-001', 'PROCESSING', 3, 2, ?, ?,
        'SYNC_TEMPORARY', null, ?)
    `).run(at + 60_000, at + 30_000, at);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/destinations/coordinator-001/diagnostics?correlationId=correlation-sale-001',
      headers: { cookie }
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      deliveries: [{
        eventId: 'event-sale-001', status: 'PROCESSING', attempts: 3,
        cycleAttempts: 2, leaseUntil: new Date(at + 30_000).toISOString()
      }],
      salesAttention: [{ saleId: 'sale-001', state: 'DELIVERY_PENDING' }],
      trace: { outbox: [{ eventId: 'event-sale-001', attempts: 3 }] }
    });
    expect(response.body).not.toContain('4111111111111111');
    expect(response.body).not.toContain('payments');
  });
});
