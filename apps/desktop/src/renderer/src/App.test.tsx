import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiProblemError, type DesktopApi } from './api-client.js';
import {
  AppView, PRODUCT_NAME, isRouteReachable, loadInitialState, resolveRoute, shortcutHash,
  visibleNavigationGroups,
  type AppViewState, type NodeConnection
} from './App.js';

const render = (state: AppViewState, route = '#/', connection: NodeConnection = 'online'): string => renderToStaticMarkup(
  <AppView
    state={state}
    connection={connection}
    route={resolveRoute(route)}
    platform="win32"
    operatorCode=""
    pin=""
    onOperatorCodeChange={() => undefined}
    onPinChange={() => undefined}
    onLogin={() => undefined}
    onLogout={() => undefined}
    onRetry={() => undefined}
  />
);

describe('desktop renderer base states', () => {
  const apiWith = (currentSession: DesktopApi['currentSession']): DesktopApi => ({
    currentSession,
    capabilities: async () => ({ fiscalMode: 'SIMULATION', simulatedReportsEnabled: false }),
    login: async () => { throw new Error('not used'); },
    logout: async () => undefined
  });

  it('derives signed-out and connection-error states during startup', async () => {
    const unauthorized = new ApiProblemError({
      type: 'urn:supermarket:problem:unauthorized', title: 'Session is invalid.',
      status: 401, code: 'UNAUTHORIZED', correlationId: 'correlation-1'
    });

    await expect(loadInitialState(apiWith(async () => { throw unauthorized; })))
      .resolves.toEqual({ state: { kind: 'signed-out', message: null }, connection: 'online' });
    await expect(loadInitialState(apiWith(async () => { throw new TypeError('network'); })))
      .resolves.toEqual({ state: { kind: 'error' }, connection: 'offline' });
  });

  it('distinguishes a server response from a genuine transport failure', async () => {
    const forbidden = new ApiProblemError({
      type: 'urn:supermarket:problem:forbidden', title: 'Forbidden.',
      status: 403, code: 'FORBIDDEN', correlationId: 'correlation-2'
    });

    // El servidor respondió (aunque con un error de negocio): la conexión es real.
    await expect(loadInitialState(apiWith(async () => { throw forbidden; })))
      .resolves.toMatchObject({ connection: 'online' });
    // El fetch nunca llegó a completarse: no hay conexión con el nodo.
    await expect(loadInitialState(apiWith(async () => { throw new Error('ECONNREFUSED'); })))
      .resolves.toMatchObject({ connection: 'offline' });
  });

  it('renders an explicit startup state', () => {
    expect(render({ kind: 'loading' })).toContain('Conectando con el nodo');
  });

  it('renders the native login form without a token field', () => {
    const markup = render({ kind: 'signed-out', message: null });

    expect(markup).toContain(`Ingresar a ${PRODUCT_NAME}`);
    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="current-password"');
    expect(markup).not.toContain('name="token"');
  });

  it('renders a recoverable connection error', () => {
    const markup = render({ kind: 'error' });

    expect(markup).toContain('No pudimos conectar con el nodo');
    expect(markup).toContain('Reintentar');
    expect(markup).toContain('role="alert"');
  });

  it('renders the authenticated shell and resolves hash navigation', () => {
    const state: AppViewState = {
      kind: 'ready',
      session: {
        actorId: 'user-1', displayName: 'Operador Uno', roleCodes: ['cashier'],
        permissionCodes: ['catalog.product.create'],
        idleExpiresAt: '2026-09-02T18:00:00.000Z',
        absoluteExpiresAt: '2026-09-03T00:00:00.000Z'
      },
      capabilities: { fiscalMode: 'SIMULATION', simulatedReportsEnabled: false }
    };
    const markup = render(state, '#/catalog');

    expect(markup).toContain('Operador Uno');
    expect(markup).toContain('SIMULACIÓN');
    expect(markup).toContain('Servidor conectado');
    expect(markup).toContain('Catálogo');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('win32');
    expect(resolveRoute('#/unknown').id).toBe('home');
  });

  it('publishes the product name and drops the sub-phase label from the shell', () => {
    const state: AppViewState = {
      kind: 'ready',
      session: {
        actorId: 'user-1', displayName: 'Operador Uno', roleCodes: ['cashier'],
        permissionCodes: [],
        idleExpiresAt: '2026-09-02T18:00:00.000Z',
        absoluteExpiresAt: '2026-09-03T00:00:00.000Z'
      },
      capabilities: { fiscalMode: 'SIMULATION', simulatedReportsEnabled: false }
    };
    const markup = render(state, '#/sales');

    expect(PRODUCT_NAME).toBe('Cullen');
    expect(markup).toContain(PRODUCT_NAME);
    expect(markup).not.toContain('Subfase');
    expect(markup).not.toMatch(/9.0d/u);
  });

  it('maps the numeric shortcuts to their routes', () => {
    expect(shortcutHash('2')).toBe('#/sales');
    expect(resolveRoute(shortcutHash('2') ?? '#/').id).toBe('sales');
    expect(shortcutHash('a')).toBeNull();
  });

  it('does not turn session-only reads into an operational profile', () => {
    const noPermission: readonly string[] = [];
    expect(isRouteReachable(resolveRoute('#/sales'), noPermission)).toBe(false);
    expect(isRouteReachable(resolveRoute('#/cash'), noPermission)).toBe(false);
    expect(isRouteReachable(resolveRoute('#/catalog'), noPermission)).toBe(false);
    expect(isRouteReachable(resolveRoute('#/inventory'), noPermission)).toBe(false);
    expect(isRouteReachable(resolveRoute('#/rates'), noPermission)).toBe(false);
  });

  it('composes profile workspaces from effective permissions without reading role codes', () => {
    const routeIds = (permissions: readonly string[]) => visibleNavigationGroups(permissions)
      .flatMap((group) => group.routes.map((route) => route.id));

    expect(routeIds(['cash.shift.open', 'cash.shift.close'])).toEqual([
      'home', 'sales', 'cash', 'catalog'
    ]);
    expect(routeIds([
      'inventory.kardex.read', 'inventory.purchase.receive', 'inventory.count.read', 'supplier.read'
    ])).toEqual(['home', 'inventory', 'suppliers', 'counts']);
    expect(routeIds([
      'config.branch.manage', 'config.device.manage', 'currency.rate.update', 'reports.audit.read'
    ])).toEqual(['home', 'config', 'rates', 'reports']);
    expect(routeIds([
      'reports.sales.read', 'reports.inventory.read', 'reports.margin.read', 'reports.audit.read'
    ])).toEqual(['home', 'reports']);
  });

  it('gates the screens whose whole purpose is a command behind their permissions', () => {
    const noPermission: readonly string[] = [];
    expect(isRouteReachable(resolveRoute('#/reports'), noPermission)).toBe(false);
    expect(isRouteReachable(resolveRoute('#/reports'), ['reports.audit.read'])).toBe(true);
    expect(isRouteReachable(resolveRoute('#/reports'), ['reports.sales.read'])).toBe(true);
    expect(isRouteReachable(resolveRoute('#/reports'), ['sale.history.read'])).toBe(true);
    expect(isRouteReachable(resolveRoute('#/suppliers'), noPermission)).toBe(false);
    expect(isRouteReachable(resolveRoute('#/suppliers'), ['supplier.read'])).toBe(true);
    expect(isRouteReachable(resolveRoute('#/suppliers'), ['supplier.update'])).toBe(true);
    expect(isRouteReachable(resolveRoute('#/counts'), noPermission)).toBe(false);
    expect(isRouteReachable(resolveRoute('#/counts'), ['inventory.count.perform'])).toBe(true);
    expect(isRouteReachable(resolveRoute('#/counts'), ['inventory.count.approve'])).toBe(true);
    expect(isRouteReachable(resolveRoute('#/counts'), ['inventory.count.read'])).toBe(true);
    expect(isRouteReachable(resolveRoute('#/config'), noPermission)).toBe(false);
    expect(isRouteReachable(resolveRoute('#/config'), ['config.branch.manage'])).toBe(true);
    expect(isRouteReachable(resolveRoute('#/config'), ['config.device.manage'])).toBe(true);
    expect(isRouteReachable(resolveRoute('#/config'), ['config.payment_method.manage'])).toBe(true);
    expect(isRouteReachable(resolveRoute('#/config'), ['config.tax.manage'])).toBe(true);
  });

  it('hides the Reportes entry and blocks the hash without a report permission, without touching the server', () => {
    const state: AppViewState = {
      kind: 'ready',
      session: {
        actorId: 'user-1', displayName: 'Operador Uno', roleCodes: ['cashier'],
        permissionCodes: [],
        idleExpiresAt: '2026-09-02T18:00:00.000Z',
        absoluteExpiresAt: '2026-09-03T00:00:00.000Z'
      },
      capabilities: { fiscalMode: 'SIMULATION', simulatedReportsEnabled: false }
    };
    const markup = render(state, '#/reports');

    expect(markup).not.toContain('>Reportes<');
    expect(markup).toContain('No tienes autorización para esta pantalla');
  });

  it('shows the Reportes entry and the screen once the session holds any one report permission', () => {
    const state: AppViewState = {
      kind: 'ready',
      session: {
        actorId: 'user-1', displayName: 'Operador Uno', roleCodes: ['supervisor'],
        permissionCodes: ['reports.cash.read'],
        idleExpiresAt: '2026-09-02T18:00:00.000Z',
        absoluteExpiresAt: '2026-09-03T00:00:00.000Z'
      },
      capabilities: { fiscalMode: 'SIMULATION', simulatedReportsEnabled: false }
    };
    const markup = render(state, '#/reports');

    expect(markup).toContain('>Reportes<');
    expect(markup).not.toContain('No tienes autorización para esta pantalla');
  });

  it('shows the connection badge derived from state, not as fixed markup', () => {
    const state: AppViewState = {
      kind: 'ready',
      session: {
        actorId: 'user-1', displayName: 'Operador Uno', roleCodes: ['cashier'],
        permissionCodes: [],
        idleExpiresAt: '2026-09-02T18:00:00.000Z',
        absoluteExpiresAt: '2026-09-03T00:00:00.000Z'
      },
      capabilities: { fiscalMode: 'SIMULATION', simulatedReportsEnabled: false }
    };

    expect(render(state, '#/', 'online')).toContain('Servidor conectado');
    expect(render(state, '#/', 'offline')).toContain('Sin conexión con el nodo');
    expect(render(state, '#/', 'offline')).not.toContain('Servidor conectado');
  });
});
