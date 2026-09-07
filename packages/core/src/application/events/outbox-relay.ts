import type { Clock, EventPublisher, OutboxEvent, OutboxStore, UnitOfWork } from '../ports/index.js';
import { ApplicationError, type SyncEnvelopeV1 } from '@supermarket/shared';
import { interpretSyncAck } from './sync-ack.js';
import { toSyncEnvelope, validateSyncEnvelope } from './sync-envelope.js';

const MAX_BATCH_SIZE = 100;
const DEFAULT_LEASE_MILLISECONDS = 30_000;

/**
 * Política de reintento aprobada en ADR-0026 D6: diez envíos efectivos por
 * evento y destino dentro de un ciclo, backoff exponencial de base 1 s con
 * tope de 60 s y jitter acotado al tope. Al agotarse, la entrega queda pausada
 * de forma durable hasta una reanudación autorizada.
 */
export const OUTBOX_RETRY_POLICY_V1 = {
  attemptsPerCycle: 10,
  baseMilliseconds: 1_000,
  capMilliseconds: 60_000
} as const;

export type OutboxRelayOptions = {
  readonly leaseMilliseconds?: number;
  /** Jitter en `[0, 1)`; el reloj de pruebas lo fija para evitar esperas reales. */
  readonly jitter?: () => number;
};

type PreparedDelivery =
  | { readonly ok: true; readonly envelope: SyncEnvelopeV1 }
  | { readonly ok: false; readonly code: string };

/**
 * Verifica el contrato saliente contra el catálogo haciendo el mismo
 * round-trip JSON que hará la red. Un contrato local incompatible se detecta
 * aquí y se aísla; no se publica ni se reintenta a ciegas.
 */
const prepareDelivery = (event: OutboxEvent): PreparedDelivery => {
  let wire: unknown;
  try {
    wire = JSON.parse(JSON.stringify(toSyncEnvelope(event))) as unknown;
  } catch {
    return { ok: false, code: 'SYNC_ENVELOPE_INVALID' };
  }
  const validation = validateSyncEnvelope(wire);
  return validation.ok
    ? { ok: true, envelope: validation.envelope }
    : { ok: false, code: validation.code };
};

/**
 * Entrega la salida local a un destino concreto. Cada destino tiene su propio
 * relay: el ACK de una terminal no confirma a otra y una terminal desconectada
 * no bloquea la entrega a su vecina. Las llamadas de red quedan fuera de toda
 * transacción de base de datos.
 */
export class OutboxRelay {
  private readonly leaseMilliseconds: number;
  private readonly jitter: () => number;

  constructor(
    private readonly destinationNodeId: string,
    private readonly store: OutboxStore,
    private readonly publisher: EventPublisher,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    options: OutboxRelayOptions = {}
  ) {
    this.leaseMilliseconds = options.leaseMilliseconds ?? DEFAULT_LEASE_MILLISECONDS;
    this.jitter = options.jitter ?? Math.random;
  }

  async runBatch(limit = 20): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
      throw new ApplicationError(
        'OUTBOX_BATCH_LIMIT_INVALID',
        `Outbox batch limit must be between 1 and ${MAX_BATCH_SIZE}.`
      );
    }

    const claimedAt = this.clock.now();
    const events = await this.unitOfWork.execute(() => this.store.claimAvailable(
      this.destinationNodeId,
      claimedAt,
      new Date(claimedAt.getTime() + this.leaseMilliseconds),
      limit
    ));

    let processed = 0;
    for (const event of events) {
      /**
       * El lease puede vencer mientras se procesa otro evento del lote: se
       * revalida antes de enviar, no solo al reclamar.
       */
      const active = await this.unitOfWork.execute(() => this.store.isClaimActive(
        event.eventId,
        this.destinationNodeId,
        event.attempts,
        this.clock.now()
      ));
      if (!active) continue;

      const prepared = prepareDelivery(event);
      if (!prepared.ok) {
        if (await this.block(event, prepared.code)) processed += 1;
        continue;
      }

      let acknowledgement: unknown;
      try {
        acknowledgement = await this.publisher.publish(prepared.envelope);
      } catch {
        if (await this.reschedule(event, 'EVENT_PUBLICATION_FAILED')) processed += 1;
        continue;
      }

      const delivery = interpretSyncAck(acknowledgement, {
        envelope: prepared.envelope,
        destinationNodeId: this.destinationNodeId
      });
      if (delivery.outcome === 'REJECTED') {
        if (await this.block(event, delivery.code)) processed += 1;
        continue;
      }
      if (delivery.outcome === 'RETRYABLE') {
        if (await this.reschedule(event, delivery.code)) processed += 1;
        continue;
      }

      const published = await this.unitOfWork.execute(() => this.store.markPublished(
        event.eventId,
        this.destinationNodeId,
        event.attempts,
        this.clock.now()
      ));
      if (published) processed += 1;
    }
    return processed;
  }

  private block(event: OutboxEvent, errorCode: string): Promise<boolean> {
    return this.unitOfWork.execute(() => this.store.markBlocked(
      event.eventId,
      this.destinationNodeId,
      event.attempts,
      errorCode
    ));
  }

  /**
   * Consume el presupuesto del ciclo. Al agotarlo la entrega queda pausada de
   * forma durable: reconectar o reiniciar no abre otro ciclo, y la generación
   * monotónica del claim se conserva para descartar confirmaciones tardías.
   */
  private reschedule(event: OutboxEvent, errorCode: string): Promise<boolean> {
    if (event.cycleAttempts >= OUTBOX_RETRY_POLICY_V1.attemptsPerCycle) {
      return this.unitOfWork.execute(() => this.store.markPaused(
        event.eventId,
        this.destinationNodeId,
        event.attempts,
        errorCode
      ));
    }
    const backoff = Math.min(
      OUTBOX_RETRY_POLICY_V1.capMilliseconds,
      OUTBOX_RETRY_POLICY_V1.baseMilliseconds *
        2 ** Math.min(event.cycleAttempts - 1, 6)
    );
    const delay = Math.min(
      OUTBOX_RETRY_POLICY_V1.capMilliseconds,
      Math.round(backoff * (1 + this.jitter()))
    );
    return this.unitOfWork.execute(() => this.store.markFailed(
      event.eventId,
      this.destinationNodeId,
      event.attempts,
      new Date(this.clock.now().getTime() + delay),
      errorCode
    ));
  }
}
