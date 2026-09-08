import {
  ApplicationError,
  DomainError,
  err,
  ok,
  type AppError,
  type JsonValue,
  type Result
} from '@supermarket/shared';
import { Role } from '../../domain/identity/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuthorizationService,
  IdGenerator,
  IdentityAdministrationStore,
  IdentityRoleSummary
} from '../ports/index.js';
import {
  toOperatorDto,
  toRoleDto,
  type ChangeRoleStatusInput,
  type CreateRoleInput,
  type IdentityDirectoryDto,
  type IdentityRoleDto,
  type UpdateRolePermissionsInput
} from './identity-dtos.js';
import { IdentityChangeTransaction } from './identity-change.js';
import { IDENTITY_PERMISSIONS } from './permissions.js';

const invalidInput = (): AppError => new ApplicationError(
  'IDENTITY_INPUT_INVALID',
  'The identity command input is invalid.'
);

const requireReason = (reason: string): string | null => {
  const normalized = reason.trim();
  return normalized.length === 0 || normalized.length > 500 ? null : normalized;
};

const snapshotOf = (role: IdentityRoleSummary | null): JsonValue =>
  role === null ? null : {
    code: role.code,
    name: role.name,
    isActive: role.isActive,
    permissionCodes: [...role.permissionCodes],
    memberCount: role.memberCount
  };

abstract class RoleCommand {
  constructor(
    protected readonly store: IdentityAdministrationStore,
    protected readonly authorization: AuthorizationService,
    protected readonly changes: IdentityChangeTransaction
  ) {}

  protected async guard(context: ExecutionContext): Promise<AppError | null> {
    if (!(await this.authorization.authorize(context, IDENTITY_PERMISSIONS.MANAGE_ROLES))) {
      return new ApplicationError('FORBIDDEN', 'Actor is not authorized to manage roles.');
    }
    return this.changes.ownershipError();
  }

  protected async roleResult(roleId: string): Promise<Result<IdentityRoleDto, AppError>> {
    const role = await this.store.findRole(roleId);
    return role === null
      ? err(new ApplicationError('IDENTITY_ROLE_NOT_FOUND', 'The role was not found.'))
      : ok(toRoleDto(role));
  }
}

export class CreateRole extends RoleCommand {
  constructor(
    store: IdentityAdministrationStore,
    authorization: AuthorizationService,
    changes: IdentityChangeTransaction,
    private readonly idGenerator: IdGenerator
  ) {
    super(store, authorization, changes);
  }

  async execute(
    input: CreateRoleInput,
    context: ExecutionContext
  ): Promise<Result<IdentityRoleDto, AppError>> {
    const denied = await this.guard(context);
    if (denied) return err(denied);

    const reason = requireReason(input.reason);
    if (reason === null) return err(invalidInput());
    const roleId = this.idGenerator.generate();
    let code: string;
    try {
      /** El dominio fija el patrón del código y normaliza a mayúsculas. */
      code = Role.create({ id: roleId, code: input.code, name: input.name }).code;
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
    const permissionCodes = [...new Set(input.permissionCodes)];

    const applied = await this.changes.run(context, {
      action: 'IDENTITY_ROLE_CREATED',
      entityType: 'Role',
      entityId: roleId,
      reason,
      snapshot: async () => null,
      mutate: () => this.store.createRole({
        roleId, code, name: input.name.trim(), permissionCodes
      }),
      after: async () => snapshotOf(await this.store.findRole(roleId))
    });
    return applied.ok ? this.roleResult(roleId) : err(applied.error);
  }
}

export class UpdateRolePermissions extends RoleCommand {
  /**
   * Cambiar los permisos de un rol cambia la autorización efectiva de **todos**
   * sus portadores: la transacción avanza la versión de cada uno, no solo la
   * del rol.
   */
  async execute(
    input: UpdateRolePermissionsInput,
    context: ExecutionContext
  ): Promise<Result<IdentityRoleDto, AppError>> {
    const denied = await this.guard(context);
    if (denied) return err(denied);

    const reason = requireReason(input.reason);
    if (reason === null) return err(invalidInput());
    const permissionCodes = [...new Set(input.permissionCodes)];

    const applied = await this.changes.run(context, {
      action: 'IDENTITY_ROLE_PERMISSIONS_UPDATED',
      entityType: 'Role',
      entityId: input.roleId,
      reason,
      snapshot: async () => snapshotOf(await this.store.findRole(input.roleId)),
      mutate: () => this.store.updateRolePermissions({ roleId: input.roleId, permissionCodes }),
      after: async () => snapshotOf(await this.store.findRole(input.roleId))
    });
    return applied.ok ? this.roleResult(input.roleId) : err(applied.error);
  }
}

export class ChangeRoleStatus extends RoleCommand {
  async execute(
    input: ChangeRoleStatusInput,
    context: ExecutionContext
  ): Promise<Result<IdentityRoleDto, AppError>> {
    const denied = await this.guard(context);
    if (denied) return err(denied);

    const reason = requireReason(input.reason);
    if (reason === null) return err(invalidInput());

    const applied = await this.changes.run(context, {
      action: 'IDENTITY_ROLE_STATUS_CHANGED',
      entityType: 'Role',
      entityId: input.roleId,
      reason,
      snapshot: async () => snapshotOf(await this.store.findRole(input.roleId)),
      mutate: () => this.store.changeRoleStatus({ roleId: input.roleId, isActive: input.isActive }),
      after: async () => snapshotOf(await this.store.findRole(input.roleId))
    });
    return applied.ok ? this.roleResult(input.roleId) : err(applied.error);
  }
}

/**
 * Lectura de la administración de identidad. Exige uno de los dos permisos de
 * identidad: quien administra roles puede verlos aunque no administre
 * operadores. La consulta del segundo permiso solo ocurre si el primero
 * deniega, para no duplicar la evidencia de una decisión ya tomada.
 */
export class GetIdentityDirectory {
  constructor(
    private readonly store: IdentityAdministrationStore,
    private readonly authorization: AuthorizationService,
    private readonly changes: IdentityChangeTransaction
  ) {}

  async execute(context: ExecutionContext): Promise<Result<IdentityDirectoryDto, AppError>> {
    const allowed = await this.authorization.authorize(context, IDENTITY_PERMISSIONS.MANAGE_USERS)
      || await this.authorization.authorize(context, IDENTITY_PERMISSIONS.MANAGE_ROLES);
    if (!allowed) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to read identity.'));
    }
    return ok({
      operators: (await this.store.listOperators()).map(toOperatorDto),
      roles: (await this.store.listRoles()).map(toRoleDto),
      permissionCodes: await this.store.listPermissionCodes(),
      ownedByThisNode: this.changes.ownershipError() === null
    });
  }
}
