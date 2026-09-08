import type {
  DeliveryDiagnosticRecord,
  OperationalDiagnosticsReader,
  OperationalTraceRecord,
  OutboxDiagnosticRecord,
  SaleEffectRecord
} from '@supermarket/core';
import type { DatabaseHandle } from './connection.js';
import { mapDatabaseError } from './unit-of-work.js';

type DeliveryRow = {
  eventId: string;
  eventType: string;
  aggregateId: string;
  correlationId: string;
  destinationNodeId: string;
  status: DeliveryDiagnosticRecord['status'];
  attempts: number;
  cycleAttempts: number;
  nextAttemptAt: number;
  leaseUntil: number | null;
  publishedAt: number | null;
  lastError: string | null;
  occurredAt: number;
};

const delivery = (row: DeliveryRow): DeliveryDiagnosticRecord => ({
  ...row,
  nextAttemptAt: new Date(row.nextAttemptAt),
  leaseUntil: row.leaseUntil === null ? null : new Date(row.leaseUntil),
  publishedAt: row.publishedAt === null ? null : new Date(row.publishedAt),
  occurredAt: new Date(row.occurredAt)
});

type OutboxRow = Omit<OutboxDiagnosticRecord,
  'nextAttemptAt' | 'leaseUntil' | 'publishedAt' | 'occurredAt'> & {
  nextAttemptAt: number;
  leaseUntil: number | null;
  publishedAt: number | null;
  occurredAt: number;
};

const outbox = (row: OutboxRow): OutboxDiagnosticRecord => ({
  ...row,
  nextAttemptAt: new Date(row.nextAttemptAt),
  leaseUntil: row.leaseUntil === null ? null : new Date(row.leaseUntil),
  publishedAt: row.publishedAt === null ? null : new Date(row.publishedAt),
  occurredAt: new Date(row.occurredAt)
});

const terminal = (value: unknown): string => typeof value === 'string' ? value : 'UNKNOWN';

/**
 * Lectura operativa allowlist de 11.05. No selecciona payloads completos,
 * pagos ni estados arbitrarios de auditoría: solo IDs, estados técnicos y la
 * evidencia de costo expresamente aprobada.
 */
export class SqliteOperationalDiagnosticsReader implements OperationalDiagnosticsReader {
  constructor(private readonly handle: DatabaseHandle) {}

  async listDeliveries(
    destinationNodeId: string,
    limit: number
  ): Promise<readonly DeliveryDiagnosticRecord[]> {
    try {
      const rows = this.handle.sqlite.prepare(`
        select event.event_id as eventId, event.event_type as eventType,
          event.aggregate_id as aggregateId, event.correlation_id as correlationId,
          delivery.destination_node_id as destinationNodeId, delivery.status as status,
          delivery.attempts as attempts, delivery.cycle_attempts as cycleAttempts,
          delivery.next_attempt_at as nextAttemptAt, delivery.lease_until as leaseUntil,
          delivery.published_at as publishedAt, delivery.last_error as lastError,
          event.occurred_at as occurredAt
        from sync_delivery delivery
        join outbox_event event on event.event_id = delivery.event_id
        where delivery.destination_node_id = ?
        order by event.occurred_at desc, event.event_id
        limit ?
      `).all(destinationNodeId, limit) as DeliveryRow[];
      return rows.map(delivery);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async listSaleEffects(
    destinationNodeId: string,
    limit: number
  ): Promise<readonly SaleEffectRecord[]> {
    try {
      const local = this.handle.sqlite.prepare(`
        select event.aggregate_id as saleId, event.event_id as eventId,
          event.correlation_id as correlationId, event.origin_node_id as originNodeId,
          json_extract(event.payload, '$.terminalId') as terminalId,
          event.occurred_at as occurredAt, 'LOCAL_REJECTION' as kind,
          coalesce(json_extract(audit.after_state, '$.errorCode'), 'REJECTED') as state,
          json_extract(audit.after_state, '$.errorCode') as errorCode
        from audit_log audit
        join business_event event
          on event.aggregate_type = 'Sale' and event.aggregate_id = audit.entity_id
          and event.event_type = 'SaleCompleted'
          and event.correlation_id = audit.correlation_id
        where audit.action = 'SALE_STOCK_ISSUE_REJECTED'
        order by event.occurred_at desc
        limit ?
      `).all(limit) as Array<Omit<SaleEffectRecord, 'occurredAt' | 'terminalId'> & {
        occurredAt: number; terminalId: unknown;
      }>;
      const outgoing = this.handle.sqlite.prepare(`
        select event.aggregate_id as saleId, event.event_id as eventId,
          event.correlation_id as correlationId, event.origin_node_id as originNodeId,
          json_extract(event.payload, '$.terminalId') as terminalId,
          event.occurred_at as occurredAt, 'OUTGOING' as kind,
          delivery.status as state, delivery.last_error as errorCode
        from sync_delivery delivery
        join outbox_event event on event.event_id = delivery.event_id
        where delivery.destination_node_id = ? and event.event_type = 'SaleCompleted'
        order by event.occurred_at desc
        limit ?
      `).all(destinationNodeId, limit) as Array<Omit<SaleEffectRecord, 'occurredAt' | 'terminalId'> & {
        occurredAt: number; terminalId: unknown;
      }>;
      const incoming = this.handle.sqlite.prepare(`
        select event.aggregate_id as saleId, event.event_id as eventId,
          event.correlation_id as correlationId, event.origin_node_id as originNodeId,
          json_extract(event.payload, '$.terminalId') as terminalId,
          event.occurred_at as occurredAt, 'INCOMING' as kind,
          work.state as state,
          coalesce(discrepancy.reason_code, work.last_error) as errorCode
        from sync_inbox_event event
        join sync_inbox_work work on work.event_id = event.event_id
          and work.consumer = 'INVENTORY_AUTHORITY'
        left join sync_discrepancy discrepancy on discrepancy.event_id = event.event_id
          and discrepancy.consumer = work.consumer and discrepancy.status = 'OPEN'
        where event.event_type = 'SaleCompleted' and work.state <> 'APPLIED'
        order by event.occurred_at desc
        limit ?
      `).all(limit) as Array<Omit<SaleEffectRecord, 'occurredAt' | 'terminalId'> & {
        occurredAt: number; terminalId: unknown;
      }>;
      return [...local, ...outgoing, ...incoming]
        .map((row) => ({ ...row, terminalId: terminal(row.terminalId), occurredAt: new Date(row.occurredAt) }))
        .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
        .slice(0, limit);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async trace(correlationId: string, limit: number): Promise<OperationalTraceRecord> {
    try {
      const events = (this.handle.sqlite.prepare(`
        select event_id as eventId, event_type as eventType, aggregate_id as aggregateId,
          aggregate_type as aggregateType, occurred_at as occurredAt
        from business_event where correlation_id = ?
        order by occurred_at, event_id limit ?
      `).all(correlationId, limit) as Array<{
        eventId: string; eventType: string; aggregateId: string;
        aggregateType: string; occurredAt: number;
      }>).map((row) => ({ ...row, occurredAt: new Date(row.occurredAt) }));
      const outboxEntries = (this.handle.sqlite.prepare(`
        select event_id as eventId, event_type as eventType, aggregate_id as aggregateId,
          status, attempts, next_attempt_at as nextAttemptAt, lease_until as leaseUntil,
          published_at as publishedAt, last_error as lastError, occurred_at as occurredAt
        from outbox_event where correlation_id = ?
        order by occurred_at, event_id limit ?
      `).all(correlationId, limit) as OutboxRow[]).map(outbox);
      const deliveries = (this.handle.sqlite.prepare(`
        select event.event_id as eventId, event.event_type as eventType,
          event.aggregate_id as aggregateId, event.correlation_id as correlationId,
          delivery.destination_node_id as destinationNodeId, delivery.status as status,
          delivery.attempts as attempts, delivery.cycle_attempts as cycleAttempts,
          delivery.next_attempt_at as nextAttemptAt, delivery.lease_until as leaseUntil,
          delivery.published_at as publishedAt, delivery.last_error as lastError,
          event.occurred_at as occurredAt
        from outbox_event event
        join sync_delivery delivery on delivery.event_id = event.event_id
        where event.correlation_id = ?
        order by event.occurred_at, event.event_id, delivery.destination_node_id
        limit ?
      `).all(correlationId, limit) as DeliveryRow[]).map(delivery);
      const audits = (this.handle.sqlite.prepare(`
        select audit_id as auditId, action, entity_type as entityType, entity_id as entityId,
          occurred_at as occurredAt, after_state as afterState
        from audit_log where correlation_id = ?
        order by occurred_at, audit_id limit ?
      `).all(correlationId, limit) as Array<{
        auditId: string; action: string; entityType: string; entityId: string;
        occurredAt: number; afterState: string | null;
      }>).map(({ afterState, ...row }) => ({
        ...row,
        occurredAt: new Date(row.occurredAt),
        costEvidence: row.action === 'SALE_STOCK_ISSUED'
          ? this.costEvidence(afterState)
          : null
      }));
      return { events, outbox: outboxEntries, deliveries, audits };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  private costEvidence(afterState: string | null): OperationalTraceRecord['audits'][number]['costEvidence'] {
    if (afterState === null) return null;
    try {
      const value = JSON.parse(afterState) as Record<string, unknown>;
      return {
        unitCostMinorUnits: typeof value.unitCostMinorUnits === 'number'
          && Number.isSafeInteger(value.unitCostMinorUnits) ? value.unitCostMinorUnits : null,
        currencyCode: typeof value.costCurrencyCode === 'string' ? value.costCurrencyCode : null,
        source: typeof value.costSource === 'string' ? value.costSource : null
      };
    } catch {
      return null;
    }
  }
}
