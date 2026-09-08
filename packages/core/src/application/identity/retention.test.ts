import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuditEntry,
  AuditWriter,
  IdentityRetentionStore,
  UnitOfWork
} from '../ports/index.js';
import { ApplyIdentityRetention, IDENTITY_RETENTION_DAYS } from './retention.js';

const context: ExecutionContext = {
  actorId: 'node-001',
  actorRoleCodes: [],
  terminalId: 'terminal-001',
  originNodeId: 'node-001',
  correlationId: 'retention-001'
};

describe('retención de identidad', () => {
  it('purga al umbral normativo y audita únicamente un cambio efectivo', async () => {
    const thresholds: Date[] = [];
    const entries: AuditEntry[] = [];
    let transactions = 0;
    const store: IdentityRetentionStore = {
      purgeExpiredSessions: async (threshold) => { thresholds.push(threshold); return 2; },
      purgeConsumedEnrollments: async (threshold) => { thresholds.push(threshold); return 3; }
    };
    const unitOfWork: UnitOfWork = {
      execute: async (work) => { transactions += 1; return work(); }
    };
    const audit: AuditWriter = { append: async (appended) => { entries.push(...appended); } };
    const now = new Date('2026-09-08T12:00:00.000Z');

    const result = await new ApplyIdentityRetention(
      store, audit, unitOfWork, { generate: () => 'audit-001' }, { now: () => now }
    ).execute(context);

    expect(result).toEqual({ ok: true, value: { sessions: 2, enrollments: 3 } });
    expect(transactions).toBe(1);
    expect(thresholds).toEqual([
      new Date('2026-08-09T12:00:00.000Z'),
      new Date('2026-08-09T12:00:00.000Z')
    ]);
    expect(IDENTITY_RETENTION_DAYS).toBe(30);
    expect(entries).toMatchObject([{
      action: 'IDENTITY_RETENTION_APPLIED',
      actorId: 'node-001',
      terminalId: 'terminal-001',
      originNodeId: 'node-001',
      correlationId: 'retention-001',
      after: { sessions: 2, enrollments: 3, retentionDays: 30 }
    }]);
  });

  it('no escribe evidencia vacía cuando nada caducó', async () => {
    const entries: AuditEntry[] = [];
    const store: IdentityRetentionStore = {
      purgeExpiredSessions: async () => 0,
      purgeConsumedEnrollments: async () => 0
    };
    const audit: AuditWriter = { append: async (appended) => { entries.push(...appended); } };
    const unitOfWork: UnitOfWork = { execute: (work) => work() };

    await new ApplyIdentityRetention(
      store, audit, unitOfWork, { generate: () => 'unused' }, { now: () => new Date() }
    ).execute(context);

    expect(entries).toEqual([]);
  });
});
