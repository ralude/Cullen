import {
  canonicalJson,
  SYNC_PROTOCOL_VERSION_V1,
  type JsonValue,
  type SyncApplicationStateV1,
  type SyncEnvelopeV1,
  type SyncReceiptV1,
  type SyncRejectionCodeV1
} from '@supermarket/shared';
import type {
  AggregateAuthorityRegistry,
  Clock,
  IdGenerator,
  SyncReceptionStore,
  SyncSenderContext,
  UnitOfWork
} from '../ports/index.js';
import { validateSyncEnvelope } from './sync-envelope.js';
import type { SyncEventContractV1 } from './sync-contracts.js';

const envelopeIdentity = (envelope: SyncEnvelopeV1): string => canonicalJson({
  eventId: envelope.eventId,
  eventType: envelope.eventType,
  contractVersion: envelope.contractVersion,
  aggregateId: envelope.aggregateId,
  aggregateType: envelope.aggregateType,
  aggregateVersion: envelope.aggregateVersion,
  originNodeId: envelope.originNodeId,
  correlationId: envelope.correlationId,
  actorId: envelope.actorId,
  occurredAt: envelope.occurredAt,
  payload: envelope.payload as JsonValue
});

const measureBytes = (input: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(input) ?? '').length;
  } catch {
    return 0;
  }
};

/**
 * Señal interna de conflicto de identidad. Es un valor de retorno y no una
 * excepción: el `UnitOfWork` traduce cualquier error de la transacción a
 * indisponibilidad, y un conflicto permanente no debe reintentarse a ciegas.
 */
const IDENTITY_CONFLICT = Symbol('sync identity conflict');

/**
 * Comprueba emisor, origen declarado, terminal verificada y dueño conocido del
 * agregado. Un `originNodeId` autodeclarado no prueba ownership y no se adopta
 * al primer emisor como dueño de un agregado desconocido.
 */
export const resolveOwnership = (
  envelope: SyncEnvelopeV1,
  contract: SyncEventContractV1,
  sender: SyncSenderContext,
  authority: { readonly resolution: 'RESOLVED'; readonly ownerNodeId: string }
    | { readonly resolution: 'UNRESOLVED' }
): SyncRejectionCodeV1 | null => {
  if (envelope.originNodeId !== sender.verifiedNodeId) return 'SYNC_SENDER_NOT_AUTHORIZED';

  if (contract.payloadOriginField !== null) {
    const declared = envelope.payload[contract.payloadOriginField];
    if (declared !== envelope.originNodeId) return 'SYNC_SENDER_NOT_AUTHORIZED';
  }

  /**
   * La terminal que declara el contrato debe coincidir con la asociada al nodo
   * en el registro confiable: un nodo autorizado no presenta hechos de la
   * terminal de su vecina.
   */
  if (contract.payloadTerminalField !== null) {
    const declared = envelope.payload[contract.payloadTerminalField];
    if (sender.verifiedTerminalId === null || declared !== sender.verifiedTerminalId) {
      return 'SYNC_SENDER_NOT_AUTHORIZED';
    }
  }

  if (authority.resolution === 'RESOLVED') {
    return authority.ownerNodeId === envelope.originNodeId
      ? null
      : 'SYNC_SENDER_NOT_AUTHORIZED';
  }

  /**
   * Sin autoridad registrada, el catálogo solo se acepta desde la identidad
   * verificada del coordinador. Cualquier otro agregado queda sin resolver
   * hasta que un alta explícita registre su dueño.
   */
  if (contract.direction === 'COORDINATOR_TO_TERMINAL' &&
    sender.coordinatorNodeId !== null &&
    sender.coordinatorNodeId === sender.verifiedNodeId) {
    return null;
  }
  return 'SYNC_AGGREGATE_OWNER_UNRESOLVED';
};

/**
 * Frontera de aplicación del receptor. Autentica y autoriza antes de responder
 * incluso a un duplicado, y confirma deduplicación, custodia y trabajo de
 * aplicación pendiente en una sola transacción. La aceptación significa
 * custodia durable, no aplicación de efectos comerciales: el progreso comercial
 * se consulta por una lectura separada y el resultado v1 permanece inmutable.
 */
export class ReceiveSyncEvent {
  constructor(
    private readonly receiverNodeId: string,
    private readonly store: SyncReceptionStore,
    private readonly authorities: AggregateAuthorityRegistry,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator
  ) {}

  async execute(input: unknown, sender: SyncSenderContext): Promise<SyncReceiptV1> {
    const validation = validateSyncEnvelope(input);
    if (!validation.ok) {
      await this.quarantine(input, sender, this.eventIdOf(input), validation.code);
      return this.rejected(this.eventIdOf(input), validation.code);
    }
    const { envelope, contract } = validation;

    let authority;
    try {
      authority = await this.authorities.authorityFor(envelope.aggregateType, envelope.aggregateId);
    } catch {
      return this.retryable(envelope.eventId, 'SYNC_RECEIVER_UNAVAILABLE');
    }

    const ownership = resolveOwnership(envelope, contract, sender, authority);
    if (ownership) {
      await this.quarantine(input, sender, envelope.eventId, ownership);
      return this.rejected(envelope.eventId, ownership);
    }

    let custody: SyncReceiptV1 | typeof IDENTITY_CONFLICT;
    try {
      custody = await this.unitOfWork.execute(() =>
        this.takeCustody(envelope, contract, sender));
    } catch {
      return this.retryable(envelope.eventId, 'SYNC_RECEIVER_UNAVAILABLE');
    }
    if (custody !== IDENTITY_CONFLICT) return custody;

    await this.quarantine(input, sender, envelope.eventId, 'SYNC_EVENT_IDENTITY_CONFLICT');
    return this.rejected(envelope.eventId, 'SYNC_EVENT_IDENTITY_CONFLICT');
  }

  /**
   * Deduplicación, clasificación y registro en una unidad transaccional. La
   * clave única arbitra dos entregas concurrentes: quien pierde la carrera
   * relee y compara contra la custodia conservada; no declara duplicado a
   * ciegas ni sobrescribe el original.
   */
  private async takeCustody(
    envelope: SyncEnvelopeV1,
    contract: SyncEventContractV1,
    sender: SyncSenderContext
  ): Promise<SyncReceiptV1 | typeof IDENTITY_CONFLICT> {
    const existing = await this.store.findByEventId(envelope.eventId);
    if (existing) return this.settled(envelope, existing.envelope, existing.application);

    const application = await this.classifyApplication(envelope, contract);
    const outcome = await this.store.record({
      envelope,
      application,
      receivedAt: this.clock.now(),
      senderNodeId: sender.verifiedNodeId,
      consumers: contract.consumers
    });
    if (outcome === 'RECORDED') {
      return {
        protocolVersion: SYNC_PROTOCOL_VERSION_V1,
        eventId: envelope.eventId,
        receiverNodeId: this.receiverNodeId,
        status: 'ACCEPTED',
        application
      };
    }

    const raced = await this.store.findByEventId(envelope.eventId);
    if (!raced) throw new Error('Sync custody vanished after a unique key collision.');
    return this.settled(envelope, raced.envelope, raced.application);
  }

  private settled(
    envelope: SyncEnvelopeV1,
    stored: SyncEnvelopeV1,
    application: SyncApplicationStateV1
  ): SyncReceiptV1 | typeof IDENTITY_CONFLICT {
    if (envelopeIdentity(stored) !== envelopeIdentity(envelope)) return IDENTITY_CONFLICT;
    return {
      protocolVersion: SYNC_PROTOCOL_VERSION_V1,
      eventId: envelope.eventId,
      receiverNodeId: this.receiverNodeId,
      status: 'DUPLICATE',
      application
    };
  }

  /**
   * La falta de una dependencia entre agregados no invalida el hecho y un hecho
   * atrasado no retrocede una proyección: ambos se conservan con custodia
   * durable y aplicación pendiente.
   */
  private async classifyApplication(
    envelope: SyncEnvelopeV1,
    contract: SyncEventContractV1
  ): Promise<SyncApplicationStateV1> {
    const highest = await this.store.highestReceivedVersion(
      envelope.aggregateType,
      envelope.aggregateId
    );
    if (highest !== undefined && envelope.aggregateVersion < highest) return 'PENDING_REVIEW';

    for (const dependency of contract.dependencies(envelope.payload)) {
      const known = await this.store.highestReceivedVersion(
        dependency.aggregateType,
        dependency.aggregateId
      );
      if (known === undefined) return 'PENDING_DEPENDENCY';
    }
    return 'PENDING_CONSUMER';
  }

  /**
   * Aísla una entrada autenticada incompatible conservando evidencia acotada:
   * identidad propia, emisor verificado, código y tamaño. No guarda el body, no
   * emite ACK de aceptación y no puede sobrescribir un evento legítimo con el
   * mismo ID. Un fallo al aislar no altera la respuesta al emisor.
   */
  private async quarantine(
    input: unknown,
    sender: SyncSenderContext,
    declaredEventId: string,
    reasonCode: string
  ): Promise<void> {
    try {
      await this.unitOfWork.execute(() => this.store.quarantine({
        quarantineId: this.ids.generate(),
        declaredEventId: declaredEventId.length > 0 ? declaredEventId : null,
        senderNodeId: sender.verifiedNodeId,
        reasonCode,
        payloadBytes: measureBytes(input),
        receivedAt: this.clock.now()
      }));
    } catch {
      /* La cuarentena es evidencia de revisión, no parte de la custodia. */
    }
  }

  private eventIdOf(input: unknown): string {
    if (typeof input !== 'object' || input === null) return '';
    const candidate = (input as Record<string, unknown>).eventId;
    return typeof candidate === 'string' && candidate.length <= 128 ? candidate : '';
  }

  private rejected(eventId: string, code: SyncRejectionCodeV1): SyncReceiptV1 {
    return {
      protocolVersion: SYNC_PROTOCOL_VERSION_V1,
      eventId,
      receiverNodeId: this.receiverNodeId,
      status: 'REJECTED',
      code
    };
  }

  private retryable(eventId: string, code: string): SyncReceiptV1 {
    return {
      protocolVersion: SYNC_PROTOCOL_VERSION_V1,
      eventId,
      receiverNodeId: this.receiverNodeId,
      status: 'RETRYABLE',
      code
    };
  }
}
