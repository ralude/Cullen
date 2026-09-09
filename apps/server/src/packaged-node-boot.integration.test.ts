import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Category, UnitOfMeasure } from '@supermarket/core';
import {
  DrizzleCategoryRepository,
  DrizzleUnitOfMeasureRepository,
  SqliteUnitOfWork
} from '@supermarket/driver-db';
import { currentAccountSid } from '@supermarket/driver-security';
import { ADMIN_PERMISSIONS, createSecurityRuntime } from './runtime.ts';

/**
 * Arranque empaquetado del nodo (CA-11.03-09, ADR-0030 D6).
 *
 * Lo que verifica y por qué así:
 *
 * - Corre el **bundle compilado** (`dist/index.js`), no las fuentes con `tsx`.
 *   Es el artefacto que el MSI instala; probar las fuentes no diría nada del
 *   empaquetado.
 * - Lo arranca como **proceso real** con su propio SQLite en un perímetro con
 *   la ACL que el instalador aplica, y habla con él por HTTP de verdad. Un
 *   `app.inject` no ejerce el listener ni la cookie sobre el transporte.
 * - **No participa el proxy de `electron-vite`.** La interfaz la sirve el nodo
 *   bajo `/app/`, que es lo que hace válidas las rutas relativas `/api/v1/...`
 *   y la cookie `SameSite=Strict` de la estación instalada.
 * - Reinicia el proceso y comprueba que la operación quedó persistida.
 *
 * El bundle del renderer se sintetiza aquí con la forma que produce
 * `electron-vite` —`index.html` más `./assets/…` relativos, porque su `base`
 * es relativa—. Depender del `out/` de otro paquete ataría esta prueba al
 * orden de construcción sin cubrir nada más: lo que se verifica es el contrato
 * de servido bajo el prefijo, no el contenido del renderer.
 *
 * Windows es la plataforma empaquetada (ADR-0030): fuera de ella el arranque
 * se niega con `DATA_DIRECTORY_PLATFORM_UNSUPPORTED` en vez de suponer una ACL,
 * así que el escenario completo sólo corre ahí.
 */
const windows = process.platform === 'win32';

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(SERVER_ROOT, 'dist', 'index.js');

const OPERATOR = { operatorCode: 'OP001', pin: '482913' };
const BARCODE = '759000000042';

type Node = {
  readonly process: ChildProcess;
  readonly origin: string;
};

describe.runIf(windows)('arranque empaquetado del nodo', () => {
  const directories: string[] = [];
  const running: ChildProcess[] = [];

  beforeAll(() => {
    execFileSync(process.execPath, ['esbuild.config.js'], {
      cwd: SERVER_ROOT, stdio: 'ignore', windowsHide: true
    });
  }, 120_000);

  afterEach(async () => {
    await Promise.all(running.splice(0).map(stop));
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  /** Deja el directorio como lo deja el instalador (ADR-0029 D7.2, ADR-0030 D4). */
  const harden = (directory: string): string => {
    mkdirSync(directory, { recursive: true });
    execFileSync('icacls', [
      directory, '/inheritance:r',
      '/grant', '*S-1-5-18:(OI)(CI)F',
      '/grant', '*S-1-5-32-544:(OI)(CI)F',
      '/grant', `*${currentAccountSid()}:(OI)(CI)F`
    ], { stdio: 'ignore', windowsHide: true });
    return directory;
  };

  /** Perímetro y bundle de interfaz de una estación, sin instalar el MSI. */
  const station = () => {
    const root = mkdtempSync(join(tmpdir(), 'cullen-packaged-'));
    directories.push(root);

    const databasePath = join(root, 'data', 'node.sqlite');
    harden(dirname(databasePath));
    const backupDirectory = harden(join(root, 'data', 'backups'));
    const keystoreDirectory = harden(join(root, 'keys'));

    const identityPath = join(root, 'node-identity.json');
    writeFileSync(identityPath, JSON.stringify({
      terminalId: '01991992-a860-7000-8000-000000000101',
      originNodeId: '01991992-a860-7000-8000-000000000102'
    }));

    const rendererDirectory = join(root, 'renderer');
    mkdirSync(join(rendererDirectory, 'assets'), { recursive: true });
    writeFileSync(join(rendererDirectory, 'index.html'),
      '<!doctype html><html lang="es"><head><meta charset="UTF-8">'
      + '<title>Cullen · Punto de venta</title></head><body><div id="root"></div>'
      + '<script type="module" src="./assets/app.js"></script></body></html>');
    writeFileSync(join(rendererDirectory, 'assets', 'app.js'),
      "export const origin = window.location.origin;\n");

    return {
      databasePath,
      environment: {
        DATABASE_PATH: databasePath,
        DATABASE_BACKUP_PATH: backupDirectory,
        NODE_KEYSTORE_PATH: keystoreDirectory,
        NODE_IDENTITY_PATH: identityPath,
        RENDERER_DIST_PATH: rendererDirectory,
        /** El almacén del sistema no se toca desde una prueba (ADR-0029 D7.3). */
        CULLEN_SECRET_VAULT: 'UNPROTECTED_DEVELOPMENT',
        SERVER_PORT: '0'
      }
    };
  };

  /** Provisiona el administrador y los datos maestros que la operación necesita. */
  const seed = async (databasePath: string): Promise<void> => {
    const runtime = createSecurityRuntime(databasePath, {
      terminalId: '01991992-a860-7000-8000-000000000101',
      originNodeId: '01991992-a860-7000-8000-000000000102'
    });
    try {
      const provisioned = await runtime.provisionInitialAdmin.execute({
        ...OPERATOR, displayName: 'Administrador', permissions: ADMIN_PERMISSIONS
      });
      expect(provisioned.ok).toBe(true);
      await new SqliteUnitOfWork(runtime.handle.sqlite).execute(async () => {
        await new DrizzleCategoryRepository(runtime.handle).save(Category.create({
          id: 'category-grocery', name: 'Víveres'
        }));
        await new DrizzleUnitOfMeasureRepository(runtime.handle).save(UnitOfMeasure.create({
          id: 'unit-each', code: 'UNIT', name: 'Unidad', quantityScale: 0
        }));
      });
    } finally {
      runtime.handle.close();
    }
  };

  /** Arranca el bundle y espera a que su listener anuncie el puerto asignado. */
  const start = (environment: Readonly<Record<string, string>>): Promise<Node> => {
    const child = spawn(process.execPath, [BUNDLE], {
      cwd: SERVER_ROOT,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    running.push(child);

    return new Promise<Node>((resolveNode, reject) => {
      let output = '';
      const timer = setTimeout(
        () => reject(new Error(`El nodo empaquetado no arrancó:\n${output}`)), 25_000
      );
      const read = (chunk: Buffer): void => {
        output += chunk.toString('utf8');
        const listening = /Server listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
        if (!listening) return;
        clearTimeout(timer);
        resolveNode({ process: child, origin: listening[1]! });
      };
      child.stdout?.on('data', read);
      child.stderr?.on('data', read);
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`El nodo empaquetado terminó con código ${code}:\n${output}`));
      });
    });
  };

  const stop = (child: ChildProcess): Promise<void> => new Promise((resolveStop) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolveStop();
    child.once('exit', () => resolveStop());
    child.kill();
  });

  const authenticate = async (origin: string): Promise<string> => {
    const response = await fetch(`${origin}/api/v1/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(OPERATOR)
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie()[0]!;
    /** La interfaz comparte origen con la API, así que la cookie es estricta. */
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    return cookie.split(';')[0]!;
  };

  it('sirve la interfaz, autentica, opera y conserva la operación tras reiniciar', async () => {
    const { databasePath, environment } = station();
    await seed(databasePath);

    const first = await start(environment);

    const page = await fetch(`${first.origin}/app/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id="root"></div>');
    /** El renderer resuelve sus assets bajo el prefijo, no en la raíz del nodo. */
    expect((await fetch(`${first.origin}/app/assets/app.js`)).status).toBe(200);
    expect((await fetch(`${first.origin}/assets/app.js`)).status).toBe(404);
    /** `/app` sin barra no deja la ventana en un 404. */
    expect((await fetch(`${first.origin}/app`, { redirect: 'manual' })).status).toBe(308);

    const cookie = await authenticate(first.origin);
    const created = await fetch(`${first.origin}/api/v1/catalog/products`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'idempotency-key': 'packaged-001' },
      body: JSON.stringify({
        name: 'Café molido',
        description: 'Alta desde el nodo empaquetado',
        categoryId: 'category-grocery',
        unitCode: 'UNIT',
        barcodes: [BARCODE],
        priceMinorUnits: 1250,
        currencyCode: 'USD',
        taxRateBasisPoints: 1600,
        reason: 'Alta del arranque empaquetado'
      })
    });
    expect(created.status).toBe(201);

    await stop(first.process);

    const second = await start(environment);
    expect(second.origin).not.toBe('');
    const reauthenticated = await authenticate(second.origin);
    const found = await fetch(
      `${second.origin}/api/v1/catalog/products/by-barcode/${BARCODE}`,
      { headers: { cookie: reauthenticated } }
    );
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({
      product: { name: 'Café molido', barcodes: [BARCODE] }
    });
  }, 120_000);

  it('no expone la API de operadores fuera de loopback ni arranca sin perímetro', async () => {
    const { databasePath, environment } = station();
    await seed(databasePath);

    await expect(start({ ...environment, SERVER_HOST: '0.0.0.0' }))
      .rejects.toThrow(/SERVER_HOST_NOT_LOOPBACK/);

    /** Una cuenta cualquiera con lectura sobre el perímetro aborta el arranque. */
    execFileSync('icacls', [
      dirname(databasePath), '/grant', '*S-1-1-0:(OI)(CI)R'
    ], { stdio: 'ignore', windowsHide: true });
    await expect(start(environment)).rejects.toThrow(/DATA_DIRECTORY_NOT_PROTECTED/);
  }, 120_000);
});
