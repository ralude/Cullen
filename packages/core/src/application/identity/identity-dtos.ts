import type { IdentityOperatorSummary, IdentityRoleSummary } from '../ports/index.js';

/**
 * Proyección de un operador para la administración de identidad.
 *
 * `hasLocalCredential` es un dato propio de este nodo: una concesión publica
 * identidad y permisos, nunca credenciales
 * ([ADR-0028](../../../../../docs/architecture/adr/0028-enrolamiento-local-de-credenciales.md)).
 * Un operador sin credencial local existe, puede estar activo y aun así no
 * puede iniciar sesión aquí.
 */
export type IdentityOperatorDto = {
  readonly userId: string;
  readonly operatorCode: string;
  readonly displayName: string;
  readonly isActive: boolean;
  readonly roleIds: readonly string[];
  readonly roleCodes: readonly string[];
  readonly hasLocalCredential: boolean;
  readonly credentialMustChange: boolean;
};

export type IdentityRoleDto = {
  readonly roleId: string;
  readonly code: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly isAssignable: boolean;
  readonly permissionCodes: readonly string[];
  readonly memberCount: number;
};

export type IdentityDirectoryDto = {
  readonly operators: readonly IdentityOperatorDto[];
  readonly roles: readonly IdentityRoleDto[];
  readonly permissionCodes: readonly string[];
  /**
   * Si este nodo administra la identidad o solo la recibe del coordinador
   * (ADR-0027 D5). Lo publica la misma autoridad que rechaza el comando, para
   * que la interfaz pueda decir la verdad en vez de deducirla.
   */
  readonly ownedByThisNode: boolean;
};

export type CreateOperatorInput = {
  readonly operatorCode: string;
  readonly displayName: string;
  readonly roleIds: readonly string[];
  readonly reason: string;
};

export type UpdateOperatorInput = {
  readonly userId: string;
  readonly displayName: string;
  readonly reason: string;
};

export type ChangeOperatorStatusInput = {
  readonly userId: string;
  readonly isActive: boolean;
  readonly reason: string;
};

export type AssignOperatorRolesInput = {
  readonly userId: string;
  readonly roleIds: readonly string[];
  readonly reason: string;
};

export type CreateRoleInput = {
  readonly code: string;
  readonly name: string;
  readonly permissionCodes: readonly string[];
  readonly reason: string;
};

export type UpdateRolePermissionsInput = {
  readonly roleId: string;
  readonly permissionCodes: readonly string[];
  readonly reason: string;
};

export type ChangeRoleStatusInput = {
  readonly roleId: string;
  readonly isActive: boolean;
  readonly reason: string;
};

export const toOperatorDto = (summary: IdentityOperatorSummary): IdentityOperatorDto => ({
  userId: summary.userId,
  operatorCode: summary.operatorCode,
  displayName: summary.displayName,
  isActive: summary.isActive,
  roleIds: summary.roleIds,
  roleCodes: summary.roleCodes,
  hasLocalCredential: summary.hasLocalCredential,
  credentialMustChange: summary.credentialMustChange
});

export const toRoleDto = (summary: IdentityRoleSummary): IdentityRoleDto => ({
  roleId: summary.roleId,
  code: summary.code,
  name: summary.name,
  isActive: summary.isActive,
  isAssignable: summary.isAssignable,
  permissionCodes: summary.permissionCodes,
  memberCount: summary.memberCount
});
