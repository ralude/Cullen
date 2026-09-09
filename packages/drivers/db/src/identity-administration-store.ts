import type {
  CredentialEnrollmentStore,
  EnrollableOperator,
  EnrollmentConsumption,
  IdentityAdministrationStore,
  IdentityOperatorSummary,
  IdentityRetentionStore,
  IdentityRoleSummary,
  IdentityWriteOutcome
} from '@supermarket/core';
import type { DatabaseHandle } from './connection.js';
import { findProjectedGrant, isGrantUsable } from './operator-grant.js';
import { mapDatabaseError, requireTransaction } from './unit-of-work.js';

type OperatorRow = {
  userId: string;
  operatorCode: string;
  displayName: string;
  isActive: number;
  authorizationVersion: number;
  hasCredential: number;
  mustChange: number;
};

type RoleRow = {
  roleId: string;
  code: string;
  name: string;
  isActive: number;
  isAssignable: number;
  memberCount: number;
};

const applied = (affectedUserIds: readonly string[]): IdentityWriteOutcome =>
  ({ status: 'APPLIED', affectedUserIds });

/**
 * Persistencia de la administración de identidad.
 *
 * Cada escritura exige la transacción del caso de uso y avanza dentro de ella
 * la versión de autorización de todo operador cuya autorización efectiva pueda
 * cambiar: el operador editado, o todos los portadores del rol tocado. No
 * decide permisos ni reglas de negocio; el invariante de último administrador
 * lo evalúa el caso de uso llamando a `hasActiveAdministrator` después de
 * escribir y antes de confirmar.
 */
export class SqliteIdentityAdministrationStore
implements IdentityAdministrationStore, CredentialEnrollmentStore, IdentityRetentionStore {
  constructor(private readonly handle: DatabaseHandle) {}

  async listOperators(): Promise<readonly IdentityOperatorSummary[]> {
    const rows = this.handle.sqlite.prepare(`
      select u.id as userId, u.operator_code as operatorCode, u.display_name as displayName,
        u.is_active as isActive, u.authorization_version as authorizationVersion,
        case when c.user_id is null then 0 else 1 end as hasCredential,
        coalesce(c.must_change, 0) as mustChange
      from identity_users u
      left join identity_credentials c on c.user_id = u.id
      order by u.operator_code
    `).all() as OperatorRow[];
    return rows.map((row) => this.operatorFrom(row));
  }

  async findOperator(userId: string): Promise<IdentityOperatorSummary | null> {
    const row = this.handle.sqlite.prepare(`
      select u.id as userId, u.operator_code as operatorCode, u.display_name as displayName,
        u.is_active as isActive, u.authorization_version as authorizationVersion,
        case when c.user_id is null then 0 else 1 end as hasCredential,
        coalesce(c.must_change, 0) as mustChange
      from identity_users u
      left join identity_credentials c on c.user_id = u.id
      where u.id = ?
    `).get(userId) as OperatorRow | undefined;
    return row === undefined ? null : this.operatorFrom(row);
  }

  async listRoles(): Promise<readonly IdentityRoleSummary[]> {
    const rows = this.handle.sqlite.prepare(`
      select r.id as roleId, r.code as code, r.name as name, r.is_active as isActive,
        r.is_assignable as isAssignable,
        (select count(*) from identity_user_roles ur where ur.role_id = r.id) as memberCount
      from identity_roles r order by r.code
    `).all() as RoleRow[];
    return rows.map((row) => this.roleFrom(row));
  }

  async findRole(roleId: string): Promise<IdentityRoleSummary | null> {
    const row = this.handle.sqlite.prepare(`
      select r.id as roleId, r.code as code, r.name as name, r.is_active as isActive,
        r.is_assignable as isAssignable,
        (select count(*) from identity_user_roles ur where ur.role_id = r.id) as memberCount
      from identity_roles r where r.id = ?
    `).get(roleId) as RoleRow | undefined;
    return row === undefined ? null : this.roleFrom(row);
  }

  async listPermissionCodes(): Promise<readonly string[]> {
    return this.handle.sqlite.prepare(
      'select code from identity_permissions where is_active = 1 order by code'
    ).pluck().all() as string[];
  }

  async createOperator(input: {
    readonly userId: string;
    readonly operatorCode: string;
    readonly displayName: string;
    readonly roleIds: readonly string[];
    readonly now: Date;
  }): Promise<IdentityWriteOutcome> {
    requireTransaction(this.handle.sqlite);
    try {
      if (this.operatorCodeTaken(input.operatorCode)) return { status: 'OPERATOR_CODE_TAKEN' };
      const unassignable = this.unassignableRole(input.roleIds);
      if (unassignable !== null) return unassignable;
      this.handle.sqlite.prepare(`
        insert into identity_users (
          id, operator_code, display_name, is_active, authorization_version, created_at
        ) values (?, ?, ?, 1, 1, ?)
      `).run(input.userId, input.operatorCode, input.displayName, input.now.getTime());
      this.assignRoles(input.userId, input.roleIds);
      return applied([input.userId]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async updateOperator(input: {
    readonly userId: string;
    readonly displayName: string;
  }): Promise<IdentityWriteOutcome> {
    requireTransaction(this.handle.sqlite);
    try {
      const changes = this.handle.sqlite.prepare(
        'update identity_users set display_name = ? where id = ?'
      ).run(input.displayName, input.userId).changes;
      /** El nombre visible no cambia autorización: nadie avanza de versión. */
      return changes === 1 ? applied([]) : { status: 'OPERATOR_NOT_FOUND' };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async changeOperatorStatus(input: {
    readonly userId: string;
    readonly isActive: boolean;
  }): Promise<IdentityWriteOutcome> {
    requireTransaction(this.handle.sqlite);
    try {
      const changes = this.handle.sqlite.prepare(`
        update identity_users
        set is_active = ?, authorization_version = authorization_version + 1
        where id = ?
      `).run(input.isActive ? 1 : 0, input.userId).changes;
      return changes === 1 ? applied([input.userId]) : { status: 'OPERATOR_NOT_FOUND' };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async assignOperatorRoles(input: {
    readonly userId: string;
    readonly roleIds: readonly string[];
  }): Promise<IdentityWriteOutcome> {
    requireTransaction(this.handle.sqlite);
    try {
      const exists = this.handle.sqlite
        .prepare('select 1 from identity_users where id = ?').get(input.userId);
      if (exists === undefined) return { status: 'OPERATOR_NOT_FOUND' };
      const unassignable = this.unassignableRole(input.roleIds);
      if (unassignable !== null) return unassignable;
      this.handle.sqlite.prepare('delete from identity_user_roles where user_id = ?')
        .run(input.userId);
      this.assignRoles(input.userId, input.roleIds);
      this.bumpAuthorization([input.userId]);
      return applied([input.userId]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async createRole(input: {
    readonly roleId: string;
    readonly code: string;
    readonly name: string;
    readonly permissionCodes: readonly string[];
  }): Promise<IdentityWriteOutcome> {
    requireTransaction(this.handle.sqlite);
    try {
      const taken = this.handle.sqlite
        .prepare('select 1 from identity_roles where code = ?').get(input.code);
      if (taken !== undefined) return { status: 'ROLE_CODE_TAKEN' };
      const unknown = this.unknownPermission(input.permissionCodes);
      if (unknown !== null) return unknown;
      this.handle.sqlite.prepare(`
        insert into identity_roles (id, code, name, is_active, is_assignable)
        values (?, ?, ?, 1, 1)
      `).run(input.roleId, input.code, input.name);
      this.assignPermissions(input.roleId, input.permissionCodes);
      /** Un rol nuevo nace sin portadores: nadie cambia de autorización. */
      return applied([]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async updateRolePermissions(input: {
    readonly roleId: string;
    readonly permissionCodes: readonly string[];
  }): Promise<IdentityWriteOutcome> {
    requireTransaction(this.handle.sqlite);
    try {
      const exists = this.handle.sqlite
        .prepare('select 1 from identity_roles where id = ?').get(input.roleId);
      if (exists === undefined) return { status: 'ROLE_NOT_FOUND' };
      const unknown = this.unknownPermission(input.permissionCodes);
      if (unknown !== null) return unknown;
      const bearers = this.roleBearers(input.roleId);
      this.handle.sqlite.prepare('delete from identity_role_permissions where role_id = ?')
        .run(input.roleId);
      this.assignPermissions(input.roleId, input.permissionCodes);
      this.bumpAuthorization(bearers);
      return applied(bearers);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async changeRoleStatus(input: {
    readonly roleId: string;
    readonly isActive: boolean;
  }): Promise<IdentityWriteOutcome> {
    requireTransaction(this.handle.sqlite);
    try {
      const bearers = this.roleBearers(input.roleId);
      const changes = this.handle.sqlite
        .prepare('update identity_roles set is_active = ? where id = ?')
        .run(input.isActive ? 1 : 0, input.roleId).changes;
      if (changes !== 1) return { status: 'ROLE_NOT_FOUND' };
      this.bumpAuthorization(bearers);
      return applied(bearers);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  /**
   * Queda al menos un operador activo cuyos permisos efectivos incluyen el
   * permiso administrativo. Es la postcondición del invariante y se consulta
   * dentro de la transacción que acaba de escribir.
   */
  async hasActiveAdministrator(permissionCode: string): Promise<boolean> {
    const found = this.handle.sqlite.prepare(`
      select 1
      from identity_users u
      join identity_user_roles ur on ur.user_id = u.id
      join identity_roles r on r.id = ur.role_id
      join identity_role_permissions rp on rp.role_id = r.id
      join identity_permissions p on p.code = rp.permission_code
      where u.is_active = 1 and r.is_active = 1 and p.is_active = 1 and p.code = ?
      limit 1
    `).get(permissionCode);
    return found !== undefined;
  }

  /**
   * Operador al que esta terminal puede materializarle una credencial local.
   *
   * La concesión del coordinador es la autoridad sobre quién es el operador y
   * gobierna mientras exista, también después del primer enrolamiento: el
   * enrolamiento crea identidad local, no independencia. Una concesión vencida
   * o revocada deja de habilitar el enrolamiento aunque ya haya fila local, que
   * es como ADR-0028 D9 invalida por efecto los tickets pendientes y cualquier
   * restablecimiento posterior. Sin concesión —nodo standalone o coordinador,
   * ADR-0028 D7— manda la identidad local.
   */
  async enrollableOperator(operatorCode: string, now: Date): Promise<EnrollableOperator | null> {
    const grant = findProjectedGrant(this.handle.sqlite, operatorCode);
    if (grant !== null && !isGrantUsable(this.handle.sqlite, grant, now.getTime())) return null;

    const local = this.handle.sqlite.prepare(`
      select u.id as userId, u.operator_code as operatorCode, u.display_name as displayName,
        u.is_active as isActive,
        case when c.user_id is null then 0 else 1 end as hasCredential
      from identity_users u
      left join identity_credentials c on c.user_id = u.id
      where u.operator_code = ? collate nocase
    `).get(operatorCode) as (Omit<OperatorRow, 'authorizationVersion' | 'mustChange'>) | undefined;
    if (local !== undefined) {
      return local.isActive === 1
        ? {
          operatorCode: local.operatorCode,
          displayName: local.displayName,
          userId: local.userId,
          hasLocalCredential: local.hasCredential === 1
        }
        : null;
    }
    if (grant === null) return null;
    return {
      operatorCode: grant.operatorCode,
      displayName: grant.displayName,
      userId: null,
      hasLocalCredential: false
    };
  }

  async authorizeEnrollment(input: {
    readonly enrollmentId: string;
    readonly tokenHash: string;
    readonly operatorCode: string;
    readonly originNodeId: string;
    readonly terminalId: string;
    readonly authorizedBy: string;
    readonly reason: string;
    readonly authorizedAt: Date;
    readonly expiresAt: Date;
  }): Promise<void> {
    requireTransaction(this.handle.sqlite);
    try {
      /** Reemitir invalida lo pendiente: nunca hay dos tickets vivos. */
      this.handle.sqlite.prepare(`
        update identity_credential_enrollments set consumed_at = ?
        where operator_code = ? collate nocase and consumed_at is null
      `).run(input.authorizedAt.getTime(), input.operatorCode);
      this.handle.sqlite.prepare(`
        insert into identity_credential_enrollments (
          id, token_hash, operator_code, origin_node_id, terminal_id,
          authorized_by, reason, authorized_at, expires_at, consumed_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, null)
      `).run(
        input.enrollmentId, input.tokenHash, input.operatorCode, input.originNodeId,
        input.terminalId, input.authorizedBy, input.reason,
        input.authorizedAt.getTime(), input.expiresAt.getTime()
      );
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async consumeEnrollment(input: {
    readonly tokenHash: string;
    readonly pinHash: string;
    readonly originNodeId: string;
    readonly terminalId: string;
    readonly newUserId: string;
    readonly now: Date;
  }): Promise<EnrollmentConsumption> {
    requireTransaction(this.handle.sqlite);
    try {
      const ticket = this.handle.sqlite.prepare(`
        select id, operator_code as operatorCode, origin_node_id as originNodeId,
          terminal_id as terminalId, authorized_by as authorizedBy,
          expires_at as expiresAt, consumed_at as consumedAt
        from identity_credential_enrollments where token_hash = ?
      `).get(input.tokenHash) as {
        id: string; operatorCode: string; originNodeId: string; terminalId: string;
        authorizedBy: string; expiresAt: number; consumedAt: number | null;
      } | undefined;
      if (ticket === undefined) return { status: 'NOT_FOUND' };
      const identified = { authorizedBy: ticket.authorizedBy, operatorCode: ticket.operatorCode };
      if (ticket.consumedAt !== null) return { status: 'CONSUMED', ...identified };
      if (ticket.originNodeId !== input.originNodeId || ticket.terminalId !== input.terminalId) {
        return { status: 'NODE_MISMATCH', ...identified };
      }
      if (input.now.getTime() >= ticket.expiresAt) return { status: 'EXPIRED', ...identified };

      const operator = await this.enrollableOperator(ticket.operatorCode, input.now);
      if (operator === null) return { status: 'OPERATOR_NOT_ENROLLABLE', ...identified };

      const userId = operator.userId ?? input.newUserId;
      const createdLocalOperator = operator.userId === null;
      if (createdLocalOperator) {
        this.handle.sqlite.prepare(`
          insert into identity_users (
            id, operator_code, display_name, is_active, authorization_version, created_at
          ) values (?, ?, ?, 1, 1, ?)
        `).run(userId, operator.operatorCode, operator.displayName, input.now.getTime());
      }
      this.handle.sqlite.prepare(`
        insert into identity_credentials (user_id, pin_hash, version, updated_at, must_change)
        values (?, ?, 1, ?, 0)
        on conflict(user_id) do update set
          pin_hash = excluded.pin_hash,
          version = identity_credentials.version + 1,
          updated_at = excluded.updated_at,
          must_change = 0
      `).run(userId, input.pinHash, input.now.getTime());
      /** Una credencial nueva invalida las sesiones vivas de ese operador. */
      this.bumpAuthorization([userId]);
      this.handle.sqlite.prepare(
        'update identity_credential_enrollments set consumed_at = ? where id = ?'
      ).run(input.now.getTime(), ticket.id);
      return {
        status: 'APPLIED',
        userId,
        operatorCode: operator.operatorCode,
        createdLocalOperator,
        replacedCredential: operator.hasLocalCredential
      };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async credentialOf(userId: string): Promise<{ readonly pinHash: string } | null> {
    const row = this.handle.sqlite.prepare(
      'select pin_hash as pinHash from identity_credentials where user_id = ?'
    ).get(userId) as { pinHash: string } | undefined;
    return row === undefined ? null : { pinHash: row.pinHash };
  }

  async replaceOwnCredential(input: {
    readonly userId: string;
    readonly pinHash: string;
    readonly now: Date;
  }): Promise<boolean> {
    requireTransaction(this.handle.sqlite);
    try {
      /**
       * El cambio propio no avanza la versión de autorización: la sesión del
       * operador sigue viva y deja de estar restringida al limpiar la marca.
       */
      return this.handle.sqlite.prepare(`
        update identity_credentials
        set pin_hash = ?, version = version + 1, updated_at = ?, must_change = 0
        where user_id = ?
      `).run(input.pinHash, input.now.getTime(), input.userId).changes === 1;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async expireCredential(input: { readonly userId: string }): Promise<boolean> {
    requireTransaction(this.handle.sqlite);
    try {
      const changes = this.handle.sqlite.prepare(
        'update identity_credentials set must_change = 1 where user_id = ?'
      ).run(input.userId).changes;
      if (changes !== 1) return false;
      this.bumpAuthorization([input.userId]);
      return true;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  /**
   * Sesiones cuyo vencimiento absoluto quedó fuera del plazo declarado
   * (ADR-0029 D8). Revocar una sesión impide usarla, pero no adelanta la fecha
   * desde la que empieza su retención.
   */
  async purgeExpiredSessions(threshold: Date): Promise<number> {
    requireTransaction(this.handle.sqlite);
    try {
      return this.handle.sqlite.prepare(`
        delete from auth_sessions
        where absolute_expires_at < ?
      `).run(threshold.getTime()).changes;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  /** Tickets consumidos o vencidos: pasado el plazo ya no detectan un replay. */
  async purgeConsumedEnrollments(threshold: Date): Promise<number> {
    requireTransaction(this.handle.sqlite);
    try {
      return this.handle.sqlite.prepare(`
        delete from identity_credential_enrollments
        where (consumed_at is not null and consumed_at < ?)
           or expires_at < ?
      `).run(threshold.getTime(), threshold.getTime()).changes;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  private operatorFrom(row: OperatorRow): IdentityOperatorSummary {
    const roles = this.handle.sqlite.prepare(`
      select r.id as roleId, r.code as code from identity_user_roles ur
      join identity_roles r on r.id = ur.role_id
      where ur.user_id = ? order by r.code
    `).all(row.userId) as { roleId: string; code: string }[];
    return {
      userId: row.userId,
      operatorCode: row.operatorCode,
      displayName: row.displayName,
      isActive: row.isActive === 1,
      roleIds: roles.map((role) => role.roleId),
      roleCodes: roles.map((role) => role.code),
      authorizationVersion: row.authorizationVersion,
      hasLocalCredential: row.hasCredential === 1,
      credentialMustChange: row.mustChange === 1
    };
  }

  private roleFrom(row: RoleRow): IdentityRoleSummary {
    return {
      roleId: row.roleId,
      code: row.code,
      name: row.name,
      isActive: row.isActive === 1,
      isAssignable: row.isAssignable === 1,
      permissionCodes: this.handle.sqlite.prepare(`
        select permission_code from identity_role_permissions
        where role_id = ? order by permission_code
      `).pluck().all(row.roleId) as string[],
      memberCount: row.memberCount
    };
  }

  private operatorCodeTaken(operatorCode: string): boolean {
    return this.handle.sqlite
      .prepare('select 1 from identity_users where operator_code = ? collate nocase')
      .get(operatorCode) !== undefined;
  }

  private unassignableRole(roleIds: readonly string[]): IdentityWriteOutcome | null {
    for (const roleId of roleIds) {
      const role = this.handle.sqlite.prepare(
        'select is_active as isActive, is_assignable as isAssignable from identity_roles where id = ?'
      ).get(roleId) as { isActive: number; isAssignable: number } | undefined;
      if (role === undefined) return { status: 'ROLE_NOT_FOUND' };
      if (role.isActive !== 1 || role.isAssignable !== 1) return { status: 'ROLE_NOT_ASSIGNABLE' };
    }
    return null;
  }

  private unknownPermission(permissionCodes: readonly string[]): IdentityWriteOutcome | null {
    for (const code of permissionCodes) {
      const known = this.handle.sqlite
        .prepare('select 1 from identity_permissions where code = ? and is_active = 1').get(code);
      if (known === undefined) return { status: 'PERMISSION_UNKNOWN' };
    }
    return null;
  }

  private assignRoles(userId: string, roleIds: readonly string[]): void {
    const insert = this.handle.sqlite.prepare(
      'insert or ignore into identity_user_roles (user_id, role_id) values (?, ?)'
    );
    for (const roleId of roleIds) insert.run(userId, roleId);
  }

  private assignPermissions(roleId: string, permissionCodes: readonly string[]): void {
    const insert = this.handle.sqlite.prepare(
      'insert or ignore into identity_role_permissions (role_id, permission_code) values (?, ?)'
    );
    for (const code of permissionCodes) insert.run(roleId, code);
  }

  private roleBearers(roleId: string): readonly string[] {
    return this.handle.sqlite
      .prepare('select user_id from identity_user_roles where role_id = ? order by user_id')
      .pluck().all(roleId) as string[];
  }

  private bumpAuthorization(userIds: readonly string[]): void {
    const bump = this.handle.sqlite.prepare(
      'update identity_users set authorization_version = authorization_version + 1 where id = ?'
    );
    for (const userId of userIds) bump.run(userId);
  }
}
