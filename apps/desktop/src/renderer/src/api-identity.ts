/**
 * Operaciones de identidad del cliente HTTP.
 * Administración de identidad: operadores, roles y enrolamiento.
 *
 * Grupo propio desde 12.05.04: cambiar una de estas operaciones se hace aquí y
 * no dentro de las noventa y dos de todas las features. `createDesktopApi` las
 * esparce, así que la superficie pública no cambia.
 */
import {
  getIdentityDirectoryContract,
  createOperatorContract,
  updateOperatorContract,
  changeOperatorStatusContract,
  assignOperatorRolesContract,
  expireOperatorCredentialContract,
  createRoleContract,
  updateRolePermissionsContract,
  changeRoleStatusContract,
  authorizeCredentialEnrollmentContract,
  type IdentityDirectoryResponse,
  type IdentityOperatorResponse,
  type IdentityRoleResponse,
  type CreateOperatorRequest,
  type UpdateOperatorRequest,
  type ChangeOperatorStatusRequest,
  type AssignOperatorRolesRequest,
  type ExpireOperatorCredentialRequest,
  type CreateRoleRequest,
  type UpdateRolePermissionsRequest,
  type ChangeRoleStatusRequest,
  type AuthorizeCredentialEnrollmentRequest,
  type CredentialEnrollmentResponse
} from '@supermarket/shared';
import { path, requestJson } from './api-transport.js';

export const identityOperations = (fetcher: typeof fetch) => ({
  getIdentityDirectory: (): Promise<IdentityDirectoryResponse> => requestJson(
    fetcher, getIdentityDirectoryContract.path, { method: getIdentityDirectoryContract.method }
  ),
  createOperator: (input: CreateOperatorRequest): Promise<IdentityOperatorResponse> => requestJson(
    fetcher, createOperatorContract.path,
    { method: createOperatorContract.method, body: JSON.stringify(input) }
  ),
  updateOperator: (
    userId: string, input: UpdateOperatorRequest
  ): Promise<IdentityOperatorResponse> => requestJson(
    fetcher, path(updateOperatorContract.path, userId),
    { method: updateOperatorContract.method, body: JSON.stringify(input) }
  ),
  changeOperatorStatus: (
    userId: string, input: ChangeOperatorStatusRequest
  ): Promise<IdentityOperatorResponse> => requestJson(
    fetcher, path(changeOperatorStatusContract.path, userId),
    { method: changeOperatorStatusContract.method, body: JSON.stringify(input) }
  ),
  assignOperatorRoles: (
    userId: string, input: AssignOperatorRolesRequest
  ): Promise<IdentityOperatorResponse> => requestJson(
    fetcher, path(assignOperatorRolesContract.path, userId),
    { method: assignOperatorRolesContract.method, body: JSON.stringify(input) }
  ),
  expireOperatorCredential: (
    userId: string, input: ExpireOperatorCredentialRequest
  ): Promise<void> => requestJson(
    fetcher, path(expireOperatorCredentialContract.path, userId),
    { method: expireOperatorCredentialContract.method, body: JSON.stringify(input) }
  ),
  createRole: (input: CreateRoleRequest): Promise<IdentityRoleResponse> => requestJson(
    fetcher, createRoleContract.path,
    { method: createRoleContract.method, body: JSON.stringify(input) }
  ),
  updateRolePermissions: (
    roleId: string, input: UpdateRolePermissionsRequest
  ): Promise<IdentityRoleResponse> => requestJson(
    fetcher, path(updateRolePermissionsContract.path, roleId),
    { method: updateRolePermissionsContract.method, body: JSON.stringify(input) }
  ),
  changeRoleStatus: (
    roleId: string, input: ChangeRoleStatusRequest
  ): Promise<IdentityRoleResponse> => requestJson(
    fetcher, path(changeRoleStatusContract.path, roleId),
    { method: changeRoleStatusContract.method, body: JSON.stringify(input) }
  ),
  authorizeCredentialEnrollment: (
    input: AuthorizeCredentialEnrollmentRequest
  ): Promise<CredentialEnrollmentResponse> => requestJson(
    fetcher, authorizeCredentialEnrollmentContract.path,
    { method: authorizeCredentialEnrollmentContract.method, body: JSON.stringify(input) }
  )
});