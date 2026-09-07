import type { JsonValue } from '../events/index.js';

/**
 * Operaciones que cambian stock y requieren al coordinador (ADR-0026 D3).
 * El conjunto es cerrado: no hay un motor genérico de flujos distribuidos.
 */
export const COORDINATED_OPERATION_KINDS = [
  'PURCHASE_RECEIPT_COMPLETION',
  'STOCK_COUNT_APPROVAL',
  'SALE_RETURN'
] as const;
export type CoordinatedOperationKind = (typeof COORDINATED_OPERATION_KINDS)[number];

/**
 * Pasos de una operación distribuida. `LOCAL_EFFECT` son los efectos que el
 * nodo de origen confirma en su propia transacción; `COORDINATOR_EFFECT` es la
 * aplicación autoritativa en el coordinador, que solo él puede confirmar.
 */
export type CoordinatedStepName = 'LOCAL_EFFECT' | 'COORDINATOR_EFFECT';
export type CoordinatedStepState = 'PENDING' | 'APPLIED' | 'REJECTED';

/**
 * `PENDING_RECONCILIATION` es el estado honesto mientras falte evidencia de
 * algún paso obligatorio: no es éxito global ni cancelación por timeout.
 * `NEEDS_REVIEW` exige intervención humana, típicamente tras un rechazo
 * definitivo con efectos previos ya comprometidos.
 */
export type CoordinatedOperationStatus =
  | 'PENDING_RECONCILIATION'
  | 'COMPLETED'
  | 'NEEDS_REVIEW';

export type CoordinatedStepRecord = {
  readonly step: CoordinatedStepName;
  readonly state: CoordinatedStepState;
  readonly nodeId: string;
  readonly evidence: JsonValue;
  readonly recordedAt: Date;
};

export type CoordinatedOperationRecord = {
  readonly operationId: string;
  readonly kind: CoordinatedOperationKind;
  /** Huella estable de la intención: reintentarla encuentra la misma operación. */
  readonly fingerprint: string;
  readonly status: CoordinatedOperationStatus;
  readonly coordinatorNodeId: string | null;
  readonly actorId: string;
  readonly terminalId: string;
  readonly originNodeId: string;
  readonly correlationId: string;
  readonly reason: string;
  readonly startedAt: Date;
  readonly updatedAt: Date;
  readonly steps: readonly CoordinatedStepRecord[];
};

export type BeginCoordinatedOperationInput = {
  readonly operationId: string;
  readonly kind: CoordinatedOperationKind;
  readonly fingerprint: string;
  readonly coordinatorNodeId: string | null;
  readonly actorId: string;
  readonly terminalId: string;
  readonly originNodeId: string;
  readonly correlationId: string;
  readonly reason: string;
  readonly startedAt: Date;
  /** Pasos obligatorios de esta operación, en el orden en que se ejecutan. */
  readonly steps: readonly CoordinatedStepName[];
};

/**
 * Intención y resultado por paso de una operación distribuida, en el nodo de
 * origen. No abre transacciones de base mientras espera red.
 */
export interface CoordinatedOperationStore {
  /**
   * Registra la intención **antes** del primer efecto. Repetir la misma huella
   * devuelve la operación existente, con sus pasos ya registrados: es el punto
   * por el que la recuperación concilia la misma intención en lugar de crear
   * otra operación comercial.
   */
  begin(input: BeginCoordinatedOperationInput): Promise<CoordinatedOperationRecord>;
  findByFingerprint(
    kind: CoordinatedOperationKind,
    fingerprint: string
  ): Promise<CoordinatedOperationRecord | null>;
  findById(operationId: string): Promise<CoordinatedOperationRecord | null>;
  /**
   * Confirma el resultado de un paso. Registrar dos veces el mismo resultado no
   * cambia nada; un paso ya aplicado nunca retrocede.
   */
  recordStep(input: {
    readonly operationId: string;
    readonly step: CoordinatedStepName;
    readonly state: CoordinatedStepState;
    readonly nodeId: string;
    readonly evidence: JsonValue;
    readonly recordedAt: Date;
  }): Promise<CoordinatedOperationRecord>;
  listByStatus(
    status: CoordinatedOperationStatus
  ): Promise<readonly CoordinatedOperationRecord[]>;
}
