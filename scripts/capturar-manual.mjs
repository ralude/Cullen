/**
 * Capturas del manual de usuario (12B.03).
 *
 * Abre el renderer compilado con el preload real dentro de una ventana del
 * mismo tamaño que la terminal —1200x800— y guarda cada pantalla tal como la
 * aplicación se ve. No recorta, no edita y no oculta el rótulo fiscal.
 *
 * Las trece pantallas de la navegación exigen una sesión, y el PIN solo se
 * escribe desde la terminal: por eso el guion **espera a que una persona
 * ingrese** en la ventana que abre, y recién entonces recorre las rutas. Las
 * dos pantallas previas al ingreso se capturan sin sesión.
 *
 * Antes de correrlo:
 *   1. pnpm --filter @supermarket/server dev        (el nodo, en 127.0.0.1:3000)
 *   2. pnpm --filter @supermarket/desktop build     (renderer y preload)
 *   3. node scripts/servir-renderer.mjs             (sirve el renderer en 5199)
 *
 * Uso:  <electron> scripts/capturar-manual.mjs
 */
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'docs', 'operacion', 'manual-usuario', 'capturas');
const PRELOAD = join(ROOT, 'apps', 'desktop', 'out', 'preload', 'index.cjs');
const URL = 'http://127.0.0.1:5199/';

/** Tamaño de la ventana de la terminal, declarado para poder repetir la toma. */
const SIZE = { width: 1200, height: 800 };

/** Las trece pantallas con sesión, en el orden del manual. */
const ROUTES = [
  { hash: '#/', name: '04-inicio' },
  { hash: '#/cash', name: '05-caja' },
  { hash: '#/sales', name: '06-venta' },
  { hash: '#/catalog', name: '07-catalogo' },
  { hash: '#/inventory', name: '08-inventario' },
  { hash: '#/suppliers', name: '09-proveedores' },
  { hash: '#/counts', name: '10-conteos' },
  { hash: '#/config', name: '11-configuracion' },
  { hash: '#/rates', name: '12-tasas' },
  { hash: '#/identity', name: '13-identidad' },
  { hash: '#/reports', name: '14-reportes' },
  { hash: '#/sync', name: '15-sync' }
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (line) => process.stdout.write(line + '\n');

app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  mkdirSync(DEST, { recursive: true });
  const window = new BrowserWindow({
    ...SIZE, show: true, title: 'Capturas del manual',
    webPreferences: { preload: PRELOAD, sandbox: false }
  });
  await window.loadURL(URL);
  await wait(2500);

  const shot = async (name) => {
    const image = await window.webContents.capturePage();
    writeFileSync(join(DEST, name + '.png'), image.toPNG());
    log('  ' + name + '.png');
  };

  const signedOut = () => window.webContents.executeJavaScript(
    'Boolean(document.querySelector(".login-card"))'
  );

  if (await signedOut()) {
    log('Sin sesión: capturando las dos pantallas de acceso.');
    await shot('01-ingreso');
    const opened = await window.webContents.executeJavaScript(`
      (() => {
        const button = [...document.querySelectorAll('button')]
          .find((b) => b.textContent.includes('Usar código de enrolamiento'));
        if (!button) return false;
        button.click();
        return true;
      })()
    `);
    if (opened) { await wait(700); await shot('02-activar-credencial'); }

    log('');
    log('Ahora ingresa en la ventana abierta. El guion sigue solo al detectar la sesión.');
    log('(El PIN lo escribes tú: este guion no lo conoce ni lo guarda.)');
    for (let attempt = 0; attempt < 600 && await signedOut(); attempt += 1) await wait(1000);
    if (await signedOut()) {
      log('No hubo ingreso en diez minutos. Quedan las dos capturas sin sesión.');
      app.quit();
      return;
    }
    await wait(1500);
  }

  log('Sesión activa: recorriendo las pantallas de la navegación.');
  for (const route of ROUTES) {
    await window.webContents.executeJavaScript(
      `window.location.hash = ${JSON.stringify(route.hash)}`
    );
    await wait(1800);
    const denied = await window.webContents.executeJavaScript(
      `document.body.textContent.includes('No tienes autorización para esta pantalla')`
    );
    if (denied) { log('  ' + route.name + ': sin permiso con esta sesión, omitida'); continue; }
    await shot(route.name);
  }

  log('');
  log('Revisa cada imagen antes de incorporarla: sin PIN, sin token, sin datos de');
  log('una persona o un comercio real, y con el rótulo SIMULACIÓN legible.');
  app.quit();
}).catch((error) => {
  process.stderr.write(String(error?.stack ?? error) + '\n');
  app.exit(1);
});
