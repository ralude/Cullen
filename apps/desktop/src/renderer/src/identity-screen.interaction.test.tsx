import { describe, expect, it, vi } from 'vitest';
import type {
  IdentityDirectoryResponse,
  IdentityOperatorResponse,
  IdentityRoleResponse,
  SessionResponse
} from '@supermarket/shared';
import { App } from './App.js';
import { ApiProblemError, type DesktopApi, type OperationApi } from './api-client.js';
import { IdentityScreen } from './operation-screens.js';
import { click, mount, settle, submit, type } from './testing/dom.js';

/**
 * Interacción de la administración de identidad (fase 11.02).
 *
 * Lo que se comprueba aquí no es negocio —eso vive en el nodo y ya tiene sus
 * pruebas— sino que la interfaz diga la verdad: que no ofrezca una capacidad
 * que este nodo no tiene, que no presente como «listo para ingresar» a quien
 * todavía no tiene credencial local, que no decida por su cuenta el invariante
 * del último administrador y que ningún PIN aparezca en la pantalla.
 */

const role = (overrides: Partial<IdentityRoleResponse> = {}): IdentityRoleResponse => ({
  roleId: 'role-admin', code: 'ADMIN', name: 'Administrador', isActive: true,
  isAssignable: true, permissionCodes: ['identity.user.manage'], memberCount: 1, ...overrides
});

const operator = (overrides: Partial<IdentityOperatorResponse> = {}): IdentityOperatorResponse => ({
  userId: 'user-001', operatorCode: 'OP001', displayName: 'Administrador', isActive: true,
  roleIds: ['role-admin'], roleCodes: ['ADMIN'], hasLocalCredential: true,
  credentialMustChange: false, ...overrides
});

const directory = (
  overrides: Partial<IdentityDirectoryResponse> = {}
): IdentityDirectoryResponse => ({
  operators: [operator()],
  roles: [role()],
  permissionCodes: ['identity.user.manage', 'identity.role.manage', 'sale.complete'],
  ownedByThisNode: true,
  ...overrides
});

const MANAGE_ALL = ['identity.user.manage', 'identity.role.manage', 'identity.credential.reset'];

const screenApi = (overrides: Partial<OperationApi> = {}): OperationApi => ({
  getIdentityDirectory: vi.fn(async () => directory()),
  createOperator: vi.fn(async () => operator({
    userId: 'user-002', operatorCode: 'OP100', displayName: 'Cajera Nueva',
    roleIds: [], roleCodes: [], hasLocalCredential: false
  })),
  updateOperator: vi.fn(async () => operator()),
  changeOperatorStatus: vi.fn(async () => operator()),
  assignOperatorRoles: vi.fn(async () => operator()),
  expireOperatorCredential: vi.fn(async () => undefined),
  createRole: vi.fn(async () => role()),
  updateRolePermissions: vi.fn(async () => role()),
  changeRoleStatus: vi.fn(async () => role()),
  authorizeCredentialEnrollment: vi.fn(async () => ({
    enrollmentId: 'enrollment-1', operatorCode: 'OP100', displayName: 'Cajera Nueva',
    enrollmentToken: 'token-de-un-solo-uso', expiresAt: '2026-09-08T12:15:00.000Z',
    replacesCredential: false
  })),
  ...overrides
} as unknown as OperationApi);

const props = (api: OperationApi, permissionCodes: readonly string[] = MANAGE_ALL) => ({
  api,
  capabilities: { fiscalMode: 'SIMULATION' as const, simulatedReportsEnabled: false },
  permissionCodes
});

const problem = (code: string, status: number): ApiProblemError => new ApiProblemError({
  type: `urn:supermarket:problem:${code.toLowerCase()}`, title: 'No aplicado.',
  status, code, correlationId: 'correlation-identity'
});

describe('interacción de la administración de identidad', () => {
  it('muestra que un operador sincronizado todavía necesita enrolamiento', async () => {
    const api = screenApi({
      getIdentityDirectory: vi.fn(async () => directory({
        operators: [
          operator(),
          operator({
            userId: 'user-002', operatorCode: 'OP200', displayName: 'Cajera Sincronizada',
            roleIds: [], roleCodes: ['CASHIER'], hasLocalCredential: false
          })
        ]
      }))
    });
    const screen = await mount(<IdentityScreen {...props(api)} />);

    const row = screen.findByText('tbody tr', 'OP200');
    expect(row?.textContent).toContain('Sin credencial local · requiere enrolamiento');
    expect(row?.textContent).not.toContain('Credencial activa');
    screen.unmount();
  });

  it('crea un operador y avisa que todavía no puede ingresar', async () => {
    const api = screenApi();
    const screen = await mount(<IdentityScreen {...props(api)} />);

    await type(screen.get<HTMLInputElement>('input[name="newOperatorCode"]'), 'op100');
    await type(screen.get<HTMLInputElement>('input[name="newOperatorName"]'), 'Cajera Nueva');
    await type(screen.get<HTMLInputElement>('input[name="newOperatorReason"]'), 'Alta de cajera');
    await submit(screen.get<HTMLFormElement>('#identity-new-operator-title ~ form'));

    expect(api.createOperator).toHaveBeenCalledWith({
      operatorCode: 'OP100', displayName: 'Cajera Nueva', roleIds: [], reason: 'Alta de cajera'
    });
    expect(screen.text()).toContain('Todavía no puede ingresar');
    screen.unmount();
  });

  it('entrega el código de enrolamiento una sola vez y nunca un PIN', async () => {
    const api = screenApi();
    const screen = await mount(<IdentityScreen {...props(api)} />);

    await type(screen.get<HTMLInputElement>('input[name="enrollmentOperatorCode"]'), 'op100');
    await type(screen.get<HTMLInputElement>('input[name="enrollmentReason"]'), 'Primer ingreso');
    await submit(screen.get<HTMLFormElement>('#identity-enrollment-title ~ form'));

    expect(api.authorizeCredentialEnrollment).toHaveBeenCalledWith({
      operatorCode: 'OP100', reason: 'Primer ingreso'
    });
    expect(screen.get('[data-testid="enrollment-token"]').textContent)
      .toBe('token-de-un-solo-uso');
    expect(screen.text()).toContain('Se muestra una sola vez');
    /** La pantalla no pide, no muestra y no puede conocer el PIN elegido. */
    expect(screen.query('input[type="password"]')).toBeNull();
    screen.unmount();
  });

  it('declara que la administración pertenece al coordinador y conserva el enrolamiento', async () => {
    const api = screenApi({
      getIdentityDirectory: vi.fn(async () => directory({ ownedByThisNode: false }))
    });
    const screen = await mount(<IdentityScreen {...props(api)} />);

    expect(screen.text()).toContain('La administración pertenece al coordinador');
    expect(screen.query('input[name="newOperatorCode"]')).toBeNull();
    expect(screen.query('input[name="newRoleCode"]')).toBeNull();
    /** La credencial es local: esta terminal sí puede enrolarla. */
    expect(screen.query('input[name="enrollmentOperatorCode"]')).not.toBeNull();
    screen.unmount();
  });

  it('deja que el nodo rechace el último administrador en vez de decidirlo la interfaz', async () => {
    const api = screenApi({
      changeOperatorStatus: vi.fn(async () => { throw problem('IDENTITY_LAST_ADMINISTRATOR', 409); })
    });
    const screen = await mount(<IdentityScreen {...props(api)} />);

    await click(screen.get('tbody tr button'));
    await type(screen.get<HTMLInputElement>('input[name="operatorReason"]'), 'Baja del titular');
    const deactivate = screen.button('Desactivar operador');
    /** La acción se ofrece: quien conoce el invariante es el servidor. */
    expect(deactivate.disabled).toBe(false);

    await click(deactivate);

    expect(api.changeOperatorStatus).toHaveBeenCalledTimes(1);
    expect(screen.text()).toContain('dejaría al sistema sin ningún administrador activo');
    screen.unmount();
  });

  it('ofrece solo el enrolamiento a quien no puede leer el directorio', async () => {
    const api = screenApi();
    const screen = await mount(
      <IdentityScreen {...props(api, ['identity.credential.reset'])} />
    );

    await settle();

    expect(api.getIdentityDirectory).not.toHaveBeenCalled();
    expect(screen.text()).toContain('no la lectura del directorio de identidad');
    expect(screen.query('input[name="enrollmentOperatorCode"]')).not.toBeNull();
    screen.unmount();
  });
});

const session = (overrides: Partial<SessionResponse> = {}): SessionResponse => ({
  actorId: 'user-001', displayName: 'Cajera 1', roleCodes: ['CASHIER'],
  permissionCodes: [...MANAGE_ALL],
  idleExpiresAt: '2026-09-08T18:00:00.000Z',
  absoluteExpiresAt: '2026-09-09T00:00:00.000Z',
  credentialMustChange: false,
  ...overrides
});

const shellApi = (overrides: Partial<DesktopApi> = {}): DesktopApi => ({
  currentSession: vi.fn(async () => { throw problem('UNAUTHORIZED', 401); }),
  login: vi.fn(async () => session()),
  logout: vi.fn(async () => undefined),
  capabilities: vi.fn(async () => ({ fiscalMode: 'SIMULATION', simulatedReportsEnabled: false })),
  changeOwnPin: vi.fn(async () => undefined),
  completeCredentialEnrollment: vi.fn(async () => ({ operatorCode: 'OP100' })),
  ...screenApi(),
  ...overrides
} as unknown as DesktopApi);

const signIn = async (screen: Awaited<ReturnType<typeof mount>>): Promise<void> => {
  await type(screen.get<HTMLInputElement>('input[name="operatorCode"]'), 'OP001');
  await type(screen.get<HTMLInputElement>('input[name="pin"]'), '123456');
  await submit(screen.get<HTMLFormElement>('form'));
};

describe('interacción del shell con la credencial local', () => {
  it('ofrece la pantalla de identidad solo a quien administra o enrola', async () => {
    const withPermission = await mount(<App api={shellApi()} />);
    await signIn(withPermission);
    expect(withPermission.findByText<HTMLAnchorElement>('nav a', 'Identidad')?.getAttribute('href'))
      .toBe('#/identity');
    withPermission.unmount();

    const withoutPermission = await mount(<App api={shellApi({
      login: vi.fn(async () => session({ permissionCodes: ['sale.complete'] }))
    })} />);
    await signIn(withoutPermission);
    expect(withoutPermission.findByText('nav a', 'Identidad')).toBeNull();
    withoutPermission.unmount();
  });

  it('restringe la sesión con credencial caducada al cambio de PIN', async () => {
    /** El nodo levanta la restricción; la relectura de la sesión lo confirma. */
    let reads = 0;
    const api = shellApi({
      login: vi.fn(async () => session({ credentialMustChange: true })),
      currentSession: vi.fn(async () => {
        reads += 1;
        if (reads === 1) throw problem('UNAUTHORIZED', 401);
        return session();
      })
    });
    const screen = await mount(<App api={api} />);
    await signIn(screen);

    expect(screen.text()).toContain('Cambia tu PIN para continuar');
    /** Ni navegación ni pantallas: el nodo rechaza todo lo demás. */
    expect(screen.query('nav[aria-label="Navegación principal"]')).toBeNull();

    await type(screen.get<HTMLInputElement>('input[name="currentPin"]'), '654321');
    await type(screen.get<HTMLInputElement>('input[name="newPin"]'), '246810');
    await type(screen.get<HTMLInputElement>('input[name="repeatedPin"]'), '246810');
    await submit(screen.get<HTMLFormElement>('form'));

    expect(api.changeOwnPin).toHaveBeenCalledWith({ currentPin: '654321', newPin: '246810' });
    /** La sesión se relee del nodo: la interfaz no se declara desbloqueada sola. */
    expect(api.currentSession).toHaveBeenCalledTimes(2);
    expect(screen.get('nav[aria-label="Navegación principal"]')).toBeTruthy();
    screen.unmount();
  });

  it('no envía el cambio cuando la confirmación del PIN no coincide', async () => {
    const api = shellApi({ login: vi.fn(async () => session({ credentialMustChange: true })) });
    const screen = await mount(<App api={api} />);
    await signIn(screen);

    await type(screen.get<HTMLInputElement>('input[name="currentPin"]'), '654321');
    await type(screen.get<HTMLInputElement>('input[name="newPin"]'), '246810');
    await type(screen.get<HTMLInputElement>('input[name="repeatedPin"]'), '111111');
    await submit(screen.get<HTMLFormElement>('form'));

    expect(api.changeOwnPin).not.toHaveBeenCalled();
    expect(screen.text()).toContain('no coinciden');
    screen.unmount();
  });

  it('canjea un código de enrolamiento desde la página de ingreso', async () => {
    const api = shellApi();
    const screen = await mount(<App api={api} />);

    await click(screen.button('Tengo un código de enrolamiento'));
    await type(screen.get<HTMLInputElement>('input[name="enrollmentToken"]'), 'token-de-un-solo-uso');
    await type(screen.get<HTMLInputElement>('input[name="enrollmentPin"]'), '654321');
    await type(screen.get<HTMLInputElement>('input[name="repeatedEnrollmentPin"]'), '654321');
    await submit(screen.all<HTMLFormElement>('form')[1]!);

    expect(api.completeCredentialEnrollment).toHaveBeenCalledWith({
      enrollmentToken: 'token-de-un-solo-uso', pin: '654321'
    });
    expect(screen.text()).toContain('Credencial activada para OP100');
    screen.unmount();
  });

  it('explica un código vencido sin dejar al operador dentro', async () => {
    const api = shellApi({
      completeCredentialEnrollment: vi.fn(async () => {
        throw problem('IDENTITY_ENROLLMENT_EXPIRED', 409);
      })
    });
    const screen = await mount(<App api={api} />);

    await click(screen.button('Tengo un código de enrolamiento'));
    await type(screen.get<HTMLInputElement>('input[name="enrollmentToken"]'), 'vencido');
    await type(screen.get<HTMLInputElement>('input[name="enrollmentPin"]'), '654321');
    await type(screen.get<HTMLInputElement>('input[name="repeatedEnrollmentPin"]'), '654321');
    await submit(screen.all<HTMLFormElement>('form')[1]!);

    expect(screen.text()).toContain('venció: pide uno nuevo');
    expect(screen.text()).toContain('Ingresar a');
    screen.unmount();
  });
});
