import {
  AUTH_POLICY,
  permissionAlternatives,
  type AuthenticationCompletion,
  type AuthenticationRecord,
  type AuthenticationStore,
  type AuthorizationService,
  type Clock,
  type ExecutionContext,
  type OperatorGrantState,
  type RequiredPermission,
  type SessionPrincipal
} from '@supermarket/core';
import type { DatabaseHandle } from './connection.js';
import { findProjectedGrant, isGrantUsable } from './operator-grant.js';

type UserRow = {
  userId: string;
  operatorCode: string;
  displayName: string;
  pinHash: string;
  credentialVersion: number;
  authorizationVersion: number;
  isActive: number;
};

type SessionRow = {
  tokenHash: string;
  userId: string;
  displayName: string;
  originNodeId: string;
  terminalId: string;
  authorizationVersion: number;
  currentAuthorizationVersion: number;
  isActive: number;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
  revokedAt: number | null;
};

const inImmediateTransaction = <T>(handle: DatabaseHandle, work: () => T): T => {
  handle.sqlite.exec('begin immediate');
  try {
    const result = work();
    handle.sqlite.exec('commit');
    return result;
  } catch (error) {
    if (handle.sqlite.inTransaction) handle.sqlite.exec('rollback');
    throw error;
  }
};

const uniqueStrings = (values: unknown[]): string[] => [...new Set(values.map(String))];

export class SqliteAuthenticationStore implements AuthenticationStore {
  constructor(private readonly handle: DatabaseHandle) {}

  async findByOperatorCode(operatorCode: string): Promise<AuthenticationRecord | null> {
    const row = this.handle.sqlite.prepare(`
      select u.id as userId, u.operator_code as operatorCode,
        u.display_name as displayName, u.is_active as isActive,
        u.authorization_version as authorizationVersion,
        c.pin_hash as pinHash, c.version as credentialVersion
      from identity_users u
      join identity_credentials c on c.user_id = u.id
      where u.operator_code = ? collate nocase
    `).get(operatorCode) as UserRow | undefined;
    return row ? {
      userId: row.userId,
      operatorCode: row.operatorCode,
      displayName: row.displayName,
      pinHash: row.pinHash,
      credentialVersion: row.credentialVersion,
      authorizationVersion: row.authorizationVersion,
      isActive: row.isActive === 1
    } : null;
  }

  async completeAttempt(input: {
    readonly userId: string;
    readonly credentialVersion: number;
    readonly pinVerified: boolean;
    readonly tokenHash?: string;
    readonly terminalId: string;
    readonly originNodeId: string;
    readonly now: Date;
    readonly idleExpiresAt?: Date;
    readonly absoluteExpiresAt?: Date;
  }): Promise<AuthenticationCompletion> {
    return inImmediateTransaction(this.handle, () => {
      const now = input.now.getTime();
      const user = this.handle.sqlite.prepare(`
        select u.id as userId, u.is_active as isActive,
          u.authorization_version as authorizationVersion,
          c.version as credentialVersion
        from identity_users u join identity_credentials c on c.user_id = u.id
        where u.id = ?
      `).get(input.userId) as Pick<UserRow,
        'userId' | 'isActive' | 'authorizationVersion' | 'credentialVersion'> | undefined;
      if (!user || user.isActive !== 1 || user.credentialVersion !== input.credentialVersion) {
        return { authenticated: false };
      }

      const lockout = this.handle.sqlite.prepare(`
        select window_started_at as windowStartedAt, failed_count as failedCount,
          locked_until as lockedUntil
        from auth_lockouts where origin_node_id = ? and user_id = ?
      `).get(input.originNodeId, input.userId) as {
        windowStartedAt: number; failedCount: number; lockedUntil: number | null;
      } | undefined;
      if (lockout?.lockedUntil !== null && lockout?.lockedUntil !== undefined && lockout.lockedUntil > now) {
        return { authenticated: false };
      }

      if (!input.pinVerified) {
        const withinWindow = lockout !== undefined
          && now - lockout.windowStartedAt < AUTH_POLICY.FAILURE_WINDOW_MS;
        const failedCount = withinWindow ? lockout.failedCount + 1 : 1;
        const windowStartedAt = withinWindow ? lockout.windowStartedAt : now;
        const lockedUntil = failedCount >= AUTH_POLICY.MAX_FAILURES
          ? now + AUTH_POLICY.LOCKOUT_MS
          : null;
        this.handle.sqlite.prepare(`
          insert into auth_lockouts (
            origin_node_id, user_id, window_started_at, failed_count, locked_until
          ) values (?, ?, ?, ?, ?)
          on conflict (origin_node_id, user_id) do update set
            window_started_at = excluded.window_started_at,
            failed_count = excluded.failed_count,
            locked_until = excluded.locked_until
        `).run(input.originNodeId, input.userId, windowStartedAt, failedCount, lockedUntil);
        return { authenticated: false };
      }

      if (!input.tokenHash || !input.idleExpiresAt || !input.absoluteExpiresAt) {
        return { authenticated: false };
      }
      this.handle.sqlite.prepare(`
        insert into auth_lockouts (
          origin_node_id, user_id, window_started_at, failed_count, locked_until
        ) values (?, ?, ?, 0, null)
        on conflict (origin_node_id, user_id) do update set
          window_started_at = excluded.window_started_at,
          failed_count = 0,
          locked_until = null
      `).run(input.originNodeId, input.userId, now);
      this.handle.sqlite.prepare(`
        insert into auth_sessions (
          token_hash, user_id, origin_node_id, terminal_id, authorization_version,
          created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, null)
      `).run(
        input.tokenHash, input.userId, input.originNodeId, input.terminalId,
        user.authorizationVersion, now, now, input.idleExpiresAt.getTime(),
        input.absoluteExpiresAt.getTime()
      );
      return {
        authenticated: true,
        principal: this.loadPrincipal(
          input.userId,
          input.terminalId,
          input.originNodeId,
          input.idleExpiresAt.getTime(),
          input.absoluteExpiresAt.getTime(),
          now
        )
      };
    });
  }

  async verifyAndTouchSession(tokenHash: string, nowDate: Date): Promise<SessionPrincipal | null> {
    return inImmediateTransaction(this.handle, () => {
      const now = nowDate.getTime();
      const session = this.handle.sqlite.prepare(`
        select s.token_hash as tokenHash, s.user_id as userId,
          u.display_name as displayName, s.origin_node_id as originNodeId,
          s.terminal_id as terminalId, s.authorization_version as authorizationVersion,
          u.authorization_version as currentAuthorizationVersion,
          u.is_active as isActive, s.idle_expires_at as idleExpiresAt,
          s.absolute_expires_at as absoluteExpiresAt, s.revoked_at as revokedAt
        from auth_sessions s join identity_users u on u.id = s.user_id
        where s.token_hash = ?
      `).get(tokenHash) as SessionRow | undefined;
      if (!session) return null;
      /**
       * Una concesión vencida o revocada invalida la sesión existente, aunque
       * siga dentro de los límites idle y absoluto de ADR-0011: la vigencia de
       * la concesión se aplica además de ellos, no en su lugar.
       */
      const grant = this.grantForUser(session.userId, now);
      const invalid = session.revokedAt !== null
        || session.isActive !== 1
        || session.authorizationVersion !== session.currentAuthorizationVersion
        || (grant.governed && !grant.usable)
        || now >= session.idleExpiresAt
        || now >= session.absoluteExpiresAt;
      if (invalid) {
        if (session.revokedAt === null) {
          this.handle.sqlite.prepare(
            'update auth_sessions set revoked_at = ? where token_hash = ? and revoked_at is null'
          ).run(now, tokenHash);
        }
        return null;
      }
      const idleExpiresAt = Math.min(
        now + AUTH_POLICY.IDLE_SESSION_MS,
        session.absoluteExpiresAt
      );
      this.handle.sqlite.prepare(`
        update auth_sessions set last_seen_at = ?, idle_expires_at = ?
        where token_hash = ? and revoked_at is null
      `).run(now, idleExpiresAt, tokenHash);
      return this.loadPrincipal(
        session.userId,
        session.terminalId,
        session.originNodeId,
        idleExpiresAt,
        session.absoluteExpiresAt,
        now
      );
    });
  }

  /**
   * Concesión vigente de un operador. La identidad de unión es el código de
   * negocio: el `userId` que publica el coordinador no es el identificador
   * local de esta terminal.
   */
  async operatorGrantState(operatorCode: string, now: Date): Promise<OperatorGrantState> {
    return this.grantState(operatorCode, now.getTime());
  }

  private grantState(operatorCode: string, wallClock: number): OperatorGrantState {
    const grant = findProjectedGrant(this.handle.sqlite, operatorCode);
    if (grant === null) return { governed: false };
    return {
      governed: true,
      usable: isGrantUsable(this.handle.sqlite, grant, wallClock),
      roleCodes: JSON.parse(grant.roleCodes) as string[],
      permissionCodes: JSON.parse(grant.permissionCodes) as string[],
      expiresAt: new Date(grant.expiresAt)
    };
  }

  private grantForUser(userId: string, now: number): OperatorGrantState {
    const operatorCode = this.handle.sqlite
      .prepare('select operator_code from identity_users where id = ?')
      .pluck().get(userId) as string | undefined;
    return operatorCode === undefined
      ? { governed: false }
      : this.grantState(operatorCode, now);
  }

  async revokeSession(tokenHash: string, now: Date): Promise<void> {
    this.handle.sqlite.prepare(`
      update auth_sessions set revoked_at = ? where token_hash = ? and revoked_at is null
    `).run(now.getTime(), tokenHash);
  }

  async provisionInitialAdmin(input: {
    readonly userId: string;
    readonly roleId: string;
    readonly operatorCode: string;
    readonly displayName: string;
    readonly pinHash: string;
    readonly permissions: readonly string[];
    readonly now: Date;
  }): Promise<boolean> {
    return inImmediateTransaction(this.handle, () => {
      const count = this.handle.sqlite.prepare('select count(*) from identity_users').pluck().get();
      if (Number(count) > 0) return false;
      const now = input.now.getTime();
      this.handle.sqlite.prepare(`
        insert into identity_users (
          id, operator_code, display_name, is_active, authorization_version, created_at
        ) values (?, ?, ?, 1, 1, ?)
      `).run(input.userId, input.operatorCode, input.displayName, now);
      this.handle.sqlite.prepare(`
        insert into identity_credentials (user_id, pin_hash, version, updated_at)
        values (?, ?, 1, ?)
      `).run(input.userId, input.pinHash, now);
      this.handle.sqlite.prepare(`
        insert into identity_roles (id, code, name, is_active, is_assignable)
        values (?, 'ADMIN', 'Administrador', 1, 1)
      `).run(input.roleId);
      const insertPermission = this.handle.sqlite.prepare(`
        insert or ignore into identity_permissions (code, name, is_active) values (?, ?, 1)
      `);
      const assignPermission = this.handle.sqlite.prepare(`
        insert into identity_role_permissions (role_id, permission_code) values (?, ?)
      `);
      for (const permission of input.permissions) {
        insertPermission.run(permission, permission);
        assignPermission.run(input.roleId, permission);
      }
      this.handle.sqlite.prepare(
        'insert into identity_user_roles (user_id, role_id) values (?, ?)'
      ).run(input.userId, input.roleId);
      return true;
    });
  }

  /**
   * Autorización de una acción protegida. Cuando el coordinador emitió una
   * concesión para este operador, ella es la autoridad: vencida o revocada
   * deniega, y su conjunto de permisos sustituye al local.
   */
  hasPermission(userId: string, permission: string, now: Date = new Date()): boolean {
    const grant = this.grantForUser(userId, now.getTime());
    if (grant.governed) {
      return grant.usable && grant.permissionCodes.includes(permission);
    }
    const found = this.handle.sqlite.prepare(`
      select 1
      from identity_users u
      join identity_user_roles ur on ur.user_id = u.id
      join identity_roles r on r.id = ur.role_id
      join identity_role_permissions rp on rp.role_id = r.id
      join identity_permissions p on p.code = rp.permission_code
      where u.id = ? and p.code = ? and u.is_active = 1
        and r.is_active = 1 and p.is_active = 1
      limit 1
    `).get(userId, permission);
    return found !== undefined;
  }

  private loadPrincipal(
    userId: string,
    terminalId: string,
    originNodeId: string,
    idleExpiresAt: number,
    absoluteExpiresAt: number,
    now: number
  ): SessionPrincipal {
    const user = this.handle.sqlite.prepare(`
      select u.display_name as displayName, coalesce(c.must_change, 0) as mustChange
      from identity_users u left join identity_credentials c on c.user_id = u.id
      where u.id = ?
    `).get(userId) as { displayName: string; mustChange: number };
    /**
     * Con concesión vigente, el principal lleva los roles y permisos que
     * publicó el coordinador; la copia local no es la autoridad de ese
     * operador. Sin concesión, el nodo standalone conserva la suya.
     */
    const grant = this.grantForUser(userId, now);
    const roleCodes = grant.governed && grant.usable
      ? [...grant.roleCodes]
      : uniqueStrings(this.handle.sqlite.prepare(`
        select r.code from identity_user_roles ur
        join identity_roles r on r.id = ur.role_id
        where ur.user_id = ? and r.is_active = 1 order by r.code
      `).pluck().all(userId));
    const permissionCodes = grant.governed && grant.usable
      ? [...grant.permissionCodes]
      : uniqueStrings(this.handle.sqlite.prepare(`
        select p.code from identity_user_roles ur
        join identity_roles r on r.id = ur.role_id
        join identity_role_permissions rp on rp.role_id = r.id
        join identity_permissions p on p.code = rp.permission_code
        where ur.user_id = ? and r.is_active = 1 and p.is_active = 1 order by p.code
      `).pluck().all(userId));
    return {
      actorId: userId,
      displayName: user.displayName,
      roleCodes,
      permissionCodes,
      terminalId,
      originNodeId,
      idleExpiresAt: new Date(idleExpiresAt),
      absoluteExpiresAt: new Date(absoluteExpiresAt),
      credentialMustChange: user.mustChange === 1
    };
  }
}

export class SqliteAuthorizationService implements AuthorizationService {
  /**
   * El reloj es explícito para que la vigencia de una concesión sea probable
   * sin depender del tiempo de pared.
   */
  constructor(
    private readonly store: SqliteAuthenticationStore,
    private readonly clock: Clock = { now: () => new Date() }
  ) {}

  /** Cualquiera de las alternativas basta: es una decisión, no varias. */
  async authorize(context: ExecutionContext, permission: RequiredPermission): Promise<boolean> {
    const now = this.clock.now();
    return permissionAlternatives(permission)
      .some((code) => this.store.hasPermission(context.actorId, code, now));
  }
}

