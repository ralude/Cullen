import { ApplicationError, err, ok, type AppError, type Result } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type { JsonValue } from '../events/index.js';
import type {
  AuditWriter,
  AuthorizationService,
  Clock,
  IdGenerator,
  SyncDiscrepancyRecord,
  SyncInboxWorkStore,
  UnitOfWork
} from '../ports/index.js';
import { SYNC_PERMISSIONS } from './permissions.js';

export type SyncDiscrepancyDto = {
  readonly discrepancyId: string;
  readonly eventId: string;
  readonly consumer: string;
  readonly reasonCode: string;
  readonly detail: JsonValue;
  readonly status: 'OPEN' | 'RESOLVED';
  readonly openedAt: string;
  readonly resolvedAt: string | null;
};

export const toSyncDiscrepancyDto = (record: SyncDiscrepancyRecord): SyncDiscrepancyDto => ({
  discrepancyId: record.discrepancyId,
  eventId: record.eventId,
  consumer: record.consumer,
  reasonCode: record.reasonCode,
  detail: record.detail,
  status: record.status,
  openedAt: record.openedAt.toISOString(),
  resolvedAt: record.resolvedAt === null ? null : record.resolvedAt.toISOString()
});

export class ListSyncDiscrepancies {
  constructor(
    private readonly store: SyncInboxWorkStore,
    private readonly authorization: AuthorizationService
  ) {}

  async execute(
    status: 'OPEN' | 'RESOLVED',
    context: ExecutionContext
  ): Promise<Result<readonly SyncDiscrepancyDto[], AppError>> {
    if (!await this.authorization.authorize(context, SYNC_PERMISSIONS.REVIEW_RECEPTION)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to review reception.'));
    }
    return ok((await this.store.listDiscrepancies(status)).map(toSyncDiscrepancyDto));
  }
}

/**
 * Vuelve a habilitar la aplicación de un hecho después de corregir la causa.
 * No inventa stock ni cierra la discrepancia: solo evidencia de aplicación
 * permite marcarla resuelta.
 */
export class RetrySyncDiscrepancy {
  constructor(
    private readonly store: SyncInboxWorkStore,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly auditWriter?: AuditWriter
  ) {}

  async execute(
    input: { readonly discrepancyId: string; readonly reason: string },
    context: ExecutionContext
  ): Promise<Result<SyncDiscrepancyDto, AppError>> {
    if (!await this.authorization.authorize(context, SYNC_PERMISSIONS.RESOLVE_DISCREPANCY)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to retry discrepancies.'));
    }
    if (input.reason.trim().length === 0) {
      return err(new ApplicationError('SYNC_DISCREPANCY_REASON_REQUIRED', 'A reason is required.'));
    }

    const record = await this.store.findDiscrepancy(input.discrepancyId);
    if (!record) {
      return err(new ApplicationError('SYNC_DISCREPANCY_NOT_FOUND', 'The discrepancy was not found.'));
    }
    if (record.status === 'RESOLVED') {
      return err(new ApplicationError(
        'SYNC_DISCREPANCY_ALREADY_RESOLVED',
        'The discrepancy is already resolved.'
      ));
    }

    const now = this.clock.now();
    await this.unitOfWork.execute(async () => {
      await this.store.scheduleDiscrepancyRetry(input.discrepancyId, now);
      await this.auditWriter?.append([{
        auditId: this.ids.generate(),
        actorId: context.actorId,
        actorRoleCodes: context.actorRoleCodes ?? [],
        action: 'SYNC_DISCREPANCY_RETRY_SCHEDULED',
        entityType: 'SyncDiscrepancy',
        entityId: record.discrepancyId,
        before: { status: record.status } as unknown as JsonValue,
        after: { status: 'OPEN', eventId: record.eventId, consumer: record.consumer } as unknown as JsonValue,
        reason: input.reason.trim(),
        terminalId: context.terminalId,
        originNodeId: context.originNodeId,
        occurredAt: now,
        correlationId: context.correlationId
      }]);
    });
    return ok(toSyncDiscrepancyDto(record));
  }
}

/**
 * Cierra una discrepancia cuando existe evidencia de aplicación. Un simple
 * reconocimiento no borra la obligación de inventario: si la tarea sigue sin
 * aplicarse, la resolución se rechaza.
 */
export class ResolveSyncDiscrepancy {
  constructor(
    private readonly store: SyncInboxWorkStore,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly auditWriter?: AuditWriter
  ) {}

  async execute(
    input: { readonly discrepancyId: string; readonly reason: string },
    context: ExecutionContext
  ): Promise<Result<SyncDiscrepancyDto, AppError>> {
    if (!await this.authorization.authorize(context, SYNC_PERMISSIONS.RESOLVE_DISCREPANCY)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to resolve discrepancies.'));
    }
    if (input.reason.trim().length === 0) {
      return err(new ApplicationError('SYNC_DISCREPANCY_REASON_REQUIRED', 'A reason is required.'));
    }

    const record = await this.store.findDiscrepancy(input.discrepancyId);
    if (!record) {
      return err(new ApplicationError('SYNC_DISCREPANCY_NOT_FOUND', 'The discrepancy was not found.'));
    }
    if (record.status === 'RESOLVED') {
      return err(new ApplicationError(
        'SYNC_DISCREPANCY_ALREADY_RESOLVED',
        'The discrepancy is already resolved.'
      ));
    }

    const now = this.clock.now();
    const resolved = await this.unitOfWork.execute(async () => {
      const closed = await this.store.resolveDiscrepancy(
        input.discrepancyId, now, context.actorId, input.reason.trim()
      );
      if (!closed) return false;
      await this.auditWriter?.append([{
        auditId: this.ids.generate(),
        actorId: context.actorId,
        actorRoleCodes: context.actorRoleCodes ?? [],
        action: 'SYNC_DISCREPANCY_RESOLVED',
        entityType: 'SyncDiscrepancy',
        entityId: record.discrepancyId,
        before: { status: 'OPEN' } as unknown as JsonValue,
        after: { status: 'RESOLVED', eventId: record.eventId, consumer: record.consumer } as unknown as JsonValue,
        reason: input.reason.trim(),
        terminalId: context.terminalId,
        originNodeId: context.originNodeId,
        occurredAt: now,
        correlationId: context.correlationId
      }]);
      return true;
    });

    if (!resolved) {
      return err(new ApplicationError(
        'SYNC_DISCREPANCY_NOT_APPLIED',
        'The discrepancy cannot be closed without evidence that the event was applied.'
      ));
    }
    return ok({
      ...toSyncDiscrepancyDto(record),
      status: 'RESOLVED',
      resolvedAt: now.toISOString()
    });
  }
}
