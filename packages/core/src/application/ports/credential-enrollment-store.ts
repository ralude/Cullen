/**
 * Credenciales locales y su enrolamiento
 * ([ADR-0028](../../../../../docs/architecture/adr/0028-enrolamiento-local-de-credenciales.md)).
 *
 * Ninguna operación de este puerto recibe, devuelve ni almacena un PIN en
 * claro: la aplicación deriva el hash con el adaptador de credenciales y aquí
 * solo viaja ese hash. El ticket de enrolamiento se guarda únicamente como
 * hash, igual que el token de sesión de ADR-0011.
 */

/** Operador que este nodo puede enrolar: fila local o concesión utilizable. */
export type EnrollableOperator = {
  readonly operatorCode: string;
  readonly displayName: string;
  /** Identificador local, `null` cuando el operador solo existe como concesión. */
  readonly userId: string | null;
  readonly hasLocalCredential: boolean;
};

export type EnrollmentConsumption =
  | {
    readonly status: 'APPLIED';
    readonly userId: string;
    readonly operatorCode: string;
    /** El nodo creó la fila local del operador al consumir el ticket. */
    readonly createdLocalOperator: boolean;
    readonly replacedCredential: boolean;
  }
  | { readonly status: 'NOT_FOUND' }
  | { readonly status: 'EXPIRED'; readonly authorizedBy: string; readonly operatorCode: string }
  | { readonly status: 'CONSUMED'; readonly authorizedBy: string; readonly operatorCode: string }
  | { readonly status: 'NODE_MISMATCH'; readonly authorizedBy: string; readonly operatorCode: string }
  | { readonly status: 'OPERATOR_NOT_ENROLLABLE'; readonly authorizedBy: string; readonly operatorCode: string };

export interface CredentialEnrollmentStore {
  /**
   * Operador enrolable en este nodo. Devuelve `null` cuando no existe fila
   * local ni concesión utilizable: conocer un `operatorCode` no crea identidad,
   * y una concesión vencida o revocada no habilita enrolamiento.
   */
  enrollableOperator(operatorCode: string, now: Date): Promise<EnrollableOperator | null>;

  /**
   * Registra la autorización y **invalida las pendientes** del mismo operador
   * en este nodo: reemitir no deja dos tickets vivos. Requiere transacción.
   */
  authorizeEnrollment(input: {
    readonly enrollmentId: string;
    readonly tokenHash: string;
    readonly operatorCode: string;
    readonly originNodeId: string;
    readonly terminalId: string;
    readonly authorizedBy: string;
    readonly reason: string;
    readonly authorizedAt: Date;
    readonly expiresAt: Date;
  }): Promise<void>;

  /**
   * Consume el ticket y materializa la credencial en la misma transacción:
   * crea la fila local si falta, escribe el hash, avanza la versión de
   * credencial y la de autorización, y marca el ticket como consumido.
   */
  consumeEnrollment(input: {
    readonly tokenHash: string;
    readonly pinHash: string;
    readonly originNodeId: string;
    readonly terminalId: string;
    readonly newUserId: string;
    readonly now: Date;
  }): Promise<EnrollmentConsumption>;

  /** Credencial vigente de un operador local, para verificar el PIN actual. */
  credentialOf(userId: string): Promise<{ readonly pinHash: string } | null>;

  /**
   * Reemplaza el PIN propio. Limpia la marca de cambio obligatorio y avanza la
   * versión de credencial. Requiere transacción.
   */
  replaceOwnCredential(input: {
    readonly userId: string;
    readonly pinHash: string;
    readonly now: Date;
  }): Promise<boolean>;

  /**
   * Marca la credencial para cambio obligatorio en el próximo ingreso y avanza
   * `authorization_version` para revocar las sesiones vivas. Requiere
   * transacción.
   */
  expireCredential(input: { readonly userId: string }): Promise<boolean>;
}
