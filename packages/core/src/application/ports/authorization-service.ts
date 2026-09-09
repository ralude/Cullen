import type { ExecutionContext } from '../execution-context.js';

/**
 * Permiso que una decisión exige. Varias alternativas son **una sola** decisión
 * —basta cualquiera de ellas— y por eso dejan una sola evidencia: comprobar la
 * segunda porque la primera no alcanzó no es una denegación, es la misma
 * pregunta todavía sin responder.
 */
export type RequiredPermission = string | readonly string[];

/** Alternativas que satisfacen la decisión, siempre como lista. */
export const permissionAlternatives = (
  permission: RequiredPermission
): readonly string[] => (typeof permission === 'string' ? [permission] : permission);

export interface AuthorizationService {
  authorize(context: ExecutionContext, permission: RequiredPermission): Promise<boolean>;
}
