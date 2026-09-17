/**
 * Operaciones de sesión del cliente HTTP.
 * Ciclo de vida de la sesión: ingreso, cierre, capacidades del nodo y las dos
 * operaciones que una credencial caducada o ausente todavía puede hacer.
 *
 * Grupo propio desde 12.05.04: cambiar una de estas operaciones se hace aquí y
 * no dentro de las noventa y dos de todas las features. `createDesktopApi` las
 * esparce, así que la superficie pública no cambia.
 */
import {
  capabilitiesContract,
  currentSessionContract,
  loginContract,
  changeOwnPinContract,
  completeCredentialEnrollmentContract,
  logoutContract,
  type CapabilitiesResponse,
  type LoginRequest,
  type SessionResponse,
  type ChangeOwnPinRequest,
  type CompleteCredentialEnrollmentRequest
} from '@supermarket/shared';
import { requestJson } from './api-transport.js';

export const sessionOperations = (fetcher: typeof fetch) => ({
  currentSession: (): Promise<SessionResponse> => requestJson(
    fetcher, currentSessionContract.path, { method: currentSessionContract.method }
  ),
  login: (input: LoginRequest): Promise<SessionResponse> => requestJson(
    fetcher,
    loginContract.path,
    { method: loginContract.method, body: JSON.stringify(input) }
  ),
  logout: (): Promise<void> => requestJson(
    fetcher, logoutContract.path, { method: logoutContract.method }
  ),
  capabilities: (): Promise<CapabilitiesResponse> => requestJson(
    fetcher, capabilitiesContract.path, { method: capabilitiesContract.method }
  ),
  changeOwnPin: (input: ChangeOwnPinRequest): Promise<void> => requestJson(
    fetcher, changeOwnPinContract.path,
    { method: changeOwnPinContract.method, body: JSON.stringify(input) }
  ),
  completeCredentialEnrollment: (
    input: CompleteCredentialEnrollmentRequest
  ): Promise<{ readonly operatorCode: string }> => requestJson(
    fetcher, completeCredentialEnrollmentContract.path,
    { method: completeCredentialEnrollmentContract.method, body: JSON.stringify(input) }
  )
});