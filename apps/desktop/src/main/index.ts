import { app, BrowserWindow, Menu } from 'electron';
import { join } from 'node:path';
import {
  enterSaleScreen, measureLoginAndShell, measureSaleFromShell, signInForMeasurement,
  startAnotherSale,
  PERFORMANCE_SCENARIO, SALE_SCENARIO, type DesktopProcessUsage
} from './performance-run.js';

/** Nombre comercial del sistema, visible en la ventana nativa. */
const PRODUCT_NAME = 'Cullen';

const performanceScenario = process.env.CULLEN_PERFORMANCE_SCENARIO?.trim();
const measuresLoginAndShell = performanceScenario === PERFORMANCE_SCENARIO;
const measuresSaleFromShell = performanceScenario === SALE_SCENARIO;
const measuresPerformance = measuresLoginAndShell || measuresSaleFromShell;

/**
 * `getAppMetrics` cubre todos los procesos de Electron —principal, GPU,
 * utilidades y renderer—; `workingSetSize` viene en KiB. El CPU acumulado sólo
 * existe para el proceso principal.
 */
const readDesktopUsage = (): DesktopProcessUsage => {
  const metrics = app.getAppMetrics();
  const cpu = process.cpuUsage();
  return {
    mainCpuUserMicros: cpu.user,
    mainCpuSystemMicros: cpu.system,
    workingSetBytes: metrics.reduce((total, metric) => total + metric.memory.workingSetSize * 1024, 0),
    processCount: metrics.length
  };
};

/**
 * Nodo local de esta terminal. La interfaz se carga desde él, no desde
 * `file://`: el renderer llama a `/api/v1/...` con rutas relativas y su sesión
 * viaja en una cookie `SameSite=Strict`, de modo que interfaz y API tienen que
 * compartir origen. Servirla desde el disco dejaba la terminal instalada sin
 * ninguna llamada válida, y solo funcionaba con el proxy de desarrollo.
 */
export const nodeUrl = (env: NodeJS.ProcessEnv = process.env): string =>
  (env.CULLEN_NODE_URL?.trim() || 'http://127.0.0.1:3000').replace(/\/+$/, '');

/** Página local mínima cuando el nodo todavía no atiende. No consume la API. */
const unreachableNodePage = (url: string): string => `data:text/html;charset=utf-8,${
  encodeURIComponent(`<!doctype html><meta charset="utf-8">
<title>${PRODUCT_NAME}</title>
<style>
  body { font: 15px system-ui, sans-serif; margin: 0; display: grid; place-items: center;
    min-height: 100vh; background: #f6f6f5; color: #1c1b19; }
  main { max-width: 30rem; padding: 2rem; text-align: center; }
  code { background: #e9e8e6; padding: .15rem .4rem; border-radius: .25rem; }
  button { margin-top: 1.5rem; padding: .6rem 1.4rem; font: inherit; cursor: pointer;
    border: 0; border-radius: .35rem; background: #1c1b19; color: #fff; }
</style>
<main>
  <h1>No pudimos conectar con el nodo</h1>
  <p>La terminal necesita su nodo local en <code>${url}</code>.
     Inícialo y vuelve a intentarlo.</p>
  <button onclick="location.replace('${url}/app/')">Reintentar</button>
</main>`)
}`;

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    title: PRODUCT_NAME,
    autoHideMenuBar: true,
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: !measuresPerformance,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, '../preload/index.cjs')
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
    return window;
  }

  const target = `${nodeUrl()}/app/`;
  /**
   * Un nodo apagado devolvería la pantalla de error de Chromium, que no explica
   * nada ni ofrece salida. Se sustituye por una página propia con reintento.
   */
  window.webContents.on('did-fail-load', (_event, _code, _description, failedUrl) => {
    if (failedUrl.startsWith('data:')) return;
    void window.loadURL(unreachableNodePage(nodeUrl()));
  });
  void window.loadURL(target);
  return window;
};

void app.whenReady().then(async () => {
  /**
   * El menu por defecto de Electron ofrece Archivo, Ver, Ventana y sus atajos
   * de recarga y devtools. Nada de eso pertenece a una caja: la terminal se
   * opera desde su propia navegacion, y una recarga accidental a mitad de un
   * cobro no es una funcion, es un riesgo.
   */
  Menu.setApplicationMenu(null);
  const window = createWindow();

  if (measuresLoginAndShell) {
    const code = process.env.CULLEN_PERFORMANCE_OPERATOR_CODE;
    const secret = process.env.CULLEN_PERFORMANCE_PIN;
    const processStartedAt = Number(process.env.CULLEN_PERFORMANCE_STARTED_AT);
    if (!code || !secret || !Number.isFinite(processStartedAt)
      || !nodeUrl().startsWith('http://127.0.0.1:')) {
      throw new Error('PERF_DESKTOP_CONFIGURATION_INVALID');
    }
    const result = await measureLoginAndShell(
      window, processStartedAt, { code, secret }, readDesktopUsage
    );
    process.stdout.write('CULLEN_PERF_RESULT ' + JSON.stringify(result) + '\n');
    app.quit();
    return;
  }

  if (measuresSaleFromShell) {
    const code = process.env.CULLEN_PERFORMANCE_OPERATOR_CODE;
    const secret = process.env.CULLEN_PERFORMANCE_PIN;
    const method = process.env.CULLEN_PERFORMANCE_PAYMENT_METHOD;
    const repetitions = Number(process.env.CULLEN_PERFORMANCE_REPETITIONS);
    if (!code || !secret || !method || !Number.isSafeInteger(repetitions) || repetitions < 1
      || !nodeUrl().startsWith('http://127.0.0.1:')) {
      throw new Error('PERF_DESKTOP_CONFIGURATION_INVALID');
    }
    /**
     * El ingreso queda fuera de toda medición: lo cubre `login-and-shell`, y
     * repetirlo por jornada añadiría su scrypt a cada observación. Todas las
     * repeticiones comparten un proceso porque la jornada es una acción dentro
     * de una sesión abierta; arrancar Chromium por repetición mediría el
     * arranque, no la venta.
     */
    await signInForMeasurement(window, code, secret);
    /**
     * Entrar a la pantalla se mide aparte y una sola vez: ahí es donde el
     * efecto de montaje carga el catálogo entero, y el operador paga ese costo
     * al entrar, no en cada cobro. Las ventas se encadenan sin salir.
     */
    process.stdout.write('CULLEN_PERF_SCREEN ' + await enterSaleScreen(window) + '\n');
    for (let run = 0; run < repetitions; run += 1) {
      const sale = await measureSaleFromShell(window, readDesktopUsage, method);
      process.stdout.write('CULLEN_PERF_RESULT ' + JSON.stringify(sale) + '\n');
      if (run + 1 < repetitions) await startAnotherSale(window);
    }
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error: unknown) => {
  /**
   * Sólo el código estable del conductor, nunca el stack ni el mensaje libre:
   * sin él, una medición fallida no dice qué paso de la jornada no ocurrió.
   */
  const code = error instanceof Error && /^PERF_[A-Z_]+$/.test(error.message)
    ? ' ' + error.message
    : '';
  process.stderr.write(
    (measuresPerformance ? 'PERF_DESKTOP_FAILED' + code : 'DESKTOP_START_FAILED') + '\n'
  );
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
