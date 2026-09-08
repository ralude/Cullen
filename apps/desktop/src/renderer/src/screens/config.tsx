import { useCallback, useEffect, useRef, useState } from 'react';
import {
  changeBranchStatusContract,
  changeDeviceStatusContract,
  activateDiscountPolicyContract,
  activateTaxPolicyContract,
  createBranchContract,
  declareDeviceContract,
  listOperationalMasterDataContract,
  saveCategoryContract,
  createCashRegisterContract,
  savePaymentMethodContract,
  saveUnitContract,
  isPermissionGranted,
  updateBranchContract,
  updateDeviceContract,
  type BranchResponse,
  type BranchStatusResponse,
  type DeviceResponse,
  type DeviceStatusResponse,
  type DeviceTypeResponse,
  type CashRegisterResponse,
  type OperationalMasterDataResponse
} from '@supermarket/shared';
import { createIdempotencyKey } from '../api-client.js';
import { ActionButton, EmptyState, Feedback, ScreenNote, type ScreenProps } from './shared.js';

const CONFIG_COMMAND_CONTRACTS = [
  createBranchContract, updateBranchContract, changeBranchStatusContract,
  declareDeviceContract, updateDeviceContract, changeDeviceStatusContract,
  saveCategoryContract, saveUnitContract, savePaymentMethodContract, createCashRegisterContract,
  activateDiscountPolicyContract, activateTaxPolicyContract
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
  const [masterData, setMasterData] = useState<OperationalMasterDataResponse>({ categories: [], units: [], paymentMethods: [] });
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
  const [categoryName, setCategoryName] = useState('');
  const [unitCode, setUnitCode] = useState('');
  const [unitName, setUnitName] = useState('');
  const [unitScale, setUnitScale] = useState('0');
  const [paymentCode, setPaymentCode] = useState('');
  const [cashRegisterName, setCashRegisterName] = useState('');
  const [cashRegisters, setCashRegisters] = useState<readonly CashRegisterResponse[]>([]);
  const [paymentName, setPaymentName] = useState('');
  const [paymentKind, setPaymentKind] = useState<'CASH' | 'CARD' | 'MOBILE_PAYMENT' | 'BANK_TRANSFER' | 'OTHER'>('CASH');
  const [paymentCurrency, setPaymentCurrency] = useState('VES');
  const [operationalReason, setOperationalReason] = useState('');
  const [discountMaximum, setDiscountMaximum] = useState('');
  const [taxRate, setTaxRate] = useState('');
  const [taxMethods, setTaxMethods] = useState('');
  const [taxCurrencies, setTaxCurrencies] = useState('');
  const [policyConfirmed, setPolicyConfirmed] = useState(false);
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
  const canManageCatalog = isPermissionGranted(saveCategoryContract.permission, permissionCodes);
  const canManagePayments = isPermissionGranted(savePaymentMethodContract.permission, permissionCodes);
  const canManageCashRegisters = isPermissionGranted(
    createCashRegisterContract.permission, permissionCodes
  );
  const canManageTax = isPermissionGranted(activateTaxPolicyContract.permission, permissionCodes);
  const canReadOperational = isPermissionGranted(listOperationalMasterDataContract.permission, permissionCodes);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [branchList, deviceList, operational, registerList] = await Promise.all([
        canManageBranches ? api.listBranches() : Promise.resolve([]),
        canManageDevices ? api.listDevices() : Promise.resolve([]),
        canReadOperational ? api.listOperationalMasterData() : Promise.resolve({ categories: [], units: [], paymentMethods: [] }),
        canManageCashRegisters ? api.listCashRegisters() : Promise.resolve([])
      ]);
      setBranches(branchList); setDevices(deviceList); setMasterData(operational);
      setCashRegisters(registerList);
    } catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  }, [api, canManageBranches, canManageCashRegisters, canManageDevices, canReadOperational]);

  useEffect(() => { void load(); }, [load]);

  const dismissFeedback = (): void => { setError(null); setNotice(null); };

  const executeOperational = async (intent: string, work: (key: string) => Promise<unknown>, message: string): Promise<void> => {
    setLoading(true); setError(null);
    try {
      await work(intentKey(intent)); intentKeys.current.delete(intent);
      setNotice(message); await load();
    } catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  };

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

      {(canManageCatalog || canManagePayments || canManageCashRegisters || canManageTax) && (
        <section className="panel">
          <div className="panel-heading"><h3>Configuración operativa</h3></div>
          <p>Las bajas conservan historia. Los cambios de política crean una versión con vigencia nueva.</p>
          <label>Motivo de la configuración
            <input value={operationalReason} onChange={(event) => setOperationalReason(event.target.value)} required />
          </label>
          {canManageCatalog && (
            <>
              <form className="stack-form" onSubmit={(event) => {
                event.preventDefault(); const intent = `category:${categoryName}:${operationalReason}`;
                void executeOperational(intent, (key) => api.saveCategory({ name: categoryName, isActive: true, reason: operationalReason }, key), 'Categoría guardada.');
              }}>
                <h4>Categorías</h4><div className="form-grid">
                  <label>Nombre<input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} required /></label>
                </div><ActionButton type="submit" busy={loading} disabled={loading || !operationalReason.trim()}>Guardar categoría</ActionButton>
              </form>
              {masterData.categories.map((category) => <div className="configuration-row" key={category.id}>
                <span>{category.name} · {category.isActive ? 'Activa' : 'Inactiva'}</span>
                <button type="button" disabled={loading || !operationalReason.trim()} onClick={() => {
                  const intent = `category:${category.id}:${!category.isActive}:${operationalReason}`;
                  void executeOperational(intent, (key) => api.saveCategory({ id: category.id, name: category.name, isActive: !category.isActive, reason: operationalReason }, key), 'Estado de categoría actualizado.');
                }}>{category.isActive ? 'Desactivar' : 'Reactivar'}</button>
              </div>)}
              <form className="stack-form" onSubmit={(event) => {
                event.preventDefault(); const intent = `unit:${unitCode}:${unitName}:${unitScale}:${operationalReason}`;
                void executeOperational(intent, (key) => api.saveUnit({ code: unitCode, name: unitName, quantityScale: Number(unitScale), isActive: true, reason: operationalReason }, key), 'Unidad guardada.');
              }}>
                <h4>Unidades</h4><div className="form-grid">
                  <label>Código<input value={unitCode} onChange={(event) => setUnitCode(event.target.value.toUpperCase())} required /></label>
                  <label>Nombre<input value={unitName} onChange={(event) => setUnitName(event.target.value)} required /></label>
                  <label>Decimales<input type="number" min="0" max="6" value={unitScale} onChange={(event) => setUnitScale(event.target.value)} required /></label>
                </div><ActionButton type="submit" busy={loading} disabled={loading || !operationalReason.trim()}>Guardar unidad</ActionButton>
              </form>
              {masterData.units.map((unit) => <div className="configuration-row" key={unit.id}>
                <span>{unit.code} · {unit.name} · escala {unit.quantityScale} · {unit.isActive ? 'Activa' : 'Inactiva'}</span>
                <button type="button" disabled={loading || !operationalReason.trim()} onClick={() => {
                  const intent = `unit:${unit.code}:${!unit.isActive}:${operationalReason}`;
                  void executeOperational(intent, (key) => api.saveUnit({ code: unit.code, name: unit.name, quantityScale: unit.quantityScale, isActive: !unit.isActive, reason: operationalReason }, key), 'Estado de unidad actualizado.');
                }}>{unit.isActive ? 'Desactivar' : 'Reactivar'}</button>
              </div>)}
            </>
          )}
          {canManageCashRegisters && (
            <>
              <form className="stack-form" onSubmit={(event) => {
                event.preventDefault();
                const intent = `cash-register:${cashRegisterName}:${operationalReason}`;
                void executeOperational(
                  intent,
                  (key) => api.createCashRegister(
                    { name: cashRegisterName, reason: operationalReason }, key
                  ),
                  'Caja registrada. Ya puedes abrir turno desde la pantalla de Caja.'
                );
              }}>
                <h4>Cajas de esta terminal</h4>
                <p className="muted">
                  Sin al menos una caja no hay turno posible. La caja pertenece a la terminal que
                  la declara y ese dueño no cambia.
                </p>
                <div className="form-grid">
                  <label>Nombre<input value={cashRegisterName}
                    onChange={(event) => setCashRegisterName(event.target.value)} required /></label>
                </div>
                <ActionButton type="submit" busy={loading}
                  disabled={loading || !operationalReason.trim() || !cashRegisterName.trim()}>
                  Registrar caja
                </ActionButton>
              </form>
              {cashRegisters.map((register) => (
                <div className="configuration-row" key={register.id}>
                  <span title={register.id}>{register.name}</span>
                </div>
              ))}
            </>
          )}
          {canManagePayments && (
            <>
              <form className="stack-form" onSubmit={(event) => {
                event.preventDefault(); const intent = `payment:${paymentCode}:${paymentName}:${paymentKind}:${paymentCurrency}:${operationalReason}`;
                void executeOperational(intent, (key) => api.savePaymentMethod({ code: paymentCode, name: paymentName, kind: paymentKind, currencyCode: paymentCurrency, isActive: true, reason: operationalReason }, key), 'Método de pago guardado.');
              }}>
                <h4>Métodos de pago</h4><div className="form-grid">
                  <label>Código<input value={paymentCode} onChange={(event) => setPaymentCode(event.target.value.toUpperCase())} required /></label>
                  <label>Nombre<input value={paymentName} onChange={(event) => setPaymentName(event.target.value)} required /></label>
                  <label>Tipo<select value={paymentKind} onChange={(event) => setPaymentKind(event.target.value as typeof paymentKind)}>
                    <option value="CASH">Efectivo</option><option value="CARD">Tarjeta</option><option value="MOBILE_PAYMENT">Pago móvil</option><option value="BANK_TRANSFER">Transferencia</option><option value="OTHER">Otro</option>
                  </select></label>
                  <label>Moneda<input maxLength={3} value={paymentCurrency} onChange={(event) => setPaymentCurrency(event.target.value.toUpperCase())} required /></label>
                </div><ActionButton type="submit" busy={loading} disabled={loading || !operationalReason.trim()}>Guardar método</ActionButton>
              </form>
              {masterData.paymentMethods.map((method) => <div className="configuration-row" key={method.code}>
                <span>{method.code} · {method.name} · {method.currencyCode} · {method.isActive ? 'Activo' : 'Inactivo'}</span>
                <button type="button" disabled={loading || !operationalReason.trim()} onClick={() => {
                  const intent = `payment:${method.code}:${!method.isActive}:${operationalReason}`;
                  void executeOperational(intent, (key) => api.savePaymentMethod({ ...method, isActive: !method.isActive, reason: operationalReason }, key), 'Estado del método actualizado.');
                }}>{method.isActive ? 'Desactivar' : 'Reactivar'}</button>
              </div>)}
            </>
          )}
          {canManageTax && (
            <div className="stack-form">
              <p className="simulation-label">
                SIMULACIÓN · publicar cambia la política vigente para operaciones nuevas y conserva todas las versiones anteriores.
              </p>
              <label><input type="checkbox" checked={policyConfirmed} onChange={(event) => setPolicyConfirmed(event.target.checked)} /> Confirmo el alcance y la nueva vigencia</label>
              <div className="form-grid">
              <form className="stack-form" onSubmit={(event) => {
                event.preventDefault(); const intent = `discount:${discountMaximum}:${operationalReason}`;
                void executeOperational(intent, (key) => api.activateDiscountPolicy({ maximumBasisPoints: Number(discountMaximum), reason: operationalReason }, key), 'Política de descuento versionada.');
              }}><h4>Descuento máximo</h4><label>Puntos base<input type="number" min="0" max="10000" value={discountMaximum} onChange={(event) => setDiscountMaximum(event.target.value)} required /></label><ActionButton type="submit" busy={loading} disabled={loading || !operationalReason.trim() || !policyConfirmed}>Publicar versión</ActionButton></form>
              <form className="stack-form" onSubmit={(event) => {
                event.preventDefault(); const intent = `tax:${taxRate}:${taxMethods}:${taxCurrencies}:${operationalReason}`;
                void executeOperational(intent, (key) => api.activateTaxPolicy({ rateBasisPoints: Number(taxRate), eligiblePaymentMethodCodes: taxMethods.split(',').map((value) => value.trim()).filter(Boolean), eligibleCurrencies: taxCurrencies.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean), reason: operationalReason }, key), 'Política IGTF versionada.');
              }}><h4>IGTF · SIMULACIÓN</h4><label>Puntos base<input type="number" min="0" max="10000" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} required /></label><label>Métodos (separados por coma)<input value={taxMethods} onChange={(event) => setTaxMethods(event.target.value.toUpperCase())} /></label><label>Monedas (separadas por coma)<input value={taxCurrencies} onChange={(event) => setTaxCurrencies(event.target.value.toUpperCase())} /></label><ActionButton type="submit" busy={loading} disabled={loading || !operationalReason.trim() || !policyConfirmed}>Publicar versión</ActionButton></form>
              </div>
            </div>
          )}
        </section>
      )}

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
