import type {
  AggregateAuthority,
  AggregateAuthorityRegistration,
  AggregateAuthorityRegistrationOutcome,
  AggregateAuthorityRegistry
} from '@supermarket/core';
import type { DatabaseHandle } from './connection.js';
import { mapDatabaseError, requireTransaction } from './unit-of-work.js';

type AuthorityRow = {
  readonly owner_node_id: string;
  readonly evidence_fingerprint: string;
};

/**
 * Autoridad de escritura persistida. La fila es inmutable por trigger: un alta
 * repetida idéntica devuelve el mismo resultado y una contradicción con el
 * dueño o la evidencia registrados nunca reasigna autoridad. Sin fila no hay
 * autoridad: el receptor no adopta al primer emisor.
 */
export class DrizzleAggregateAuthorityRegistry implements AggregateAuthorityRegistry {
  constructor(private readonly handle: DatabaseHandle) {}

  async authorityFor(aggregateType: string, aggregateId: string): Promise<AggregateAuthority> {
    try {
      const row = this.findRow(aggregateType, aggregateId);
      return row === undefined
        ? { resolution: 'UNRESOLVED' }
        : { resolution: 'RESOLVED', ownerNodeId: row.owner_node_id };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async register(
    registration: AggregateAuthorityRegistration
  ): Promise<AggregateAuthorityRegistrationOutcome> {
    requireTransaction(this.handle.sqlite);
    try {
      const inserted = this.handle.sqlite.prepare(`
        insert into sync_aggregate_authority (
          aggregate_type, aggregate_id, owner_node_id, source,
          evidence_fingerprint, registered_at, registered_by
        ) values (?, ?, ?, ?, ?, ?, ?)
        on conflict(aggregate_type, aggregate_id) do nothing
      `).run(
        registration.aggregateType,
        registration.aggregateId,
        registration.ownerNodeId,
        registration.source,
        registration.evidenceFingerprint,
        registration.registeredAt.getTime(),
        registration.registeredBy
      );
      if (inserted.changes === 1) {
        return { outcome: 'REGISTERED', ownerNodeId: registration.ownerNodeId };
      }

      const existing = this.findRow(registration.aggregateType, registration.aggregateId);
      if (existing === undefined) {
        throw new Error('Aggregate authority vanished after a unique key collision.');
      }
      const identical = existing.owner_node_id === registration.ownerNodeId &&
        existing.evidence_fingerprint === registration.evidenceFingerprint;
      return {
        outcome: identical ? 'ALREADY_REGISTERED' : 'CONFLICT',
        ownerNodeId: existing.owner_node_id
      };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  private findRow(aggregateType: string, aggregateId: string): AuthorityRow | undefined {
    return this.handle.sqlite.prepare(`
      select owner_node_id, evidence_fingerprint
      from sync_aggregate_authority
      where aggregate_type = ? and aggregate_id = ?
    `).get(aggregateType, aggregateId) as AuthorityRow | undefined;
  }
}
