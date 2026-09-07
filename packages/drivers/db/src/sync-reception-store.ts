import type {
  ReceivedSyncEvent,
  SyncCustodyRecord,
  SyncQuarantineEntry,
  SyncReceptionStore
} from '@supermarket/core';
import {
  SYNC_PROTOCOL_VERSION_V1,
  type JsonObject,
  type SyncApplicationStateV1
} from '@supermarket/shared';
import type { DatabaseHandle } from './connection.js';
import { mapDatabaseError, requireTransaction } from './unit-of-work.js';

type InboxRow = {
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
  readonly application_state: SyncApplicationStateV1;
  readonly received_at: number;
};

const toReceivedEvent = (row: InboxRow): ReceivedSyncEvent => ({
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
  },
  application: row.application_state,
  receivedAt: new Date(row.received_at)
});

/**
 * Custodia durable del receptor. `record` inserta la custodia y el trabajo de
 * aplicación pendiente dentro de la transacción que abre el caso de uso: el
 * ACK sale después del commit y un rollback no deja trabajo huérfano.
 *
 * La clave primaria de `sync_inbox_event` arbitra dos entregas concurrentes.
 * El adaptador no compara identidades: devuelve `DUPLICATE` para que la
 * aplicación relea y compare, en lugar de declarar duplicado a ciegas.
 */
export class DrizzleSyncReceptionStore implements SyncReceptionStore {
  constructor(private readonly handle: DatabaseHandle) {}

  async findByEventId(eventId: string): Promise<ReceivedSyncEvent | undefined> {
    try {
      const row = this.handle.sqlite
        .prepare('select * from sync_inbox_event where event_id = ?')
        .get(eventId) as InboxRow | undefined;
      return row ? toReceivedEvent(row) : undefined;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async highestReceivedVersion(
    aggregateType: string,
    aggregateId: string
  ): Promise<number | undefined> {
    try {
      const row = this.handle.sqlite.prepare(`
        select max(aggregate_version) as highest
        from sync_inbox_event
        where aggregate_type = ? and aggregate_id = ?
      `).get(aggregateType, aggregateId) as { highest: number | null } | undefined;
      return row?.highest ?? undefined;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async record(entry: SyncCustodyRecord): Promise<'RECORDED' | 'DUPLICATE'> {
    requireTransaction(this.handle.sqlite);
    const { envelope } = entry;
    const receivedAt = entry.receivedAt.getTime();
    try {
      const inserted = this.handle.sqlite.prepare(`
        insert into sync_inbox_event (
          event_id, event_type, contract_version, aggregate_id, aggregate_type,
          aggregate_version, origin_node_id, correlation_id, actor_id, occurred_at,
          payload, application_state, received_from_node_id, received_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(event_id) do nothing
      `).run(
        envelope.eventId,
        envelope.eventType,
        envelope.contractVersion,
        envelope.aggregateId,
        envelope.aggregateType,
        envelope.aggregateVersion,
        envelope.originNodeId,
        envelope.correlationId,
        envelope.actorId,
        new Date(envelope.occurredAt).getTime(),
        JSON.stringify(envelope.payload),
        entry.application,
        entry.senderNodeId,
        receivedAt
      );
      if (inserted.changes !== 1) return 'DUPLICATE';

      const work = this.handle.sqlite.prepare(`
        insert into sync_inbox_work (
          event_id, consumer, state, attempts, next_attempt_at, updated_at
        ) values (?, ?, 'PENDING', 0, ?, ?)
      `);
      for (const consumer of entry.consumers) {
        work.run(envelope.eventId, consumer, receivedAt, receivedAt);
      }
      return 'RECORDED';
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async quarantine(entry: SyncQuarantineEntry): Promise<void> {
    requireTransaction(this.handle.sqlite);
    try {
      this.handle.sqlite.prepare(`
        insert into sync_quarantine (
          quarantine_id, declared_event_id, sender_node_id, reason_code,
          payload_bytes, received_at
        ) values (?, ?, ?, ?, ?, ?)
      `).run(
        entry.quarantineId,
        entry.declaredEventId,
        entry.senderNodeId,
        entry.reasonCode,
        entry.payloadBytes,
        entry.receivedAt.getTime()
      );
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
