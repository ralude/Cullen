import { ok, type AppError, type Result } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuditWriter,
  Clock,
  IdGenerator,
  IdentityRetentionStore,
  UnitOfWork
} from '../ports/index.js';

/** Plazo declarado por ADR-0029 D8 para sesiones y tickets consumidos. */
export const IDENTITY_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type IdentityRetentionDto = {
  readonly sessions: number;
  readonly enrollments: number;
};

/**
 * Aplica la retención de identidad. Se ejecuta en el nodo, no por HTTP: no es
 * una decisión de un operador sino el cumplimiento de una política declarada.
 *
 * Solo deja auditoría cuando efectivamente borró algo; un arranque que no
 * purga nada no tiene por qué escribir evidencia de que no hizo nada.
 */
export class ApplyIdentityRetention {
  constructor(
    private readonly store: IdentityRetentionStore,
    private readonly auditWriter: AuditWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock
  ) {}

  async execute(context: ExecutionContext): Promise<Result<IdentityRetentionDto, AppError>> {
    const now = this.clock.now();
    const threshold = new Date(now.getTime() - IDENTITY_RETENTION_DAYS * DAY_MS);
    return this.unitOfWork.execute(async () => {
      const sessions = await this.store.purgeExpiredSessions(threshold);
      const enrollments = await this.store.purgeConsumedEnrollments(threshold);
      if (sessions + enrollments > 0) {
        await this.auditWriter.append([{
          auditId: this.idGenerator.generate(),
          actorId: context.actorId,
          actorRoleCodes: context.actorRoleCodes ?? [],
          action: 'IDENTITY_RETENTION_APPLIED',
          entityType: 'Retention',
          entityId: 'identity',
          before: null,
          after: { sessions, enrollments, retentionDays: IDENTITY_RETENTION_DAYS },
          reason: 'Retención declarada de sesiones y enrolamientos.',
          terminalId: context.terminalId,
          originNodeId: context.originNodeId,
          occurredAt: now,
          correlationId: context.correlationId
        }]);
      }
      return ok({ sessions, enrollments });
    });
  }
}
