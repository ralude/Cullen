/**
 * Permisos de administración de identidad ([ADR-0027](
 * ../../../../../docs/architecture/adr/0027-administracion-de-identidad.md)).
 *
 * `RESET_CREDENTIAL` es distinto de `MANAGE_USERS` a propósito: administrar
 * quién existe y autorizar el enrolamiento local de una credencial en esta
 * terminal ([ADR-0028](
 * ../../../../../docs/architecture/adr/0028-enrolamiento-local-de-credenciales.md))
 * son decisiones de riesgo distinto y se conceden por separado.
 */
export const IDENTITY_PERMISSIONS = {
  MANAGE_USERS: 'identity.user.manage',
  MANAGE_ROLES: 'identity.role.manage',
  RESET_CREDENTIAL: 'identity.credential.reset'
} as const;
