import type Database from 'better-sqlite3';

/**
 * Concesión que el coordinador publicó para un operador, tal como la proyecta
 * esta terminal
 * ([ADR-0026](../../../../docs/architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md) D5).
 *
 * Vive fuera de los repositorios porque dos decisiones distintas dependen de la
 * misma vigencia: autorizar una sesión y enrolar una credencial local
 * ([ADR-0028](../../../../docs/architecture/adr/0028-enrolamiento-local-de-credenciales.md) D7).
 * Evaluarla con dos criterios dejaría que una concesión revocada siguiera
 * habilitando una de las dos.
 */
export type ProjectedOperatorGrant = {
  readonly operatorCode: string;
  readonly displayName: string;
  readonly roleCodes: string;
  readonly permissionCodes: string;
  readonly isActive: number;
  readonly expiresAt: number;
};

/** Concesión proyectada del operador, buscada por su código de negocio. */
export const findProjectedGrant = (
  sqlite: Database.Database,
  operatorCode: string
): ProjectedOperatorGrant | null => {
  const row = sqlite.prepare(`
    select operator_code as operatorCode, display_name as displayName,
      role_codes as roleCodes, permission_codes as permissionCodes,
      is_active as isActive, expires_at as expiresAt
    from identity_operator_grant where operator_code = ? collate nocase
  `).get(operatorCode) as ProjectedOperatorGrant | undefined;
  return row ?? null;
};

/**
 * Instante durable más alto que este nodo ya observó: la última vez que se vio
 * una sesión y la aplicación de la concesión más reciente.
 *
 * Atrasar el reloj del equipo no puede ampliar una concesión (ADR-0026 D5), así
 * que la vigencia se evalúa contra este máximo y no contra un reloj que pudo
 * retroceder. Adelantarlo tampoco la extiende: solo la vence antes.
 */
export const observedInstant = (sqlite: Database.Database, wallClock: number): number => {
  const watermark = sqlite.prepare(`
    select max(instant) from (
      select max(last_seen_at) as instant from auth_sessions
      union all select max(applied_at) as instant from identity_operator_grant
    )
  `).pluck().get() as number | null;
  return watermark === null ? wallClock : Math.max(wallClock, watermark);
};

/** Vigente y activa. Una concesión vencida o revocada no es utilizable. */
export const isGrantUsable = (
  sqlite: Database.Database,
  grant: ProjectedOperatorGrant,
  wallClock: number
): boolean => grant.isActive === 1 && observedInstant(sqlite, wallClock) < grant.expiresAt;
