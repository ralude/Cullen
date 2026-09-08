/**
 * Retención de los rastros de identidad que dejan de aportar evidencia
 * ([ADR-0029](../../../../../docs/architecture/adr/0029-proteccion-de-datos-en-reposo.md) D8).
 *
 * Una sesión cerrada y un ticket de enrolamiento consumido conservan solo
 * hashes, pero su utilidad —detectar el replay, explicar un acceso— no
 * sobrevive al plazo declarado. `audit_log` no entra aquí: es evidencia y no
 * se purga.
 */
export type IdentityRetentionStore = {
  /** Sesiones cerradas o vencidas antes del umbral. Devuelve cuántas se borraron. */
  purgeExpiredSessions(threshold: Date): Promise<number>;
  /** Tickets consumidos o vencidos antes del umbral. Devuelve cuántos se borraron. */
  purgeConsumedEnrollments(threshold: Date): Promise<number>;
};
