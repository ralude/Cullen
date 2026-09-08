import { ok, type AppError, type Result } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuditWriter,
  Clock,
  IdGenerator,
  SecretVaultProtection,
  UnitOfWork
} from '../ports/index.js';

export type ProtectionUseDto = { readonly audited: boolean };

/**
 * La excepción de desarrollo de ADR-0029 D7.3 no es un fallback silencioso:
 * cada arranque que la usa deja evidencia en la auditoría append-only.
 */
export class RecordProtectionUse {
  constructor(
    private readonly auditWriter: AuditWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock
  ) {}

  async execute(
    protection: SecretVaultProtection,
    context: ExecutionContext
  ): Promise<Result<ProtectionUseDto, AppError>> {
    if (protection === 'OS_KEYSTORE') return ok({ audited: false });
    const now = this.clock.now();
    return this.unitOfWork.execute(async () => {
      await this.auditWriter.append([{
        auditId: this.idGenerator.generate(),
        actorId: context.actorId,
        actorRoleCodes: context.actorRoleCodes ?? [],
        action: 'SECURITY_UNPROTECTED_VAULT_USED',
        entityType: 'ProtectionKey',
        entityId: context.originNodeId,
        before: null,
        after: { protection },
        reason: 'Excepción explícita de custodia para desarrollo.',
        terminalId: context.terminalId,
        originNodeId: context.originNodeId,
        occurredAt: now,
        correlationId: context.correlationId
      }]);
      return ok({ audited: true });
    });
  }
}
