import type { JsonValue, SyncEnvelopeV1 } from '@supermarket/shared';

/**
 * Trabajo de aplicación reclamado por el procesador. `attempts` es la
 * generación del claim: una confirmación de una generación anterior no puede
 * marcar progreso.
 */
export type SyncInboxWorkItem = {
  readonly eventId: string;
  readonly consumer: string;
  readonly attempts: number;
  readonly envelope: SyncEnvelopeV1;
};

export type SyncDiscrepancyRecord = {
  readonly discrepancyId: string;
  readonly eventId: string;
  readonly consumer: string;
  readonly reasonCode: string;
  readonly detail: JsonValue;
  readonly status: 'OPEN' | 'RESOLVED';
  readonly openedAt: Date;
  readonly resolvedAt: Date | null;
  readonly resolvedBy: string | null;
  readonly resolutionReason: string | null;
};

export type SyncDiscrepancyInput = {
  readonly discrepancyId: string;
  readonly eventId: string;
  readonly consumer: string;
  readonly reasonCode: string;
  readonly detail: JsonValue;
  readonly occurredAt: Date;
};

/**
 * Estado durable del procesamiento posterior a la custodia. Separa la
 * recepción de la aplicación: un fallo después del ACK conserva la tarea y
 * reiniciar la recupera, sin obligar al emisor a repetir el hecho.
 */
export interface SyncInboxWorkStore {
  claimPending(
    now: Date,
    leaseUntil: Date,
    limit: number
  ): Promise<readonly SyncInboxWorkItem[]>;
  isClaimActive(
    eventId: string,
    consumer: string,
    attempts: number,
    now: Date
  ): Promise<boolean>;
  markApplied(
    eventId: string,
    consumer: string,
    attempts: number,
    appliedAt: Date
  ): Promise<boolean>;
  markRetryable(
    eventId: string,
    consumer: string,
    attempts: number,
    nextAttemptAt: Date,
    errorCode: string
  ): Promise<boolean>;
  /**
   * Marca la tarea como discrepancia y registra su evidencia única. Una
   * reentrega posterior no abre otra discrepancia ni duplica movimientos.
   */
  openDiscrepancy(
    entry: SyncDiscrepancyInput,
    attempts: number
  ): Promise<boolean>;
  /**
   * Una dependencia recibida no equivale a aplicada: comprueba la condición
   * real sobre el agregado referenciado.
   */
  isDependencyApplied(aggregateType: string, aggregateId: string): Promise<boolean>;
  listDiscrepancies(status: 'OPEN' | 'RESOLVED'): Promise<readonly SyncDiscrepancyRecord[]>;
  findDiscrepancy(discrepancyId: string): Promise<SyncDiscrepancyRecord | undefined>;
  /** Vuelve a habilitar la tarea de una discrepancia tras corregir su causa. */
  scheduleDiscrepancyRetry(discrepancyId: string, now: Date): Promise<boolean>;
  resolveDiscrepancy(
    discrepancyId: string,
    resolvedAt: Date,
    resolvedBy: string,
    reason: string
  ): Promise<boolean>;
  countPending(): Promise<number>;
  /** Trabajo sin aplicar de un consumidor concreto. */
  countPendingFor(consumer: string): Promise<number>;
  /**
   * Progreso de aplicación de un hecho. Es la lectura separada que ADR-0026 D2
   * exige: el ACK de recepción conserva su resultado inmutable y el progreso
   * comercial se consulta aparte. Un hecho sin consumidor implementado queda
   * `APPLIED` en cuanto tiene custodia, porque no hay efecto que esperar.
   */
  applicationProgress(eventId: string): Promise<SyncApplicationProgress>;
}

/**
 * Progreso de aplicación de un hecho ya recibido. `NONE` significa que este
 * receptor no tiene custodia del evento; nunca se responde `APPLIED` por
 * desconocerlo. `DISCREPANCY` distingue una aplicación abierta a revisión de
 * una que simplemente todavía no ocurrió: esperar no la resuelve.
 */
export type SyncApplicationProgress = 'APPLIED' | 'PENDING' | 'DISCREPANCY' | 'NONE';
