import type {
  BeginCoordinatedOperationInput,
  CoordinatedOperationKind,
  CoordinatedOperationRecord,
  CoordinatedOperationStatus,
  CoordinatedOperationStore,
  CoordinatedStepName,
  CoordinatedStepRecord,
  CoordinatedStepState,
  JsonValue
} from '@supermarket/core';
import type { DatabaseHandle } from './connection.js';
import { mapDatabaseError, requireTransaction } from './unit-of-work.js';

type OperationRow = {
  operationId: string;
  kind: CoordinatedOperationKind;
  fingerprint: string;
  status: CoordinatedOperationStatus;
  coordinatorNodeId: string | null;
  actorId: string;
  terminalId: string;
  originNodeId: string;
  correlationId: string;
  reason: string;
  startedAt: number;
  updatedAt: number;
};

type StepRow = {
  step: CoordinatedStepName;
  state: CoordinatedStepState;
  nodeId: string;
  evidence: string | null;
  recordedAt: number;
};

const parseEvidence = (value: string | null): JsonValue => {
  if (value === null) return null;
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return null;
  }
};

/**
 * Intención y resultado por paso de las operaciones distribuidas de stock.
 *
 * El estado de la operación se **deriva** de sus pasos en cada escritura: no es
 * un campo que alguien pueda adelantar por su cuenta. Sin evidencia de todos
 * los pasos obligatorios queda `PENDING_RECONCILIATION`, y un rechazo la lleva
 * a `NEEDS_REVIEW` porque puede haber efectos previos ya comprometidos.
 */
export class SqliteCoordinatedOperationStore implements CoordinatedOperationStore {
  constructor(private readonly handle: DatabaseHandle) {}

  async begin(input: BeginCoordinatedOperationInput): Promise<CoordinatedOperationRecord> {
    requireTransaction(this.handle.sqlite);
    try {
      this.handle.sqlite.prepare(`
        insert into sync_coordinated_operation (
          operation_id, kind, fingerprint, status, coordinator_node_id, actor_id,
          terminal_id, origin_node_id, correlation_id, reason, started_at, updated_at
        ) values (?, ?, ?, 'PENDING_RECONCILIATION', ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict (kind, fingerprint) do nothing
      `).run(
        input.operationId,
        input.kind,
        input.fingerprint,
        input.coordinatorNodeId,
        input.actorId,
        input.terminalId,
        input.originNodeId,
        input.correlationId,
        input.reason,
        input.startedAt.getTime(),
        input.startedAt.getTime()
      );
      const existing = this.readByFingerprint(input.kind, input.fingerprint);
      if (existing === null) {
        throw new Error('coordinated operation could not be registered');
      }
      const insertStep = this.handle.sqlite.prepare(`
        insert into sync_coordinated_step (
          operation_id, step, state, node_id, evidence, recorded_at
        ) values (?, ?, 'PENDING', ?, null, ?)
        on conflict (operation_id, step) do nothing
      `);
      for (const step of input.steps) {
        insertStep.run(
          existing.operationId,
          step,
          step === 'COORDINATOR_EFFECT' && input.coordinatorNodeId !== null
            ? input.coordinatorNodeId
            : input.originNodeId,
          input.startedAt.getTime()
        );
      }
      return this.require(existing.operationId);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findByFingerprint(
    kind: CoordinatedOperationKind,
    fingerprint: string
  ): Promise<CoordinatedOperationRecord | null> {
    try {
      const row = this.readByFingerprint(kind, fingerprint);
      return row === null ? null : this.require(row.operationId);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findById(operationId: string): Promise<CoordinatedOperationRecord | null> {
    try {
      return this.read(operationId);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async recordStep(input: {
    readonly operationId: string;
    readonly step: CoordinatedStepName;
    readonly state: CoordinatedStepState;
    readonly nodeId: string;
    readonly evidence: JsonValue;
    readonly recordedAt: Date;
  }): Promise<CoordinatedOperationRecord> {
    try {
      this.handle.sqlite.prepare(`
        insert into sync_coordinated_step (
          operation_id, step, state, node_id, evidence, recorded_at
        ) values (?, ?, ?, ?, ?, ?)
        on conflict (operation_id, step) do update set
          state = excluded.state,
          node_id = excluded.node_id,
          evidence = excluded.evidence,
          recorded_at = excluded.recorded_at
          where sync_coordinated_step.state != 'APPLIED'
      `).run(
        input.operationId,
        input.step,
        input.state,
        input.nodeId,
        JSON.stringify(input.evidence),
        input.recordedAt.getTime()
      );
      this.refreshStatus(input.operationId, input.recordedAt);
      return this.require(input.operationId);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async listByStatus(
    status: CoordinatedOperationStatus
  ): Promise<readonly CoordinatedOperationRecord[]> {
    try {
      const ids = this.handle.sqlite.prepare(`
        select operation_id from sync_coordinated_operation
        where status = ? order by started_at, operation_id
      `).pluck().all(status) as string[];
      return ids.map((operationId) => this.require(operationId));
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  /** El estado se deriva de los pasos; nunca se declara por separado. */
  private refreshStatus(operationId: string, at: Date): void {
    const steps = this.steps(operationId);
    const status: CoordinatedOperationStatus =
      steps.some(({ state }) => state === 'REJECTED')
        ? 'NEEDS_REVIEW'
        : steps.every(({ state }) => state === 'APPLIED')
          ? 'COMPLETED'
          : 'PENDING_RECONCILIATION';
    this.handle.sqlite.prepare(`
      update sync_coordinated_operation set status = ?, updated_at = ?
      where operation_id = ?
    `).run(status, at.getTime(), operationId);
  }

  private readByFingerprint(
    kind: CoordinatedOperationKind,
    fingerprint: string
  ): OperationRow | null {
    return (this.handle.sqlite.prepare(`
      ${OPERATION_COLUMNS} where kind = ? and fingerprint = ?
    `).get(kind, fingerprint) as OperationRow | undefined) ?? null;
  }

  private read(operationId: string): CoordinatedOperationRecord | null {
    const row = this.handle.sqlite
      .prepare(`${OPERATION_COLUMNS} where operation_id = ?`)
      .get(operationId) as OperationRow | undefined;
    if (row === undefined) return null;
    return {
      operationId: row.operationId,
      kind: row.kind,
      fingerprint: row.fingerprint,
      status: row.status,
      coordinatorNodeId: row.coordinatorNodeId,
      actorId: row.actorId,
      terminalId: row.terminalId,
      originNodeId: row.originNodeId,
      correlationId: row.correlationId,
      reason: row.reason,
      startedAt: new Date(row.startedAt),
      updatedAt: new Date(row.updatedAt),
      steps: this.steps(operationId)
    };
  }

  private require(operationId: string): CoordinatedOperationRecord {
    const record = this.read(operationId);
    if (record === null) throw new Error('coordinated operation was not found');
    return record;
  }

  private steps(operationId: string): readonly CoordinatedStepRecord[] {
    const rows = this.handle.sqlite.prepare(`
      select step, state, node_id as nodeId, evidence, recorded_at as recordedAt
      from sync_coordinated_step where operation_id = ? order by step
    `).all(operationId) as StepRow[];
    return rows.map((row) => ({
      step: row.step,
      state: row.state,
      nodeId: row.nodeId,
      evidence: parseEvidence(row.evidence),
      recordedAt: new Date(row.recordedAt)
    }));
  }
}

const OPERATION_COLUMNS = `
  select operation_id as operationId, kind, fingerprint, status,
    coordinator_node_id as coordinatorNodeId, actor_id as actorId,
    terminal_id as terminalId, origin_node_id as originNodeId,
    correlation_id as correlationId, reason,
    started_at as startedAt, updated_at as updatedAt
  from sync_coordinated_operation
`;
