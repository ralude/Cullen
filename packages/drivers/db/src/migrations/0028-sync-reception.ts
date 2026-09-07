/**
 * Estado durable del receptor de sincronizacion (10.03, corte 1).
 *
 * `sync_inbox_event` es la custodia: una fila por `event_id`, inmutable. Su
 * clave primaria arbitra la carrera entre entregas concurrentes: una colision
 * se relee y se compara contra el sobre conservado. `sync_inbox_work` conserva
 * el trabajo de aplicacion pendiente de cada consumidor, que se confirma en la
 * misma transaccion que la custodia: ningun ACK sale antes del commit y un
 * rollback no deja trabajo huerfano.
 *
 * `sync_aggregate_authority` registra un dueno unico e inmutable por agregado.
 * Sin fila no hay autoridad: no se adopta al primer emisor.
 *
 * `sync_quarantine` aisla entradas autenticadas incompatibles sin sobrescribir
 * un evento legitimo con el mismo ID; por eso tiene identidad propia y solo
 * guarda codigos y longitudes, nunca el body recibido.
 *
 * Forward-only: no reescribe historia ni reinterpreta publicaciones previas.
 */
export const syncReceptionSql = `
create table sync_aggregate_authority (
  aggregate_type text not null,
  aggregate_id text not null,
  owner_node_id text not null,
  source text not null check (source in ('MANUAL', 'DELEGATED')),
  evidence_fingerprint text not null,
  registered_at integer not null,
  registered_by text not null,
  primary key (aggregate_type, aggregate_id)
);

create index sync_aggregate_authority_owner
  on sync_aggregate_authority(owner_node_id, aggregate_type);

create trigger sync_aggregate_authority_immutable
before update on sync_aggregate_authority
begin
  select raise(abort, 'aggregate authority is immutable');
end;

create trigger sync_aggregate_authority_permanent
before delete on sync_aggregate_authority
begin
  select raise(abort, 'aggregate authority cannot be deleted');
end;

create table sync_inbox_event (
  event_id text primary key,
  event_type text not null,
  contract_version integer not null check (contract_version > 0),
  aggregate_id text not null,
  aggregate_type text not null,
  aggregate_version integer not null check (aggregate_version > 0),
  origin_node_id text not null,
  correlation_id text not null,
  actor_id text not null,
  occurred_at integer not null,
  payload text not null check (json_valid(payload)),
  application_state text not null check (
    application_state in ('PENDING_CONSUMER', 'PENDING_DEPENDENCY', 'PENDING_REVIEW')
  ),
  received_from_node_id text not null,
  received_at integer not null
);

create index sync_inbox_event_aggregate
  on sync_inbox_event(aggregate_type, aggregate_id, aggregate_version);

create trigger sync_inbox_event_immutable
before update on sync_inbox_event
begin
  select raise(abort, 'received sync event is immutable');
end;

create trigger sync_inbox_event_permanent
before delete on sync_inbox_event
begin
  select raise(abort, 'received sync event cannot be deleted');
end;

create table sync_inbox_work (
  event_id text not null references sync_inbox_event(event_id),
  consumer text not null,
  state text not null check (
    state in ('PENDING', 'APPLIED', 'DISCREPANCY', 'BLOCKED')
  ),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at integer not null,
  lease_until integer,
  last_error text,
  applied_at integer,
  updated_at integer not null,
  primary key (event_id, consumer)
);

create index sync_inbox_work_queue
  on sync_inbox_work(state, next_attempt_at, lease_until);

create table sync_quarantine (
  quarantine_id text primary key,
  declared_event_id text,
  sender_node_id text not null,
  reason_code text not null,
  payload_bytes integer not null check (payload_bytes >= 0),
  received_at integer not null
);

create index sync_quarantine_sender
  on sync_quarantine(sender_node_id, received_at);
`;
