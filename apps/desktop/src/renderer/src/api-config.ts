/**
 * Operaciones de configuración operativa del cliente HTTP.
 * Configuración operativa: sucursales, dispositivos, cajas, métodos de pago y
 * políticas vigentes, más el maestro que la pantalla lee de una vez.
 *
 * Grupo propio desde 12.05.04: cambiar una de estas operaciones se hace aquí y
 * no dentro de las noventa y dos de todas las features. `createDesktopApi` las
 * esparce, así que la superficie pública no cambia.
 */
import {
  listCashRegistersContract,
  listPaymentMethodsContract,
  createBranchContract,
  createCashRegisterContract,
  updateBranchContract,
  changeBranchStatusContract,
  getBranchContract,
  listBranchesContract,
  declareDeviceContract,
  updateDeviceContract,
  changeDeviceStatusContract,
  listDevicesContract,
  listOperationalMasterDataContract,
  savePaymentMethodContract,
  activateDiscountPolicyContract,
  activateTaxPolicyContract,
  type CreateBranchRequest,
  type CreateCashRegisterRequest,
  type CashRegisterConfigResponse,
  type UpdateBranchRequest,
  type ChangeBranchStatusRequest,
  type BranchResponse,
  type BranchStatusResponse,
  type DeclareDeviceRequest,
  type UpdateDeviceRequest,
  type ChangeDeviceStatusRequest,
  type DeviceResponse,
  type DeviceStatusResponse,
  type OperationalMasterDataResponse,
  type SavePaymentMethodRequest,
  type ActivateDiscountPolicyRequest,
  type ActivateTaxPolicyRequest,
  type PolicyActivationResponse,
  type CashRegisterResponse,
  type PaymentMethodResponse
} from '@supermarket/shared';
import { path, requestJson, search, withIdempotency } from './api-transport.js';

export const configOperations = (fetcher: typeof fetch) => ({
  createBranch: (input: CreateBranchRequest, idempotencyKey: string): Promise<BranchResponse> => requestJson(
    fetcher, createBranchContract.path,
    { method: createBranchContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  updateBranch: (branchId: string, input: UpdateBranchRequest, idempotencyKey: string): Promise<BranchResponse> => requestJson(
    fetcher, path(updateBranchContract.path, branchId),
    { method: updateBranchContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  changeBranchStatus: (branchId: string, input: ChangeBranchStatusRequest, idempotencyKey: string): Promise<BranchResponse> => requestJson(
    fetcher, path(changeBranchStatusContract.path, branchId),
    { method: changeBranchStatusContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  getBranch: (branchId: string): Promise<BranchResponse> => requestJson(
    fetcher, path(getBranchContract.path, branchId), { method: getBranchContract.method }
  ),
  listBranches: (status?: BranchStatusResponse): Promise<readonly BranchResponse[]> => requestJson(
    fetcher, listBranchesContract.path + search({ status }), { method: listBranchesContract.method }
  ),
  declareDevice: (input: DeclareDeviceRequest, idempotencyKey: string): Promise<DeviceResponse> => requestJson(
    fetcher, declareDeviceContract.path,
    { method: declareDeviceContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  updateDevice: (deviceId: string, input: UpdateDeviceRequest, idempotencyKey: string): Promise<DeviceResponse> => requestJson(
    fetcher, path(updateDeviceContract.path, deviceId),
    { method: updateDeviceContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  changeDeviceStatus: (deviceId: string, input: ChangeDeviceStatusRequest, idempotencyKey: string): Promise<DeviceResponse> => requestJson(
    fetcher, path(changeDeviceStatusContract.path, deviceId),
    { method: changeDeviceStatusContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  listDevices: (query: { terminalId?: string; status?: DeviceStatusResponse } = {}): Promise<readonly DeviceResponse[]> => requestJson(
    fetcher, listDevicesContract.path + search(query), { method: listDevicesContract.method }
  ),
  listOperationalMasterData: (): Promise<OperationalMasterDataResponse> => requestJson(
    fetcher, listOperationalMasterDataContract.path, { method: listOperationalMasterDataContract.method }
  ),
  savePaymentMethod: (input: SavePaymentMethodRequest, idempotencyKey: string): Promise<OperationalMasterDataResponse['paymentMethods'][number]> => requestJson(
    fetcher, savePaymentMethodContract.path,
    { method: savePaymentMethodContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  createCashRegister: (input: CreateCashRegisterRequest, idempotencyKey: string): Promise<CashRegisterConfigResponse> => requestJson(
    fetcher, createCashRegisterContract.path,
    { method: createCashRegisterContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  activateDiscountPolicy: (input: ActivateDiscountPolicyRequest, idempotencyKey: string): Promise<PolicyActivationResponse> => requestJson(
    fetcher, activateDiscountPolicyContract.path,
    { method: activateDiscountPolicyContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  activateTaxPolicy: (input: ActivateTaxPolicyRequest, idempotencyKey: string): Promise<PolicyActivationResponse> => requestJson(
    fetcher, activateTaxPolicyContract.path,
    { method: activateTaxPolicyContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  listPaymentMethods: (): Promise<readonly PaymentMethodResponse[]> => requestJson(
    fetcher, listPaymentMethodsContract.path, { method: listPaymentMethodsContract.method }
  ),
  listCashRegisters: (): Promise<readonly CashRegisterResponse[]> => requestJson(
    fetcher, listCashRegistersContract.path, { method: listCashRegistersContract.method }
  ),
  /**
   * Estado de sincronización de un destino y antigüedad de sus referencias. Es
   * una lectura: consultarla no confirma ninguna entrega.
   */
});