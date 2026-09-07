/**
 * Enlace con el coordinador de la tienda, tal como lo conoce este nodo.
 *
 * `coordinatorNodeId` es `null` en un nodo standalone: no hay coordinación que
 * exigir y las operaciones conservan la atomicidad local existente. Con
 * coordinador, completar compras, aprobar conteos y procesar devoluciones
 * exigen enlace, conforme ADR-0026 D3.
 */
export interface CoordinatorLink {
  readonly coordinatorNodeId: string | null;
  /**
   * Enlace utilizable **ahora**: conectividad observada por el worker y
   * referencias del coordinador aplicadas. Comprobar la conexión no confirma
   * ningún evento ni sustituye la evidencia por paso.
   */
  isReachable(): Promise<boolean>;
}

/** Resultado de consultar al coordinador si ya aplicó un hecho. */
export type RemoteApplicationState = 'APPLIED' | 'PENDING' | 'UNKNOWN';

/**
 * Consulta de progreso en el coordinador. Es una lectura: no reenvía el hecho,
 * no confirma custodia por su cuenta y una respuesta ausente vale `UNKNOWN`,
 * nunca `APPLIED`.
 */
export interface RemoteApplicationProbe {
  applicationOf(eventId: string): Promise<RemoteApplicationState>;
}
