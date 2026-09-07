import type { BusinessEventV1 } from '../events/index.js';

export type OutboxEvent = BusinessEventV1 & {
  readonly status: 'PROCESSING';
  /** Generación monotónica del claim para este destino. */
  readonly attempts: number;
  /** Envíos ya consumidos del presupuesto del ciclo vigente. */
  readonly cycleAttempts: number;
};

/**
 * Resumen de la salida hacia un destino, para las lecturas de estado. Cuenta
 * evidencia durable: una salida vacía no basta para declarar `SYNCED`, y una
 * fila pausada o bloqueada exige intervención aunque no queden pendientes.
 */
export type OutboxDestinationSummary = {
  readonly destinationNodeId: string;
  readonly pending: number;
  readonly paused: number;
  readonly blocked: number;
  readonly lastPublishedAt: Date | null;
  readonly lastError: string | null;
};

/**
 * Salida local. El payload se conserva una vez y el estado de entrega es
 * independiente por `(eventId, destinationNodeId)`: un ACK de una terminal no
 * confirma a otra, y retirar un destino no convierte pendientes en publicados.
 */
export interface OutboxStore {
  enqueue(events: readonly BusinessEventV1[]): Promise<void>;
  claimAvailable(
    destinationNodeId: string,
    now: Date,
    leaseUntil: Date,
    limit: number
  ): Promise<readonly OutboxEvent[]>;
  isClaimActive(
    eventId: string,
    destinationNodeId: string,
    attempts: number,
    now: Date
  ): Promise<boolean>;
  markPublished(
    eventId: string,
    destinationNodeId: string,
    attempts: number,
    publishedAt: Date
  ): Promise<boolean>;
  markFailed(
    eventId: string,
    destinationNodeId: string,
    attempts: number,
    nextAttemptAt: Date,
    errorCode: string
  ): Promise<boolean>;
  /**
   * Aísla un contrato incompatible o rechazado de forma permanente. La fila
   * conserva payload, identidad e intentos, deja de reclamarse y sigue
   * bloqueando a sus sucesores; nunca pasa a `PUBLISHED` para desbloquearlos.
   */
  markBlocked(
    eventId: string,
    destinationNodeId: string,
    attempts: number,
    errorCode: string
  ): Promise<boolean>;
  /**
   * Agota el presupuesto del ciclo y pausa la entrega de forma durable.
   * Reconectar o reiniciar no abre otro ciclo ni resetea intentos.
   */
  markPaused(
    eventId: string,
    destinationNodeId: string,
    attempts: number,
    errorCode: string
  ): Promise<boolean>;
  /**
   * Reanudación autorizada: reabre el presupuesto del ciclo conservando la
   * generación del claim, el payload y la historia de la fila.
   */
  resumeDelivery(
    eventId: string,
    destinationNodeId: string,
    now: Date,
    resumedBy: string
  ): Promise<boolean>;
  summarize(destinationNodeId: string): Promise<OutboxDestinationSummary>;
  listPaused(destinationNodeId: string): Promise<readonly {
    readonly eventId: string;
    readonly lastError: string | null;
    readonly pausedAt: Date;
  }[]>;
}
