import { useCallback, useEffect, useState } from 'react';
import {
  authorizeCredentialEnrollmentContract,
  createOperatorContract,
  createRoleContract,
  getIdentityDirectoryContract,
  isPermissionGranted,
  type CredentialEnrollmentResponse,
  type IdentityDirectoryResponse,
  type IdentityOperatorResponse,
  type IdentityRoleResponse
} from '@supermarket/shared';
import {
  ActionButton, EmptyState, Feedback, ReasonField, ScreenNote, type ScreenProps
} from './shared.js';

/**
 * Contratos que hacen de esta pantalla trabajo real. El enrolamiento entra
 * aparte del directorio: es una capacidad local que existe aunque este nodo no
 * administre la identidad, y su permiso se concede por separado.
 */
const IDENTITY_WORK_CONTRACTS = [
  getIdentityDirectoryContract, authorizeCredentialEnrollmentContract
] as const;

export const canAdministerIdentity = (permissionCodes: readonly string[]): boolean =>
  IDENTITY_WORK_CONTRACTS.some(
    (contract) => isPermissionGranted(contract.permission, permissionCodes)
  );

/**
 * Estado de acceso local de un operador. La identidad puede llegar por
 * concesión del coordinador, pero la credencial nunca viaja
 * ([ADR-0028](../../../../../docs/architecture/adr/0028-enrolamiento-local-de-credenciales.md)):
 * un operador conocido y activo puede seguir sin poder ingresar aquí, y la
 * pantalla debe decirlo en lugar de presentarlo como listo.
 */
export type LocalAccessState =
  | 'ENROLLED'
  | 'MUST_CHANGE_PIN'
  | 'NEEDS_ENROLLMENT'
  | 'GRANTED_NEEDS_ENROLLMENT';

export const localAccessOf = (operator: IdentityOperatorResponse): LocalAccessState => {
  if (!operator.hasLocalIdentity) return 'GRANTED_NEEDS_ENROLLMENT';
  if (!operator.hasLocalCredential) return 'NEEDS_ENROLLMENT';
  return operator.credentialMustChange ? 'MUST_CHANGE_PIN' : 'ENROLLED';
};

export const LOCAL_ACCESS_LABELS: Record<LocalAccessState, string> = {
  ENROLLED: 'Credencial activa en esta terminal',
  MUST_CHANGE_PIN: 'Debe cambiar el PIN al ingresar',
  NEEDS_ENROLLMENT: 'Sin credencial local · requiere enrolamiento',
  GRANTED_NEEDS_ENROLLMENT: 'Concedido por el coordinador · requiere enrolamiento'
};

export const LOCAL_ACCESS_HINTS: Record<LocalAccessState, string> = {
  ENROLLED: 'Puede ingresar en esta terminal con su PIN.',
  MUST_CHANGE_PIN: 'Ingresa con su PIN actual y solo puede cambiarlo hasta hacerlo.',
  NEEDS_ENROLLMENT:
    'La identidad existe en este nodo, pero todavía no puede iniciar sesión aquí: '
    + 'autoriza un enrolamiento para que escriba su PIN en esta terminal.',
  GRANTED_NEEDS_ENROLLMENT:
    'El coordinador publica su identidad y sus permisos; esta terminal no los edita. '
    + 'Todavía no puede iniciar sesión aquí: autoriza un enrolamiento para que escriba '
    + 'su PIN en esta terminal.'
};

const sameCodes = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && [...left].sort().join('|') === [...right].sort().join('|');

/** Alterna una casilla sin mutar el arreglo de origen. */
export const toggleCode = (codes: readonly string[], code: string): readonly string[] =>
  codes.includes(code) ? codes.filter((value) => value !== code) : [...codes, code];

const EMPTY_DIRECTORY: IdentityDirectoryResponse = {
  operators: [], roles: [], permissionCodes: [], ownedByThisNode: true
};

const emptyOperatorForm = { operatorCode: '', displayName: '', reason: '' };
const emptyRoleForm = { code: '', name: '', reason: '' };

export const IdentityScreen = ({ api, permissionCodes }: ScreenProps): React.JSX.Element => {
  const [directory, setDirectory] = useState<IdentityDirectoryResponse>(EMPTY_DIRECTORY);
  const [selectedOperator, setSelectedOperator] = useState<IdentityOperatorResponse | null>(null);
  const [selectedRole, setSelectedRole] = useState<IdentityRoleResponse | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [operatorReason, setOperatorReason] = useState('');
  const [roleIds, setRoleIds] = useState<readonly string[]>([]);
  const [rolePermissions, setRolePermissions] = useState<readonly string[]>([]);
  const [roleReason, setRoleReason] = useState('');
  const [newOperator, setNewOperator] = useState(emptyOperatorForm);
  const [newOperatorRoles, setNewOperatorRoles] = useState<readonly string[]>([]);
  const [newRole, setNewRole] = useState(emptyRoleForm);
  const [enrollment, setEnrollment] = useState({ operatorCode: '', reason: '' });
  const [ticket, setTicket] = useState<CredentialEnrollmentResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * El servidor sigue decidiendo: esto solo evita ofrecer un formulario cuyo
   * comando ya sabemos rechazado. Ninguna de estas comprobaciones sustituye la
   * autorización que el caso de uso vuelve a exigir.
   */
  const canReadDirectory = isPermissionGranted(
    getIdentityDirectoryContract.permission, permissionCodes
  );
  const canManageUsers = isPermissionGranted(createOperatorContract.permission, permissionCodes);
  const canManageRoles = isPermissionGranted(createRoleContract.permission, permissionCodes);
  const canEnroll = isPermissionGranted(
    authorizeCredentialEnrollmentContract.permission, permissionCodes
  );
  /** La administración vive donde está la autoridad de identidad (ADR-0027 D5). */
  const administers = directory.ownedByThisNode;

  const load = useCallback(async (): Promise<void> => {
    if (!canReadDirectory) return;
    setLoading(true);
    try { setDirectory(await api.getIdentityDirectory()); }
    catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  }, [api, canReadDirectory]);

  useEffect(() => { void load(); }, [load]);

  const dismissFeedback = (): void => { setError(null); setNotice(null); };

  const selectOperator = (operator: IdentityOperatorResponse): void => {
    setSelectedOperator(operator);
    setDisplayName(operator.displayName);
    setRoleIds(operator.roleIds);
    setOperatorReason('');
  };

  const selectRole = (role: IdentityRoleResponse): void => {
    setSelectedRole(role);
    setRolePermissions(role.permissionCodes);
    setRoleReason('');
  };

  const run = async (command: () => Promise<void>, message: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await command();
      setNotice(message);
      await load();
    } catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  };

  const createOperator = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await run(async () => {
      const created = await api.createOperator({
        operatorCode: newOperator.operatorCode.trim().toUpperCase(),
        displayName: newOperator.displayName.trim(),
        roleIds: newOperatorRoles,
        reason: newOperator.reason.trim()
      });
      setNewOperator(emptyOperatorForm);
      setNewOperatorRoles([]);
      selectOperator(created);
    }, 'Operador creado. Todavía no puede ingresar: autoriza su enrolamiento.');
  };

  const renameOperator = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const operator = selectedOperator;
    if (!operator) return;
    await run(async () => {
      selectOperator(await api.updateOperator(operator.userId, {
        displayName: displayName.trim(), reason: operatorReason.trim()
      }));
    }, 'Nombre del operador actualizado.');
  };

  const saveRoles = async (): Promise<void> => {
    const operator = selectedOperator;
    if (!operator) return;
    await run(async () => {
      selectOperator(await api.assignOperatorRoles(operator.userId, {
        roleIds, reason: operatorReason.trim()
      }));
    }, 'Roles del operador actualizados. Sus sesiones abiertas se cierran.');
  };

  const changeOperatorStatus = async (): Promise<void> => {
    const operator = selectedOperator;
    if (!operator) return;
    await run(async () => {
      selectOperator(await api.changeOperatorStatus(operator.userId, {
        isActive: !operator.isActive, reason: operatorReason.trim()
      }));
    }, 'Estado del operador actualizado.');
  };

  const expireCredential = async (): Promise<void> => {
    const operator = selectedOperator;
    if (!operator) return;
    await run(
      () => api.expireOperatorCredential(operator.userId, { reason: operatorReason.trim() }),
      'Credencial caducada: en su próximo ingreso solo podrá cambiar el PIN.'
    );
  };

  const createRole = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await run(async () => {
      selectRole(await api.createRole({
        code: newRole.code.trim().toUpperCase(),
        name: newRole.name.trim(),
        permissionCodes: [],
        reason: newRole.reason.trim()
      }));
      setNewRole(emptyRoleForm);
    }, 'Rol creado sin permisos: asígnalos antes de usarlo.');
  };

  const saveRolePermissions = async (): Promise<void> => {
    const role = selectedRole;
    if (!role) return;
    await run(async () => {
      selectRole(await api.updateRolePermissions(role.roleId, {
        permissionCodes: rolePermissions, reason: roleReason.trim()
      }));
    }, 'Permisos del rol actualizados. Las sesiones que lo usan se cierran.');
  };

  const changeRoleStatus = async (): Promise<void> => {
    const role = selectedRole;
    if (!role) return;
    await run(async () => {
      selectRole(await api.changeRoleStatus(role.roleId, {
        isActive: !role.isActive, reason: roleReason.trim()
      }));
    }, 'Estado del rol actualizado.');
  };

  const authorizeEnrollment = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setTicket(null);
    try {
      const issued = await api.authorizeCredentialEnrollment({
        operatorCode: enrollment.operatorCode.trim().toUpperCase(),
        reason: enrollment.reason.trim()
      });
      setTicket(issued);
      setEnrollment({ operatorCode: '', reason: '' });
      setNotice(null);
      await load();
    } catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  };

  return (
    <div className="operation-screen">
      <ScreenNote>
        Administra quién opera este nodo y con qué permisos. Cada cambio exige un motivo y queda
        auditado; el PIN nunca se muestra ni se transporta: el operador lo escribe en la terminal
        donde va a trabajar.
      </ScreenNote>
      <Feedback error={error} notice={notice} onDismiss={dismissFeedback} />

      {!administers && (
        <section className="panel" role="note" aria-labelledby="identity-ownership-title">
          <h2 id="identity-ownership-title">La administración pertenece al coordinador</h2>
          <p className="muted">
            Esta terminal recibe operadores, roles y permisos del coordinador de la tienda y no
            puede crearlos ni modificarlos. Lo que sí resuelve aquí es el acceso local: autoriza el
            enrolamiento de una credencial para que un operador ya conocido pueda ingresar en esta
            estación.
          </p>
        </section>
      )}

      {canEnroll && (
        <section className="panel" aria-labelledby="identity-enrollment-title">
          <h2 id="identity-enrollment-title">Enrolamiento de credencial</h2>
          <p className="muted">
            Autoriza que un operador escriba su PIN en esta terminal. Entrégale el código de un
            solo uso; nadie más —ni tú— conoce el PIN que elija.
          </p>
          <form className="stack-form" onSubmit={authorizeEnrollment}>
            <div className="form-grid">
              <label>Código de operador
                <input
                  name="enrollmentOperatorCode"
                  value={enrollment.operatorCode}
                  required
                  onChange={(event) => setEnrollment({
                    ...enrollment, operatorCode: event.target.value.toUpperCase()
                  })}
                />
              </label>
              <ReasonField
                name="enrollmentReason"
                value={enrollment.reason}
                onChange={(reason) => setEnrollment({ ...enrollment, reason })}
                suggestions={['Alta de personal nuevo', 'Cambio de terminal asignada', 'Credencial olvidada', 'Reposición tras bloqueo']}
              />
            </div>
            <ActionButton className="primary-button" type="submit" busy={loading} disabled={loading}>
              {loading ? 'Autorizando…' : 'Autorizar enrolamiento'}
            </ActionButton>
          </form>
          {ticket && (
            <div className="feedback form-success" role="status">
              <div>
                <p>
                  Código de enrolamiento para <strong>{ticket.operatorCode}</strong> ·
                  {' '}{ticket.displayName}
                </p>
                <p><code data-testid="enrollment-token">{ticket.enrollmentToken}</code></p>
                <p className="muted">
                  Se muestra una sola vez y vence el {new Date(ticket.expiresAt).toLocaleString('es-VE')}.
                  {ticket.replacesCredential
                    ? ' Reemplazará la credencial local que ya existe.'
                    : ' Es el primer acceso local de este operador.'}
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      {!canReadDirectory ? (
        <EmptyState>
          Tu perfil autoriza el enrolamiento de credenciales, no la lectura del directorio de
          identidad.
        </EmptyState>
      ) : (
        <>
          <section className="panel" aria-labelledby="identity-operators-title">
            <div className="screen-toolbar">
              <h2 id="identity-operators-title">Operadores</h2>
              <ActionButton type="button" onClick={() => void load()} busy={loading} disabled={loading}>
                {loading ? 'Consultando…' : 'Actualizar'}
              </ActionButton>
            </div>
            {directory.operators.length === 0 ? (
              <EmptyState>Este nodo todavía no conoce operadores.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Código</th><th>Nombre</th><th>Roles</th><th>Acceso local</th>
                      <th>Estado</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {directory.operators.map((operator) => (
                      <tr key={operator.userId}>
                        <td>{operator.operatorCode}</td>
                        <td>{operator.displayName}</td>
                        <td>{operator.roleCodes.join(', ') || 'Sin roles'}</td>
                        <td title={LOCAL_ACCESS_HINTS[localAccessOf(operator)]}>
                          {LOCAL_ACCESS_LABELS[localAccessOf(operator)]}
                        </td>
                        <td>{operator.isActive ? 'Activo' : 'Inactivo'}</td>
                        <td>
                          <button type="button" onClick={() => selectOperator(operator)}>
                            Ver
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {selectedOperator && (
            <section className="panel" aria-labelledby="identity-operator-detail-title">
              <h2 id="identity-operator-detail-title">
                {selectedOperator.operatorCode} · {selectedOperator.displayName}
              </h2>
              <p className="muted">
                {LOCAL_ACCESS_HINTS[localAccessOf(selectedOperator)]}
              </p>
              {administers && canManageUsers && selectedOperator.hasLocalIdentity && (
                <form className="stack-form" onSubmit={renameOperator}>
                  <div className="form-grid">
                    <label>Nombre visible
                      <input
                        name="displayName"
                        value={displayName}
                        required
                        onChange={(event) => setDisplayName(event.target.value)}
                      />
                    </label>
                    {/* El mismo motivo cubre renombrar, asignar roles, activar y expirar. */}
                    <ReasonField
                      name="operatorReason"
                      value={operatorReason}
                      onChange={setOperatorReason}
                      suggestions={['Ingreso de personal', 'Egreso de personal', 'Cambio de funciones', 'Corrección de datos', 'Medida de seguridad']}
                    />
                  </div>
                  <fieldset>
                    <legend>Roles</legend>
                    {directory.roles.map((role) => (
                      <label key={role.roleId} className="checkbox-row">
                        <input
                          type="checkbox"
                          name={`role-${role.code}`}
                          checked={roleIds.includes(role.roleId)}
                          disabled={!role.isAssignable || !role.isActive}
                          onChange={() => setRoleIds(toggleCode(roleIds, role.roleId))}
                        />
                        <span>{role.code} · {role.name}</span>
                      </label>
                    ))}
                  </fieldset>
                  <div className="button-row">
                    <ActionButton className="primary-button" type="submit" busy={loading} disabled={loading}>
                      Guardar nombre
                    </ActionButton>
                    <ActionButton
                      type="button"
                      busy={loading}
                      disabled={loading || sameCodes(roleIds, selectedOperator.roleIds)}
                      onClick={() => void saveRoles()}
                    >
                      Guardar roles
                    </ActionButton>
                    <ActionButton type="button" busy={loading} disabled={loading}
                      onClick={() => void changeOperatorStatus()}>
                      {selectedOperator.isActive ? 'Desactivar operador' : 'Reactivar operador'}
                    </ActionButton>
                    {selectedOperator.hasLocalCredential && (
                      <ActionButton type="button" busy={loading} disabled={loading}
                        onClick={() => void expireCredential()}>
                        Caducar credencial
                      </ActionButton>
                    )}
                  </div>
                </form>
              )}
            </section>
          )}

          {administers && canManageUsers && (
            <section className="panel" aria-labelledby="identity-new-operator-title">
              <h2 id="identity-new-operator-title">Nuevo operador</h2>
              <p className="muted">
                El alta crea la identidad, no el acceso: el operador solo podrá ingresar cuando
                enrole su credencial en la terminal donde vaya a trabajar.
              </p>
              <form className="stack-form" onSubmit={createOperator}>
                <div className="form-grid">
                  <label>Código
                    <input
                      name="newOperatorCode"
                      value={newOperator.operatorCode}
                      required
                      onChange={(event) => setNewOperator({
                        ...newOperator, operatorCode: event.target.value.toUpperCase()
                      })}
                    />
                  </label>
                  <label>Nombre visible
                    <input
                      name="newOperatorName"
                      value={newOperator.displayName}
                      required
                      onChange={(event) => setNewOperator({
                        ...newOperator, displayName: event.target.value
                      })}
                    />
                  </label>
                  <ReasonField
                    name="newOperatorReason"
                    value={newOperator.reason}
                    onChange={(reason) => setNewOperator({ ...newOperator, reason })}
                    suggestions={['Ingreso de personal nuevo', 'Cobertura de vacante', 'Personal temporal de temporada']}
                  />
                </div>
                <fieldset>
                  <legend>Roles iniciales</legend>
                  {directory.roles.map((role) => (
                    <label key={role.roleId} className="checkbox-row">
                      <input
                        type="checkbox"
                        name={`new-role-${role.code}`}
                        checked={newOperatorRoles.includes(role.roleId)}
                        disabled={!role.isAssignable || !role.isActive}
                        onChange={() => setNewOperatorRoles(toggleCode(newOperatorRoles, role.roleId))}
                      />
                      <span>{role.code} · {role.name}</span>
                    </label>
                  ))}
                </fieldset>
                <ActionButton className="primary-button" type="submit" busy={loading} disabled={loading}>
                  {loading ? 'Creando…' : 'Crear operador'}
                </ActionButton>
              </form>
            </section>
          )}

          <section className="panel" aria-labelledby="identity-roles-title">
            <h2 id="identity-roles-title">Roles</h2>
            {directory.roles.length === 0 ? (
              <EmptyState>No hay roles definidos en este nodo.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Código</th><th>Nombre</th><th>Permisos</th><th>Operadores</th>
                      <th>Estado</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {directory.roles.map((role) => (
                      <tr key={role.roleId}>
                        <td>{role.code}</td>
                        <td>{role.name}</td>
                        <td>{role.permissionCodes.length}</td>
                        <td>{role.memberCount}</td>
                        <td>{role.isActive ? 'Activo' : 'Inactivo'}</td>
                        <td>
                          <button type="button" onClick={() => selectRole(role)}>Ver</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {selectedRole && administers && canManageRoles && (
            <section className="panel" aria-labelledby="identity-role-detail-title">
              <h2 id="identity-role-detail-title">
                {selectedRole.code} · {selectedRole.name}
              </h2>
              {/* El mismo motivo cubre cambiar permisos y activar o desactivar el rol. */}
              <ReasonField
                name="roleReason"
                value={roleReason}
                onChange={setRoleReason}
                required={false}
                suggestions={['Ajuste de funciones del cargo', 'Corrección de permisos', 'Rol en desuso', 'Reorganización de responsabilidades']}
              />
              <fieldset>
                <legend>Permisos</legend>
                {directory.permissionCodes.map((code) => (
                  <label key={code} className="checkbox-row">
                    <input
                      type="checkbox"
                      name={`permission-${code}`}
                      checked={rolePermissions.includes(code)}
                      onChange={() => setRolePermissions(toggleCode(rolePermissions, code))}
                    />
                    <span>{code}</span>
                  </label>
                ))}
              </fieldset>
              <div className="button-row">
                <ActionButton
                  className="primary-button"
                  type="button"
                  busy={loading}
                  disabled={loading || sameCodes(rolePermissions, selectedRole.permissionCodes)}
                  onClick={() => void saveRolePermissions()}
                >
                  Guardar permisos
                </ActionButton>
                <ActionButton type="button" busy={loading} disabled={loading}
                  onClick={() => void changeRoleStatus()}>
                  {selectedRole.isActive ? 'Desactivar rol' : 'Reactivar rol'}
                </ActionButton>
              </div>
            </section>
          )}

          {administers && canManageRoles && (
            <section className="panel" aria-labelledby="identity-new-role-title">
              <h2 id="identity-new-role-title">Nuevo rol</h2>
              <form className="stack-form" onSubmit={createRole}>
                <div className="form-grid">
                  <label>Código
                    <input
                      name="newRoleCode"
                      value={newRole.code}
                      required
                      onChange={(event) => setNewRole({
                        ...newRole, code: event.target.value.toUpperCase()
                      })}
                    />
                  </label>
                  <label>Nombre
                    <input
                      name="newRoleName"
                      value={newRole.name}
                      required
                      onChange={(event) => setNewRole({ ...newRole, name: event.target.value })}
                    />
                  </label>
                  <ReasonField
                    name="newRoleReason"
                    value={newRole.reason}
                    onChange={(reason) => setNewRole({ ...newRole, reason })}
                    suggestions={['Nuevo cargo en la tienda', 'Separación de funciones', 'Perfil temporal para auditoría']}
                  />
                </div>
                <ActionButton className="primary-button" type="submit" busy={loading} disabled={loading}>
                  {loading ? 'Creando…' : 'Crear rol'}
                </ActionButton>
              </form>
            </section>
          )}
        </>
      )}
    </div>
  );
};
