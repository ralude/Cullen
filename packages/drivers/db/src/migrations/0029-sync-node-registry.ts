/**
 * Registro confiable de nodos (10.03, corte 2).
 *
 * Mapea nodo, terminal, rol y tienda antes de escuchar en LAN: la confianza no
 * se descubre a partir del primer certificado presentado. La huella del
 * certificado es el unico material criptografico almacenado; claves privadas y
 * secretos permanecen fuera de la base y de los logs.
 *
 * El nodo y su tienda son inmutables una vez registrados; solo cambian estado y
 * evidencia de revocacion. Una revocacion conserva la fila y su historia.
 */
export const syncNodeRegistrySql = `
create table sync_node (
  node_id text primary key,
  store_id text not null,
  role text not null check (role in ('COORDINATOR', 'TERMINAL')),
  terminal_id text,
  credential_fingerprint text not null unique,
  status text not null check (status in ('ACTIVE', 'REVOKED')),
  not_after integer not null,
  registered_at integer not null,
  registered_by text not null,
  registration_reason text not null,
  revoked_at integer,
  revoked_by text,
  revocation_reason text
);

create unique index sync_node_single_coordinator
  on sync_node(store_id) where role = 'COORDINATOR';

create unique index sync_node_terminal_identity
  on sync_node(store_id, terminal_id) where terminal_id is not null;

create trigger sync_node_identity_immutable
before update on sync_node
when new.store_id is not old.store_id
  or new.role is not old.role
  or new.terminal_id is not old.terminal_id
  or new.credential_fingerprint is not old.credential_fingerprint
  or new.registered_at is not old.registered_at
begin
  select raise(abort, 'sync node identity is immutable');
end;

create trigger sync_node_terminal_required
before insert on sync_node
when new.role = 'TERMINAL' and new.terminal_id is null
begin
  select raise(abort, 'terminal node requires a terminal identifier');
end;

create trigger sync_node_permanent
before delete on sync_node
begin
  select raise(abort, 'sync node registration cannot be deleted');
end;
`;
