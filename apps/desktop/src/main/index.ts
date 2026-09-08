import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

/** Nombre comercial del sistema, visible en la ventana nativa. */
const PRODUCT_NAME = 'Cullen';

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

const createWindow = (): void => {
  const window = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, '../preload/index.cjs')
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
    return;
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
};

void app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
