import {
  application,
  type BusinessEventV1,
  type JsonValue,
  type OutboxDestinationSummary,
  type OutboxEvent,
  type OutboxStore
} from '@supermarket/core';
import type { DatabaseHandle } from './connection.js';
import { outboxEvents } from './schema.js';
import { mapDatabaseError, requireTransaction } from './unit-of-work.js';

type OutboxRow = {
  readonly event_id: string;
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
  readonly attempts: number;
  readonly cycle_attempts: number;
};

/**
 * Salida local con estado de entrega por destino. `outbox_event` conserva el
 * payload y la historia local; `sync_delivery` conserva claim, generación,
 * presupuesto de ciclo y resultado de cada destino por separado.
 *
 * Las filas de entrega se materializan al reclamar: un destino que todavía no
 * existía recibe los hechos pendientes sin copiar sus payloads.
 */
export class DrizzleOutboxStore implements OutboxStore {
  constructor(private readonly handle: DatabaseHandle) {}

  async enqueue(events: readonly BusinessEventV1[]): Promise<void> {
    requireTransaction(this.handle.sqlite);
    if (events.length === 0) return;
    try {
      this.handle.db.insert(outboxEvents).values(events.map((event) => ({
        ...event,
        occurredAt: event.occurredAt.getTime(),
        payload: JSON.stringify(event.payload),
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: event.occurredAt.getTime(),
        leaseUntil: null,
        lastError: null,
        publishedAt: null,
        createdAt: event.occurredAt.getTime()
      }))).onConflictDoNothing({ target: outboxEvents.eventId }).run();
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async claimAvailable(
    destinationNodeId: string,
    now: Date,
    leaseUntil: Date,
    limit: number
  ): Promise<readonly OutboxEvent[]> {
    requireTransaction(this.handle.sqlite);
    try {
      const timestamp = now.getTime();
      this.materialize(destinationNodeId, timestamp);

      const rows = this.handle.sqlite.prepare(`
        select candidate.*, delivery.attempts as attempts,
          delivery.cycle_attempts as cycle_attempts
        from outbox_event candidate
        join sync_delivery delivery
          on delivery.event_id = candidate.event_id
          and delivery.destination_node_id = ?
        where (
          (delivery.status = 'PENDING' and delivery.next_attempt_at <= ?)
          or (delivery.status = 'PROCESSING' and delivery.lease_until <= ?)
        )
        and not exists (
          select 1
          from outbox_event predecessor
          join sync_delivery blocked
            on blocked.event_id = predecessor.event_id
            and blocked.destination_node_id = delivery.destination_node_id
          where predecessor.origin_node_id = candidate.origin_node_id
            and predecessor.aggregate_type = candidate.aggregate_type
            and predecessor.aggregate_id = candidate.aggregate_id
            and blocked.status <> 'PUBLISHED'
            and (
              predecessor.aggregate_version < candidate.aggregate_version
              or (
                predecessor.aggregate_version = candidate.aggregate_version
                and predecessor.event_id < candidate.event_id
              )
            )
        )
        order by candidate.created_at, candidate.event_id
        limit ?
      `).all(destinationNodeId, timestamp, timestamp, limit) as OutboxRow[];

      /**
       * Una versión que el catálogo cerrado no publica para ese tipo no puede
       * materializarse como `BusinessEventV1`: se aísla de forma durable antes
       * de mapearla y no aborta el lote de los demás agregados. Sus sucesores
       * siguen bloqueados porque la cabecera aislada no está publicada.
       *
       * Lo que decide es el catálogo, no una versión fija: una versión nueva se
       * añade sin invalidar a la anterior (ADR-0023). Un **tipo** desconocido no
       * se juzga aquí: lo clasifica el relay, que distingue esa causa de una
       * versión incompatible.
       */
      const deliverable = rows.filter((row) => {
        if (application.findSyncContract(row.event_type) === undefined ||
          application.findSyncContract(row.event_type, row.contract_version) !== undefined) {
          return true;
        }
        this.blockRow(row.event_id, destinationNodeId, row.attempts,
          'OUTBOX_CONTRACT_VERSION_UNSUPPORTED');
        return false;
      });

      for (const row of deliverable) {
        this.handle.sqlite.prepare(`
          update sync_delivery
          set status = 'PROCESSING', attempts = attempts + 1,
            cycle_attempts = cycle_attempts + 1, lease_until = ?
          where event_id = ? and destination_node_id = ? and attempts = ?
            and status not in ('PUBLISHED', 'BLOCKED', 'PAUSED')
        `).run(leaseUntil.getTime(), row.event_id, destinationNodeId, row.attempts);
      }
      return deliverable.map((row) => ({
        eventId: row.event_id,
        eventType: row.event_type,
        contractVersion: row.contract_version,
        aggregateId: row.aggregate_id,
        aggregateType: row.aggregate_type,
        aggregateVersion: row.aggregate_version,
        originNodeId: row.origin_node_id,
        correlationId: row.correlation_id,
        actorId: row.actor_id,
        occurredAt: new Date(row.occurred_at),
        payload: JSON.parse(row.payload) as JsonValue,
        status: 'PROCESSING',
        attempts: row.attempts + 1,
        cycleAttempts: row.cycle_attempts + 1
      }));
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async isClaimActive(
    eventId: string,
    destinationNodeId: string,
    attempts: number,
    now: Date
  ): Promise<boolean> {
    requireTransaction(this.handle.sqlite);
    return this.handle.sqlite.prepare(`
      select 1 from sync_delivery
      where event_id = ? and destination_node_id = ? and attempts = ?
        and status = 'PROCESSING' and lease_until > ?
    `).get(eventId, destinationNodeId, attempts, now.getTime()) !== undefined;
  }

  async markPublished(
    eventId: string,
    destinationNodeId: string,
    attempts: number,
    publishedAt: Date
  ): Promise<boolean> {
    requireTransaction(this.handle.sqlite);
    const settled = this.handle.sqlite.prepare(`
      update sync_delivery
      set status = 'PUBLISHED', published_at = ?, lease_until = null,
        last_error = null, cycle_attempts = 0
      where event_id = ? and destination_node_id = ? and status = 'PROCESSING' and attempts = ?
    `).run(publishedAt.getTime(), eventId, destinationNodeId, attempts).changes === 1;
    if (settled) this.rollUp(eventId, publishedAt);
    return settled;
  }

  async markFailed(
    eventId: string,
    destinationNodeId: string,
    attempts: number,
    nextAttemptAt: Date,
    errorCode: string
  ): Promise<boolean> {
    requireTransaction(this.handle.sqlite);
    return this.handle.sqlite.prepare(`
      update sync_delivery
      set status = 'PENDING', next_attempt_at = ?, lease_until = null, last_error = ?
      where event_id = ? and destination_node_id = ? and status = 'PROCESSING' and attempts = ?
    `).run(nextAttemptAt.getTime(), errorCode, eventId, destinationNodeId, attempts)
      .changes === 1;
  }

  async markBlocked(
    eventId: string,
    destinationNodeId: string,
    attempts: number,
    errorCode: string
  ): Promise<boolean> {
    requireTransaction(this.handle.sqlite);
    const blocked = this.handle.sqlite.prepare(`
      update sync_delivery
      set status = 'BLOCKED', lease_until = null, last_error = ?
      where event_id = ? and destination_node_id = ? and status = 'PROCESSING' and attempts = ?
    `).run(errorCode, eventId, destinationNodeId, attempts).changes === 1;
    if (blocked) this.markLocalStatus(eventId, 'BLOCKED', errorCode);
    return blocked;
  }

  async markPaused(
    eventId: string,
    destinationNodeId: string,
    attempts: number,
    errorCode: string
  ): Promise<boolean> {
    requireTransaction(this.handle.sqlite);
    return this.handle.sqlite.prepare(`
      update sync_delivery
      set status = 'PAUSED', lease_until = null, last_error = ?, paused_at = next_attempt_at
      where event_id = ? and destination_node_id = ? and status = 'PROCESSING' and attempts = ?
    `).run(errorCode, eventId, destinationNodeId, attempts).changes === 1;
  }

  async resumeDelivery(
    eventId: string,
    destinationNodeId: string,
    now: Date,
    resumedBy: string
  ): Promise<boolean> {
    requireTransaction(this.handle.sqlite);
    return this.handle.sqlite.prepare(`
      update sync_delivery
      set status = 'PENDING', cycle_attempts = 0, next_attempt_at = ?, lease_until = null,
        resumed_at = ?, resumed_by = ?
      where event_id = ? and destination_node_id = ? and status = 'PAUSED'
    `).run(now.getTime(), now.getTime(), resumedBy, eventId, destinationNodeId).changes === 1;
  }

  async summarize(destinationNodeId: string): Promise<OutboxDestinationSummary> {
    try {
      const row = this.handle.sqlite.prepare(`
        select
          sum(case when status in ('PENDING', 'PROCESSING') then 1 else 0 end) as pending,
          sum(case when status = 'PAUSED' then 1 else 0 end) as paused,
          sum(case when status = 'BLOCKED' then 1 else 0 end) as blocked,
          max(published_at) as last_published_at
        from sync_delivery
        where destination_node_id = ?
      `).get(destinationNodeId) as {
        pending: number | null;
        paused: number | null;
        blocked: number | null;
        last_published_at: number | null;
      };
      const lastError = this.handle.sqlite.prepare(`
        select last_error from sync_delivery
        where destination_node_id = ? and last_error is not null
        order by next_attempt_at desc limit 1
      `).pluck().get(destinationNodeId) as string | undefined;
      return {
        destinationNodeId,
        pending: row.pending ?? 0,
        paused: row.paused ?? 0,
        blocked: row.blocked ?? 0,
        lastPublishedAt: row.last_published_at === null
          ? null
          : new Date(row.last_published_at),
        lastError: lastError ?? null
      };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async listPaused(destinationNodeId: string): Promise<readonly {
    readonly eventId: string;
    readonly lastError: string | null;
    readonly pausedAt: Date;
  }[]> {
    try {
      const rows = this.handle.sqlite.prepare(`
        select event_id, last_error, paused_at from sync_delivery
        where destination_node_id = ? and status = 'PAUSED'
        order by paused_at, event_id
      `).all(destinationNodeId) as {
        event_id: string;
        last_error: string | null;
        paused_at: number;
      }[];
      return rows.map((row) => ({
        eventId: row.event_id,
        lastError: row.last_error,
        pausedAt: new Date(row.paused_at)
      }));
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  /**
   * Crea las filas de entrega que falten para el destino. Una publicación
   * histórica local no acredita entrega LAN: la fila nace pendiente y la
   * deduplicación del receptor evita repetir efectos.
   */
  private materialize(destinationNodeId: string, now: number): void {
    this.handle.sqlite.prepare(`
      insert into sync_delivery (
        event_id, destination_node_id, status, attempts, cycle_attempts,
        next_attempt_at, created_at
      )
      select event_id, ?, 'PENDING', 0, 0, next_attempt_at, ?
      from outbox_event
      where not exists (
        select 1 from sync_delivery
        where sync_delivery.event_id = outbox_event.event_id
          and sync_delivery.destination_node_id = ?
      )
    `).run(destinationNodeId, now, destinationNodeId);
  }

  /**
   * Estado local de resumen sobre los destinos ya materializados. No es
   * autoridad de entrega: un destino que todavía no tiene fila no está
   * representado aquí, y `sync_delivery` sigue siendo la única evidencia de
   * qué nodo confirmó qué hecho. Retirar un destino no convierte pendientes en
   * publicados porque su fila permanece.
   */
  private rollUp(eventId: string, publishedAt: Date): void {
    this.handle.sqlite.prepare(`
      update outbox_event
      set status = 'PUBLISHED', published_at = ?, lease_until = null, last_error = null
      where event_id = ? and status <> 'BLOCKED' and not exists (
        select 1 from sync_delivery
        where sync_delivery.event_id = outbox_event.event_id
          and sync_delivery.status <> 'PUBLISHED'
      )
    `).run(publishedAt.getTime(), eventId);
  }

  private markLocalStatus(eventId: string, status: string, errorCode: string): void {
    this.handle.sqlite.prepare(`
      update outbox_event
      set status = ?, lease_until = null, last_error = ?
      where event_id = ? and status <> 'PUBLISHED'
    `).run(status, errorCode, eventId);
  }

  /** Aislamiento de una fila que todavía no pudo reclamarse; conserva `attempts`. */
  private blockRow(
    eventId: string,
    destinationNodeId: string,
    attempts: number,
    errorCode: string
  ): void {
    this.handle.sqlite.prepare(`
      update sync_delivery
      set status = 'BLOCKED', lease_until = null, last_error = ?
      where event_id = ? and destination_node_id = ? and attempts = ?
        and status in ('PENDING', 'PROCESSING')
    `).run(errorCode, eventId, destinationNodeId, attempts);
    this.markLocalStatus(eventId, 'BLOCKED', errorCode);
  }
}
