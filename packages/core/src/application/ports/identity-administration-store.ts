/**
 * Persistencia de la administración de identidad.
 *
 * Toda escritura de este puerto exige una transacción activa y ocurre dentro de
 * la unidad de trabajo del caso de uso, junto con el avance de
 * `authorization_version` de cada operador afectado y la comprobación del
 * invariante de último administrador. No hay ninguna combinación válida en la
 * que el cambio y su versión queden en transacciones distintas
 * ([ADR-0027](../../../../../docs/architecture/adr/0027-administracion-de-identidad.md) D4).
 */

/** Operador tal como lo administra el nodo dueño de la identidad. */
export type IdentityOperatorSummary = {
  readonly userId: string;
  readonly operatorCode: string;
  readonly displayName: string;
  readonly isActive: boolean;
  readonly roleIds: readonly string[];
  readonly roleCodes: readonly string[];
  readonly authorizationVersion: number;
  /** Existe credencial en **este** nodo. Una concesión no la implica (ADR-0028). */
  readonly hasLocalCredential: boolean;
  /** La credencial vigente obliga a cambiar el PIN en el próximo ingreso. */
  readonly credentialMustChange: boolean;
};

export type IdentityRoleSummary = {
  readonly roleId: string;
  readonly code: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly isAssignable: boolean;
  readonly permissionCodes: readonly string[];
  readonly memberCount: number;
};

/**
 * Resultado de una escritura de identidad. `APPLIED` publica los operadores
 * cuya autorización efectiva pudo cambiar: son los que avanzaron de versión y
 * los que la auditoría nombra.
 */
export type IdentityWriteOutcome =
  | { readonly status: 'APPLIED'; readonly affectedUserIds: readonly string[] }
  | { readonly status: 'OPERATOR_NOT_FOUND' }
  | { readonly status: 'ROLE_NOT_FOUND' }
  | { readonly status: 'OPERATOR_CODE_TAKEN' }
  | { readonly status: 'ROLE_CODE_TAKEN' }
  | { readonly status: 'ROLE_NOT_ASSIGNABLE' }
  | { readonly status: 'PERMISSION_UNKNOWN' };

export interface IdentityAdministrationStore {
  listOperators(): Promise<readonly IdentityOperatorSummary[]>;
  listRoles(): Promise<readonly IdentityRoleSummary[]>;
  /** Códigos de permiso que la base conoce, para validar una asignación. */
  listPermissionCodes(): Promise<readonly string[]>;
  findOperator(userId: string): Promise<IdentityOperatorSummary | null>;
  findRole(roleId: string): Promise<IdentityRoleSummary | null>;

  createOperator(input: {
    readonly userId: string;
    readonly operatorCode: string;
    readonly displayName: string;
    readonly roleIds: readonly string[];
    readonly now: Date;
  }): Promise<IdentityWriteOutcome>;

  updateOperator(input: {
    readonly userId: string;
    readonly displayName: string;
  }): Promise<IdentityWriteOutcome>;

  changeOperatorStatus(input: {
    readonly userId: string;
    readonly isActive: boolean;
  }): Promise<IdentityWriteOutcome>;

  assignOperatorRoles(input: {
    readonly userId: string;
    readonly roleIds: readonly string[];
  }): Promise<IdentityWriteOutcome>;

  createRole(input: {
    readonly roleId: string;
    readonly code: string;
    readonly name: string;
    readonly permissionCodes: readonly string[];
  }): Promise<IdentityWriteOutcome>;

  updateRolePermissions(input: {
    readonly roleId: string;
    readonly permissionCodes: readonly string[];
  }): Promise<IdentityWriteOutcome>;

  changeRoleStatus(input: {
    readonly roleId: string;
    readonly isActive: boolean;
  }): Promise<IdentityWriteOutcome>;

  /**
   * Postcondición del invariante de último administrador: se evalúa **después**
   * de escribir y dentro de la misma transacción, de modo que cubre el efecto
   * de cualquier mutación y no la forma del comando.
   */
  hasActiveAdministrator(permissionCode: string): Promise<boolean>;
}
