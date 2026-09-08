import { afterEach, describe, expect, it } from 'vitest';
import type { InjectOptions } from 'fastify';
import { buildApp } from '../app.ts';
import { ADMIN_PERMISSIONS, createSecurityRuntime, type SecurityRuntime } from '../runtime.ts';

/**
 * Confinamiento del material de credencial sobre la composición real.
 *
 * La regla que se comprueba aquí no es de negocio sino de contención: el PIN,
 * su hash, la sal y el ticket de enrolamiento pertenecen al nodo donde se usan
 * y no pueden salir por ninguna vía —respuesta HTTP, ledger, outbox, concesión
 * de operadores o auditoría— conforme a
 * [ADR-0026](../../../../docs/architecture/adr/0026-autoridad-del-coordinador.md)
 * D5 y [ADR-0028](../../../../docs/architecture/adr/0028-enrolamiento-local-de-credenciales.md)
 * D1. El recorrido ejercita todos los caminos que crean o reemplazan una
 * credencial y después barre la base entera, tabla por tabla.
 */
describe('confinamiento del material de credencial', () => {
  const runtimes: SecurityRuntime[] = [];
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const runtime of runtimes.splice(0)) if (runtime.handle.sqlite.open) runtime.handle.close();
  });

  /** PIN distintivos: un dígito repetido podría aparecer por azar en un id. */
  const ADMIN_PIN = '827364';
  const ENROLLED_PIN = '918273';
  const REPLACED_PIN = '546372';

  const login = async (
    app: ReturnType<typeof buildApp>, operatorCode: string, pin: string
  ): Promise<string> => {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/session', payload: { operatorCode, pin }
    });
    expect(response.statusCode, response.body).toBe(200);
    return String(response.headers['set-cookie']).split(';')[0]!;
  };

  /** Toda celda de texto de la base, con su tabla y su columna. */
  const everyCell = (runtime: SecurityRuntime): readonly {
    readonly table: string; readonly column: string; readonly value: string;
  }[] => {
    const tables = runtime.handle.sqlite.prepare(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%'"
    ).pluck().all() as readonly string[];
    return tables.flatMap((table) => (
      runtime.handle.sqlite.prepare(`select * from "${table}"`).all() as readonly Record<string, unknown>[]
    ).flatMap((row) => Object.entries(row).map(([column, value]) => ({
      table, column, value: value === null ? '' : String(value)
    }))));
  };

  it('no deja el PIN ni el ticket en ninguna tabla, respuesta o evento', async () => {
    const runtime = createSecurityRuntime(
      ':memory:', { terminalId: 'terminal-001', originNodeId: 'node-001' }, {}, null
    );
    runtimes.push(runtime);
    expect((await runtime.provisionInitialAdmin.execute({
      operatorCode: 'OP001', displayName: 'Administrador', pin: ADMIN_PIN,
      permissions: ADMIN_PERMISSIONS
    })).ok).toBe(true);
    const app = buildApp(runtime.dependencies);
    apps.push(app);
    const cookie = await login(app, 'OP001', ADMIN_PIN);
    const bodies: string[] = [];
    const call = async (
      options: InjectOptions, expected = 200
    ): Promise<Record<string, unknown>> => {
      const response = await app.inject({ ...options, headers: { cookie } });
      expect(response.statusCode, `${String(options.url)}: ${response.body}`).toBe(expected);
      bodies.push(response.body);
      return response.statusCode === 204 ? {} : response.json<Record<string, unknown>>();
    };

    /** Alta, enrolamiento, ingreso, cambio de PIN propio y caducidad. */
    const created = await call({
      method: 'POST', url: '/api/v1/identity/operators',
      payload: { operatorCode: 'OP100', displayName: 'Cajera Nueva', roleIds: [], reason: 'Alta' }
    }, 201);
    const ticket = await call({
      method: 'POST', url: '/api/v1/identity/credential-enrollments',
      payload: { operatorCode: 'OP100', reason: 'Primer ingreso' }
    }, 201);
    const rawToken = String(ticket['enrollmentToken']);
    const enrolled = await app.inject({
      method: 'POST', url: '/api/v1/auth/credential-enrollment',
      payload: { enrollmentToken: rawToken, pin: ENROLLED_PIN }
    });
    expect(enrolled.statusCode, enrolled.body).toBe(200);
    bodies.push(enrolled.body);

    const operatorCookie = await login(app, 'OP100', ENROLLED_PIN);
    const changed = await app.inject({
      method: 'PUT', url: '/api/v1/auth/pin', headers: { cookie: operatorCookie },
      payload: { currentPin: ENROLLED_PIN, newPin: REPLACED_PIN }
    });
    expect(changed.statusCode, changed.body).toBe(204);
    await call({
      method: 'POST',
      url: `/api/v1/identity/operators/${String(created['userId'])}/credential-expiration`,
      payload: { reason: 'Rotación' }
    }, 204);

    /** La publicación de concesiones es la vía por la que la identidad sí viaja. */
    await call({
      method: 'POST', url: '/api/v1/sync/references/operator-grants/publish',
      payload: { reason: 'Corte inicial de concesiones' }
    });
    bodies.push((await app.inject({
      method: 'GET', url: '/api/v1/identity', headers: { cookie }
    })).body);

    /**
     * El barrido lee filas reales: sin esta comprobación, una consulta que no
     * devolviera nada haría pasar el resto por vacío.
     */
    expect(everyCell(runtime).some((cell) => cell.value.includes('OP100'))).toBe(true);

    const secrets = { ADMIN_PIN, ENROLLED_PIN, REPLACED_PIN, ticket: rawToken };
    for (const [name, secret] of Object.entries(secrets)) {
      for (const body of bodies) {
        /** El ticket viaja una vez, en la respuesta que lo emite y en ninguna más. */
        if (name === 'ticket' && body === JSON.stringify(ticket)) continue;
        expect(body, name).not.toContain(secret);
      }
      const leaked = everyCell(runtime).filter((cell) => cell.value.includes(secret));
      expect(leaked, `${name} apareció en ${leaked.map((c) => c.table + '.' + c.column).join(', ')}`)
        .toEqual([]);
    }

    /**
     * Ningún evento del ledger ni del outbox nombra material de credencial,
     * aunque su valor esté cifrado o resumido: una clave con ese nombre ya
     * sería un canal por el que podría empezar a viajar.
     */
    const forbidden = /"(pin|pinHash|pin_hash|salt|token|tokenHash|token_hash|credential|secret)"/i;
    for (const table of ['outbox_event', 'ledger_event', 'audit_log']) {
      const exists = runtime.handle.sqlite.prepare(
        "select count(*) from sqlite_master where type = 'table' and name = ?"
      ).pluck().get(table) as number;
      if (exists === 0) continue;
      const payloads = everyCell(runtime)
        .filter((cell) => cell.table === table && cell.value.startsWith('{'));
      expect(payloads.length, table).toBeGreaterThan(0);
      for (const cell of payloads) {
        expect(cell.value, `${cell.table}.${cell.column}`).not.toMatch(forbidden);
      }
    }
  });
});
