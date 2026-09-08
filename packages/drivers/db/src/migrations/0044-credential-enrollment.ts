/**
 * Enrolamiento local de credenciales y credencial marcada para cambio.
 *
 * [ADR-0028](../../../../../docs/architecture/adr/0028-enrolamiento-local-de-credenciales.md):
 * la credencial se materializa en el nodo donde se usa. La autorización es
 * local, de un solo uso y ligada a operador, nodo y terminal; la base guarda
 * solo el hash del ticket, nunca su valor en claro ni el PIN.
 *
 * `must_change` implementa el otro camino de ADR-0027 D3: una credencial
 * caducada por un administrador deja ingresar, pero la sesión resultante solo
 * puede cambiar el PIN.
 */
export const credentialEnrollmentSql = `
  alter table identity_credentials
    add column must_change integer not null default 0 check (must_change in (0, 1));

  create table identity_credential_enrollments (
    id text primary key,
    token_hash text not null unique,
    operator_code text not null collate nocase,
    origin_node_id text not null,
    terminal_id text not null,
    authorized_by text not null references identity_users(id),
    reason text not null,
    authorized_at integer not null,
    expires_at integer not null,
    consumed_at integer,
    check (expires_at > authorized_at)
  );

  create index identity_credential_enrollments_pending_idx
    on identity_credential_enrollments (operator_code, consumed_at, expires_at);
`;
