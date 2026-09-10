import { useCallback, useEffect, useState } from 'react';
import {
  changeSupplierStatusContract,
  correctSupplierTaxIdentityContract,
  createSupplierContract,
  isPermissionGranted,
  listSuppliersContract,
  updateSupplierContract,
  type FiscalAddressPayload,
  type SupplierResponse,
  type SupplierStatusResponse,
  type UpdateSupplierRequest
} from '@supermarket/shared';
import { createIdempotencyKey } from '../api-client.js';
import {
  ActionButton, EmptyState, Feedback, Modal, ReasonField, ScreenNote, type ScreenProps
} from './shared.js';

/** Contratos que convierten esta pantalla en trabajo real y no en una lectura. */
const SUPPLIER_WORK_CONTRACTS = [
  listSuppliersContract, createSupplierContract, updateSupplierContract,
  correctSupplierTaxIdentityContract
] as const;

/**
 * El maestro se ofrece a quien puede leerlo o administrarlo; cada comando se
 * sigue mostrando según su contrato y vuelve a autorizar en el servidor.
 */
export const canManageSuppliers = (permissionCodes: readonly string[]): boolean =>
  SUPPLIER_WORK_CONTRACTS.some(
    (contract) => isPermissionGranted(contract.permission, permissionCodes)
  );

export const SUPPLIER_STATUS_LABELS: Record<SupplierStatusResponse, string> = {
  ACTIVE: 'Activo',
  BLOCKED: 'Bloqueado',
  INACTIVE: 'Inactivo'
};

export const SUPPLIER_STATUS_HINTS: Record<SupplierStatusResponse, string> = {
  ACTIVE: 'Opera con normalidad y admite nuevas operaciones.',
  BLOCKED: 'Vigente pero suspendido: no admite operaciones nuevas y puede reactivarse.',
  INACTIVE: 'Relación comercial retirada: queda fuera de los selectores operativos.'
};

/**
 * Tipo fiscal que Cullen v1 admite por país: `RIF` en Venezuela y la identidad
 * genérica `TAX_ID` en el resto. El operador no lo escribe; el dominio vuelve a
 * exigirlo en el servidor.
 */
export const supplierTaxTypeFor = (country: string): string =>
  (country.trim().toUpperCase() === 'VE' ? 'RIF' : 'TAX_ID');

export type SupplierForm = {
  readonly legalName: string;
  readonly tradeName: string;
  readonly addressCountry: string;
  readonly addressLine: string;
  readonly reason: string;
};

export const toSupplierForm = (supplier: SupplierResponse): SupplierForm => ({
  legalName: supplier.legalName,
  tradeName: supplier.tradeName ?? '',
  addressCountry: supplier.fiscalAddress?.countryCode ?? supplier.taxIdentity.country,
  addressLine: supplier.fiscalAddress?.addressLine ?? '',
  reason: ''
});

const optional = (value: string): string | null => (value.trim() === '' ? null : value.trim());

/**
 * La dirección fiscal viaja completa o no viaja: país y línea son inseparables.
 * Una línea vacía la retira; una línea escrita sin país no llega al servidor
 * como media dirección.
 */
export const toFiscalAddress = (form: SupplierForm): FiscalAddressPayload | null => {
  const addressLine = form.addressLine.trim();
  const countryCode = form.addressCountry.trim().toUpperCase();
  return addressLine === '' || countryCode === '' ? null : { countryCode, addressLine };
};

const sameAddress = (
  left: FiscalAddressPayload | null,
  right: FiscalAddressPayload | null
): boolean => (left === null || right === null
  ? left === right
  : left.countryCode === right.countryCode && left.addressLine === right.addressLine);

/**
 * Construye la actualización con los campos que realmente cambiaron. El
 * contrato exige al menos uno: sin cambios no hay comando que enviar y la
 * pantalla no debe inventar uno.
 */
export const supplierUpdatePayload = (
  supplier: SupplierResponse,
  form: SupplierForm
): UpdateSupplierRequest | null => {
  const legalName = form.legalName.trim();
  const tradeName = optional(form.tradeName);
  const fiscalAddress = toFiscalAddress(form);
  const changes = {
    ...(legalName !== supplier.legalName && legalName !== '' ? { legalName } : {}),
    ...(tradeName !== supplier.tradeName ? { tradeName } : {}),
    ...(sameAddress(fiscalAddress, supplier.fiscalAddress) ? {} : { fiscalAddress })
  };
  if (Object.keys(changes).length === 0) return null;
  return { ...changes, reason: form.reason.trim() };
};

const emptyCreateForm = {
  legalName: '', tradeName: '', addressCountry: 'VE', addressLine: '',
  country: 'VE', value: '', reason: ''
};

export const SuppliersScreen = ({ api, permissionCodes }: ScreenProps): React.JSX.Element => {
  const [suppliers, setSuppliers] = useState<readonly SupplierResponse[]>([]);
  const [statusFilter, setStatusFilter] = useState<'' | SupplierStatusResponse>('');
  const [selected, setSelected] = useState<SupplierResponse | null>(null);
  const [form, setForm] = useState<SupplierForm>({
    legalName: '', tradeName: '', addressCountry: 'VE', addressLine: '', reason: ''
  });
  const [status, setStatus] = useState<SupplierStatusResponse>('ACTIVE');
  const [statusReason, setStatusReason] = useState('');
  const [taxValue, setTaxValue] = useState('');
  const [taxCountry, setTaxCountry] = useState('VE');
  const [taxReason, setTaxReason] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canCreate = isPermissionGranted(createSupplierContract.permission, permissionCodes);
  const canUpdate = isPermissionGranted(updateSupplierContract.permission, permissionCodes);
  const canChangeStatus = isPermissionGranted(
    changeSupplierStatusContract.permission, permissionCodes
  );
  const canCorrect = isPermissionGranted(
    correctSupplierTaxIdentityContract.permission, permissionCodes
  );

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try { setSuppliers(await api.listSuppliers(statusFilter === '' ? undefined : statusFilter)); }
    catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  }, [api, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const dismissFeedback = (): void => { setError(null); setNotice(null); };

  const select = (supplier: SupplierResponse): void => {
    setSelected(supplier);
    setForm(toSupplierForm(supplier));
    setStatus(supplier.status);
    setStatusReason('');
    setTaxCountry(supplier.taxIdentity.country);
    setTaxValue(supplier.taxIdentity.value);
    setTaxReason('');
  };

  const run = async (
    command: () => Promise<SupplierResponse>,
    message: string
  ): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const supplier = await command();
      select(supplier);
      setNotice(message);
      await load();
    } catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  };

  const create = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const fiscalAddress = toFiscalAddress(createForm);
    await run(async () => {
      const created = await api.createSupplier({
        legalName: createForm.legalName.trim(),
        ...(createForm.tradeName.trim() ? { tradeName: createForm.tradeName.trim() } : {}),
        ...(fiscalAddress ? { fiscalAddress } : {}),
        taxIdentity: {
          country: createForm.country.trim().toUpperCase(),
          type: supplierTaxTypeFor(createForm.country),
          value: createForm.value.trim()
        },
        reason: createForm.reason.trim()
      }, createIdempotencyKey());
      setCreateForm(emptyCreateForm);
      setShowCreate(false);
      return created;
    }, 'Proveedor registrado.');
  };

  const update = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!selected) return;
    const payload = supplierUpdatePayload(selected, form);
    if (!payload) {
      setError(null);
      setNotice('No hay cambios que guardar en este proveedor.');
      return;
    }
    await run(
      () => api.updateSupplier(selected.id, payload, createIdempotencyKey()),
      'Proveedor actualizado.'
    );
  };

  const changeStatus = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!selected) return;
    await run(
      () => api.changeSupplierStatus(
        selected.id, { status, reason: statusReason.trim() }, createIdempotencyKey()
      ),
      'Estado del proveedor actualizado.'
    );
  };

  const correctTaxIdentity = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!selected) return;
    await run(
      () => api.correctSupplierTaxIdentity(selected.id, {
        taxIdentity: {
          country: taxCountry.trim().toUpperCase(),
          type: supplierTaxTypeFor(taxCountry),
          value: taxValue.trim()
        },
        reason: taxReason.trim()
      }, createIdempotencyKey()),
      'Identidad fiscal corregida.'
    );
  };

  return (
    <div className="operation-screen">
      <ScreenNote>
        Administra el maestro de proveedores. Cada alta, cambio y corrección queda auditada; el
        estado sustituye al borrado y solo un proveedor activo puede recibir compras nuevas.
      </ScreenNote>
      <Feedback error={error} notice={notice} onDismiss={dismissFeedback} />
      <section className="panel">
        <div className="screen-toolbar">
          <label>Estado
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as '' | SupplierStatusResponse)}
            >
              <option value="">Todos</option>
              <option value="ACTIVE">Activos</option>
              <option value="BLOCKED">Bloqueados</option>
              <option value="INACTIVE">Inactivos</option>
            </select>
          </label>
          <ActionButton type="button" onClick={() => void load()} busy={loading} disabled={loading}>
            {loading ? 'Consultando…' : 'Actualizar listado'}
          </ActionButton>
          {canCreate && (
            <button type="button" onClick={() => setShowCreate(true)}>Nuevo proveedor</button>
          )}
        </div>
        {showCreate && canCreate && (
          <Modal
            title="Nuevo proveedor"
            description="El maestro exige razón social, identidad fiscal y motivo."
            onClose={() => setShowCreate(false)}
          >
          <form className="stack-form" onSubmit={create}>
            <div className="form-grid">
              <label>Razón social
                <input value={createForm.legalName} required
                  onChange={(event) => setCreateForm({ ...createForm, legalName: event.target.value })} />
              </label>
              <label>Nombre comercial
                <input value={createForm.tradeName}
                  onChange={(event) => setCreateForm({ ...createForm, tradeName: event.target.value })} />
              </label>
              <label>País
                <input value={createForm.country} maxLength={2} required
                  onChange={(event) => setCreateForm({ ...createForm, country: event.target.value.toUpperCase() })} />
              </label>
              <label>Tipo fiscal
                <input value={supplierTaxTypeFor(createForm.country)} readOnly
                  />
              </label>
              <label>Identificación fiscal
                <input value={createForm.value} placeholder="J-12345678-9" required
                  onChange={(event) => setCreateForm({ ...createForm, value: event.target.value })} />
              </label>
              <label>País de la dirección
                <input value={createForm.addressCountry} maxLength={2}
                  onChange={(event) => setCreateForm({
                    ...createForm, addressCountry: event.target.value.toUpperCase()
                  })} />
              </label>
              <label>Dirección fiscal
                <input value={createForm.addressLine} placeholder="Opcional en el maestro"
                  onChange={(event) => setCreateForm({ ...createForm, addressLine: event.target.value })} />
              </label>
            </div>
            <ReasonField
              value={createForm.reason}
              onChange={(reason) => setCreateForm({ ...createForm, reason })}
              suggestions={['Nuevo proveedor aprobado', 'Alta de proveedor existente', 'Proveedor alterno para contingencia']}
            />
            <ActionButton className="primary-button" type="submit" busy={loading} disabled={loading}>
              {loading ? 'Registrando…' : 'Registrar proveedor'}
            </ActionButton>
          </form>
          </Modal>
        )}
        {suppliers.length === 0 ? (
          <EmptyState>No hay proveedores registrados para este filtro.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Código</th><th>Razón social</th><th>Identidad fiscal</th>
                  <th>Estado</th><th />
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td>{supplier.code}</td>
                    <td>
                      {supplier.legalName}
                      {supplier.tradeName && <small className="muted"> · {supplier.tradeName}</small>}
                    </td>
                    <td>{supplier.taxIdentity.type} {supplier.taxIdentity.value}</td>
                    <td>{SUPPLIER_STATUS_LABELS[supplier.status]}</td>
                    <td>
                      <button type="button" onClick={() => select(supplier)}>Ver ficha</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selected && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{selected.code}</p>
              <h3>{selected.legalName}</h3>
            </div>
            <strong className="total-figure">{SUPPLIER_STATUS_LABELS[selected.status]}</strong>
          </div>
          <dl className="detail-grid">
            <div><dt>Identidad fiscal</dt><dd>
              {selected.taxIdentity.country} · {selected.taxIdentity.type} {selected.taxIdentity.value}
            </dd></div>
            <div><dt>Normalizada</dt><dd>{selected.taxIdentity.normalizedValue}</dd></div>
            <div><dt>Alta</dt><dd>{new Date(selected.createdAt).toLocaleString('es-VE')}</dd></div>
            <div><dt>Versión</dt><dd>{selected.version}</dd></div>
          </dl>
          <form className="stack-form" onSubmit={update}>
            <p className="eyebrow">Datos comerciales</p>
            <div className="form-grid">
              <label>Razón social
                <input value={form.legalName} required
                  onChange={(event) => setForm({ ...form, legalName: event.target.value })} />
              </label>
              <label>Nombre comercial
                <input value={form.tradeName}
                  onChange={(event) => setForm({ ...form, tradeName: event.target.value })} />
              </label>
              <label>País de la dirección
                <input value={form.addressCountry} maxLength={2}
                  onChange={(event) => setForm({
                    ...form, addressCountry: event.target.value.toUpperCase()
                  })} />
              </label>
              <label>Dirección fiscal
                <input value={form.addressLine} placeholder="Vacía retira la dirección"
                  onChange={(event) => setForm({ ...form, addressLine: event.target.value })} />
              </label>
            </div>
            <ReasonField
              value={form.reason}
              onChange={(reason) => setForm({ ...form, reason })}
              suggestions={['Cambio informado por el proveedor', 'Corrección de datos mal cargados', 'Actualización de dirección fiscal']}
            />
            <ActionButton className="primary-button" type="submit" busy={loading}
              disabled={loading || !canUpdate}>
              {loading ? 'Guardando…' : 'Guardar cambios'}
            </ActionButton>
          </form>
          <form className="stack-form" onSubmit={changeStatus}>
            <p className="eyebrow">Estado</p>
            <label>Nuevo estado
              <select value={status}
                onChange={(event) => setStatus(event.target.value as SupplierStatusResponse)}>
                <option value="ACTIVE">Activo</option>
                <option value="BLOCKED">Bloqueado</option>
                <option value="INACTIVE">Inactivo</option>
              </select>
            </label>
            <p className="muted">{SUPPLIER_STATUS_HINTS[status]}</p>
            <ReasonField
              value={statusReason}
              onChange={setStatusReason}
              suggestions={['Cese de relación comercial', 'Documentación vencida', 'Incumplimiento de entrega', 'Reactivación aprobada']}
            />
            <ActionButton type="submit" busy={loading} disabled={loading || !canChangeStatus}>
              {loading ? 'Aplicando…' : 'Cambiar estado'}
            </ActionButton>
          </form>
          {canCorrect && (
            <form className="stack-form" onSubmit={correctTaxIdentity}>
              <p className="eyebrow">Corrección privilegiada</p>
              <p className="muted">
                Corrige la identidad fiscal de la misma entidad legal. Un contribuyente distinto
                exige registrar otro proveedor.
              </p>
              <div className="form-grid">
                <label>País
                  <input value={taxCountry} maxLength={2} required
                    onChange={(event) => setTaxCountry(event.target.value.toUpperCase())} />
                </label>
                <label>Tipo fiscal
                  <input value={supplierTaxTypeFor(taxCountry)} readOnly />
                </label>
                <label>Identificación fiscal
                  <input value={taxValue} required onChange={(event) => setTaxValue(event.target.value)} />
                </label>
              </div>
              <label>Motivo
                <input value={taxReason} required onChange={(event) => setTaxReason(event.target.value)} />
              </label>
              <ActionButton type="submit" busy={loading} disabled={loading}>
                {loading ? 'Corrigiendo…' : 'Corregir identidad fiscal'}
              </ActionButton>
            </form>
          )}
        </section>
      )}
    </div>
  );
};
