import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { SqliteIdentityAdministrationStore } from './identity-administration-store.js';
import { applyMigrations } from './migrations.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

describe('retención de identidad sobre SQLite', () => {
  let handle: DatabaseHandle | undefined;

  afterEach(() => {
    if (handle?.sqlite.open) handle.close();
    handle = undefined;
  });

  it('purga solo sesiones y tickets cuyo plazo terminó', async () => {
    handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    handle.sqlite.exec(`
      insert into identity_users (
        id, operator_code, display_name, is_active, authorization_version, created_at
      ) values ('user-001', 'OP001', 'Operador', 1, 1, 1);

      insert into auth_sessions (
        token_hash, user_id, origin_node_id, terminal_id, authorization_version,
        created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at
      ) values
        ('expired-old', 'user-001', 'node', 'terminal', 1, 1, 1, 10, 10, null),
        ('revoked-but-retained', 'user-001', 'node', 'terminal', 1, 1, 1, 300, 300, 5),
        ('active', 'user-001', 'node', 'terminal', 1, 1, 1, 300, 300, null);

      insert into identity_credential_enrollments (
        id, token_hash, operator_code, origin_node_id, terminal_id, authorized_by,
        reason, authorized_at, expires_at, consumed_at
      ) values
        ('enrollment-expired', 'ticket-expired', 'OP001', 'node', 'terminal',
          'user-001', 'test', 1, 10, null),
        ('enrollment-consumed', 'ticket-consumed', 'OP001', 'node', 'terminal',
          'user-001', 'test', 1, 300, 10),
        ('enrollment-pending', 'ticket-pending', 'OP001', 'node', 'terminal',
          'user-001', 'test', 1, 300, null);
    `);

    const store = new SqliteIdentityAdministrationStore(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const result = await unitOfWork.execute(async () => ({
      sessions: await store.purgeExpiredSessions(new Date(100)),
      enrollments: await store.purgeConsumedEnrollments(new Date(100))
    }));

    expect(result).toEqual({ sessions: 1, enrollments: 2 });
    expect(handle.sqlite.prepare('select token_hash from auth_sessions order by token_hash')
      .pluck().all()).toEqual(['active', 'revoked-but-retained']);
    expect(handle.sqlite.prepare(
      'select token_hash from identity_credential_enrollments order by token_hash'
    ).pluck().all()).toEqual(['ticket-pending']);
    expect(handle.sqlite.prepare('select count(*) from audit_log').pluck().get()).toBe(0);
  });
});
