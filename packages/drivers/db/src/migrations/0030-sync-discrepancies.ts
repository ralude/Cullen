/**
 * Discrepancias de aplicacion del receptor (10.03, corte 3).
 *
 * Una discrepancia unica por `(event_id, consumer)` conserva las lineas y
 * causas necesarias para resolverla. La venta sigue siendo valida: no se
 * revierte un hecho ni se inventan entradas de ajuste para cuadrar el saldo.
 *
 * Resolver conserva historia: la fila permanece con su evidencia, su actor y
 * su motivo. Una reentrega posterior no abre otra discrepancia.
 */
export const syncDiscrepanciesSql = `
create table sync_discrepancy (
  discrepancy_id text primary key,
  event_id text not null references sync_inbox_event(event_id),
  consumer text not null,
  reason_code text not null,
  detail text not null check (json_valid(detail)),
  status text not null check (status in ('OPEN', 'RESOLVED')),
  opened_at integer not null,
  updated_at integer not null,
  resolved_at integer,
  resolved_by text,
  resolution_reason text
);

create unique index sync_discrepancy_unique on sync_discrepancy(event_id, consumer);

create index sync_discrepancy_open on sync_discrepancy(status, opened_at);

create trigger sync_discrepancy_permanent
before delete on sync_discrepancy
begin
  select raise(abort, 'sync discrepancy cannot be deleted');
end;

create trigger sync_discrepancy_evidence_immutable
before update on sync_discrepancy
when new.event_id is not old.event_id
  or new.consumer is not old.consumer
  or new.reason_code is not old.reason_code
  or new.detail is not old.detail
  or new.opened_at is not old.opened_at
begin
  select raise(abort, 'sync discrepancy evidence is immutable');
end;
`;
