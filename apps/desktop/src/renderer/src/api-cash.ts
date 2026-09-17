/**
 * Operaciones de caja del cliente HTTP.
 * Turno de caja: apertura, movimientos, cierre y consulta.
 *
 * Grupo propio desde 12.05.04: cambiar una de estas operaciones se hace aquí y
 * no dentro de las noventa y dos de todas las features. `createDesktopApi` las
 * esparce, así que la superficie pública no cambia.
 */
import {
  closeShiftContract,
  getShiftContract,
  getOpenShiftContract,
  openShiftContract,
  registerCashMovementContract,
  type CloseShiftRequest,
  type OpenShiftRequest,
  type RegisterCashMovementRequest,
  type ShiftResponse
} from '@supermarket/shared';
import { path, requestJson, withIdempotency } from './api-transport.js';

export const cashOperations = (fetcher: typeof fetch) => ({
  getOpenShift: (cashRegisterId: string): Promise<ShiftResponse> => requestJson(
    fetcher, path(getOpenShiftContract.path, cashRegisterId), { method: getOpenShiftContract.method }
  ),
  openShift: (input: OpenShiftRequest, idempotencyKey: string): Promise<ShiftResponse> => requestJson(
    fetcher, openShiftContract.path,
    { method: openShiftContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  registerCashMovement: (shiftId: string, input: RegisterCashMovementRequest, idempotencyKey: string): Promise<ShiftResponse> => requestJson(
    fetcher, path(registerCashMovementContract.path, shiftId),
    { method: registerCashMovementContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  closeShift: (shiftId: string, input: CloseShiftRequest, idempotencyKey: string): Promise<ShiftResponse> => requestJson(
    fetcher, path(closeShiftContract.path, shiftId),
    { method: closeShiftContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  getShift: (shiftId: string): Promise<ShiftResponse> => requestJson(
    fetcher, path(getShiftContract.path, shiftId), { method: getShiftContract.method }
  )
});