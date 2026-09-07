import { ApplicationError, err, ok, type AppError, type Result } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type { JsonValue } from '../events/index.js';
import type {
  AuditWriter,
  AuthorizationService,
  Clock,
  CoordinatedOperationKind,
  CoordinatedOperationRecord,
  CoordinatedOperationStatus,
  CoordinatedOperationStore,
  CoordinatedStepName,
  CoordinatedStepState,
  CoordinatorLink,
  IdGenerator,
  RemoteApplicationProbe,
  UnitOfWork
} from '../ports/index.js';
import { SYNC_PERMISSIONS } from './permissions.js';

/**
 * Coordinación LAN de las operaciones que cambian stock (ADR-0026 D3).
 *
 * Estar conectado no habilita una transacción que abarque dos SQLite. Lo que
 * hay es una intención durable en el origen, un resultado por paso y una
 * reconciliación que **consulta** esos resultados en lugar de repetir efectos.
 *
 * Un nodo sin coordinador —standalone— conserva su atomicidad local: no se le
 * exige enlace y su operación queda completa con su único paso.
 */
export class CoordinatedStockOperations {
  constructor(
    private readonly store: CoordinatedOperationStore,
    private readonly link: CoordinatorLink,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly auditWriter?: AuditWriter
  ) {}

  /**
   * Registra la intención antes del primer efecto y exige enlace con el
   * coordinador. Sin enlace devuelve error **sin haber tocado nada**: es la
   * restricción de D5, no una cancelación de algo ya iniciado.
   *
   * Repetir la misma huella devuelve la operación existente con sus pasos, de
   * modo que una recuperación concilia esa intención en lugar de abrir otra.
   */
  async begin(
    input: {
      readonly kind: CoordinatedOperationKind;
      readonly fingerprint: string;
      readonly reason: string;
    },
    context: ExecutionContext
  ): Promise<Result<CoordinatedOperationRecord, AppError>> {
    const existing = await this.store.findByFingerprint(input.kind, input.fingerprint);
    if (existing) return ok(existing);

    const coordinatorNodeId = this.link.coordinatorNodeId;
    if (coordinatorNodeId !== null && !await this.link.isReachable()) {
      return err(new ApplicationError(
        'SYNC_COORDINATION_REQUIRED',
        'This operation requires a reachable coordinator before starting any effect.',
        { details: { kind: input.kind } }
      ));
    }

    const now = this.clock.now();
    /** La intención y su auditoría se confirman juntas: una sin la otra no sirve. */
    const record = await this.unitOfWork.execute(async () => {
      const registered = await this.store.begin({
        operationId: this.ids.generate(),
        kind: input.kind,
        fingerprint: input.fingerprint,
        coordinatorNodeId,
        actorId: context.actorId,
        terminalId: context.terminalId,
        originNodeId: context.originNodeId,
        correlationId: context.correlationId,
        reason: input.reason,
        startedAt: now,
        /**
         * Un nodo standalone no tiene paso remoto que esperar. Declararlo y
         * dejarlo pendiente para siempre sería presentar como incompleta una
         * operación que sí terminó.
         */
        steps: coordinatorNodeId === null
          ? ['LOCAL_EFFECT']
          : ['LOCAL_EFFECT', 'COORDINATOR_EFFECT']
      });
      await this.auditWriter?.append([{
        auditId: this.ids.generate(),
        actorId: context.actorId,
        actorRoleCodes: context.actorRoleCodes ?? [],
        action: 'SYNC_COORDINATED_OPERATION_STARTED',
        entityType: 'SyncCoordinatedOperation',
        entityId: registered.operationId,
        before: null,
        after: { kind: input.kind, fingerprint: input.fingerprint } as unknown as JsonValue,
        reason: input.reason,
        terminalId: context.terminalId,
        originNodeId: context.originNodeId,
        occurredAt: now,
        correlationId: context.correlationId
      }]);
      return registered;
    });
    return ok(record);
  }

  /**
   * Confirma los efectos locales. La evidencia lleva los `eventId` con los que
   * la reconciliación pregunta al coordinador; sin ellos no habría forma de
   * saber si el paso remoto ocurrió.
   */
  async recordLocalEffect(
    operationId: string,
    eventIds: readonly string[],
    originNodeId: string
  ): Promise<CoordinatedOperationRecord> {
    return this.store.recordStep({
      operationId,
      step: 'LOCAL_EFFECT',
      state: 'APPLIED',
      nodeId: originNodeId,
      evidence: { eventIds: [...eventIds] } as unknown as JsonValue,
      recordedAt: this.clock.now()
    });
  }

  /**
   * Concilia las operaciones pendientes consultando al coordinador si ya aplicó
   * los hechos del paso local. No reenvía nada: el reenvío es del worker y su
   * política de retry, y repetir un efecto comercial no es una opción.
   */
  async reconcile(
    probe: RemoteApplicationProbe
  ): Promise<readonly CoordinatedOperationRecord[]> {
    const pending = await this.store.listByStatus('PENDING_RECONCILIATION');
    const reconciled: CoordinatedOperationRecord[] = [];
    for (const operation of pending) {
      const local = operation.steps.find(({ step }) => step === 'LOCAL_EFFECT');
      const remote = operation.steps.find(({ step }) => step === 'COORDINATOR_EFFECT');
      if (local?.state !== 'APPLIED' || remote === undefined ||
        remote.state === 'APPLIED' || operation.coordinatorNodeId === null) {
        reconciled.push(operation);
        continue;
      }
      const eventIds = eventIdsOf(local.evidence);
      if (eventIds.length === 0) {
        reconciled.push(operation);
        continue;
      }
      const states = await Promise.all(eventIds.map((eventId) => probe.applicationOf(eventId)));
      /**
       * Una discrepancia remota es un resultado definitivo: la intención pasa a
       * `NEEDS_REVIEW` con la evidencia de qué hecho la causó. Esperar no la
       * resuelve, y compensarla es una decisión humana, no un paso automático.
       */
      if (states.some((state) => state === 'DISCREPANCY')) {
        reconciled.push(await this.store.recordStep({
          operationId: operation.operationId,
          step: 'COORDINATOR_EFFECT',
          state: 'REJECTED',
          nodeId: operation.coordinatorNodeId,
          evidence: {
            eventIds: eventIds.filter((_, index) => states[index] === 'DISCREPANCY'),
            reasonCode: 'SYNC_REMOTE_APPLICATION_DISCREPANCY'
          } as unknown as JsonValue,
          recordedAt: this.clock.now()
        }));
        continue;
      }
      /**
       * Todos los hechos aplicados, o el paso sigue pendiente: un timeout o un
       * estado desconocido conservan `PENDING_RECONCILIATION`, nunca éxito.
       */
      if (!states.every((state) => state === 'APPLIED')) {
        reconciled.push(operation);
        continue;
      }
      reconciled.push(await this.store.recordStep({
        operationId: operation.operationId,
        step: 'COORDINATOR_EFFECT',
        state: 'APPLIED',
        nodeId: operation.coordinatorNodeId,
        evidence: { eventIds: [...eventIds] } as unknown as JsonValue,
        recordedAt: this.clock.now()
      }));
    }
    return reconciled;
  }
}

const eventIdsOf = (evidence: JsonValue): readonly string[] => {
  if (typeof evidence !== 'object' || evidence === null || Array.isArray(evidence)) return [];
  const value = (evidence as Record<string, JsonValue>).eventIds;
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? value as string[]
    : [];
};

export type CoordinatedOperationStepDto = {
  readonly step: CoordinatedStepName;
  readonly state: CoordinatedStepState;
  readonly nodeId: string;
  readonly recordedAt: string;
};

export type CoordinatedOperationDto = {
  readonly operationId: string;
  readonly kind: CoordinatedOperationKind;
  readonly status: CoordinatedOperationStatus;
  readonly fingerprint: string;
  readonly coordinatorNodeId: string | null;
  readonly reason: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly steps: readonly CoordinatedOperationStepDto[];
};

export const toCoordinatedOperationDto = (
  record: CoordinatedOperationRecord
): CoordinatedOperationDto => ({
  operationId: record.operationId,
  kind: record.kind,
  status: record.status,
  fingerprint: record.fingerprint,
  coordinatorNodeId: record.coordinatorNodeId,
  reason: record.reason,
  startedAt: record.startedAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
  /** La evidencia por paso no se expone: lleva identidades de hechos internos. */
  steps: record.steps.map((step) => ({
    step: step.step,
    state: step.state,
    nodeId: step.nodeId,
    recordedAt: step.recordedAt.toISOString()
  }))
});

/**
 * Operaciones distribuidas que todavía esperan evidencia, o que exigen
 * revisión. Es la lectura que hace visible el «pendiente de conciliación»: un
 * timeout no cancela nada y una operación sin todos sus pasos nunca se presenta
 * como exitosa.
 */
export class ListCoordinatedOperations {
  constructor(
    private readonly store: CoordinatedOperationStore,
    private readonly authorization: AuthorizationService
  ) {}

  async execute(
    status: CoordinatedOperationStatus,
    context: ExecutionContext
  ): Promise<Result<readonly CoordinatedOperationDto[], AppError>> {
    if (!await this.authorization.authorize(context, SYNC_PERMISSIONS.REVIEW_RECEPTION)) {
      return err(new ApplicationError(
        'FORBIDDEN',
        'Actor is not authorized to inspect coordinated operations.'
      ));
    }
    const records = await this.store.listByStatus(status);
    return ok(records.map(toCoordinatedOperationDto));
  }
}
