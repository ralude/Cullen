import { ApplicationError, err, ok, type AppError, type Result } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuditWriter,
  Clock,
  IdGenerator,
  SecretVault,
  UnitOfWork
} from '../ports/index.js';

export type RotateProtectedMaterialInput = {
  readonly reason: string;
  /**
   * Claves que todavía cifran material vivo, leídas de los respaldos
   * publicados. Una clave referenciada no se olvida: hacerlo convertiría esos
   * respaldos en irrecuperables (ADR-0029 D9).
   */
  readonly referencedKeyIds: readonly string[];
};

export type ProtectedMaterialRotationDto = {
  readonly keyId: string;
  readonly retiredKeyId: string | null;
  readonly forgottenKeyIds: readonly string[];
};

/**
 * Rotación de la clave con la que el nodo protege respaldos y secretos
 * ([ADR-0029](../../../../../docs/architecture/adr/0029-proteccion-de-datos-en-reposo.md) D9).
 *
 * Es una operación del nodo y no del API de operadores: se ejecuta en la
 * máquina, con la cuenta que administra el servicio, y deja evidencia con
 * actor, terminal, timestamp UTC y motivo. La clave nueva cifra material
 * futuro; la anterior se retira y sobrevive mientras algún respaldo dependa de
 * ella. La custodia efectiva viaja en la evidencia: una clave sin proteger es
 * un hecho auditable, no un detalle de configuración.
 */
export class RotateProtectedMaterial {
  constructor(
    private readonly vault: SecretVault,
    private readonly auditWriter: AuditWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock
  ) {}

  async execute(
    input: RotateProtectedMaterialInput,
    context: ExecutionContext
  ): Promise<Result<ProtectedMaterialRotationDto, AppError>> {
    const reason = input.reason.trim();
    if (reason.length === 0 || reason.length > 500) {
      return err(new ApplicationError(
        'PROTECTION_ROTATION_REASON_REQUIRED', 'The rotation requires a reason.'
      ));
    }
    const now = this.clock.now();
    const rotated = await this.vault.rotate(now);

    const referenced = new Set(input.referencedKeyIds);
    const forgottenKeyIds: string[] = [];
    for (const key of await this.vault.list()) {
      if (key.state !== 'RETIRED' || referenced.has(key.keyId)) continue;
      if (await this.vault.forget(key.keyId)) forgottenKeyIds.push(key.keyId);
    }

    return this.unitOfWork.execute(async () => {
      await this.auditWriter.append([{
        auditId: this.idGenerator.generate(),
        actorId: context.actorId,
        actorRoleCodes: context.actorRoleCodes ?? [],
        action: 'SECURITY_PROTECTION_KEY_ROTATED',
        entityType: 'ProtectionKey',
        entityId: rotated.keyId,
        before: { activeKeyId: rotated.retiredKeyId },
        after: {
          activeKeyId: rotated.keyId,
          retiredKeyId: rotated.retiredKeyId,
          forgottenKeyIds,
          protection: this.vault.protection
        },
        reason,
        terminalId: context.terminalId,
        originNodeId: context.originNodeId,
        occurredAt: now,
        correlationId: context.correlationId
      }]);
      return ok({ keyId: rotated.keyId, retiredKeyId: rotated.retiredKeyId, forgottenKeyIds });
    });
  }
}
