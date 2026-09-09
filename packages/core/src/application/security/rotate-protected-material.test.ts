import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuditEntry,
  AuditWriter,
  ProtectionKeySummary,
  SecretVault,
  UnitOfWork
} from '../ports/index.js';
import { RotateProtectedMaterial } from './rotate-protected-material.js';

const context: ExecutionContext = {
  actorId: 'node-001',
  actorRoleCodes: [],
  terminalId: 'terminal-001',
  originNodeId: 'node-001',
  correlationId: 'rotation-001'
};

const key = (keyId: string, state: 'ACTIVE' | 'RETIRED'): ProtectionKeySummary => ({
  keyId,
  state,
  createdAt: new Date('2025-09-08T12:00:00.000Z'),
  retiredAt: state === 'RETIRED' ? new Date('2026-01-01T00:00:00.000Z') : null
});

describe('rotación del material protegido', () => {
  it('conserva claves referenciadas, olvida retiradas sin uso y deja evidencia', async () => {
    const entries: AuditEntry[] = [];
    const forgotten: string[] = [];
    const keys = [key('old-referenced', 'RETIRED'), key('old-unused', 'RETIRED')];
    const vault: SecretVault = {
      protection: 'UNPROTECTED_DEVELOPMENT',
      activeKey: async () => { throw new Error('not used'); },
      keyById: async () => null,
      list: async () => [...keys, key('new-active', 'ACTIVE')],
      rotate: async () => ({ keyId: 'new-active', retiredKeyId: 'previous-active' }),
      forget: async (keyId) => { forgotten.push(keyId); return true; }
    };
    const audit: AuditWriter = { append: async (appended) => { entries.push(...appended); } };
    const unitOfWork: UnitOfWork = { execute: (work) => work() };

    const result = await new RotateProtectedMaterial(
      vault, audit, unitOfWork, { generate: () => 'audit-rotation' },
      { now: () => new Date('2026-09-08T12:00:00.000Z') }
    ).execute({
      reason: 'Rotación anual programada.',
      referencedKeyIds: ['old-referenced', 'previous-active']
    }, context);

    expect(result).toEqual({ ok: true, value: {
      keyId: 'new-active',
      retiredKeyId: 'previous-active',
      forgottenKeyIds: ['old-unused']
    } });
    expect(forgotten).toEqual(['old-unused']);
    expect(entries).toMatchObject([{
      action: 'SECURITY_PROTECTION_KEY_ROTATED',
      actorId: 'node-001',
      terminalId: 'terminal-001',
      originNodeId: 'node-001',
      reason: 'Rotación anual programada.',
      after: {
        activeKeyId: 'new-active',
        retiredKeyId: 'previous-active',
        forgottenKeyIds: ['old-unused'],
        protection: 'UNPROTECTED_DEVELOPMENT'
      }
    }]);
  });

  it('no olvida ninguna clave cuando la evidencia no llega a confirmarse', async () => {
    const forgotten: string[] = [];
    const vault: SecretVault = {
      protection: 'OS_KEYSTORE',
      activeKey: async () => { throw new Error('not used'); },
      keyById: async () => null,
      list: async () => [key('old-unused', 'RETIRED'), key('new-active', 'ACTIVE')],
      rotate: async () => ({ keyId: 'new-active', retiredKeyId: 'old-unused' }),
      forget: async (keyId) => { forgotten.push(keyId); return true; }
    };
    /** La transacción que escribe la auditoría no confirma: nada que la respalde. */
    const unitOfWork: UnitOfWork = {
      execute: async () => { throw new Error('database is locked'); }
    };

    const rotation = new RotateProtectedMaterial(
      vault, { append: async () => undefined }, unitOfWork,
      { generate: () => 'audit-rotation' },
      { now: () => new Date('2026-09-08T12:00:00.000Z') }
    ).execute({ reason: 'Rotación con base indisponible.', referencedKeyIds: [] }, context);

    await expect(rotation).rejects.toThrowError('database is locked');
    /** Una clave retirada sin registro sería un respaldo irrecuperable. */
    expect(forgotten).toEqual([]);
  });

  it('rechaza un motivo vacío antes de tocar el almacén', async () => {
    let rotations = 0;
    const vault: SecretVault = {
      protection: 'OS_KEYSTORE',
      activeKey: async () => { throw new Error('not used'); },
      keyById: async () => null,
      list: async () => [],
      rotate: async () => { rotations += 1; return { keyId: 'new', retiredKeyId: null }; },
      forget: async () => false
    };

    const result = await new RotateProtectedMaterial(
      vault, { append: async () => undefined }, { execute: (work) => work() },
      { generate: () => 'unused' }, { now: () => new Date() }
    ).execute({ reason: ' ', referencedKeyIds: [] }, context);

    expect(result).toMatchObject({
      ok: false, error: { code: 'PROTECTION_ROTATION_REASON_REQUIRED' }
    });
    expect(rotations).toBe(0);
  });
});
