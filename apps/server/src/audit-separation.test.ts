import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DrizzleAuditWriter, openDatabase, SqliteUnitOfWork } from '@supermarket/driver-db';
import { migrateNodeDatabase, readNodeStorage } from './node-storage.ts';
import { buildApp } from './app.ts';

describe('separación entre diagnóstico y evidencia', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('conserva la auditoría append-only aunque el log técnico se descarte', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cullen-audit-separation-'));
    directories.push(root);
    const storage = readNodeStorage({ DATABASE_PATH: join(root, 'node.sqlite') });
    migrateNodeDatabase(storage);
    const database = openDatabase(storage.databasePath);
    await new SqliteUnitOfWork(database.sqlite).execute(() => new DrizzleAuditWriter(database).append([{
      auditId: 'audit-001',
      actorId: 'operator-001',
      actorRoleCodes: ['ADMIN'],
      action: 'SENSITIVE_OPERATION_RECORDED',
      entityType: 'Test',
      entityId: 'entity-001',
      before: null,
      after: null,
      reason: 'Prueba de separación.',
      terminalId: 'terminal-001',
      originNodeId: 'node-001',
      occurredAt: new Date('2026-09-08T12:00:00.000Z'),
      correlationId: 'correlation-001'
    }]));
    database.close();

    const lines: string[] = [];
    const app = buildApp(undefined, {
      logDestination: { write: (chunk) => { lines.push(chunk); } }
    });
    app.log.info({ correlationId: 'correlation-001' }, 'technical entry');
    await app.close();
    expect(lines.length).toBeGreaterThan(0);
    lines.splice(0);

    const reopened = openDatabase(storage.databasePath);
    try {
      expect(reopened.sqlite.prepare(
        'select action from audit_log where audit_id = ?'
      ).pluck().get('audit-001')).toBe('SENSITIVE_OPERATION_RECORDED');
      expect(() => reopened.sqlite.prepare('delete from audit_log').run())
        .toThrow(/append-only/);
    } finally {
      reopened.close();
    }
  });
});
