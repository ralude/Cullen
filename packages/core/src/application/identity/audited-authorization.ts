import type { ExecutionContext } from '../execution-context.js';
import { permissionAlternatives } from '../ports/index.js';
import type {
  AuditEntry,
  AuditWriter,
  AuthorizationService,
  Clock,
  IdGenerator,
  RequiredPermission,
  TransactionState,
  UnitOfWork
} from '../ports/index.js';

/** Acción con la que la auditoría conserva una decisión de autorización negada. */
export const AUTHORIZATION_DENIED_ACTION = 'AUTHORIZATION_DENIED';

/**
 * Punto único de decisión de autorización con evidencia.
 *
 * Decora el servicio de autorización real y conserva **solo la denegación**: la
 * concesión ya queda evidenciada por la entrada de negocio que el propio
 * comando escribe al tener efecto, y auditar además cada lectura autorizada
 * convertiría la auditoría en ruido sin agregar evidencia (ADR-0006).
 *
 * La evidencia se persiste en una unidad de trabajo propia, independiente de la
 * transacción del comando rechazado. Si la decisión ocurre dentro de esa
 * transacción, la denegación se difiere hasta salir de ella —una transacción
 * anidada está prohibida— y la asienta {@link DeferredDenialUnitOfWork}.
 *
 * Un fallo al persistir la evidencia se propaga: una denegación sin registrar
 * no puede presentarse como una decisión auditada.
 */
export class AuditedAuthorizationService implements AuthorizationService {
  private readonly deferred: AuditEntry[] = [];

  constructor(
    private readonly inner: AuthorizationService,
    private readonly auditWriter: AuditWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly transaction: TransactionState,
    private readonly auditIdGenerator: IdGenerator,
    private readonly clock: Clock
  ) {}

  async authorize(context: ExecutionContext, permission: RequiredPermission): Promise<boolean> {
    if (await this.inner.authorize(context, permission)) return true;
    const entry = this.denial(context, permissionAlternatives(permission));
    if (this.transaction.isActive) {
      this.deferred.push(entry);
      return false;
    }
    await this.persist([entry]);
    return false;
  }

  /** Asienta las denegaciones decididas dentro de una transacción ya cerrada. */
  async flushDeferredDenials(): Promise<void> {
    if (this.deferred.length === 0) return;
    await this.persist(this.deferred.splice(0));
  }

  /**
   * Una decisión, una entrada. Con alternativas, la evidencia nombra todas las
   * que habrían bastado: ninguna se cumplió, y registrar una por cada consulta
   * contaría varias denegaciones donde solo hubo una.
   */
  private denial(context: ExecutionContext, alternatives: readonly string[]): AuditEntry {
    return {
      auditId: this.auditIdGenerator.generate(),
      actorId: context.actorId,
      actorRoleCodes: context.actorRoleCodes ?? [],
      action: AUTHORIZATION_DENIED_ACTION,
      entityType: 'Permission',
      entityId: alternatives.join('|'),
      before: null,
      after: { granted: false },
      reason: alternatives.length === 1
        ? `Actor lacks the required permission: ${alternatives[0]}.`
        : `Actor lacks every permission that could authorize it: ${alternatives.join(', ')}.`,
      terminalId: context.terminalId,
      originNodeId: context.originNodeId,
      occurredAt: this.clock.now(),
      correlationId: context.correlationId
    };
  }

  private async persist(entries: readonly AuditEntry[]): Promise<void> {
    await this.unitOfWork.execute(() => this.auditWriter.append(entries));
  }
}

/**
 * Unidad de trabajo que asienta las denegaciones diferidas al terminar la
 * transacción del comando, en una transacción propia.
 *
 * Si el comando falló, su error prevalece: una evidencia perdida no se disfraza
 * de fallo distinto. Si el comando terminó y la evidencia no pudo escribirse,
 * el fallo se propaga en lugar de devolver una denegación no auditada.
 */
export class DeferredDenialUnitOfWork implements UnitOfWork {
  constructor(
    private readonly inner: UnitOfWork,
    private readonly authorization: Pick<AuditedAuthorizationService, 'flushDeferredDenials'>
  ) {}

  async execute<T>(work: () => Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await this.inner.execute(work);
    } catch (error) {
      await this.authorization.flushDeferredDenials().catch(() => undefined);
      throw error;
    }
    await this.authorization.flushDeferredDenials();
    return result;
  }
}
