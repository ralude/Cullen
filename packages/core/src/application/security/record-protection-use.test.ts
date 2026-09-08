import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '../execution-context.js';
import type { AuditEntry, AuditWriter, UnitOfWork } from '../ports/index.js';
import { RecordProtectionUse } from './record-protection-use.js';

const context: ExecutionContext = {
  actorId: 'node-001',
  actorRoleCodes: [],
  terminalId: 'terminal-001',
  originNodeId: 'node-001',
  correlationId: 'startup-protection-001'
};

describe('evidencia de custodia de claves', () => {
  const execute = async (protection: 'OS_KEYSTORE' | 'UNPROTECTED_DEVELOPMENT') => {
    const entries: AuditEntry[] = [];
    const audit: AuditWriter = { append: async (appended) => { entries.push(...appended); } };
    const unitOfWork: UnitOfWork = { execute: (work) => work() };
    const result = await new RecordProtectionUse(
      audit, unitOfWork, { generate: () => 'audit-001' },
      { now: () => new Date('2026-09-08T12:00:00.000Z') }
    ).execute(protection, context);
    return { result, entries };
  };

  it('audita cada uso de la excepción explícita de desarrollo', async () => {
    const { result, entries } = await execute('UNPROTECTED_DEVELOPMENT');

    expect(result).toEqual({ ok: true, value: { audited: true } });
    expect(entries).toMatchObject([{
      action: 'SECURITY_UNPROTECTED_VAULT_USED',
      actorId: 'node-001',
      terminalId: 'terminal-001',
      originNodeId: 'node-001',
      correlationId: 'startup-protection-001',
      after: { protection: 'UNPROTECTED_DEVELOPMENT' }
    }]);
  });

  it('no agrega ruido cuando la clave está custodiada por el sistema', async () => {
    const { result, entries } = await execute('OS_KEYSTORE');
    expect(result).toEqual({ ok: true, value: { audited: false } });
    expect(entries).toEqual([]);
  });
});
