import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '../execution-context.js';
import type {
  DeliveryDiagnosticRecord,
  OperationalDiagnosticsReader,
  OperationalTraceRecord,
  SaleEffectRecord
} from '../ports/index.js';
import { SYNC_PERMISSIONS } from './permissions.js';
import { GetOperationalDiagnostics } from './operational-diagnostics.js';

const context: ExecutionContext = {
  actorId: 'operator-001',
  actorRoleCodes: ['ADMIN'],
  terminalId: 'terminal-001',
  originNodeId: 'node-001',
  correlationId: 'request-correlation'
};
const now = new Date('2026-09-08T12:00:00.000Z');

const delivery = (eventId: string, status: DeliveryDiagnosticRecord['status']) => ({
  eventId,
  eventType: 'SaleCompleted',
  aggregateId: `sale-${eventId}`,
  correlationId: `correlation-${eventId}`,
  destinationNodeId: 'coordinator',
  status,
  attempts: 2,
  cycleAttempts: 1,
  nextAttemptAt: new Date('2026-09-08T11:59:00.000Z'),
  leaseUntil: status === 'PROCESSING' ? new Date('2026-09-08T12:01:00.000Z') : null,
  publishedAt: status === 'PUBLISHED' ? new Date('2026-09-08T11:59:30.000Z') : null,
  lastError: null,
  occurredAt: new Date('2026-09-08T11:00:00.000Z')
}) satisfies DeliveryDiagnosticRecord;

const effect = (
  eventId: string,
  kind: SaleEffectRecord['kind'],
  state: string
): SaleEffectRecord => ({
  saleId: `sale-${eventId}`,
  eventId,
  correlationId: `correlation-${eventId}`,
  originNodeId: 'node-001',
  terminalId: 'terminal-001',
  occurredAt: new Date('2026-09-08T11:00:00.000Z'),
  kind,
  state,
  errorCode: null
});

describe('diagnóstico operativo correlacionado', () => {
  it('no confunde custodia con aplicación y omite ventas aplicadas', async () => {
    const deliveries = [delivery('pending', 'PROCESSING'), delivery('applied', 'PUBLISHED')];
    const effects = [
      effect('local', 'LOCAL_REJECTION', 'STOCK_INSUFFICIENT'),
      effect('pending', 'OUTGOING', 'PROCESSING'),
      effect('applied', 'OUTGOING', 'PUBLISHED'),
      effect('remote-pending', 'OUTGOING', 'PUBLISHED'),
      effect('discrepancy', 'INCOMING', 'DISCREPANCY')
    ];
    const trace: OperationalTraceRecord = { events: [], outbox: [], deliveries: [], audits: [] };
    const reader: OperationalDiagnosticsReader = {
      listDeliveries: async () => deliveries,
      listSaleEffects: async () => effects,
      trace: async () => trace
    };
    const remote = {
      applicationOf: async (eventId: string) => eventId === 'applied'
        ? 'APPLIED' as const
        : 'PENDING' as const
    };
    const useCase = new GetOperationalDiagnostics(
      reader,
      { authorize: async (_actor, permission) => permission === SYNC_PERMISSIONS.REVIEW_RECEPTION },
      { now: () => now },
      remote
    );

    const result = await useCase.execute({
      destinationNodeId: 'coordinator', correlationId: 'correlation-applied'
    }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deliveries[0]).toMatchObject({
      status: 'PROCESSING', attempts: 2, ageMilliseconds: 3_600_000
    });
    expect(result.value.salesAttention.map(({ eventId, state }) => [eventId, state])).toEqual([
      ['local', 'LOCAL_REJECTED'],
      ['pending', 'DELIVERY_PENDING'],
      ['remote-pending', 'APPLICATION_PENDING'],
      ['discrepancy', 'DISCREPANCY']
    ]);
    expect(result.value.trace).toEqual({ events: [], outbox: [], deliveries: [], audits: [] });
  });

  it('autoriza antes de leer y valida la correlación', async () => {
    let reads = 0;
    const reader: OperationalDiagnosticsReader = {
      listDeliveries: async () => { reads += 1; return []; },
      listSaleEffects: async () => { reads += 1; return []; },
      trace: async () => { reads += 1; return { events: [], outbox: [], deliveries: [], audits: [] }; }
    };
    const denied = new GetOperationalDiagnostics(
      reader, { authorize: async () => false }, { now: () => now }
    );
    await expect(denied.execute({ destinationNodeId: 'coordinator' }, context))
      .resolves.toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(reads).toBe(0);

    const allowed = new GetOperationalDiagnostics(
      reader, { authorize: async () => true }, { now: () => now }
    );
    await expect(allowed.execute({
      destinationNodeId: 'coordinator', correlationId: 'short'
    }, context)).resolves.toMatchObject({
      ok: false, error: { code: 'CORRELATION_ID_INVALID' }
    });
    expect(reads).toBe(0);
  });
});
