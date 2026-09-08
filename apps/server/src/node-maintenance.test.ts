import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '@supermarket/driver-db';
import { migrateNodeDatabase, readNodeStorage } from './node-storage.ts';
import { runNodeStartupMaintenance } from './node-maintenance.ts';

describe('mantenimiento local del arranque', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('aplica retención y audita cada arranque con custodia de desarrollo', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cullen-maintenance-'));
    directories.push(root);
    const storage = readNodeStorage({ DATABASE_PATH: join(root, 'node.sqlite') });
    migrateNodeDatabase(storage);
    const handle = openDatabase(storage.databasePath);
    handle.sqlite.exec(`
      insert into identity_users (
        id, operator_code, display_name, is_active, authorization_version, created_at
      ) values ('user-001', 'OP001', 'Operador', 1, 1, 1);
      insert into auth_sessions (
        token_hash, user_id, origin_node_id, terminal_id, authorization_version,
        created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at
      ) values ('expired', 'user-001', 'node-001', 'terminal-001', 1, 1, 1, 2, 2, null);
      insert into identity_credential_enrollments (
        id, token_hash, operator_code, origin_node_id, terminal_id, authorized_by,
        reason, authorized_at, expires_at, consumed_at
      ) values ('enrollment', 'ticket', 'OP001', 'node-001', 'terminal-001',
        'user-001', 'test', 1, 2, null);
    `);
    handle.close();

    const options = {
      databasePath: storage.databasePath,
      nodeIdentity: { originNodeId: 'node-001', terminalId: 'terminal-001' },
      protection: 'UNPROTECTED_DEVELOPMENT' as const
    };
    await runNodeStartupMaintenance(options);
    await runNodeStartupMaintenance(options);

    const inspected = openDatabase(storage.databasePath);
    try {
      expect(inspected.sqlite.prepare('select count(*) from auth_sessions').pluck().get()).toBe(0);
      expect(inspected.sqlite.prepare(
        'select count(*) from identity_credential_enrollments'
      ).pluck().get()).toBe(0);
      expect(inspected.sqlite.prepare(`
        select action from audit_log order by occurred_at, action
      `).pluck().all()).toEqual([
        'IDENTITY_RETENTION_APPLIED',
        'SECURITY_UNPROTECTED_VAULT_USED',
        'SECURITY_UNPROTECTED_VAULT_USED'
      ]);
    } finally {
      inspected.close();
    }
  });
});
