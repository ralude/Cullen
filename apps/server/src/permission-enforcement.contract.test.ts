import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as shared from '@supermarket/shared';
import { buildApp } from './app.ts';
import { ADMIN_PERMISSIONS, createSecurityRuntime, type SecurityRuntime } from './runtime.ts';

/**
 * Una prueba por permiso publicado, contra la composición real (CA-11.02-09).
 *
 * La visibilidad del renderer no es autorización: lo único que la demuestra es
 * que el mismo actor, con y sin el permiso, obtenga respuestas distintas del
 * servidor. Se recorren **todos** los contratos que declaran permiso, en vez de
 * una lista escrita a mano que envejece en silencio cuando se agrega un
 * endpoint.
 *
 * La autorización se resuelve por consulta en cada petición, así que retirar el
 * permiso del rol basta para observar la denegación sin volver a autenticar.
 */

type JsonSchema = Record<string, unknown>;
type Contract = {
  readonly method: string;
  readonly path: string;
  readonly permission: string | null;
  readonly idempotency?: string;
  readonly schema?: {
    readonly body?: JsonSchema;
    readonly params?: JsonSchema;
    readonly querystring?: JsonSchema;
  };
};

const isContract = (value: unknown): value is Contract =>
  typeof value === 'object' && value !== null
  && typeof (value as Contract).method === 'string'
  && typeof (value as Contract).path === 'string'
  && 'permission' in value;

/**
 * El paquete exporta contratos junto a tipos, errores y utilidades: la forma
 * —método, ruta y permiso declarado— es lo que distingue a un contrato, no su
 * nombre.
 */
const contracts: readonly [string, Contract][] = Object.entries(shared)
  .filter(([, value]) => isContract(value) && value.permission !== null)
  .map(([name, value]): [string, Contract] => [name, value as unknown as Contract])
  .sort(([left], [right]) => left.localeCompare(right));

/**
 * Muestra que satisface un `pattern` del contrato. Es un mapa explícito y no un
 * generador: si aparece un patrón nuevo la prueba falla en vez de inventar un
 * valor que el esquema rechazaría, y quien lo agregue decide su muestra.
 */
const PATTERN_SAMPLES: Readonly<Record<string, string>> = {
  '^[0-9]{6,12}$': '123456',
  '^[A-Z]{3,8}$': 'VES',
  '^[A-Z]{3}$': 'VES',
  '^[A-Z]{2}$': 'VE',
  '^[A-Za-z]{2}$': 'VE',
  '^[A-Za-z]{3}$': 'VES',
  '^\\d{4}-\\d{2}-\\d{2}$': '2026-09-08',
  '^\\d+([.,]\\d+)?$': '1',
  '^[0-9a-f]{64}$': 'a'.repeat(64)
};

/**
 * Alternativas de un `anyOf`: un cuerpo de actualización parcial exige al menos
 * uno de sus campos. Ignorarlo produciría un cuerpo que el esquema rechaza
 * antes de llegar a la autorización, y la prueba mediría validación en vez de
 * permiso.
 */
const firstAlternative = (schema: JsonSchema): JsonSchema | undefined =>
  (Array.isArray(schema['anyOf']) ? schema['anyOf'][0] as JsonSchema : undefined);

const sample = (schema: JsonSchema | undefined): unknown => {
  if (!schema) return undefined;
  if ('const' in schema) return schema['const'];
  if (Array.isArray(schema['enum'])) return schema['enum'][0];
  const type = Array.isArray(schema['type']) ? schema['type'][0] : schema['type'];
  if (type === undefined && Array.isArray(schema['anyOf'])) {
    return sample(schema['anyOf'][0] as JsonSchema);
  }
  if (type === 'boolean') return true;
  if (type === 'null') return null;
  if (type === 'integer' || type === 'number') {
    const minimum = schema['minimum'];
    return typeof minimum === 'number' ? minimum : 1;
  }
  if (type === 'array') {
    const minItems = typeof schema['minItems'] === 'number' ? schema['minItems'] : 0;
    const item = sample(schema['items'] as JsonSchema | undefined);
    return Array.from({ length: minItems }, () => item);
  }
  if (type === 'object') {
    const properties = (schema['properties'] ?? {}) as Record<string, JsonSchema>;
    const alternative = firstAlternative(schema)?.['required'] as readonly string[] | undefined;
    const required = [
      ...((schema['required'] ?? []) as readonly string[]), ...(alternative ?? [])
    ];
    return Object.fromEntries(required.map((key) => [key, sample(properties[key])]));
  }
  const pattern = schema['pattern'];
  if (typeof pattern === 'string') {
    const value = PATTERN_SAMPLES[pattern];
    if (value === undefined) throw new Error(`Sin muestra para el patrón ${pattern}`);
    return value;
  }
  if (schema['format'] === 'date-time') return '2026-09-08T12:00:00.000Z';
  const minLength = typeof schema['minLength'] === 'number' ? schema['minLength'] : 1;
  return 'x'.repeat(Math.max(minLength, 1));
};

const urlOf = (contract: Contract): string => {
  const params = sample(contract.schema?.params) as Record<string, string> | undefined;
  const path = contract.path.replace(
    /:([A-Za-z]+)/g, (_match, name: string) => encodeURIComponent(params?.[name] ?? 'x')
  );
  const query = sample(contract.schema?.querystring) as Record<string, unknown> | undefined;
  const search = new URLSearchParams(
    Object.entries(query ?? {}).map(([key, value]) => [key, String(value)])
  ).toString();
  return search ? `${path}?${search}` : path;
};

describe('cada permiso declarado se aplica en el servidor', () => {
  let runtime: SecurityRuntime;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;

  beforeAll(async () => {
    /** Los reportes X/Z simulados solo registran ruta con su capacidad activa. */
    runtime = createSecurityRuntime(
      ':memory:', { terminalId: 'terminal-001', originNodeId: 'node-001' },
      { executionTarget: 'SIMULATOR', reportConsent: 'ALLOW_SIMULATED_X_AND_Z' }, null
    );
    expect((await runtime.provisionInitialAdmin.execute({
      operatorCode: 'OP001', displayName: 'Administrador', pin: '827364',
      permissions: ADMIN_PERMISSIONS
    })).ok).toBe(true);
    app = buildApp(runtime.dependencies);
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/session',
      payload: { operatorCode: 'OP001', pin: '827364' }
    });
    expect(response.statusCode, response.body).toBe(200);
    cookie = String(response.headers['set-cookie']).split(';')[0]!;
  });

  afterAll(async () => {
    await app.close();
    if (runtime.handle.sqlite.open) runtime.handle.close();
  });

  const withPermissions = (granted: readonly string[]): void => {
    runtime.handle.sqlite.exec('delete from identity_role_permissions');
    const insert = runtime.handle.sqlite.prepare(
      'insert into identity_role_permissions (role_id, permission_code) values (?, ?)'
    );
    const roleId = runtime.handle.sqlite.prepare(
      "select id from identity_roles where code = 'ADMIN'"
    ).pluck().get() as string;
    for (const permission of granted) insert.run(roleId, permission);
  };

  const request = async (contract: Contract): Promise<number> => {
    const body = sample(contract.schema?.body);
    const response = await app.inject({
      method: contract.method as 'GET',
      url: urlOf(contract),
      headers: { cookie, 'idempotency-key': `enforcement-${Math.random().toString(36).slice(2)}` },
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> })
    });
    return response.statusCode;
  };

  it('recorre todos los contratos con permiso declarado', () => {
    expect(contracts.length).toBeGreaterThan(60);
  });

  it.each(contracts)('%s', async (_name: string, contract: Contract) => {
    const required = contract.permission!.split('|');

    withPermissions(ADMIN_PERMISSIONS.filter((code) => !required.includes(code)));
    expect(await request(contract), `sin permiso: ${contract.path}`).toBe(403);

    /**
     * Con el permiso, la petición puede fallar por datos inventados —404, 409,
     * 400— pero ya no por autorización. Eso es lo que separa un permiso
     * aplicado de una pantalla oculta.
     */
    withPermissions(ADMIN_PERMISSIONS);
    expect(await request(contract), `con permiso: ${contract.path}`).not.toBe(403);
  });
});
