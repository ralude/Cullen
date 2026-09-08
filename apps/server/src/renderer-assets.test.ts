import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';

/** Petición con el camino tal cual, sin la normalización de un cliente HTTP. */
const rawRequest = (
  port: number, path: string
): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
  const call = request({ host: '127.0.0.1', port, path, method: 'GET' }, (response) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => { body += chunk; });
    response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
  });
  call.on('error', reject);
  call.end();
});

/**
 * La terminal instalada carga su interfaz desde el nodo para compartir origen
 * con la API: es lo que hace válidas las rutas relativas `/api/v1/...` y la
 * cookie de sesión `SameSite=Strict`. Servida desde el disco, ninguna llamada
 * llegaba con credenciales.
 */
describe('interfaz servida por el nodo', () => {
  const runningApps: ReturnType<typeof buildApp>[] = [];
  const directories: string[] = [];
  const previous = process.env.RENDERER_DIST_PATH;

  afterEach(async () => {
    await Promise.all(runningApps.splice(0).map((app) => app.close()));
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.RENDERER_DIST_PATH;
    else process.env.RENDERER_DIST_PATH = previous;
  });

  const bundle = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'cullen-renderer-'));
    directories.push(root);
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>Cullen</title>');
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'assets', 'index.js'), 'console.log("cullen");');
    return root;
  };

  it('sirve la interfaz en el mismo origen que la API', async () => {
    process.env.RENDERER_DIST_PATH = bundle();
    const app = buildApp();
    runningApps.push(app);

    const page = await app.inject({ method: 'GET', url: '/app/' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Cullen');

    const asset = await app.inject({ method: 'GET', url: '/app/assets/index.js' });
    expect(asset.statusCode).toBe(200);

    // La raíz sin barra final llega igual a la interfaz.
    const redirected = await app.inject({ method: 'GET', url: '/app' });
    expect(redirected.statusCode).toBe(308);
    expect(redirected.headers.location).toBe('/app/');

    // El nodo sigue siendo el mismo origen para la salud y la API.
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  /**
   * `inject` normaliza la ruta antes de enrutarla, así que el salto solo llega
   * al servidor de estáticos en una petición real con el camino sin resolver.
   */
  it('no sirve archivos fuera del paquete de la interfaz', async () => {
    process.env.RENDERER_DIST_PATH = bundle();
    const app = buildApp();
    runningApps.push(app);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    const escaped = await rawRequest(port, '/app/../../package.json');

    // No revela si el archivo existe ni escala a un error interno del nodo.
    expect(escaped.status).toBe(404);
    expect(JSON.parse(escaped.body)).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('arranca sin interfaz empaquetada, como en desarrollo', async () => {
    delete process.env.RENDERER_DIST_PATH;
    const app = buildApp();
    runningApps.push(app);

    expect((await app.inject({ method: 'GET', url: '/app/' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('no publica una ruta rota cuando el paquete declarado no existe', async () => {
    process.env.RENDERER_DIST_PATH = join(tmpdir(), 'cullen-renderer-inexistente');
    const app = buildApp();
    runningApps.push(app);

    expect((await app.inject({ method: 'GET', url: '/app/' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});
