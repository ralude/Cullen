import { ApplicationError, err, ok, type AppError, type Result } from '@supermarket/shared';
import {
  OPERATOR_GRANT_RENEWAL_MS,
  OPERATOR_GRANT_VALIDITY_MS,
  toOperatorGrantPublication
} from '../catalog/reference-publications.js';
import type { ExecutionContext } from '../execution-context.js';
import { toBusinessEvents, type DomainEventLike, type JsonValue } from '../events/index.js';
import type {
  AuditWriter,
  AuthorizationService,
  Clock,
  IdGenerator,
  OperatorGrantSource,
  OutboxStore,
  UnitOfWork
} from '../ports/index.js';
import { SYNC_PERMISSIONS } from './permissions.js';

export type OperatorGrantsPublishedDto = {
  readonly operators: number;
  readonly expiresAt: string;
  readonly publishedAt: string;
};

/**
 * Emite las concesiones de autorización de los operadores del coordinador.
 *
 * El corte inicial y la renovación son el mismo caso de uso y el mismo
 * contrato: cada emisión avanza la versión de concesión del operador —aunque su
 * conjunto de permisos no haya cambiado— para que el consumidor no la descarte
 * por atrasada, y declara una vigencia de ocho horas desde este reloj.
 *
 * Enumera también a los operadores inactivos, como `INACTIVE`: una terminal que
 * nunca supo de un operador desactivado no podría aplicar su revocación.
 *
 * Nunca transporta credenciales. El PIN, su hash y las sesiones son locales de
 * cada nodo, conforme ADR-0026 D5.
 */
export class PublishOperatorGrants {
  constructor(
    private readonly source: OperatorGrantSource,
    private readonly outbox: OutboxStore,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly auditWriter?: AuditWriter
  ) {}

  async execute(
    input: { readonly reason: string },
    context: ExecutionContext
  ): Promise<Result<OperatorGrantsPublishedDto, AppError>> {
    if (!await this.authorization.authorize(context, SYNC_PERMISSIONS.PUBLISH_REFERENCES)) {
      return err(new ApplicationError(
        'FORBIDDEN',
        'Actor is not authorized to publish operator grants.'
      ));
    }
    if (input.reason.trim().length === 0) {
      return err(new ApplicationError(
        'SYNC_GRANT_REASON_REQUIRED',
        'An operator grant reason is required.'
      ));
    }

    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + OPERATOR_GRANT_VALIDITY_MS);
    return ok(await this.unitOfWork.execute(async () => {
      const operators = await this.source.listOperators();
      const publications: DomainEventLike[] = [];
      for (const operator of operators) {
        const version = await this.source.nextGrantVersion(operator.userId, now, expiresAt);
        publications.push(toOperatorGrantPublication(
          { ...operator, version },
          { eventId: this.ids.generate(), occurredAt: now }
        ));
      }
      await this.outbox.enqueue(toBusinessEvents(publications, context));
      await this.auditWriter?.append([{
        auditId: this.ids.generate(),
        actorId: context.actorId,
        actorRoleCodes: context.actorRoleCodes ?? [],
        action: 'SYNC_OPERATOR_GRANTS_PUBLISHED',
        entityType: 'SyncReference',
        entityId: 'operator-grants',
        before: null,
        /** Cuántas concesiones y hasta cuándo; nunca los permisos de cada operador. */
        after: {
          operators: operators.length,
          expiresAt: expiresAt.toISOString()
        } as unknown as JsonValue,
        reason: input.reason.trim(),
        terminalId: context.terminalId,
        originNodeId: context.originNodeId,
        occurredAt: now,
        correlationId: context.correlationId
      }]);

      return {
        operators: operators.length,
        expiresAt: expiresAt.toISOString(),
        publishedAt: now.toISOString()
      };
    }));
  }

  /**
   * Reemite las concesiones cuando a la vigente le queda menos de la mitad de
   * su ventana, o cuando algún operador todavía no tiene una. Así una terminal
   * conectada conserva siempre ocho horas por delante y, al cortarse la LAN,
   * sigue operando dentro de esa ventana.
   *
   * Devuelve `null` cuando no había nada que reemitir.
   */
  async renewIfDue(
    context: ExecutionContext
  ): Promise<Result<OperatorGrantsPublishedDto | null, AppError>> {
    const earliest = await this.source.earliestGrantExpiry();
    const now = this.clock.now();
    if (earliest !== null && earliest.getTime() - now.getTime() > OPERATOR_GRANT_RENEWAL_MS) {
      return ok(null);
    }
    return this.execute({ reason: 'Renovación programada de concesiones.' }, context);
  }
}
