import { afterEach, describe, expect, it } from 'vitest';
import type { IdentityDirectoryResponse } from '@supermarket/shared';
import {
  ADMIN_PERMISSIONS,
  buildApp,
  createSecurityRuntime,
  type SecurityRuntime
} from '@supermarket/server/testing';
import { App } from '../renderer/src/App.js';
import { createDesktopApi } from '../renderer/src/api-client.js';
import { mount, settle, submit, type, unmountAll } from '../renderer/src/testing/dom.js';

type RunningApp = ReturnType<typeof buildApp>;

const runtimes: SecurityRuntime[] = [];
const apps: RunningApp[] = [];

afterEach(async () => {
  unmountAll();
  window.localStorage.clear();
  window.location.hash = '';
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const runtime of runtimes.splice(0)) {
    if (runtime.handle.sqlite.open) runtime.handle.close();
  }
});

const eventually = async (assertion: () => void): Promise<void> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await settle();
    }
  }
  throw lastError;
};

const browserSession = (baseUrl: string): typeof fetch => {
  let cookie = '';
  return async (input, init = {}) => {
    const rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    const headers = new Headers(init.headers);
    if (cookie) headers.set('cookie', cookie);
    const response = await fetch(new URL(rawUrl, baseUrl), { ...init, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';', 1)[0] ?? '';
    return response;
  };
};

/**
 * Nodo real con su administrador inicial y la credencial ya caducada: lo que
 * deja la administración de identidad cuando fuerza el cambio de PIN.
 */
const nodeWithExpiredCredential = async (): Promise<string> => {
  const runtime = createSecurityRuntime(':memory:', {
    terminalId: 'terminal-001', originNodeId: 'node-001'
  });
  runtimes.push(runtime);
  const provisioned = await runtime.provisionInitialAdmin.execute({
    operatorCode: 'OP001', displayName: 'Operador E2E', pin: '123456',
    permissions: ADMIN_PERMISSIONS
  });
  expect(provisioned.ok).toBe(true);

  const app = buildApp(runtime.dependencies);
  apps.push(app);
  const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });

  const admin = browserSession(baseUrl);
  const json = { 'content-type': 'application/json' };
  expect((await admin('/api/v1/auth/session', {
    method: 'POST', headers: json, body: JSON.stringify({ operatorCode: 'OP001', pin: '123456' })
  })).ok).toBe(true);
  const directory = await (await admin('/api/v1/identity')).json() as IdentityDirectoryResponse;
  const userId = directory.operators.find((operator) => operator.operatorCode === 'OP001')?.userId;
  expect(userId).toBeTruthy();
  const expired = await admin(`/api/v1/identity/operators/${userId}/credential-expiration`, {
    method: 'POST', headers: json, body: JSON.stringify({ reason: 'Rotación E2E' })
  });
  expect(expired.status).toBe(204);
  return baseUrl;
};

const signIn = async (screen: Awaited<ReturnType<typeof mount>>, pin: string): Promise<void> => {
  await eventually(() => expect(screen.text()).toContain('Identificación'));
  await type(screen.get<HTMLInputElement>('input[name="operatorCode"]'), 'OP001');
  await type(screen.get<HTMLInputElement>('input[name="pin"]'), pin);
  await submit(screen.get<HTMLFormElement>('form.login-card'));
};

/**
 * D-011: el nodo rechaza con `AUTH_PIN_CHANGE_REQUIRED` todo lo que no sea
 * cambiar el PIN o salir, incluidas las capacidades. El shell debe llegar al
 * formulario igual, sin interpretar ese rechazo como un nodo caído.
 */
describe('credencial caducada E2E sobre el nodo real', () => {
  it('lleva del ingreso al cambio obligatorio de PIN y, cambiado, a la operación', async () => {
    const baseUrl = await nodeWithExpiredCredential();
    const screen = await mount(<App api={createDesktopApi(browserSession(baseUrl))} />);

    await signIn(screen, '123456');
    await eventually(() => expect(screen.text()).toContain('Cambia tu PIN para continuar'));
    expect(screen.text()).not.toContain('No pudimos conectar con el nodo');
    expect(screen.query('nav[aria-label="Navegación principal"]')).toBeNull();

    await type(screen.get<HTMLInputElement>('input[name="currentPin"]'), '123456');
    await type(screen.get<HTMLInputElement>('input[name="newPin"]'), '246810');
    await type(screen.get<HTMLInputElement>('input[name="repeatedPin"]'), '246810');
    await submit(screen.get<HTMLFormElement>('form'));

    await eventually(() => {
      expect(screen.get('nav[aria-label="Navegación principal"]')).toBeTruthy();
      expect(screen.text()).toContain('Operador E2E');
    });
  }, 20_000);

  it('retoma el cambio obligatorio al reabrir la ventana con la sesión restringida', async () => {
    const baseUrl = await nodeWithExpiredCredential();
    const session = browserSession(baseUrl);
    const first = await mount(<App api={createDesktopApi(session)} />);
    await signIn(first, '123456');
    await eventually(() => expect(first.text()).toContain('Cambia tu PIN para continuar'));
    first.unmount();

    /** Misma cookie, ventana nueva: el arranque lee la sesión que ya existe. */
    const reopened = await mount(<App api={createDesktopApi(session)} />);
    await eventually(() => expect(reopened.text()).toContain('Cambia tu PIN para continuar'));
    expect(reopened.text()).not.toContain('No pudimos conectar con el nodo');
  }, 20_000);
});
