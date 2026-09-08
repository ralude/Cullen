/**
 * Estado de la transacción del nodo.
 *
 * La evidencia de una decisión de autorización se persiste en su propia unidad
 * de trabajo. Cuando la decisión ocurre dentro del comando —el cierre de turno
 * con diferencia evalúa su permiso ya en transacción—, abrir otra sería
 * anidarla, y las reglas del driver de base lo prohíben. Este puerto solo
 * informa si hay una transacción activa, sin exponer el motor.
 */
export interface TransactionState {
  readonly isActive: boolean;
}
