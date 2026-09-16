import type { BrowserWindow } from 'electron';

export const PERFORMANCE_SCENARIO = 'login-and-shell';

/**
 * Consumo de la terminal al terminar la jornada medida. El CPU acumulado sólo
 * existe para el proceso principal —Chromium expone por proceso un porcentaje
 * instantáneo, que no es consumo acumulado y no se publica como si lo fuera—,
 * mientras que la memoria sí se suma sobre todos los procesos de Electron.
 */
export type DesktopProcessUsage = {
  readonly mainCpuUserMicros: number;
  readonly mainCpuSystemMicros: number;
  readonly workingSetBytes: number;
  readonly processCount: number;
};

export type DesktopPerformanceResult = {
  readonly 'desktop-to-login': number;
  readonly 'login-to-shell': number;
  readonly 'session-recovery': number;
  readonly usage: DesktopProcessUsage;
};

const WAIT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 10;
const monotonicEpoch = (): number => performance.timeOrigin + performance.now();

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

/**
 * Espera una condición observable dentro de Chromium. El predicado es fijo y
 * no devuelve texto del DOM, cookies ni credenciales al proceso principal.
 */
const waitFor = async (window: BrowserWindow, expression: string): Promise<void> => {
  const deadline = monotonicEpoch() + WAIT_TIMEOUT_MS;
  while (monotonicEpoch() < deadline) {
    if (await window.webContents.executeJavaScript(expression, true) as boolean) return;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('PERF_DESKTOP_TIMEOUT');
};

/**
 * Asigna un input como lo haría el navegador para que React reciba el evento.
 * Los valores sintéticos sólo existen en memoria y nunca forman parte del
 * resultado ni de los logs del arnés.
 */
const submitCredentials = async (
  window: BrowserWindow,
  code: string,
  secret: string
): Promise<void> => {
  const script = `(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const assign = (name, value) => {
      const input = document.querySelector('input[name="' + name + '"]');
      if (!(input instanceof HTMLInputElement) || !setValue) return false;
      setValue.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    };
    const form = document.querySelector('form.login-card');
    if (!(form instanceof HTMLFormElement)) return false;
    if (!assign('operatorCode', ${JSON.stringify(code)})) return false;
    if (!assign('pin', ${JSON.stringify(secret)})) return false;
    form.requestSubmit();
    return true;
  })()`;
  const submitted = await window.webContents.executeJavaScript(script, true) as boolean;
  if (!submitted) throw new Error('PERF_DESKTOP_LOGIN_FORM_MISSING');
};

/** No consulta el DOM anterior: espera a que Chromium termine la recarga. */
const reload = (window: BrowserWindow): Promise<void> => new Promise((resolveReload) => {
  window.webContents.once('did-finish-load', () => resolveReload());
  window.webContents.reload();
});

/**
 * Instrumentación exclusiva de 12.01 sobre el renderer compilado y Chromium
 * real. La UI continúa hablando por HTTP/Fastify; no se añade IPC de negocio.
 */
export const measureLoginAndShell = async (
  window: BrowserWindow,
  processStartedAt: number,
  credentials: { readonly code: string; readonly secret: string },
  readUsage: () => DesktopProcessUsage
): Promise<DesktopPerformanceResult> => {
  await waitFor(window, "document.querySelector('form.login-card') !== null");
  const loginReadyAt = monotonicEpoch();

  await submitCredentials(window, credentials.code, credentials.secret);
  await waitFor(window, "document.querySelector('.app-shell') !== null");
  const shellReadyAt = monotonicEpoch();

  const recoveryStartedAt = monotonicEpoch();
  await reload(window);
  await waitFor(window, "document.querySelector('.app-shell') !== null");

  const finishedAt = monotonicEpoch();
  return {
    'desktop-to-login': loginReadyAt - processStartedAt,
    'login-to-shell': shellReadyAt - loginReadyAt,
    'session-recovery': finishedAt - recoveryStartedAt,
    /** Se lee con la terminal ya operando, antes de cerrarla. */
    usage: readUsage()
  };
};
