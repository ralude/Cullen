import { afterEach, describe, expect, it } from 'vitest';
import {
  AssignOperatorRoles,
  AuthorizeCredentialEnrollment,
  ChangeOperatorStatus,
  ChangeOwnPin,
  ChangeRoleStatus,
  CompleteCredentialEnrollment,
  CreateOperator,
  CreateRole,
  ExpireOperatorCredential,
  GetIdentityDirectory,
  IdentityChangeTransaction,
  UpdateRolePermissions,
  type CoordinatorLink,
  type ExecutionContext,
  type PinHasher,
  type SessionTokenService
} from '@supermarket/core';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleAuditWriter } from './audit-writer.js';
import { SqliteAuthenticationStore, SqliteAuthorizationService } from './authentication-store.js';
import { SqliteIdentityAdministrationStore } from './identity-administration-store.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

const ADMIN_PERMISSIONS = [
  'identity.user.manage', 'identity.role.manage', 'identity.credential.reset', 'sale.void'
];

/** Hasher de prueba: conserva la forma del puerto sin el costo de scrypt. */
const pinHasher: PinHasher = {
  hash: async (pin) => `hashed:${pin}`,
  verify: async (pin, encoded) => encoded === `hashed:${pin}`,
  verifyDummy: async () => undefined
};

describe('identity administration over SQLite', () => {
  const handles: DatabaseHandle[] = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) if (handle.sqlite.open) handle.close();
  });

  const setup = (options: { readonly coordinatorNodeId?: string } = {}) => {
    const handle = openDatabase(':memory:');
    handles.push(handle);
    applyMigrations(handle.sqlite);

    const sequence = { value: 0 };
    const ids = { generate: () => `id-${String(++sequence.value).padStart(4, '0')}` };
    const time = { value: new Date('2026-09-08T12:00:00.000Z') };
    const clock = { now: () => time.value };
    /** El hash no contiene al token: la prueba de fuga sería trivial si lo hiciera. */
    const hashOf = (raw: string): string => `sha256:${[...raw].reverse().join('')}`;
    const tokens: SessionTokenService = {
      generate: () => {
        const raw = `token-${++sequence.value}`;
        return { raw, hash: hashOf(raw) };
      },
      hash: hashOf
    };
    const coordinator: CoordinatorLink = {
      coordinatorNodeId: options.coordinatorNodeId ?? null,
      isReachable: async () => true
    };

    const store = new SqliteIdentityAdministrationStore(handle);
    const authenticationStore = new SqliteAuthenticationStore(handle);
    const authorization = new SqliteAuthorizationService(authenticationStore, clock);
    const auditWriter = new DrizzleAuditWriter(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const changes = new IdentityChangeTransaction(
      store, auditWriter, unitOfWork, ids, clock, coordinator
    );

    /** Dos administradores efectivos: es el estado que el invariante protege. */
    unitOfWorkSeed(handle);

    return {
      handle,
      ids,
      time,
      store,
      unitOfWork,
      useCases: {
        createOperator: new CreateOperator(store, authorization, changes, ids, clock),
        assignRoles: new AssignOperatorRoles(store, authorization, changes),
        changeStatus: new ChangeOperatorStatus(store, authorization, changes),
        createRole: new CreateRole(store, authorization, changes, ids),
        updateRolePermissions: new UpdateRolePermissions(store, authorization, changes),
        changeRoleStatus: new ChangeRoleStatus(store, authorization, changes),
        directory: new GetIdentityDirectory(store, authorization, changes),
        authorizeEnrollment: new AuthorizeCredentialEnrollment(
          store, authorization, tokens, auditWriter, unitOfWork, ids, clock
        ),
        completeEnrollment: new CompleteCredentialEnrollment(
          store, pinHasher, tokens, auditWriter, unitOfWork, ids, clock
        ),
        expireCredential: new ExpireOperatorCredential(
          store, authorization, auditWriter, unitOfWork, ids, clock
        ),
        changeOwnPin: new ChangeOwnPin(store, pinHasher, auditWriter, unitOfWork, ids, clock)
      }
    };
  };

  const unitOfWorkSeed = (handle: DatabaseHandle): void => {
    handle.sqlite.exec(`
      insert into identity_roles (id, code, name, is_active, is_assignable)
      values ('role-admin', 'ADMIN', 'Administrador', 1, 1);
      insert or ignore into identity_permissions (code, name, is_active) values
        ${ADMIN_PERMISSIONS.map((code) => `('${code}', '${code}', 1)`).join(',')};
      insert into identity_role_permissions (role_id, permission_code)
        ${ADMIN_PERMISSIONS.map((code) => `select 'role-admin', '${code}'`).join(' union all ')};
      insert into identity_users (
        id, operator_code, display_name, is_active, authorization_version, created_at
      ) values
        ('user-a', 'OPA', 'Admin A', 1, 1, 1757332800000),
        ('user-b', 'OPB', 'Admin B', 1, 1, 1757332800000);
      insert into identity_credentials (user_id, pin_hash, version, updated_at, must_change)
      values ('user-a', 'hashed:111111', 1, 1757332800000, 0),
        ('user-b', 'hashed:222222', 1, 1757332800000, 0);
      insert into identity_user_roles (user_id, role_id)
      values ('user-a', 'role-admin'), ('user-b', 'role-admin');
    `);
  };

  const contextOf = (actorId: string): ExecutionContext => ({
    actorId,
    actorRoleCodes: ['ADMIN'],
    terminalId: 'terminal-001',
    originNodeId: 'node-001',
    correlationId: `correlation-${actorId}`
  });

  const versionOf = (handle: DatabaseHandle, userId: string): number =>
    handle.sqlite.prepare('select authorization_version from identity_users where id = ?')
      .pluck().get(userId) as number;

  const auditActions = (handle: DatabaseHandle): readonly string[] =>
    handle.sqlite.prepare('select action from audit_log order by audit_id').pluck()
      .all() as string[];

  it('creates an operator without any credential and audits the change', async () => {
    const { handle, useCases } = setup();

    const created = await useCases.createOperator.execute({
      operatorCode: 'op007', displayName: 'Cajero Nuevo', roleIds: [],
      reason: 'Alta de cajero'
    }, contextOf('user-a'));

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({
      operatorCode: 'OP007', displayName: 'Cajero Nuevo',
      isActive: true, hasLocalCredential: false, credentialMustChange: false
    });
    expect(handle.sqlite.prepare('select count(*) from identity_credentials').pluck().get()).toBe(2);
    expect(auditActions(handle)).toEqual(['IDENTITY_OPERATOR_CREATED']);
  });

  it('rejects a duplicated operator code without writing anything', async () => {
    const { handle, useCases } = setup();

    const duplicated = await useCases.createOperator.execute({
      operatorCode: 'opa', displayName: 'Otro', roleIds: [], reason: 'Alta duplicada'
    }, contextOf('user-a'));

    expect(duplicated.ok).toBe(false);
    if (duplicated.ok) return;
    expect(duplicated.error.code).toBe('IDENTITY_OPERATOR_CODE_TAKEN');
    expect(handle.sqlite.prepare('select count(*) from identity_users').pluck().get()).toBe(2);
    expect(auditActions(handle)).toEqual([]);
  });

  it('advances the authorization version of every operator a role change reaches', async () => {
    const { handle, useCases } = setup();
    const before = [versionOf(handle, 'user-a'), versionOf(handle, 'user-b')];

    const updated = await useCases.updateRolePermissions.execute({
      roleId: 'role-admin',
      permissionCodes: ['identity.user.manage', 'identity.role.manage', 'identity.credential.reset'],
      reason: 'Retiro de anulación de ventas'
    }, contextOf('user-a'));

    expect(updated.ok).toBe(true);
    expect([versionOf(handle, 'user-a'), versionOf(handle, 'user-b')])
      .toEqual([before[0]! + 1, before[1]! + 1]);
    expect(auditActions(handle)).toEqual(['IDENTITY_ROLE_PERMISSIONS_UPDATED']);
  });

  it('advances the version of the operator whose roles change, and not of the rest', async () => {
    const { handle, useCases } = setup();
    const roleCreated = await useCases.createRole.execute({
      code: 'SHIFT_LEAD', name: 'Jefe de turno', permissionCodes: ['sale.void'], reason: 'Rol operativo'
    }, contextOf('user-a'));
    expect(roleCreated.ok).toBe(true);
    if (!roleCreated.ok) return;
    const versionB = versionOf(handle, 'user-b');

    const assigned = await useCases.assignRoles.execute({
      userId: 'user-b', roleIds: ['role-admin', roleCreated.value.roleId], reason: 'Suma de rol'
    }, contextOf('user-a'));

    expect(assigned.ok).toBe(true);
    expect(versionOf(handle, 'user-b')).toBe(versionB + 1);
    expect(versionOf(handle, 'user-a')).toBe(1);
  });

  it.each([
    ['deactivating the last administrator', async (useCases: ReturnType<typeof setup>['useCases']) =>
      useCases.changeStatus.execute(
        { userId: 'user-b', isActive: false, reason: 'Baja' }, contextOf('user-b')
      )],
    ['removing the role that grants it', async (useCases: ReturnType<typeof setup>['useCases']) =>
      useCases.assignRoles.execute(
        { userId: 'user-b', roleIds: [], reason: 'Sin rol' }, contextOf('user-b')
      )],
    ['emptying the permissions of the role', async (useCases: ReturnType<typeof setup>['useCases']) =>
      useCases.updateRolePermissions.execute(
        { roleId: 'role-admin', permissionCodes: ['sale.void'], reason: 'Sin identidad' },
        contextOf('user-b')
      )],
    ['deactivating the role', async (useCases: ReturnType<typeof setup>['useCases']) =>
      useCases.changeRoleStatus.execute(
        { roleId: 'role-admin', isActive: false, reason: 'Rol fuera de uso' }, contextOf('user-b')
      )]
  ])('refuses to leave the system without an administrator by %s', async (_label, act) => {
    const { handle, useCases } = setup();
    /** Un solo administrador efectivo: cualquiera de los caminos lo dejaría en cero. */
    const removed = await useCases.assignRoles.execute(
      { userId: 'user-a', roleIds: [], reason: 'Solo queda B' }, contextOf('user-a')
    );
    expect(removed.ok).toBe(true);
    const versionBefore = versionOf(handle, 'user-b');

    const rejected = await act(useCases);

    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.code).toBe('IDENTITY_LAST_ADMINISTRATOR');
    /** La transacción revirtió entera: ni el efecto ni su versión quedaron. */
    expect(versionOf(handle, 'user-b')).toBe(versionBefore);
    expect(handle.sqlite.prepare(
      "select is_active from identity_users where id = 'user-b'"
    ).pluck().get()).toBe(1);
    expect(handle.sqlite.prepare(
      "select is_active from identity_roles where id = 'role-admin'"
    ).pluck().get()).toBe(1);
    expect(auditActions(handle)).toContain('IDENTITY_OPERATOR_ROLES_ASSIGNED');
    expect(auditActions(handle).some((action) => action.endsWith('_REJECTED'))).toBe(true);
  });

  it('lets exactly one of two competing administrators commit', async () => {
    const { handle, useCases } = setup();

    /**
     * A y B se retiran la capacidad administrativa a la vez. El invariante se
     * evalúa dentro de la transacción que ya escribió, así que la segunda
     * operación —la que llega con una precondición vencida— no puede
     * confirmarse.
     */
    const outcomes = await Promise.allSettled([
      useCases.changeStatus.execute(
        { userId: 'user-b', isActive: false, reason: 'A retira a B' }, contextOf('user-a')
      ),
      useCases.changeStatus.execute(
        { userId: 'user-a', isActive: false, reason: 'B retira a A' }, contextOf('user-b')
      )
    ]);

    const committed = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled' && outcome.value.ok
    );
    expect(committed).toHaveLength(1);
    expect(await new SqliteIdentityAdministrationStore(handle)
      .hasActiveAdministrator('identity.user.manage')).toBe(true);
    expect(handle.sqlite.prepare(
      'select count(*) from identity_users where is_active = 1'
    ).pluck().get()).toBe(1);
  });

  it('refuses identity administration on a node that does not own it', async () => {
    const { handle, useCases } = setup({ coordinatorNodeId: 'coordinator-001' });

    const rejected = await useCases.createOperator.execute({
      operatorCode: 'OP009', displayName: 'Cajero', roleIds: [], reason: 'Alta en terminal'
    }, contextOf('user-a'));

    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.code).toBe('IDENTITY_NOT_OWNED_BY_NODE');
    expect(handle.sqlite.prepare('select count(*) from identity_users').pluck().get()).toBe(2);
    expect(auditActions(handle)).toEqual([]);
  });

  it('denies an actor without the identity permission and keeps the state', async () => {
    const { handle, useCases } = setup();
    handle.sqlite.exec(`
      insert into identity_users (
        id, operator_code, display_name, is_active, authorization_version, created_at
      ) values ('user-c', 'OPC', 'Cajero', 1, 1, 1757332800000);
    `);

    const denied = await useCases.createOperator.execute({
      operatorCode: 'OP010', displayName: 'Cajero', roleIds: [], reason: 'Alta sin permiso'
    }, contextOf('user-c'));

    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error.code).toBe('FORBIDDEN');
    expect(handle.sqlite.prepare('select count(*) from identity_users').pluck().get()).toBe(3);
  });

  const seedGrant = (handle: DatabaseHandle, expiresAt: Date): void => {
    handle.sqlite.prepare(`
      insert into identity_operator_grant (
        user_id, operator_code, display_name, role_codes, permission_codes,
        is_active, version, expires_at, published_by, published_at, applied_at
      ) values ('coordinator-user', 'OPG', 'Cajera de Sucursal', '["CASHIER"]', '["sale.void"]',
        1, 1, ?, 'coordinator-001', ?, ?)
    `).run(expiresAt.getTime(), 1757332800000, 1757332800000);
  };

  it('enrolls a credential for an operator that only exists as a grant', async () => {
    const { handle, useCases, time } = setup({ coordinatorNodeId: 'coordinator-001' });
    seedGrant(handle, new Date('2026-09-08T20:00:00.000Z'));

    const authorized = await useCases.authorizeEnrollment.execute(
      { operatorCode: 'opg', reason: 'Primer ingreso en esta caja' }, contextOf('user-a')
    );
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;
    expect(authorized.value).toMatchObject({ operatorCode: 'OPG', replacesCredential: false });

    const completed = await useCases.completeEnrollment.execute(
      { enrollmentToken: authorized.value.enrollmentToken, pin: '654321' },
      { terminalId: 'terminal-001', originNodeId: 'node-001', correlationId: 'correlation-enroll' }
    );

    expect(completed.ok).toBe(true);
    const enrolled = handle.sqlite.prepare(`
      select u.id as userId, u.is_active as isActive, c.pin_hash as pinHash
      from identity_users u join identity_credentials c on c.user_id = u.id
      where u.operator_code = 'OPG'
    `).get();
    expect(enrolled).toMatchObject({ isActive: 1, pinHash: 'hashed:654321' });
    /** La identidad local nace sin roles: la concesión sigue siendo la autoridad. */
    expect(handle.sqlite.prepare(
      "select count(*) from identity_user_roles where user_id = (select id from identity_users where operator_code = 'OPG')"
    ).pluck().get()).toBe(0);
    expect(auditActions(handle)).toEqual([
      'IDENTITY_CREDENTIAL_ENROLLMENT_AUTHORIZED', 'IDENTITY_CREDENTIAL_ENROLLED'
    ]);
    expect(time.value.toISOString()).toBe('2026-09-08T12:00:00.000Z');
  });

  it('stops enrolling once the grant is revoked, also after the first enrollment', async () => {
    const { handle, useCases } = setup({ coordinatorNodeId: 'coordinator-001' });
    seedGrant(handle, new Date('2026-09-08T20:00:00.000Z'));
    const first = await useCases.authorizeEnrollment.execute(
      { operatorCode: 'OPG', reason: 'Primer ingreso en esta caja' }, contextOf('user-a')
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect((await useCases.completeEnrollment.execute(
      { enrollmentToken: first.value.enrollmentToken, pin: '654321' },
      { terminalId: 'terminal-001', originNodeId: 'node-001', correlationId: 'correlation-first' }
    )).ok).toBe(true);

    /** Ticket emitido mientras la concesión todavía servía. */
    const pending = await useCases.authorizeEnrollment.execute(
      { operatorCode: 'OPG', reason: 'PIN olvidado' }, contextOf('user-a')
    );
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    handle.sqlite.prepare(
      "update identity_operator_grant set is_active = 0 where operator_code = 'OPG'"
    ).run();

    const revoked = await useCases.completeEnrollment.execute(
      { enrollmentToken: pending.value.enrollmentToken, pin: '999999' },
      { terminalId: 'terminal-001', originNodeId: 'node-001', correlationId: 'correlation-revoked' }
    );
    const reissued = await useCases.authorizeEnrollment.execute(
      { operatorCode: 'OPG', reason: 'Otro intento' }, contextOf('user-a')
    );

    expect(revoked.ok).toBe(false);
    expect(reissued.ok).toBe(false);
    if (revoked.ok || reissued.ok) return;
    /** La identidad local ya existe, pero la concesión revocada manda igual. */
    expect(revoked.error.code).toBe('IDENTITY_OPERATOR_NOT_FOUND');
    expect(reissued.error.code).toBe('IDENTITY_OPERATOR_NOT_FOUND');
    expect(handle.sqlite.prepare(`
      select pin_hash from identity_credentials
      where user_id = (select id from identity_users where operator_code = 'OPG')
    `).pluck().get()).toBe('hashed:654321');
  });

  it('refuses a replayed enrollment ticket', async () => {
    const { handle, useCases } = setup();
    const authorized = await useCases.authorizeEnrollment.execute(
      { operatorCode: 'OPB', reason: 'PIN olvidado' }, contextOf('user-a')
    );
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;
    const consume = () => useCases.completeEnrollment.execute(
      { enrollmentToken: authorized.value.enrollmentToken, pin: '777777' },
      { terminalId: 'terminal-001', originNodeId: 'node-001', correlationId: 'correlation-replay' }
    );

    expect((await consume()).ok).toBe(true);
    const replayed = await consume();

    expect(replayed.ok).toBe(false);
    if (replayed.ok) return;
    expect(replayed.error.code).toBe('IDENTITY_ENROLLMENT_CONSUMED');
    expect(handle.sqlite.prepare(
      "select pin_hash from identity_credentials where user_id = 'user-b'"
    ).pluck().get()).toBe('hashed:777777');
  });

  it('refuses an expired enrollment ticket', async () => {
    const { useCases, time } = setup();
    const authorized = await useCases.authorizeEnrollment.execute(
      { operatorCode: 'OPB', reason: 'PIN olvidado' }, contextOf('user-a')
    );
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;
    time.value = new Date('2026-09-08T12:16:00.000Z');

    const late = await useCases.completeEnrollment.execute(
      { enrollmentToken: authorized.value.enrollmentToken, pin: '777777' },
      { terminalId: 'terminal-001', originNodeId: 'node-001', correlationId: 'correlation-late' }
    );

    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.error.code).toBe('IDENTITY_ENROLLMENT_EXPIRED');
  });

  it('refuses a ticket presented on another node or terminal', async () => {
    const { useCases } = setup();
    const authorized = await useCases.authorizeEnrollment.execute(
      { operatorCode: 'OPB', reason: 'PIN olvidado' }, contextOf('user-a')
    );
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;

    const elsewhere = await useCases.completeEnrollment.execute(
      { enrollmentToken: authorized.value.enrollmentToken, pin: '777777' },
      { terminalId: 'terminal-999', originNodeId: 'node-001', correlationId: 'correlation-other' }
    );

    expect(elsewhere.ok).toBe(false);
    if (elsewhere.ok) return;
    expect(elsewhere.error.code).toBe('IDENTITY_ENROLLMENT_NODE_MISMATCH');
  });

  it('refuses an unknown ticket and an operator without local identity or usable grant', async () => {
    const { handle, useCases } = setup();
    seedGrant(handle, new Date('2026-09-08T11:00:00.000Z'));

    const unknownTicket = await useCases.completeEnrollment.execute(
      { enrollmentToken: 'raw-forged', pin: '777777' },
      { terminalId: 'terminal-001', originNodeId: 'node-001', correlationId: 'correlation-forged' }
    );
    const expiredGrant = await useCases.authorizeEnrollment.execute(
      { operatorCode: 'OPG', reason: 'Concesión vencida' }, contextOf('user-a')
    );
    const unknownOperator = await useCases.authorizeEnrollment.execute(
      { operatorCode: 'NOBODY', reason: 'Operador inexistente' }, contextOf('user-a')
    );

    expect(unknownTicket.ok).toBe(false);
    expect(expiredGrant.ok).toBe(false);
    expect(unknownOperator.ok).toBe(false);
    if (unknownTicket.ok || expiredGrant.ok || unknownOperator.ok) return;
    expect(unknownTicket.error.code).toBe('IDENTITY_ENROLLMENT_NOT_FOUND');
    /** Vencida e inexistente comparten respuesta: no se filtra qué existe. */
    expect(expiredGrant.error.code).toBe('IDENTITY_OPERATOR_NOT_FOUND');
    expect(unknownOperator.error.code).toBe('IDENTITY_OPERATOR_NOT_FOUND');
  });

  it('keeps the PIN and the ticket out of the durable evidence', async () => {
    const { handle, useCases } = setup();
    const authorized = await useCases.authorizeEnrollment.execute(
      { operatorCode: 'OPB', reason: 'PIN olvidado' }, contextOf('user-a')
    );
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;
    await useCases.completeEnrollment.execute(
      { enrollmentToken: authorized.value.enrollmentToken, pin: '424242' },
      { terminalId: 'terminal-001', originNodeId: 'node-001', correlationId: 'correlation-secret' }
    );

    const audit = JSON.stringify(handle.sqlite.prepare('select * from audit_log').all());
    const enrollments = JSON.stringify(
      handle.sqlite.prepare('select * from identity_credential_enrollments').all()
    );
    for (const secret of ['424242', authorized.value.enrollmentToken, 'hashed:424242']) {
      expect(audit, secret).not.toContain(secret);
      expect(enrollments, secret).not.toContain(secret);
    }
  });

  it('expires a credential and restricts the session until the operator changes the PIN', async () => {
    const { handle, useCases } = setup();
    const versionBefore = versionOf(handle, 'user-b');

    const expired = await useCases.expireCredential.execute(
      { userId: 'user-b', reason: 'Rotación de credencial' }, contextOf('user-a')
    );

    expect(expired.ok).toBe(true);
    expect(handle.sqlite.prepare(
      "select must_change from identity_credentials where user_id = 'user-b'"
    ).pluck().get()).toBe(1);
    /** El cambio de autorización revoca las sesiones vivas del operador. */
    expect(versionOf(handle, 'user-b')).toBe(versionBefore + 1);

    const changed = await useCases.changeOwnPin.execute(
      { currentPin: '222222', newPin: '999999' }, contextOf('user-b')
    );

    expect(changed.ok).toBe(true);
    expect(handle.sqlite.prepare(
      "select must_change, pin_hash from identity_credentials where user_id = 'user-b'"
    ).get()).toEqual({ must_change: 0, pin_hash: 'hashed:999999' });
    /** Cambiar el PIN propio no expulsa al operador de su propia sesión. */
    expect(versionOf(handle, 'user-b')).toBe(versionBefore + 1);
  });

  it('refuses a PIN change with the wrong current PIN or a PIN outside the policy', async () => {
    const { handle, useCases } = setup();

    const wrong = await useCases.changeOwnPin.execute(
      { currentPin: '000000', newPin: '999999' }, contextOf('user-b')
    );
    const weak = await useCases.changeOwnPin.execute(
      { currentPin: '222222', newPin: '12' }, contextOf('user-b')
    );

    expect(wrong.ok).toBe(false);
    expect(weak.ok).toBe(false);
    if (wrong.ok || weak.ok) return;
    expect(wrong.error.code).toBe('AUTHENTICATION_FAILED');
    expect(weak.error.code).toBe('AUTH_PIN_POLICY_VIOLATION');
    expect(handle.sqlite.prepare(
      "select pin_hash from identity_credentials where user_id = 'user-b'"
    ).pluck().get()).toBe('hashed:222222');
  });

  it('publishes the directory with the operators that still lack a local credential', async () => {
    const { handle, useCases } = setup();
    seedGrant(handle, new Date('2026-09-08T20:00:00.000Z'));
    await useCases.createOperator.execute(
      { operatorCode: 'OP020', displayName: 'Sin credencial', roleIds: [], reason: 'Alta' },
      contextOf('user-a')
    );

    const directory = await useCases.directory.execute(contextOf('user-a'));

    expect(directory.ok).toBe(true);
    if (!directory.ok) return;
    expect(directory.value.operators.find((operator) => operator.operatorCode === 'OP020'))
      .toMatchObject({ hasLocalCredential: false, isActive: true });
    expect(directory.value.roles.map((role) => role.code)).toContain('ADMIN');
    expect(directory.value.permissionCodes).toContain('identity.user.manage');
  });
});
