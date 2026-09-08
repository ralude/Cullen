import { describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '@supermarket/shared';
import { App } from './App.js';
import { ApiProblemError, type DesktopApi } from './api-client.js';
import { click, mount, settle, submit, type } from './testing/dom.js';

/**
 * Interacción del shell: iniciar sesión, alcanzar la pantalla de
 * sincronización y salir. Cierra el recorrido que las pruebas de render
 * estático no podían cubrir, porque depende de efectos, del `hash` de la
 * ventana y de los manejadores del formulario (CA-04-11).
 */

const session = (permissionCodes: readonly string[]): SessionResponse => ({
  userId: 'user-001',
  operatorCode: 'CAJA01',
  displayName: 'Cajera 1',
  roleCodes: ['SUPERVISOR'],
  permissionCodes: [...permissionCodes],
  expiresAt: '2026-09-07T20:00:00.000Z'
} as unknown as SessionResponse);

const REVIEWER = ['sync.reception.review', 'sync.node.manage'];

const desktopApi = (overrides: Partial<DesktopApi> = {}): DesktopApi => ({
  currentSession: vi.fn(async () => {
    throw new ApiProblemError({
      type: 'urn:supermarket:problem:unauthorized',
      title: 'Session is invalid.',
      status: 401,
      code: 'UNAUTHORIZED',
      correlationId: 'correlation-startup'
    });
  }),
  login: vi.fn(async () => session(REVIEWER)),
  logout: vi.fn(async () => undefined),
  capabilities: vi.fn(async () => ({ fiscalMode: 'SIMULATION', simulatedReportsEnabled: false })),
  listSyncNodes: vi.fn(async () => []),
  getSyncStatus: vi.fn(async () => { throw new Error('no consultado en esta prueba'); }),
  getOperationalDiagnostics: vi.fn(async () => { throw new Error('no consultado en esta prueba'); }),
  listCoordinatedOperations: vi.fn(async () => []),
  ...overrides
} as unknown as DesktopApi);

const signIn = async (screen: Awaited<ReturnType<typeof mount>>): Promise<void> => {
  await type(screen.get<HTMLInputElement>('input[name="operatorCode"]'), 'CAJA01');
  await type(screen.get<HTMLInputElement>('input[type="password"]'), '1234');
  await submit(screen.get<HTMLFormElement>('form'));
};

const goTo = async (hash: string): Promise<void> => {
  window.location.hash = hash;
  await settle();
};

describe('interacción del shell del renderer', () => {
  it('arranca sin sesión, autentica con el formulario y muestra la navegación', async () => {
    const api = desktopApi();
    const screen = await mount(<App api={api} />);

    expect(screen.text()).toContain('Ingresar a');

    await signIn(screen);

    expect(api.login).toHaveBeenCalledWith({ operatorCode: 'CAJA01', pin: '1234' });
    expect(screen.get('nav[aria-label="Navegación principal"]')).toBeTruthy();
    /** El PIN no queda en el formulario después de autenticar. */
    expect(screen.query<HTMLInputElement>('input[type="password"]')).toBeNull();
    await goTo('#/');
  });

  it('lleva a la pantalla de sincronización desde la navegación y carga sus nodos', async () => {
    const api = desktopApi();
    const screen = await mount(<App api={api} />);
    await signIn(screen);

    const link = screen.findByText<HTMLAnchorElement>('nav a', 'Sync');
    expect(link?.getAttribute('href')).toBe('#/sync');

    await goTo('#/sync');

    expect(screen.get('nav a[aria-current="page"]').textContent).toContain('Sync');
    expect(screen.text()).toContain('Consultar este estado no confirma ninguna entrega');
    /** La pantalla montada sí ejecuta su efecto de carga de nodos. */
    expect(api.listSyncNodes).toHaveBeenCalledTimes(1);
    await goTo('#/');
  });

  it('no ofrece la pantalla de sincronización a una sesión sin permiso', async () => {
    const api = desktopApi({ login: vi.fn(async () => session(['sale.complete'])) });
    const screen = await mount(<App api={api} />);
    await signIn(screen);

    expect(screen.findByText('nav a', 'Sync')).toBeNull();

    /** Forzar el hash tampoco la abre: la ruta no es alcanzable para esta sesión. */
    await goTo('#/sync');
    expect(screen.text()).not.toContain('Consultar este estado no confirma ninguna entrega');
    await goTo('#/');
  });

  it('explica un PIN incorrecto sin dejar la sesión a medias', async () => {
    const api = desktopApi({
      login: vi.fn(async () => {
        throw new ApiProblemError({
          type: 'urn:supermarket:problem:authentication-failed',
          title: 'Authentication failed.',
          status: 401,
          code: 'AUTHENTICATION_FAILED',
          correlationId: 'correlation-login'
        });
      })
    });
    const screen = await mount(<App api={api} />);

    await signIn(screen);

    expect(screen.text()).toContain('Código de operador o PIN incorrecto.');
    expect(screen.query('nav[aria-label="Navegación principal"]')).toBeNull();
    expect(screen.get<HTMLInputElement>('input[type="password"]').value).toBe('');
  });

  it('cierra la sesión y vuelve al formulario de ingreso', async () => {
    const api = desktopApi();
    const screen = await mount(<App api={api} />);
    await signIn(screen);

    await click(screen.button('Salir'));

    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(screen.text()).toContain('Ingresar a');
    expect(screen.query('nav[aria-label="Navegación principal"]')).toBeNull();
  });
});
