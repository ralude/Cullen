import type {
  SyncApplicationProgress,
  SyncDiscrepancyInput,
  SyncDiscrepancyRecord,
  SyncInboxWorkItem,
  SyncInboxWorkStore
} from '@supermarket/core';
import {
  SYNC_PROTOCOL_VERSION_V1,
  type JsonObject,
  type JsonValue
} from '@supermarket/shared';
import type { DatabaseHandle } from './connection.js';
import { mapDatabaseError, requireTransaction } from './unit-of-work.js';

type WorkRow = {
  readonly event_id: string;
  readonly consumer: string;
  readonly attempts: number;
  readonly event_type: string;
  readonly contract_version: number;
  readonly aggregate_id: string;
  readonly aggregate_type: string;
  readonly aggregate_version: number;
  readonly origin_node_id: string;
  readonly correlation_id: string;
  readonly actor_id: string;
  readonly occurred_at: number;
  readonly payload: string;
};

type DiscrepancyRow = {
  readonly discrepancy_id: string;
  readonly event_id: string;
  readonly consumer: string;
  readonly reason_code: string;
  readonly detail: string;
  readonly status: 'OPEN' | 'RESOLVED';
  readonly opened_at: number;
  readonly resolved_at: number | null;
  readonly resolved_by: string | null;
  readonly resolution_reason: string | null;
};

const toWorkItem = (row: WorkRow): SyncInboxWorkItem => ({
  eventId: row.event_id,
  consumer: row.consumer,
  attempts: row.attempts,
  envelope: {
    protocolVersion: SYNC_PROTOCOL_VERSION_V1,
    eventId: row.event_id,
    eventType: row.event_type,
    contractVersion: row.contract_version,
    aggregateId: row.aggregate_id,
    aggregateType: row.aggregate_type,
    aggregateVersion: row.aggregate_version,
    originNodeId: row.origin_node_id,
    correlationId: row.correlation_id,
    actorId: row.actor_id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    payload: JSON.parse(row.payload) as JsonObject
  }
});

const toDiscrepancy = (row: DiscrepancyRow): SyncDiscrepancyRecord => ({
  discrepancyId: row.discrepancy_id,
  eventId: row.event_id,
  consumer: row.consumer,
  reasonCode: row.reason_code,
  detail: JSON.parse(row.detail) as JsonValue,
  status: row.status,
  openedAt: new Date(row.opened_at),
  resolvedAt: row.resolved_at === null ? null : new Date(row.resolved_at),
  resolvedBy: row.resolved_by,
  resolutionReason: row.resolution_reason
});

/**
 * Trabajo de aplicación del receptor. Reclamar incrementa `attempts`, que actúa
 * como generación del claim: una confirmación de una generación anterior no
 * marca progreso y un lease vencido permite retomar la tarea tras un reinicio.
 */
export class DrizzleSyncInboxWorkStore implements SyncInboxWorkStore {
  constructor(private readonly handle: DatabaseHandle) {}

  async claimPending(
    now: Date,
    leaseUntil: Date,
    limit: number
  ): Promise<readonly SyncInboxWorkItem[]> {
    requireTransaction(this.handle.sqlite);
    try {
      const timestamp = now.getTime();
      const rows = this.handle.sqlite.prepare(`
        select work.event_id, work.consumer, work.attempts, event.event_type,
          event.contract_version, event.aggregate_id, event.aggregate_type,
          event.aggregate_version, event.origin_node_id, event.correlation_id,
          event.actor_id, event.occurred_at, event.payload
        from sync_inbox_work work
        join sync_inbox_event event on event.event_id = work.event_id
        where work.state = 'PENDING'
          and work.next_attempt_at <= ?
          and (work.lease_until is null or work.lease_until <= ?)
        order by event.received_at, work.event_id, work.consumer
        limit ?
      `).all(timestamp, timestamp, limit) as WorkRow[];

      const claim = this.handle.sqlite.prepare(`
        update sync_inbox_work
        set attempts = attempts + 1, lease_until = ?
        where event_id = ? and consumer = ? and attempts = ? and state = 'PENDING'
      `);
      for (const row of rows) {
        claim.run(leaseUntil.getTime(), row.event_id, row.consumer, row.attempts);
      }
      return rows.map((row) => toWorkItem({ ...row, attempts: row.attempts + 1 }));
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async isClaimActive(
    eventId: string,
    consumer: string,
    attempts: number,
    now: Date
  ): Promise<boolean> {
    try {
      return this.handle.sqlite.prepare(`
        select 1 from sync_inbox_work
        where event_id = ? and consumer = ? and attempts = ?
          and state = 'PENDING' and lease_until > ?
      `).get(eventId, consumer, attempts, now.getTime()) !== undefined;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async markApplied(
    eventId: string,
    consumer: string,
    attempts: number,
    appliedAt: Date
  ): Promise<boolean> {
    requireTransaction(this.handle.sqlite);
    try {
      return this.handle.sqlite.prepare(`
        update sync_inbox_work
        set state = 'APPLIED', lease_until = null, last_error = null,
          applied_at = ?, updated_at = ?
        where event_id = ? and consumer = ? and attempts = ? and state = 'PENDING'
      `).run(appliedAt.getTime(), appliedAt.getTime(), eventId, consumer, attempts)
        .changes === 1;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async markRetryable(
    eventId: string,
    consumer: string,
    attempts: number,
    nextAttemptAt: Date,
    errorCode: string
  ): Promise<boolean> {
    requireTransaction(this.handle.sqlite);
    try {
      return this.handle.sqlite.prepare(`
        update sync_inbox_work
        set lease_until = null, next_attempt_at = ?, last_error = ?, updated_at = ?
        where event_id = ? and consumer = ? and attempts = ? and state = 'PENDING'
      `).run(
        nextAttemptAt.getTime(), errorCode, nextAttemptAt.getTime(), eventId, consumer, attempts
      ).changes === 1;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async openDiscrepancy(entry: SyncDiscrepancyInput, attempts: number): Promise<boolean> {
    requireTransaction(this.handle.sqlite);
    try {
      const moved = this.handle.sqlite.prepare(`
        update sync_inbox_work
        set state = 'DISCREPANCY', lease_until = null, last_error = ?, updated_at = ?
        where event_id = ? and consumer = ? and attempts = ? and state = 'PENDING'
      `).run(
        entry.reasonCode, entry.occurredAt.getTime(), entry.eventId, entry.consumer, attempts
      ).changes === 1;
      if (!moved) return false;

      /**
       * Una discrepancia única por evento y consumidor: una reentrega o un
       * reintento posterior no abre otra ni duplica evidencia.
       */
      this.handle.sqlite.prepare(`
        insert into sync_discrepancy (
          discrepancy_id, event_id, consumer, reason_code, detail, status,
          opened_at, updated_at
        ) values (?, ?, ?, ?, ?, 'OPEN', ?, ?)
        on conflict(event_id, consumer) do nothing
      `).run(
        entry.discrepancyId,
        entry.eventId,
        entry.consumer,
        entry.reasonCode,
        JSON.stringify(entry.detail ?? null),
        entry.occurredAt.getTime(),
        entry.occurredAt.getTime()
      );
      return true;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async isDependencyApplied(aggregateType: string, aggregateId: string): Promise<boolean> {
    try {
      const received = this.handle.sqlite.prepare(`
        select 1 from sync_inbox_event where aggregate_type = ? and aggregate_id = ?
      `).get(aggregateType, aggregateId) !== undefined;
      if (!received) return false;
      return this.handle.sqlite.prepare(`
        select 1
        from sync_inbox_work work
        join sync_inbox_event event on event.event_id = work.event_id
        where event.aggregate_type = ? and event.aggregate_id = ? and work.state <> 'APPLIED'
      `).get(aggregateType, aggregateId) === undefined;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async listDiscrepancies(
    status: 'OPEN' | 'RESOLVED'
  ): Promise<readonly SyncDiscrepancyRecord[]> {
    try {
      const rows = this.handle.sqlite.prepare(
        'select * from sync_discrepancy where status = ? order by opened_at, discrepancy_id'
      ).all(status) as DiscrepancyRow[];
      return rows.map(toDiscrepancy);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findDiscrepancy(discrepancyId: string): Promise<SyncDiscrepancyRecord | undefined> {
    try {
      const row = this.handle.sqlite
        .prepare('select * from sync_discrepancy where discrepancy_id = ?')
        .get(discrepancyId) as DiscrepancyRow | undefined;
      return row ? toDiscrepancy(row) : undefined;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async scheduleDiscrepancyRetry(discrepancyId: string, now: Date): Promise<boolean> {
    requireTransaction(this.handle.sqlite);
    try {
      return this.handle.sqlite.prepare(`
        update sync_inbox_work
        set state = 'PENDING', next_attempt_at = ?, lease_until = null, updated_at = ?
        where state = 'DISCREPANCY' and (event_id, consumer) in (
          select event_id, consumer from sync_discrepancy
          where discrepancy_id = ? and status = 'OPEN'
        )
      `).run(now.getTime(), now.getTime(), discrepancyId).changes === 1;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  /**
   * Solo evidencia de aplicación cierra una discrepancia: mientras su tarea no
   * esté `APPLIED`, la obligación de inventario permanece abierta.
   */
  async resolveDiscrepancy(
    discrepancyId: string,
    resolvedAt: Date,
    resolvedBy: string,
    reason: string
  ): Promise<boolean> {
    requireTransaction(this.handle.sqlite);
    try {
      return this.handle.sqlite.prepare(`
        update sync_discrepancy
        set status = 'RESOLVED', resolved_at = ?, resolved_by = ?, resolution_reason = ?,
          updated_at = ?
        where discrepancy_id = ? and status = 'OPEN' and exists (
          select 1 from sync_inbox_work work
          where work.event_id = sync_discrepancy.event_id
            and work.consumer = sync_discrepancy.consumer
            and work.state = 'APPLIED'
        )
      `).run(
        resolvedAt.getTime(), resolvedBy, reason, resolvedAt.getTime(), discrepancyId
      ).changes === 1;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  /**
   * Progreso de aplicación de un hecho. Sin custodia responde `NONE`: no
   * conocerlo nunca equivale a haberlo aplicado. Con custodia y sin trabajo
   * pendiente responde `APPLIED`, que también cubre a los contratos sin
   * consumidor implementado, donde no hay efecto que esperar.
   */
  async applicationProgress(eventId: string): Promise<SyncApplicationProgress> {
    try {
      const custody = this.handle.sqlite.prepare(
        'select count(*) from sync_inbox_event where event_id = ?'
      ).pluck().get(eventId) as number;
      if (custody === 0) return 'NONE';
      const pending = this.handle.sqlite.prepare(
        "select count(*) from sync_inbox_work where event_id = ? and state <> 'APPLIED'"
      ).pluck().get(eventId) as number;
      return pending === 0 ? 'APPLIED' : 'PENDING';
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async countPendingFor(consumer: string): Promise<number> {
    try {
      return this.handle.sqlite.prepare(
        "select count(*) from sync_inbox_work where consumer = ? and state <> 'APPLIED'"
      ).pluck().get(consumer) as number;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async countPending(): Promise<number> {
    try {
      return this.handle.sqlite.prepare(
        "select count(*) from sync_inbox_work where state <> 'APPLIED'"
      ).pluck().get() as number;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
