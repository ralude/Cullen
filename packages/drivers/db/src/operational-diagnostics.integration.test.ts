import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { applyMigrations } from './migrations.js';
import { SqliteOperationalDiagnosticsReader } from './operational-diagnostics.js';

/**
 * Aislamiento por nodo de la lectura operativa (ADR-0023).
 *
 * El diagnóstico describe la conversación con un nodo concreto: lo entregado a
 * él y lo recibido de él. Un coordinador atiende varias terminales sobre la
 * misma base, así que mezclarlas mostraría en una las incidencias de otra.
 */
const OCCURRED_AT = new Date('2026-09-09T10:00:00.000Z').getTime();

describe('lectura operativa por nodo', () => {
  const handles: DatabaseHandle[] = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) if (handle.sqlite.open) handle.close();
  });

  const setup = (): DatabaseHandle => {
    const handle = openDatabase(':memory:');
    handles.push(handle);
    applyMigrations(handle.sqlite);
    return handle;
  };

  /** Venta recibida de otra terminal y todavía sin aplicar por el coordinador. */
  const receiveSale = (handle: DatabaseHandle, input: {
    readonly eventId: string;
    readonly originNodeId: string;
    readonly terminalId: string;
  }): void => {
    handle.sqlite.prepare(`
      insert into sync_inbox_event (
        event_id, event_type, contract_version, aggregate_id, aggregate_type,
        aggregate_version, origin_node_id, correlation_id, actor_id, occurred_at,
        payload, application_state, received_from_node_id, received_at
      ) values (?, 'SaleCompleted', 1, ?, 'Sale', 1, ?, ?, 'user-001', ?, ?,
        'PENDING_CONSUMER', ?, ?)
    `).run(
      input.eventId, `sale-${input.eventId}`, input.originNodeId,
      `correlation-${input.eventId}`, OCCURRED_AT,
      JSON.stringify({ terminalId: input.terminalId }), input.originNodeId, OCCURRED_AT
    );
    handle.sqlite.prepare(`
      insert into sync_inbox_work (
        event_id, consumer, state, attempts, next_attempt_at, updated_at
      ) values (?, 'INVENTORY_AUTHORITY', 'PENDING', 1, ?, ?)
    `).run(input.eventId, OCCURRED_AT, OCCURRED_AT);
  };

  it('solo devuelve los efectos entrantes del nodo consultado', async () => {
    const handle = setup();
    receiveSale(handle, {
      eventId: 'event-a', originNodeId: 'node-terminal-a', terminalId: 'terminal-a'
    });
    receiveSale(handle, {
      eventId: 'event-b', originNodeId: 'node-terminal-b', terminalId: 'terminal-b'
    });
    const reader = new SqliteOperationalDiagnosticsReader(handle);

    const first = await reader.listSaleEffects('node-terminal-a', 50);
    const second = await reader.listSaleEffects('node-terminal-b', 50);
    const unknown = await reader.listSaleEffects('node-terminal-c', 50);

    expect(first.map(({ eventId }) => eventId)).toEqual(['event-a']);
    expect(first[0]).toMatchObject({
      kind: 'INCOMING', originNodeId: 'node-terminal-a', terminalId: 'terminal-a'
    });
    expect(second.map(({ eventId }) => eventId)).toEqual(['event-b']);
    expect(unknown).toEqual([]);
  });
});
