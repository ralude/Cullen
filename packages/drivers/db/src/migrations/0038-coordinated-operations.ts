/**
 * Operaciones distribuidas de stock (ADR-0026 D3).
 *
 * No hay commit atómico entre dos SQLite: hay una **intención durable** en el
 * nodo de origen y un resultado por paso. Cada nodo confirma solo sus propios
 * efectos, en su propia transacción, y la reconciliación consulta esos
 * resultados en lugar de repetir efectos.
 *
 * La huella es estable por operación: reintentar la misma intención encuentra
 * la existente en lugar de abrir otra. Sin evidencia de todos los pasos
 * obligatorios, la operación queda `PENDING_RECONCILIATION` y visible como tal;
 * un timeout nunca la cancela ni la declara exitosa.
 */
export const coordinatedOperationsSql = `
  create table sync_coordinated_operation (
    operation_id text primary key,
    kind text not null check (kind in (
      'PURCHASE_RECEIPT_COMPLETION', 'STOCK_COUNT_APPROVAL', 'SALE_RETURN'
    )),
    fingerprint text not null,
    status text not null check (status in (
      'PENDING_RECONCILIATION', 'COMPLETED', 'NEEDS_REVIEW'
    )),
    coordinator_node_id text,
    actor_id text not null,
    terminal_id text not null,
    origin_node_id text not null,
    correlation_id text not null,
    reason text not null,
    started_at integer not null,
    updated_at integer not null,
    unique (kind, fingerprint)
  );

  create index sync_coordinated_operation_status_idx
    on sync_coordinated_operation (status, started_at);

  create table sync_coordinated_step (
    operation_id text not null references sync_coordinated_operation(operation_id),
    step text not null check (step in ('LOCAL_EFFECT', 'COORDINATOR_EFFECT')),
    state text not null check (state in ('PENDING', 'APPLIED', 'REJECTED')),
    node_id text not null,
    evidence text,
    recorded_at integer not null,
    primary key (operation_id, step)
  );

  /** Un paso aplicado es historia: no retrocede a pendiente ni se borra. */
  create trigger sync_coordinated_step_applied_immutable
  before update on sync_coordinated_step
  when old.state = 'APPLIED' and new.state != 'APPLIED'
  begin
    select raise(abort, 'an applied coordinated step cannot regress');
  end;

  create trigger sync_coordinated_step_append_only_delete
  before delete on sync_coordinated_step
  begin
    select raise(abort, 'coordinated steps are append-only');
  end;
`;
