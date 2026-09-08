import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '@supermarket/shared';
import { loadNodeIdentity } from '@supermarket/driver-security';
import { writeFileSync } from 'node:fs';
import { buildApp } from './app.ts';
import { ADMIN_PERMISSIONS, createSecurityRuntime, type SecurityRuntime } from './runtime.ts';
import { resolveOperatorHost } from './session-transport.ts';
import { readSyncListenerConfiguration } from './sync/lan-listener.ts';

/**
 * Frontera de nodo y de sesión (11.03, cortes 3 y 4).
 *
 * Terminal y nodo no vienen de la petición sino del composition root, y una
 * sesión pertenece al nodo que la emitió. Lo que aquí se fija no es una
 * implementación sino la garantía: ninguna cabecera, cuerpo o cookie puede
 * moverlas, y ninguna configuración insegura llega a servir.
 */
describe('frontera de nodo', () => {
  const runtimes: SecurityRuntime[] = [];
  const apps: ReturnType<typeof buildApp>[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const runtime of runtimes.splice(0)) if (runtime.handle.sqlite.open) runtime.handle.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  const temporaryDirectory = (): string => {
    const directory = mkdtempSync(join(tmpdir(), 'cullen-node-'));
    directories.push(directory);
    return directory;
  };

  const start = async (options: {
    readonly databasePath?: string;
    readonly terminalId?: string;
    readonly originNodeId?: string;
    readonly track?: boolean;
  } = {}) => {
    const runtime = createSecurityRuntime(
      options.databasePath ?? ':memory:',
      {
        terminalId: options.terminalId ?? 'terminal-001',
        originNodeId: options.originNodeId ?? 'node-001'
      },
      {},
      null
    );
    if (options.track !== false) runtimes.push(runtime);
    const provisioned = await runtime.provisionInitialAdmin.execute({
      operatorCode: 'OP001', displayName: 'Operador', pin: '123456',
      permissions: ADMIN_PERMISSIONS
    });
    expect(provisioned.ok || provisioned.error.code === 'AUTH_ALREADY_PROVISIONED').toBe(true);
    const app = buildApp(runtime.dependencies);
    if (options.track !== false) apps.push(app);
    return { app, runtime };
  };

  const login = async (app: ReturnType<typeof buildApp>): Promise<string> => {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/session',
      payload: { operatorCode: 'OP001', pin: '123456' }
    });
    expect(response.statusCode, response.body).toBe(200);
    return String(response.headers['set-cookie']).split(';')[0]!;
  };

  it('no deja que cabecera, cuerpo ni cookie muevan terminal ni nodo', async () => {
    const { app, runtime } = await start();
    const cookie = await login(app);

    /** El cuerpo ni siquiera admite los campos: el esquema los rechaza. */
    const body = await app.inject({
      method: 'POST', url: '/api/v1/identity/operators', headers: { cookie },
      payload: {
        operatorCode: 'OP100', displayName: 'Cajera', roleIds: [], reason: 'Alta',
        terminalId: 'attacker-terminal', originNodeId: 'attacker-node'
      }
    });
    expect(body.statusCode).toBe(400);
    expect(body.json()).toMatchObject({ code: 'HTTP_VALIDATION_FAILED' });

    /** Cabecera y cookie sí llegan al servidor, y aun así no cambian nada. */
    const created = await app.inject({
      method: 'POST', url: '/api/v1/identity/operators',
      headers: {
        cookie: `${cookie}; terminalId=attacker-terminal; originNodeId=attacker-node`,
        'x-terminal-id': 'attacker-terminal',
        'x-origin-node-id': 'attacker-node',
        'x-forwarded-for': '10.0.0.9'
      },
      payload: { operatorCode: 'OP100', displayName: 'Cajera', roleIds: [], reason: 'Alta' }
    });
    expect(created.statusCode, created.body).toBe(201);

    const evidence = runtime.handle.sqlite.prepare(
      "select terminal_id, origin_node_id from audit_log where action = 'IDENTITY_OPERATOR_CREATED'"
    ).all() as readonly { terminal_id: string; origin_node_id: string }[];
    expect(evidence.length).toBeGreaterThan(0);
    for (const row of evidence) {
      expect(row.terminal_id).toBe('terminal-001');
      expect(row.origin_node_id).toBe('node-001');
    }
    const sessions = runtime.handle.sqlite.prepare(
      'select terminal_id, origin_node_id from auth_sessions'
    ).all() as readonly { terminal_id: string; origin_node_id: string }[];
    expect(sessions).toEqual([{ terminal_id: 'terminal-001', origin_node_id: 'node-001' }]);
  });

  it('no acepta en un nodo la sesión emitida por otro', async () => {
    const first = await start({ terminalId: 'terminal-001', originNodeId: 'node-001' });
    const second = await start({ terminalId: 'terminal-002', originNodeId: 'node-002' });
    const cookie = await login(first.app);

    /** La misma cookie, en el nodo vecino con su propia base: no existe. */
    const foreign = await second.app.inject({
      method: 'GET', url: '/api/v1/auth/session', headers: { cookie }
    });
    expect(foreign.statusCode).toBe(401);
    expect(foreign.json()).toMatchObject({ code: 'UNAUTHORIZED' });

    /** Y sigue siendo válida donde nació: el rechazo no es un efecto lateral. */
    const own = await first.app.inject({
      method: 'GET', url: '/api/v1/auth/session', headers: { cookie }
    });
    expect(own.statusCode).toBe(200);
  });

  it('sobrevive al reinicio del nodo y caduca sin él', async () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, 'node.sqlite');

    const first = await start({ databasePath, track: false });
    const cookie = await login(first.app);
    const created = await first.app.inject({
      method: 'POST', url: '/api/v1/identity/operators', headers: { cookie },
      payload: { operatorCode: 'OP100', displayName: 'Cajera', roleIds: [], reason: 'Alta' }
    });
    expect(created.statusCode, created.body).toBe(201);
    await first.app.close();
    first.runtime.handle.close();

    /** Reinicio real: proceso nuevo sobre el mismo archivo. */
    const second = await start({ databasePath });
    const recovered = await second.app.inject({
      method: 'GET', url: '/api/v1/auth/session', headers: { cookie }
    });
    expect(recovered.statusCode).toBe(200);
    const directory1 = await second.app.inject({
      method: 'GET', url: '/api/v1/identity', headers: { cookie }
    });
    expect(directory1.json<{ operators: readonly { operatorCode: string }[] }>().operators
      .map((operator) => operator.operatorCode)).toContain('OP100');

    /** Una sesión caducada obliga a autenticar otra vez, y el trabajo persiste. */
    second.runtime.handle.sqlite.prepare(
      'update auth_sessions set idle_expires_at = 1, absolute_expires_at = 1'
    ).run();
    const expired = await second.app.inject({
      method: 'GET', url: '/api/v1/auth/session', headers: { cookie }
    });
    expect(expired.statusCode).toBe(401);

    const fresh = await login(second.app);
    const afterRelogin = await second.app.inject({
      method: 'GET', url: '/api/v1/identity', headers: { cookie: fresh }
    });
    expect(afterRelogin.json<{ operators: readonly { operatorCode: string }[] }>().operators
      .map((operator) => operator.operatorCode)).toContain('OP100');
  });
});

describe('arranque con configuración insegura', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  const temporaryFile = (name: string, content: string): string => {
    const directory = mkdtempSync(join(tmpdir(), 'cullen-identity-'));
    directories.push(directory);
    const path = join(directory, name);
    writeFileSync(path, content);
    return path;
  };

  /** Ningún mensaje público nombra rutas, material ni valores de configuración. */
  const isSafe = (error: unknown, ...secrets: readonly string[]): void => {
    expect(error).toBeInstanceOf(AppError);
    const message = (error as AppError).message;
    expect(message).not.toMatch(/[\\/]/);
    for (const secret of secrets) expect(message).not.toContain(secret);
  };

  it('aborta con un host de operadores fuera de loopback', () => {
    let thrown: unknown;
    try { resolveOperatorHost({ SERVER_HOST: '0.0.0.0' }); } catch (error) { thrown = error; }
    isSafe(thrown, '0.0.0.0');
    expect((thrown as AppError).code).toBe('SERVER_HOST_NOT_LOOPBACK');
  });

  it('aborta con material de sincronización incompleto', () => {
    let thrown: unknown;
    try {
      readSyncListenerConfiguration({ SYNC_LISTENER_PORT: '8443' });
    } catch (error) { thrown = error; }
    isSafe(thrown);
    expect((thrown as AppError).code).toBe('SYNC_LISTENER_CONFIGURATION_INCOMPLETE');
  });

  it('aborta con una identidad de nodo ilegible o corrupta', () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'cullen-missing-')), 'node-identity.json');
    directories.push(missing);
    let absent: unknown;
    try { loadNodeIdentity(missing); } catch (error) { absent = error; }
    isSafe(absent, missing);
    expect((absent as AppError).code).toBe('NODE_IDENTITY_LOAD_FAILED');

    const corrupt = temporaryFile('node-identity.json', '{ "terminalId": "" }');
    let invalid: unknown;
    try { loadNodeIdentity(corrupt); } catch (error) { invalid = error; }
    isSafe(invalid, corrupt);
    expect((invalid as AppError).code).toBe('NODE_IDENTITY_INVALID');
  });
});
