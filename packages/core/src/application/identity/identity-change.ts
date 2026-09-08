import {
  ApplicationError,
  err,
  ok,
  type AppError,
  type Result
} from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type { JsonValue } from '../events/index.js';
import type {
  AuditEntry,
  AuditWriter,
  Clock,
  CoordinatorLink,
  IdGenerator,
  IdentityAdministrationStore,
  IdentityWriteOutcome,
  UnitOfWork
} from '../ports/index.js';
import { IDENTITY_PERMISSIONS } from './permissions.js';

/**
 * Código estable del invariante de último administrador
 * ([ADR-0027](../../../../../docs/architecture/adr/0027-administracion-de-identidad.md) D4).
 */
export const IDENTITY_LAST_ADMINISTRATOR = 'IDENTITY_LAST_ADMINISTRATOR';

/** Un nodo que no es dueño de la identidad no administra operadores ni roles. */
export const IDENTITY_NOT_OWNED_BY_NODE = 'IDENTITY_NOT_OWNED_BY_NODE';

const FAILURE_CODES: Readonly<Record<Exclude<IdentityWriteOutcome['status'], 'APPLIED'>, string>> = {
  OPERATOR_NOT_FOUND: 'IDENTITY_OPERATOR_NOT_FOUND',
  ROLE_NOT_FOUND: 'IDENTITY_ROLE_NOT_FOUND',
  OPERATOR_CODE_TAKEN: 'IDENTITY_OPERATOR_CODE_TAKEN',
  ROLE_CODE_TAKEN: 'IDENTITY_ROLE_CODE_TAKEN',
  ROLE_NOT_ASSIGNABLE: 'USER_ROLE_NOT_ASSIGNABLE',
  PERMISSION_UNKNOWN: 'IDENTITY_PERMISSION_UNKNOWN'
};

const FAILURE_MESSAGES: Readonly<Record<Exclude<IdentityWriteOutcome['status'], 'APPLIED'>, string>> = {
  OPERATOR_NOT_FOUND: 'The operator was not found.',
  ROLE_NOT_FOUND: 'The role was not found.',
  OPERATOR_CODE_TAKEN: 'The operator code is already in use.',
  ROLE_CODE_TAKEN: 'The role code is already in use.',
  ROLE_NOT_ASSIGNABLE: 'Only active and assignable roles can be assigned to a user.',
  PERMISSION_UNKNOWN: 'The permission code is unknown.'
};

export type IdentityChangeRequest = {
  readonly action: string;
  readonly entityType: 'Operator' | 'Role';
  readonly entityId: string;
  readonly reason: string;
  /** Estado previo leído dentro de la transacción, antes de mutar. */
  readonly snapshot: () => Promise<JsonValue | null>;
  readonly mutate: () => Promise<IdentityWriteOutcome>;
  /** Estado posterior leído dentro de la misma transacción. */
  readonly after: () => Promise<JsonValue | null>;
};

/**
 * Envoltura transaccional común a toda mutación de identidad.
 *
 * Ejecuta en una única transacción: leer el estado previo, mutar, comprobar por
 * efecto que sigue habiendo un administrador activo y asentar la auditoría. El
 * invariante se evalúa **después** de escribir, de modo que cubre cualquier
 * forma de cambio —quitar el permiso, quitar el rol, desactivar el rol,
 * desactivar al usuario— sin enumerarlas. Violarlo revierte la transacción
 * entera y deja evidencia del rechazo en una transacción propia.
 *
 * No es un servicio de identidad: no decide permisos, no valida entradas y no
 * conoce ninguna regla de un caso de uso concreto.
 */
export class IdentityChangeTransaction {
  constructor(
    private readonly store: IdentityAdministrationStore,
    private readonly auditWriter: AuditWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly auditIdGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly coordinator: CoordinatorLink
  ) {}

  /**
   * Falla cerrado en una terminal: la identidad pertenece al coordinador
   * (ADR-0027 D5). Un nodo standalone es su propio coordinador.
   */
  ownershipError(): AppError | null {
    return this.coordinator.coordinatorNodeId === null
      ? null
      : new ApplicationError(
        IDENTITY_NOT_OWNED_BY_NODE,
        'Identity administration belongs to the store coordinator.'
      );
  }

  async run(
    context: ExecutionContext,
    request: IdentityChangeRequest
  ): Promise<Result<readonly string[], AppError>> {
    try {
      return await this.unitOfWork.execute(async () => {
        const before = await request.snapshot();
        const outcome = await request.mutate();
        if (outcome.status !== 'APPLIED') {
          return err(new ApplicationError(
            FAILURE_CODES[outcome.status],
            FAILURE_MESSAGES[outcome.status]
          ));
        }
        if (!await this.store.hasActiveAdministrator(IDENTITY_PERMISSIONS.MANAGE_USERS)) {
          throw new ApplicationError(
            IDENTITY_LAST_ADMINISTRATOR,
            'The change would leave the system without an active administrator.'
          );
        }
        await this.auditWriter.append([this.entry(context, request, before, await request.after())]);
        return ok(outcome.affectedUserIds);
      });
    } catch (error) {
      if (error instanceof ApplicationError && error.code === IDENTITY_LAST_ADMINISTRATOR) {
        await this.recordRejection(context, request);
        return err(error);
      }
      throw error;
    }
  }

  /**
   * La transacción del cambio ya revirtió, así que el rechazo se conserva en
   * una unidad de trabajo propia: un intento de dejar al sistema sin
   * administración es evidencia de negocio, no un detalle técnico.
   */
  private async recordRejection(
    context: ExecutionContext,
    request: IdentityChangeRequest
  ): Promise<void> {
    await this.unitOfWork.execute(() => this.auditWriter.append([{
      ...this.entry(context, request, null, { rejected: IDENTITY_LAST_ADMINISTRATOR }),
      action: `${request.action}_REJECTED`
    }]));
  }

  private entry(
    context: ExecutionContext,
    request: IdentityChangeRequest,
    before: JsonValue | null,
    after: JsonValue | null
  ): AuditEntry {
    return {
      auditId: this.auditIdGenerator.generate(),
      actorId: context.actorId,
      actorRoleCodes: context.actorRoleCodes ?? [],
      action: request.action,
      entityType: request.entityType,
      entityId: request.entityId,
      before,
      after,
      reason: request.reason,
      terminalId: context.terminalId,
      originNodeId: context.originNodeId,
      occurredAt: this.clock.now(),
      correlationId: context.correlationId
    };
  }
}
