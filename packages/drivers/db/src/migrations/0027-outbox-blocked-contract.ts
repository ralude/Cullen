/**
 * Agrega el estado durable `BLOCKED` a la cola de salida para aislar contratos
 * incompatibles o rechazados de forma permanente. SQLite no permite alterar una
 * restricción `check`, así que la tabla se reconstruye conservando cada fila,
 * su estado, sus intentos y su evidencia de error. Forward-only: no reescribe
 * historia ni reinterpreta un `PUBLISHED` anterior.
 */
export const outboxBlockedContractSql = `
alter table outbox_event rename to outbox_event_previous;

create table outbox_event (
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
  status text not null check (status in ('PENDING', 'PROCESSING', 'PUBLISHED', 'BLOCKED')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at integer not null,
  lease_until integer,
  last_error text,
  published_at integer,
  created_at integer not null
);

insert into outbox_event (
  event_id, event_type, contract_version, aggregate_id, aggregate_type, aggregate_version,
  origin_node_id, correlation_id, actor_id, occurred_at, payload, status, attempts,
  next_attempt_at, lease_until, last_error, published_at, created_at
)
select
  event_id, event_type, contract_version, aggregate_id, aggregate_type, aggregate_version,
  origin_node_id, correlation_id, actor_id, occurred_at, payload, status, attempts,
  next_attempt_at, lease_until, last_error, published_at, created_at
from outbox_event_previous;

drop table outbox_event_previous;

create index outbox_event_delivery
  on outbox_event(status, next_attempt_at, lease_until, created_at);
`;
