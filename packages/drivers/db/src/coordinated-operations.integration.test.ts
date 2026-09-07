import { describe, expect, it } from 'vitest';
import { application, type CoordinatorLink, type RemoteApplicationProbe } from '@supermarket/core';
import { DrizzleAuditWriter } from './audit-writer.js';
import { SqliteCoordinatedOperationStore } from './coordinated-operation-store.js';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { applyMigrations } from './migrations.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

/**
 * Coordinación LAN de las operaciones que cambian stock (ADR-0026 D3).
 *
 * No hay commit atómico entre dos SQLite: hay intención durable, un resultado
 * por paso y una reconciliación que consulta esos resultados. Sin enlace no se
 * inicia nada; sin evidencia de todos los pasos la operación queda pendiente de
 * conciliación y visible como tal.
 */

const STARTED_AT = new Date('2026-09-06T12:00:00.000Z');
let moment = STARTED_AT;
const clock = { now: (): Date => moment };
let issued = 0;
const ids = { generate: (): string => `operation-${(issued += 1)}` };

const context = {
  actorId: 'operator-001',
  actorRoleCodes: ['ADMIN'],
  terminalId: 'terminal-001',
  originNodeId: 'node-terminal-1',
  correlationId: 'correlation-operation'
};

const migrated = (): DatabaseHandle => {
  const handle = openDatabase(':memory:');
  applyMigrations(handle.sqlite);
  /** El auditor exige un actor existente. */
  handle.sqlite.prepare(`
    insert into identity_users (
      id, operator_code, display_name, is_active, authorization_version, created_at
    ) values ('operator-001', 'CAJA01', 'Cajera 1', 1, 1, ?)
  `).run(STARTED_AT.getTime());
  return handle;
};

const link = (coordinatorNodeId: string | null, reachable: boolean): CoordinatorLink => ({
  coordinatorNodeId,
  isReachable: async () => reachable
});

const operations = (
  handle: DatabaseHandle,
  coordinator: CoordinatorLink
): application.CoordinatedStockOperations =>
  new application.CoordinatedStockOperations(
    new SqliteCoordinatedOperationStore(handle),
    coordinator,
    clock,
    new SqliteUnitOfWork(handle.sqlite),
    ids,
    new DrizzleAuditWriter(handle)
  );

const probe = (states: Readonly<Record<string, 'APPLIED' | 'PENDING' | 'UNKNOWN'>>):
RemoteApplicationProbe => ({
  applicationOf: async (eventId) => states[eventId] ?? 'UNKNOWN'
});

const statusOf = (handle: DatabaseHandle): string | undefined => handle.sqlite
  .prepare('select status from sync_coordinated_operation').pluck().get() as string | undefined;

describe('operaciones distribuidas de stock', () => {
  it('no inicia nada cuando el coordinador no está enlazado', async () => {
    const handle = migrated();

    const result = await operations(handle, link('node-coordinator', false)).begin({
      kind: 'PURCHASE_RECEIPT_COMPLETION',
      fingerprint: 'receipt-001',
      reason: 'Recepción de proveedor.'
    }, context);

    expect(result.ok ? null : result.error.code).toBe('SYNC_COORDINATION_REQUIRED');
    /** Ni intención ni auditoría: la restricción precede a cualquier efecto. */
    expect(handle.sqlite.prepare('select count(*) from sync_coordinated_operation')
      .pluck().get()).toBe(0);
    expect(handle.sqlite.prepare('select count(*) from audit_log').pluck().get()).toBe(0);
    handle.close();
  });

  it('un nodo standalone no exige enlace y completa con su único paso', async () => {
    const handle = migrated();
    const coordinated = operations(handle, link(null, false));

    const started = await coordinated.begin({
      kind: 'STOCK_COUNT_APPROVAL',
      fingerprint: 'count-001',
      reason: 'Conteo mensual.'
    }, context);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    expect(statusOf(handle)).toBe('PENDING_RECONCILIATION');
    const applied = await coordinated.recordLocalEffect(
      started.value.operationId, ['event-1'], context.originNodeId
    );

    expect(applied.status).toBe('COMPLETED');
    expect(applied.steps).toHaveLength(1);
    handle.close();
  });

  it('con coordinador queda pendiente hasta tener evidencia del paso remoto', async () => {
    const handle = migrated();
    const coordinated = operations(handle, link('node-coordinator', true));
    const started = await coordinated.begin({
      kind: 'SALE_RETURN', fingerprint: 'sale-001', reason: 'Producto defectuoso.'
    }, context);
    if (!started.ok) throw new Error('the operation should have started');

    const local = await coordinated.recordLocalEffect(
      started.value.operationId, ['event-return-1'], context.originNodeId
    );
    expect(local.status).toBe('PENDING_RECONCILIATION');

    /** El coordinador todavía no lo aplicó: sigue pendiente, no se cancela. */
    await coordinated.reconcile(probe({ 'event-return-1': 'PENDING' }));
    expect(statusOf(handle)).toBe('PENDING_RECONCILIATION');

    /** Tampoco lo da por hecho cuando no se pudo preguntar. */
    await coordinated.reconcile(probe({ 'event-return-1': 'UNKNOWN' }));
    expect(statusOf(handle)).toBe('PENDING_RECONCILIATION');

    moment = new Date(STARTED_AT.getTime() + 60_000);
    const reconciled = await coordinated.reconcile(probe({ 'event-return-1': 'APPLIED' }));

    expect(reconciled[0]?.status).toBe('COMPLETED');
    expect(statusOf(handle)).toBe('COMPLETED');
    moment = STARTED_AT;
    handle.close();
  });

  it('reintentar la misma intención concilia la existente y no abre otra', async () => {
    const handle = migrated();
    const coordinated = operations(handle, link('node-coordinator', true));
    const first = await coordinated.begin({
      kind: 'PURCHASE_RECEIPT_COMPLETION', fingerprint: 'receipt-001', reason: 'Primera.'
    }, context);
    if (!first.ok) throw new Error('the operation should have started');
    await coordinated.recordLocalEffect(
      first.value.operationId, ['event-receipt-1'], context.originNodeId
    );

    /**
     * Una caída después del efecto local reabre el mismo comando: debe
     * reencontrar su intención, con su paso ya aplicado, en lugar de repetirla.
     */
    const second = await coordinated.begin({
      kind: 'PURCHASE_RECEIPT_COMPLETION', fingerprint: 'receipt-001', reason: 'Reintento.'
    }, context);

    expect(second.ok && second.value.operationId).toBe(first.value.operationId);
    expect(second.ok && second.value.steps.find(({ step }) => step === 'LOCAL_EFFECT')?.state)
      .toBe('APPLIED');
    expect(handle.sqlite.prepare('select count(*) from sync_coordinated_operation')
      .pluck().get()).toBe(1);
    handle.close();
  });

  it('sin enlace tampoco reintenta una intención ya iniciada: la conserva', async () => {
    const handle = migrated();
    const started = await operations(handle, link('node-coordinator', true)).begin({
      kind: 'SALE_RETURN', fingerprint: 'sale-002', reason: 'Producto defectuoso.'
    }, context);
    if (!started.ok) throw new Error('the operation should have started');

    /** La LAN se cae; la misma intención sigue siendo recuperable. */
    const offline = await operations(handle, link('node-coordinator', false)).begin({
      kind: 'SALE_RETURN', fingerprint: 'sale-002', reason: 'Recuperación.'
    }, context);

    expect(offline.ok && offline.value.operationId).toBe(started.value.operationId);
    expect(statusOf(handle)).toBe('PENDING_RECONCILIATION');
    handle.close();
  });

  it('un paso aplicado no retrocede y un rechazo exige revisión', async () => {
    const handle = migrated();
    const store = new SqliteCoordinatedOperationStore(handle);
    const coordinated = operations(handle, link('node-coordinator', true));
    const started = await coordinated.begin({
      kind: 'STOCK_COUNT_APPROVAL', fingerprint: 'count-002', reason: 'Conteo.'
    }, context);
    if (!started.ok) throw new Error('the operation should have started');
    await coordinated.recordLocalEffect(
      started.value.operationId, ['event-count-1'], context.originNodeId
    );

    await store.recordStep({
      operationId: started.value.operationId,
      step: 'LOCAL_EFFECT',
      state: 'PENDING',
      nodeId: context.originNodeId,
      evidence: null,
      recordedAt: moment
    });
    const preserved = await store.findById(started.value.operationId);
    expect(preserved?.steps.find(({ step }) => step === 'LOCAL_EFFECT')?.state).toBe('APPLIED');

    const rejected = await store.recordStep({
      operationId: started.value.operationId,
      step: 'COORDINATOR_EFFECT',
      state: 'REJECTED',
      nodeId: 'node-coordinator',
      evidence: { reasonCode: 'STOCK_INSUFFICIENT' },
      recordedAt: moment
    });
    expect(rejected.status).toBe('NEEDS_REVIEW');
    handle.close();
  });

  it('la lectura expone las pendientes sin filtrar la evidencia interna', async () => {
    const handle = migrated();
    const store = new SqliteCoordinatedOperationStore(handle);
    const coordinated = operations(handle, link('node-coordinator', true));
    const started = await coordinated.begin({
      kind: 'SALE_RETURN', fingerprint: 'sale-003', reason: 'Producto defectuoso.'
    }, context);
    if (!started.ok) throw new Error('the operation should have started');
    await coordinated.recordLocalEffect(
      started.value.operationId, ['event-secret-1'], context.originNodeId
    );

    const listed = await new application.ListCoordinatedOperations(
      store, { authorize: async () => true }
    ).execute('PENDING_RECONCILIATION', context);

    expect(listed.ok && listed.value).toHaveLength(1);
    expect(listed.ok && listed.value[0]).toMatchObject({
      kind: 'SALE_RETURN',
      status: 'PENDING_RECONCILIATION',
      fingerprint: 'sale-003',
      coordinatorNodeId: 'node-coordinator'
    });
    expect(JSON.stringify(listed.ok ? listed.value : [])).not.toContain('event-secret-1');

    const denied = await new application.ListCoordinatedOperations(
      store, { authorize: async () => false }
    ).execute('PENDING_RECONCILIATION', context);
    expect(denied.ok ? null : denied.error.code).toBe('FORBIDDEN');
    handle.close();
  });

  it('no se declara aplicado un paso remoto por no poder preguntar en el ciclo', async () => {
    const handle = migrated();
    const coordinated = operations(handle, link('node-coordinator', true));
    const started = await coordinated.begin({
      kind: 'PURCHASE_RECEIPT_COMPLETION', fingerprint: 'receipt-002', reason: 'Recepción.'
    }, context);
    if (!started.ok) throw new Error('the operation should have started');
    await coordinated.recordLocalEffect(
      started.value.operationId, ['event-a', 'event-b'], context.originNodeId
    );

    /** Uno aplicado y otro no: la operación no se cierra a medias. */
    await coordinated.reconcile(probe({ 'event-a': 'APPLIED', 'event-b': 'PENDING' }));

    expect(statusOf(handle)).toBe('PENDING_RECONCILIATION');
    handle.close();
  });

  it('la intención y su auditoría se confirman juntas o no se confirma nada', async () => {
    const handle = migrated();
    const failing = new application.CoordinatedStockOperations(
      new SqliteCoordinatedOperationStore(handle),
      link(null, false),
      clock,
      new SqliteUnitOfWork(handle.sqlite),
      ids,
      { append: async () => { throw new Error('audit unavailable'); } }
    );

    await expect(failing.begin({
      kind: 'SALE_RETURN', fingerprint: 'sale-004', reason: 'Producto defectuoso.'
    }, context)).rejects.toMatchObject({ code: 'DATABASE_OPERATION_FAILED' });

    /** Sin auditoría no queda intención: no se registra media operación. */
    expect(handle.sqlite.prepare('select count(*) from sync_coordinated_operation')
      .pluck().get()).toBe(0);
    expect(handle.sqlite.prepare('select count(*) from sync_coordinated_step')
      .pluck().get()).toBe(0);
    handle.close();
  });
});
