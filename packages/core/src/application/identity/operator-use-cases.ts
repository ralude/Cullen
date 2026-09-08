import {
  ApplicationError,
  DomainError,
  err,
  ok,
  type AppError,
  type Result
} from '@supermarket/shared';
import type { JsonValue } from '@supermarket/shared';
import { User } from '../../domain/identity/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuthorizationService,
  Clock,
  IdGenerator,
  IdentityAdministrationStore,
  IdentityOperatorSummary
} from '../ports/index.js';
import {
  toOperatorDto,
  type AssignOperatorRolesInput,
  type ChangeOperatorStatusInput,
  type CreateOperatorInput,
  type IdentityOperatorDto,
  type UpdateOperatorInput
} from './identity-dtos.js';
import { IdentityChangeTransaction } from './identity-change.js';
import { IDENTITY_PERMISSIONS } from './permissions.js';

/**
 * Código de negocio del operador. Se normaliza a mayúsculas, igual que en el
 * ingreso, y se limita a lo que un teclado de caja puede escribir sin ambigüedad.
 */
const OPERATOR_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

export const normalizeOperatorCode = (value: string): string => value.trim().toUpperCase();

const requireReason = (reason: string): string | null => {
  const normalized = reason.trim();
  return normalized.length === 0 || normalized.length > 500 ? null : normalized;
};

const invalidInput = (): AppError => new ApplicationError(
  'IDENTITY_INPUT_INVALID',
  'The identity command input is invalid.'
);

const snapshotOf = (operator: IdentityOperatorSummary | null): JsonValue =>
  operator === null ? null : {
    operatorCode: operator.operatorCode,
    displayName: operator.displayName,
    isActive: operator.isActive,
    roleCodes: [...operator.roleCodes]
  };

/**
 * Base común de los comandos de operador: autorización, ownership del nodo y
 * lectura del estado que la auditoría necesita. No decide ninguna regla propia
 * de un comando concreto.
 */
abstract class OperatorCommand {
  constructor(
    protected readonly store: IdentityAdministrationStore,
    protected readonly authorization: AuthorizationService,
    protected readonly changes: IdentityChangeTransaction
  ) {}

  protected async guard(context: ExecutionContext): Promise<AppError | null> {
    if (!(await this.authorization.authorize(context, IDENTITY_PERMISSIONS.MANAGE_USERS))) {
      return new ApplicationError('FORBIDDEN', 'Actor is not authorized to manage operators.');
    }
    return this.changes.ownershipError();
  }

  protected async operatorResult(userId: string): Promise<Result<IdentityOperatorDto, AppError>> {
    const operator = await this.store.findOperator(userId);
    return operator === null
      ? err(new ApplicationError('IDENTITY_OPERATOR_NOT_FOUND', 'The operator was not found.'))
      : ok(toOperatorDto(operator));
  }
}

export class CreateOperator extends OperatorCommand {
  constructor(
    store: IdentityAdministrationStore,
    authorization: AuthorizationService,
    changes: IdentityChangeTransaction,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock
  ) {
    super(store, authorization, changes);
  }

  /**
   * Crea la identidad del operador, nunca su credencial: el acceso local se
   * habilita por enrolamiento (ADR-0028) y puede ocurrir en otro nodo.
   */
  async execute(
    input: CreateOperatorInput,
    context: ExecutionContext
  ): Promise<Result<IdentityOperatorDto, AppError>> {
    const denied = await this.guard(context);
    if (denied) return err(denied);

    const operatorCode = normalizeOperatorCode(input.operatorCode);
    const reason = requireReason(input.reason);
    if (!OPERATOR_CODE_PATTERN.test(operatorCode) || reason === null) return err(invalidInput());
    const userId = this.idGenerator.generate();
    try {
      /** El dominio valida el nombre visible y la unicidad de roles asignados. */
      User.create({ id: userId, displayName: input.displayName });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
    const roleIds = [...new Set(input.roleIds)];

    const applied = await this.changes.run(context, {
      action: 'IDENTITY_OPERATOR_CREATED',
      entityType: 'Operator',
      entityId: userId,
      reason,
      snapshot: async () => null,
      mutate: () => this.store.createOperator({
        userId,
        operatorCode,
        displayName: input.displayName.trim(),
        roleIds,
        now: this.clock.now()
      }),
      after: async () => snapshotOf(await this.store.findOperator(userId))
    });
    return applied.ok ? this.operatorResult(userId) : err(applied.error);
  }
}

export class UpdateOperator extends OperatorCommand {
  async execute(
    input: UpdateOperatorInput,
    context: ExecutionContext
  ): Promise<Result<IdentityOperatorDto, AppError>> {
    const denied = await this.guard(context);
    if (denied) return err(denied);

    const reason = requireReason(input.reason);
    if (reason === null) return err(invalidInput());
    try {
      User.create({ id: input.userId, displayName: input.displayName });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }

    const applied = await this.changes.run(context, {
      action: 'IDENTITY_OPERATOR_UPDATED',
      entityType: 'Operator',
      entityId: input.userId,
      reason,
      snapshot: async () => snapshotOf(await this.store.findOperator(input.userId)),
      mutate: () => this.store.updateOperator({
        userId: input.userId,
        displayName: input.displayName.trim()
      }),
      after: async () => snapshotOf(await this.store.findOperator(input.userId))
    });
    return applied.ok ? this.operatorResult(input.userId) : err(applied.error);
  }
}

export class ChangeOperatorStatus extends OperatorCommand {
  /**
   * Desactivar es reversible y no borra (ADR-0027 D2). Desactivar al último
   * administrador activo lo impide el invariante, evaluado por efecto dentro de
   * la transacción.
   */
  async execute(
    input: ChangeOperatorStatusInput,
    context: ExecutionContext
  ): Promise<Result<IdentityOperatorDto, AppError>> {
    const denied = await this.guard(context);
    if (denied) return err(denied);

    const reason = requireReason(input.reason);
    if (reason === null) return err(invalidInput());

    const applied = await this.changes.run(context, {
      action: 'IDENTITY_OPERATOR_STATUS_CHANGED',
      entityType: 'Operator',
      entityId: input.userId,
      reason,
      snapshot: async () => snapshotOf(await this.store.findOperator(input.userId)),
      mutate: () => this.store.changeOperatorStatus({
        userId: input.userId,
        isActive: input.isActive
      }),
      after: async () => snapshotOf(await this.store.findOperator(input.userId))
    });
    return applied.ok ? this.operatorResult(input.userId) : err(applied.error);
  }
}

export class AssignOperatorRoles extends OperatorCommand {
  async execute(
    input: AssignOperatorRolesInput,
    context: ExecutionContext
  ): Promise<Result<IdentityOperatorDto, AppError>> {
    const denied = await this.guard(context);
    if (denied) return err(denied);

    const reason = requireReason(input.reason);
    if (reason === null) return err(invalidInput());
    const roleIds = [...new Set(input.roleIds)];

    const applied = await this.changes.run(context, {
      action: 'IDENTITY_OPERATOR_ROLES_ASSIGNED',
      entityType: 'Operator',
      entityId: input.userId,
      reason,
      snapshot: async () => snapshotOf(await this.store.findOperator(input.userId)),
      mutate: () => this.store.assignOperatorRoles({ userId: input.userId, roleIds }),
      after: async () => snapshotOf(await this.store.findOperator(input.userId))
    });
    return applied.ok ? this.operatorResult(input.userId) : err(applied.error);
  }
}
