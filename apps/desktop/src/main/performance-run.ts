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

export const SALE_SCENARIO = 'sale-from-shell';

export type DesktopSaleResult = {
  readonly 'sale-start': number;
  readonly 'sale-add-line': number;
  readonly 'sale-settle': number;
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
const waitFor = async (window: BrowserWindow, expression: string, step = ''): Promise<void> => {
  const deadline = monotonicEpoch() + WAIT_TIMEOUT_MS;
  while (monotonicEpoch() < deadline) {
    if (await window.webContents.executeJavaScript(expression, true) as boolean) return;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('PERF_DESKTOP_TIMEOUT' + (step ? '_' + step : ''));
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

/**
 * Hace clic donde el operador haría clic. Devuelve false si el elemento no
 * está, para que el conductor aborte en vez de medir una pantalla que no
 * llegó: una jornada que no ocurrió no es una observación rápida.
 */
const click = async (window: BrowserWindow, selector: string): Promise<void> => {
  const script = `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!(target instanceof HTMLElement)) return false;
    target.click();
    return true;
  })()`;
  const clicked = await window.webContents.executeJavaScript(script, true) as boolean;
  if (!clicked) throw new Error('PERF_DESKTOP_SALE_TARGET_MISSING');
};

/**
 * Jornada de venta conducida por la interfaz real, no por la API.
 *
 * Existe porque 12.02 mide el camino renderer–nodo, y la jornada de la línea
 * base entra por `app.inject`: no cruza socket, cliente HTTP ni React. Aquí
 * cada tramo empieza en un gesto del operador y termina cuando la pantalla
 * refleja el resultado, así que incluye render y espera de la UI.
 *
 * Cobra con un solo método **no gravado**: una venta que cobró IGTF no puede
 * emitir su factura hoy —D-003—, y aunque este recorrido no factura, se
 * conserva el mismo criterio que la jornada medida para que ambas comparen lo
 * mismo. La emisión del documento no forma parte de este escenario.
 */
export const measureSaleFromShell = async (
  window: BrowserWindow,
  readUsage: () => DesktopProcessUsage,
  paymentMethodCode: string
): Promise<DesktopSaleResult> => {
  const screenAt = monotonicEpoch();
  await click(window, '.start-panel .primary-button');
  await waitFor(window, "document.querySelector('.sale-catalog .product-tile') !== null", 'CATALOG');
  const startedAt = monotonicEpoch();

  await click(window, '.sale-catalog .product-tile');
  await waitFor(window, "document.querySelectorAll('.sale-lines tbody tr').length > 0", 'LINE');
  const lineAt = monotonicEpoch();

  await click(window, `.method-chips input[value=${JSON.stringify(paymentMethodCode)}]`);
  await click(window, '.amount-field button');
  await waitFor(window, "document.querySelector('.amount-field input').value !== ''", 'AMOUNT');
  await click(window, '#sale-payment-form .complete-button');
  await waitFor(window, "document.querySelector('.closed-sale') !== null", 'SETTLED');
  const settledAt = monotonicEpoch();

  /** La venta tiene que haber quedado completada, no anulada. */
  const completed = await window.webContents.executeJavaScript(
    "document.querySelector('.closed-sale .eyebrow').textContent.includes('completada')", true
  ) as boolean;
  if (!completed) throw new Error('PERF_DESKTOP_SALE_NOT_COMPLETED');

  return {
    'sale-start': startedAt - screenAt,
    'sale-add-line': lineAt - startedAt,
    'sale-settle': settledAt - lineAt,
    usage: readUsage()
  };
};

/**
 * Encadena otra venta como lo haría el operador: pulsando «Iniciar otra venta»
 * **sin salir de la pantalla**.
 *
 * Importa para no medir un artefacto: el catálogo se carga en un efecto al
 * montar la pantalla, así que navegar fuera y volver lo recargaría entero en
 * cada repetición y cargaría a la venta un costo que la operación real paga una
 * sola vez, al entrar.
 */
export const startAnotherSale = async (window: BrowserWindow): Promise<void> => {
  /**
   * Hijo directo: «Emitir factura» y «Registrar devolución» también son
   * `.primary-button`, pero viven dentro de sus propias secciones. Un selector
   * descendente pulsaría la factura y la jornada mediría otra cosa.
   */
  await click(window, '.closed-sale > .primary-button');
  /** Vuelve el panel de apertura, no el catálogo: la venta activa se limpió. */
  await waitFor(
    window, "document.querySelector('.start-panel .primary-button:not([disabled])') !== null",
    'REOPEN'
  );
};

/**
 * Ingreso fuera de medición, para escenarios que necesitan una sesión abierta
 * antes de empezar a medir. El costo del ingreso ya lo mide `login-and-shell`.
 */
export const signInForMeasurement = async (
  window: BrowserWindow, code: string, secret: string
): Promise<void> => {
  await waitFor(window, "document.querySelector('form.login-card') !== null");
  await submitCredentials(window, code, secret);
  await waitFor(window, "document.querySelector('.app-shell') !== null");
};

/**
 * Entra a la pantalla de venta desde el shell. Se mide **una vez por sesión**,
 * no por venta: aquí es donde el efecto de montaje carga el catálogo entero, y
 * el operador paga ese costo al entrar, no en cada cobro.
 */
export const enterSaleScreen = async (window: BrowserWindow): Promise<number> => {
  const at = monotonicEpoch();
  await window.webContents.executeJavaScript("window.location.hash = '#/sales'", true);
  await waitFor(window, "document.querySelector('.sales-screen .start-panel') !== null", 'SALE_SCREEN');
  /** El carrito no abre hasta que la pantalla resolvió el turno de la estación. */
  await waitFor(
    window, "document.querySelector('.start-panel .primary-button:not([disabled])') !== null",
    'SHIFT_READY'
  );
  return monotonicEpoch() - at;
};
