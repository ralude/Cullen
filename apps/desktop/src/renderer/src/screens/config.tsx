import { useCallback, useEffect, useRef, useState } from 'react';
import {
  changeBranchStatusContract,
  changeDeviceStatusContract,
  createBranchContract,
  declareDeviceContract,
  isPermissionGranted,
  updateBranchContract,
  updateDeviceContract,
  type BranchResponse,
  type BranchStatusResponse,
  type DeviceResponse,
  type DeviceStatusResponse,
  type DeviceTypeResponse
} from '@supermarket/shared';
import { createIdempotencyKey } from '../api-client.js';
import { ActionButton, EmptyState, Feedback, ScreenNote, type ScreenProps } from './shared.js';

const CONFIG_COMMAND_CONTRACTS = [
  createBranchContract, updateBranchContract, changeBranchStatusContract,
  declareDeviceContract, updateDeviceContract, changeDeviceStatusContract
] as const;

/** El listado de sucursales y dispositivos existe para quien los administra. */
export const canManageConfig = (permissionCodes: readonly string[]): boolean =>
  CONFIG_COMMAND_CONTRACTS.some((contract) => isPermissionGranted(contract.permission, permissionCodes));

export const DEVICE_TYPE_LABELS: Record<DeviceTypeResponse, string> = {
  FISCAL_PRINTER: 'Impresora fiscal',
  BARCODE_SCANNER: 'Lector de código de barras',
  SCALE: 'Balanza',
  CASH_DRAWER: 'Gaveta de efectivo'
};

const BRANCH_STATUS_LABELS: Record<BranchStatusResponse, string> = { ACTIVE: 'Activa', INACTIVE: 'Inactiva' };
const DEVICE_STATUS_LABELS: Record<DeviceStatusResponse, string> = { ACTIVE: 'Activo', INACTIVE: 'Inactivo' };

export const ConfigScreen = ({ api, permissionCodes }: ScreenProps): React.JSX.Element => {
  const [branches, setBranches] = useState<readonly BranchResponse[]>([]);
  const [devices, setDevices] = useState<readonly DeviceResponse[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [branchCode, setBranchCode] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchReason, setBranchReason] = useState('');
  const [branchStatusReason, setBranchStatusReason] = useState('');

  const [deviceType, setDeviceType] = useState<DeviceTypeResponse>('BARCODE_SCANNER');
  const [deviceIdentifier, setDeviceIdentifier] = useState('');
  const [deviceTerminalId, setDeviceTerminalId] = useState('');
  const [deviceBranchId, setDeviceBranchId] = useState('');
  const [deviceReason, setDeviceReason] = useState('');
  const [deviceStatusReason, setDeviceStatusReason] = useState('');
  const intentKeys = useRef(new Map<string, string>());
  const intentKey = (intent: string): string => {
    const existing = intentKeys.current.get(intent);
    if (existing) return existing;
    const created = createIdempotencyKey();
    intentKeys.current.set(intent, created);
    return created;
  };

  const canManageBranches = isPermissionGranted(createBranchContract.permission, permissionCodes);
  const canManageDevices = isPermissionGranted(declareDeviceContract.permission, permissionCodes);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [branchList, deviceList] = await Promise.all([api.listBranches(), api.listDevices()]);
      setBranches(branchList); setDevices(deviceList);
    } catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const dismissFeedback = (): void => { setError(null); setNotice(null); };

  const createBranch = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const intent = `branch:create:${branchCode.trim()}:${branchName.trim()}:${branchReason.trim()}`;
    setLoading(true); setError(null);
    try {
      await api.createBranch({
        code: branchCode.trim(), name: branchName.trim(), reason: branchReason.trim()
      }, intentKey(intent));
      intentKeys.current.delete(intent);
      setBranchCode(''); setBranchName(''); setBranchReason('');
      setNotice('Sucursal registrada.');
      await load();
    } catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  };

  const toggleBranchStatus = async (branch: BranchResponse): Promise<void> => {
    const next = branch.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const intent = `branch:status:${branch.id}:${next}:${branchStatusReason.trim()}`;
    setLoading(true); setError(null);
    try {
      await api.changeBranchStatus(branch.id, {
        status: next, reason: branchStatusReason.trim()
      }, intentKey(intent));
      intentKeys.current.delete(intent);
      setBranchStatusReason('');
      setNotice('Estado de la sucursal actualizado.');
      await load();
    } catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  };

  const declareDevice = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const intent = `device:declare:${deviceType}:${deviceIdentifier.trim()}:${deviceTerminalId.trim()}:${deviceBranchId}:${deviceReason.trim()}`;
    setLoading(true); setError(null);
    try {
      await api.declareDevice({
        type: deviceType, identifier: deviceIdentifier.trim(), terminalId: deviceTerminalId.trim(),
        ...(deviceBranchId ? { branchId: deviceBranchId } : {}), reason: deviceReason.trim()
      }, intentKey(intent));
      intentKeys.current.delete(intent);
      setDeviceIdentifier(''); setDeviceTerminalId(''); setDeviceBranchId(''); setDeviceReason('');
      setNotice('Dispositivo declarado. La declaración no habilita ninguna capacidad real.');
      await load();
    } catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  };

  const toggleDeviceStatus = async (device: DeviceResponse): Promise<void> => {
    const next = device.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const intent = `device:status:${device.id}:${next}:${deviceStatusReason.trim()}`;
    setLoading(true); setError(null);
    try {
      await api.changeDeviceStatus(device.id, {
        status: next, reason: deviceStatusReason.trim()
      }, intentKey(intent));
      intentKeys.current.delete(intent);
      setDeviceStatusReason('');
      setNotice('Estado del dispositivo actualizado.');
      await load();
    } catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  };

  return (
    <div className="operation-screen">
      <ScreenNote>
        Sucursales y dispositivos son dato maestro y etiqueta de pertenencia: no gobiernan
        autoridad de escritura entre nodos ni habilitan hardware real. Toda impresora fiscal
        declarada aquí sigue operando en modo <strong>SIMULACIÓN</strong>.
      </ScreenNote>
      <Feedback error={error} notice={notice} onDismiss={dismissFeedback} />

      <section className="panel">
        <div className="panel-heading"><h3>Sucursales</h3></div>
        {canManageBranches && (
          <form className="stack-form" onSubmit={createBranch}>
            <div className="form-grid">
              <label>Código<input value={branchCode} onChange={(event) => setBranchCode(event.target.value)} required /></label>
              <label>Nombre<input value={branchName} onChange={(event) => setBranchName(event.target.value)} required /></label>
            </div>
            <label>Motivo<input value={branchReason} onChange={(event) => setBranchReason(event.target.value)} required /></label>
            <ActionButton className="primary-button" type="submit" busy={loading} disabled={loading}>
              Registrar sucursal
            </ActionButton>
          </form>
        )}
        {canManageBranches && branches.length > 0 && (
          <label>Motivo del cambio de estado
            <input value={branchStatusReason}
              onChange={(event) => setBranchStatusReason(event.target.value)} required />
          </label>
        )}
        {branches.length === 0 ? <EmptyState>No hay sucursales registradas.</EmptyState> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Código</th><th>Nombre</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {branches.map((branch) => (
                  <tr key={branch.id}>
                    <td>{branch.code}</td><td>{branch.name}</td>
                    <td>{BRANCH_STATUS_LABELS[branch.status]}</td>
                    <td>
                      {canManageBranches && (
                        <button type="button" onClick={() => void toggleBranchStatus(branch)}
                          disabled={loading || branchStatusReason.trim().length === 0}>
                          {branch.status === 'ACTIVE' ? 'Desactivar' : 'Reactivar'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading"><h3>Dispositivos declarados</h3></div>
        {canManageDevices && (
          <form className="stack-form" onSubmit={declareDevice}>
            <div className="form-grid">
              <label>Tipo
                <select value={deviceType} onChange={(event) => setDeviceType(event.target.value as DeviceTypeResponse)}>
                  {Object.entries(DEVICE_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>Identificador<input value={deviceIdentifier} onChange={(event) => setDeviceIdentifier(event.target.value)} required /></label>
              <label>Estación (terminal)<input value={deviceTerminalId} onChange={(event) => setDeviceTerminalId(event.target.value)} required /></label>
              <label>Sucursal (opcional)
                <select value={deviceBranchId} onChange={(event) => setDeviceBranchId(event.target.value)}>
                  <option value="">Sin asignar</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}</option>)}
                </select>
              </label>
            </div>
            {deviceType === 'FISCAL_PRINTER' && (
              <p className="simulation-label">Impresora fiscal · SIMULACIÓN — declararla no habilita emisión real.</p>
            )}
            <label>Motivo<input value={deviceReason} onChange={(event) => setDeviceReason(event.target.value)} required /></label>
            <ActionButton className="primary-button" type="submit" busy={loading} disabled={loading}>
              Declarar dispositivo
            </ActionButton>
          </form>
        )}
        {canManageDevices && devices.length > 0 && (
          <label>Motivo del cambio de estado
            <input value={deviceStatusReason}
              onChange={(event) => setDeviceStatusReason(event.target.value)} required />
          </label>
        )}
        {devices.length === 0 ? <EmptyState>No hay dispositivos declarados.</EmptyState> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Tipo</th><th>Identificador</th><th>Estación</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {devices.map((device) => (
                  <tr key={device.id}>
                    <td>{DEVICE_TYPE_LABELS[device.type]}</td>
                    <td>{device.identifier}</td>
                    <td>{device.terminalId}</td>
                    <td>{DEVICE_STATUS_LABELS[device.status]}</td>
                    <td>
                      {canManageDevices && (
                        <button type="button" onClick={() => void toggleDeviceStatus(device)}
                          disabled={loading || deviceStatusReason.trim().length === 0}>
                          {device.status === 'ACTIVE' ? 'Dar de baja' : 'Reactivar'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
