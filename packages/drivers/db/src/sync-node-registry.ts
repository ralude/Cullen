import type {
  RegisteredSyncNode,
  SyncNodeRegistration,
  SyncNodeRegistry,
  SyncNodeRole
} from '@supermarket/core';
import type { DatabaseHandle } from './connection.js';
import { mapDatabaseError, requireTransaction } from './unit-of-work.js';

type NodeRow = {
  readonly node_id: string;
  readonly store_id: string;
  readonly role: SyncNodeRole;
  readonly terminal_id: string | null;
  readonly credential_fingerprint: string;
  readonly address_host: string | null;
  readonly address_port: number | null;
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly not_after: number;
  readonly registered_at: number;
  readonly registered_by: string;
  readonly registration_reason: string;
  readonly revoked_at: number | null;
};

const toNode = (row: NodeRow): RegisteredSyncNode => ({
  nodeId: row.node_id,
  storeId: row.store_id,
  role: row.role,
  terminalId: row.terminal_id,
  credentialFingerprint: row.credential_fingerprint,
  addressHost: row.address_host,
  addressPort: row.address_port,
  notAfter: new Date(row.not_after),
  registeredAt: new Date(row.registered_at),
  registeredBy: row.registered_by,
  registrationReason: row.registration_reason,
  status: row.status,
  revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at)
});

/**
 * Registro confiable de nodos. La identidad de un nodo es inmutable por
 * trigger; una revocación conserva la fila y su evidencia. Solo se persiste la
 * huella del certificado: ninguna clave privada llega a la base.
 */
export class SqliteSyncNodeRegistry implements SyncNodeRegistry {
  constructor(private readonly handle: DatabaseHandle) {}

  async findByCredentialFingerprint(
    fingerprint: string
  ): Promise<RegisteredSyncNode | undefined> {
    return this.selectOne('credential_fingerprint = ?', fingerprint);
  }

  async findByNodeId(nodeId: string): Promise<RegisteredSyncNode | undefined> {
    return this.selectOne('node_id = ?', nodeId);
  }

  async coordinatorOf(storeId: string): Promise<RegisteredSyncNode | undefined> {
    return this.selectOne("store_id = ? and role = 'COORDINATOR'", storeId);
  }

  async list(): Promise<readonly RegisteredSyncNode[]> {
    try {
      const rows = this.handle.sqlite
        .prepare('select * from sync_node order by store_id, role, node_id')
        .all() as NodeRow[];
      return rows.map(toNode);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async deliveryDestinations(storeId: string, now: Date): Promise<readonly RegisteredSyncNode[]> {
    try {
      const rows = this.handle.sqlite.prepare(`
        select * from sync_node
        where store_id = ? and status = 'ACTIVE' and not_after > ?
          and address_host is not null and address_port is not null
        order by node_id
      `).all(storeId, now.getTime()) as NodeRow[];
      return rows.map(toNode);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async register(registration: SyncNodeRegistration): Promise<void> {
    requireTransaction(this.handle.sqlite);
    try {
      this.handle.sqlite.prepare(`
        insert into sync_node (
          node_id, store_id, role, terminal_id, credential_fingerprint, status,
          not_after, registered_at, registered_by, registration_reason,
          address_host, address_port
        ) values (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)
      `).run(
        registration.nodeId,
        registration.storeId,
        registration.role,
        registration.terminalId,
        registration.credentialFingerprint,
        registration.notAfter.getTime(),
        registration.registeredAt.getTime(),
        registration.registeredBy,
        registration.registrationReason,
        registration.addressHost,
        registration.addressPort
      );
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async revoke(
    nodeId: string,
    revokedAt: Date,
    revokedBy: string,
    reason: string
  ): Promise<boolean> {
    requireTransaction(this.handle.sqlite);
    try {
      return this.handle.sqlite.prepare(`
        update sync_node
        set status = 'REVOKED', revoked_at = ?, revoked_by = ?, revocation_reason = ?
        where node_id = ? and status = 'ACTIVE'
      `).run(revokedAt.getTime(), revokedBy, reason, nodeId).changes === 1;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  private selectOne(where: string, parameter: string): Promise<RegisteredSyncNode | undefined> {
    try {
      const row = this.handle.sqlite
        .prepare(`select * from sync_node where ${where}`)
        .get(parameter) as NodeRow | undefined;
      return Promise.resolve(row ? toNode(row) : undefined);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
