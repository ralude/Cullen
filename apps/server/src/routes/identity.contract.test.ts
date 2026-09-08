import { afterEach, describe, expect, it } from 'vitest';
import type { CredentialEnrollmentResponse, IdentityDirectoryResponse } from '@supermarket/shared';
import { buildApp } from '../app.ts';
import { ADMIN_PERMISSIONS, createSecurityRuntime, type SecurityRuntime } from '../runtime.ts';

/**
 * Contratos de administración de identidad sobre la composición real: el
 * servidor sigue siendo la autoridad y ninguna respuesta transporta un PIN.
 */
describe('identity HTTP contracts', () => {
  const runtimes: SecurityRuntime[] = [];
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const runtime of runtimes.splice(0)) if (runtime.handle.sqlite.open) runtime.handle.close();
  });

  const setup = async (options: {
    readonly permissions?: readonly string[];
    readonly coordinatorNodeId?: string;
  } = {}) => {
    const runtime = createSecurityRuntime(
      ':memory:',
      { terminalId: 'terminal-001', originNodeId: 'node-001' },
      {},
      options.coordinatorNodeId ?? null
    );
    runtimes.push(runtime);
    const provisioned = await runtime.provisionInitialAdmin.execute({
      operatorCode: 'OP001', displayName: 'Administrador', pin: '123456',
      permissions: options.permissions ?? ADMIN_PERMISSIONS
    });
    expect(provisioned.ok).toBe(true);
    const app = buildApp(runtime.dependencies);
    apps.push(app);
    return { app, runtime, cookie: await login(app, 'OP001', '123456') };
  };

  const login = async (
    app: ReturnType<typeof buildApp>, operatorCode: string, pin: string
  ): Promise<string> => {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/session', payload: { operatorCode, pin }
    });
    expect(response.statusCode, response.body).toBe(200);
    return String(response.headers['set-cookie']).split(';')[0]!;
  };

  it('creates an operator that exists without being able to sign in yet', async () => {
    const { app, cookie } = await setup();

    const created = await app.inject({
      method: 'POST', url: '/api/v1/identity/operators', headers: { cookie },
      payload: {
        operatorCode: 'op100', displayName: 'Cajera Nueva', roleIds: [], reason: 'Alta de cajera'
      }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      operatorCode: 'OP100', isActive: true, hasLocalCredential: false
    });
    const denied = await app.inject({
      method: 'POST', url: '/api/v1/auth/session',
      payload: { operatorCode: 'OP100', pin: '654321' }
    });
    expect(denied.statusCode).toBe(401);
  });

  it('enrolls the credential of a new operator without anyone else knowing the PIN', async () => {
    const { app, cookie } = await setup();
    const created = await app.inject({
      method: 'POST', url: '/api/v1/identity/operators', headers: { cookie },
      payload: { operatorCode: 'OP101', displayName: 'Cajera', roleIds: [], reason: 'Alta' }
    });
    expect(created.statusCode).toBe(201);

    const authorized = await app.inject({
      method: 'POST', url: '/api/v1/identity/credential-enrollments', headers: { cookie },
      payload: { operatorCode: 'OP101', reason: 'Primer ingreso' }
    });
    expect(authorized.statusCode).toBe(201);
    const ticket = authorized.json<CredentialEnrollmentResponse>();
    expect(ticket.replacesCredential).toBe(false);

    /** El consumo no exige sesión: el operador todavía no puede iniciar una. */
    const completed = await app.inject({
      method: 'POST', url: '/api/v1/auth/credential-enrollment',
      payload: { enrollmentToken: ticket.enrollmentToken, pin: '654321' }
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toEqual({ operatorCode: 'OP101' });

    const session = await login(app, 'OP101', '654321');
    expect(session).toContain('pos_session=');
    const replayed = await app.inject({
      method: 'POST', url: '/api/v1/auth/credential-enrollment',
      payload: { enrollmentToken: ticket.enrollmentToken, pin: '111111' }
    });
    expect(replayed.statusCode).toBe(409);
    expect(replayed.json()).toMatchObject({ code: 'IDENTITY_ENROLLMENT_CONSUMED' });
  });

  it('restricts a session whose credential must change to changing the PIN', async () => {
    const { app, cookie } = await setup();
    const created = await app.inject({
      method: 'POST', url: '/api/v1/identity/operators', headers: { cookie },
      payload: { operatorCode: 'OP102', displayName: 'Cajera', roleIds: [], reason: 'Alta' }
    });
    const userId = created.json<{ userId: string }>().userId;
    const authorized = await app.inject({
      method: 'POST', url: '/api/v1/identity/credential-enrollments', headers: { cookie },
      payload: { operatorCode: 'OP102', reason: 'Primer ingreso' }
    });
    await app.inject({
      method: 'POST', url: '/api/v1/auth/credential-enrollment',
      payload: {
        enrollmentToken: authorized.json<CredentialEnrollmentResponse>().enrollmentToken,
        pin: '654321'
      }
    });
    const expired = await app.inject({
      method: 'POST', url: `/api/v1/identity/operators/${userId}/credential-expiration`,
      headers: { cookie }, payload: { reason: 'Rotación' }
    });
    expect(expired.statusCode).toBe(204);

    const restricted = await login(app, 'OP102', '654321');
    const session = await app.inject({
      method: 'GET', url: '/api/v1/auth/session', headers: { cookie: restricted }
    });
    expect(session.json()).toMatchObject({ credentialMustChange: true });

    const blocked = await app.inject({
      method: 'GET', url: '/api/v1/catalog/products', headers: { cookie: restricted }
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: 'AUTH_PIN_CHANGE_REQUIRED' });

    const changed = await app.inject({
      method: 'PUT', url: '/api/v1/auth/pin', headers: { cookie: restricted },
      payload: { currentPin: '654321', newPin: '246810' }
    });
    expect(changed.statusCode).toBe(204);

    const allowed = await app.inject({
      method: 'GET', url: '/api/v1/catalog/products', headers: { cookie: restricted }
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('refuses identity administration on a terminal owned by a coordinator', async () => {
    const { app, cookie } = await setup({ coordinatorNodeId: 'coordinator-001' });

    const created = await app.inject({
      method: 'POST', url: '/api/v1/identity/operators', headers: { cookie },
      payload: { operatorCode: 'OP103', displayName: 'Cajera', roleIds: [], reason: 'Alta' }
    });

    expect(created.statusCode).toBe(409);
    expect(created.json()).toMatchObject({ code: 'IDENTITY_NOT_OWNED_BY_NODE' });
    /** El directorio publica la misma verdad que hace fallar al comando. */
    const directory = await app.inject({
      method: 'GET', url: '/api/v1/identity', headers: { cookie }
    });
    expect(directory.json<IdentityDirectoryResponse>().ownedByThisNode).toBe(false);
    /** El enrolamiento sí es local: la terminal conserva esa capacidad. */
    const enrollment = await app.inject({
      method: 'POST', url: '/api/v1/identity/credential-enrollments', headers: { cookie },
      payload: { operatorCode: 'OP001', reason: 'Reemplazo de credencial' }
    });
    expect(enrollment.statusCode).toBe(201);
  });

  it('refuses to leave the node without an administrator', async () => {
    const { app, runtime, cookie } = await setup();
    const directory = await app.inject({
      method: 'GET', url: '/api/v1/identity', headers: { cookie }
    });
    const { operators, roles, ownedByThisNode } = directory.json<IdentityDirectoryResponse>();
    expect(ownedByThisNode).toBe(true);
    const administrator = operators.find((operator) => operator.operatorCode === 'OP001');
    const adminRole = roles.find((role) => role.code === 'ADMIN');
    expect(administrator).toBeDefined();
    expect(adminRole).toBeDefined();

    const rejected = await app.inject({
      method: 'PUT', url: `/api/v1/identity/operators/${administrator!.userId}/status`,
      headers: { cookie }, payload: { isActive: false, reason: 'Baja del único administrador' }
    });

    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toMatchObject({ code: 'IDENTITY_LAST_ADMINISTRATOR' });
    expect(runtime.handle.sqlite.prepare(
      "select is_active from identity_users where operator_code = 'OP001'"
    ).pluck().get()).toBe(1);
    expect(runtime.handle.sqlite.prepare(
      "select count(*) from audit_log where action like '%_REJECTED'"
    ).pluck().get()).toBe(1);
  });

  it('revokes the live session of an operator whose authorization changes', async () => {
    const { app, cookie } = await setup();
    const created = await app.inject({
      method: 'POST', url: '/api/v1/identity/operators', headers: { cookie },
      payload: { operatorCode: 'OP104', displayName: 'Cajera', roleIds: [], reason: 'Alta' }
    });
    const userId = created.json<{ userId: string }>().userId;
    const authorized = await app.inject({
      method: 'POST', url: '/api/v1/identity/credential-enrollments', headers: { cookie },
      payload: { operatorCode: 'OP104', reason: 'Primer ingreso' }
    });
    await app.inject({
      method: 'POST', url: '/api/v1/auth/credential-enrollment',
      payload: {
        enrollmentToken: authorized.json<CredentialEnrollmentResponse>().enrollmentToken,
        pin: '654321'
      }
    });
    const cashier = await login(app, 'OP104', '654321');
    expect((await app.inject({
      method: 'GET', url: '/api/v1/auth/session', headers: { cookie: cashier }
    })).statusCode).toBe(200);

    const assigned = await app.inject({
      method: 'PUT', url: `/api/v1/identity/operators/${userId}/roles`,
      headers: { cookie }, payload: { roleIds: [], reason: 'Cambio de perfil' }
    });
    expect(assigned.statusCode).toBe(200);

    const afterChange = await app.inject({
      method: 'GET', url: '/api/v1/auth/session', headers: { cookie: cashier }
    });
    expect(afterChange.statusCode).toBe(401);
    expect(afterChange.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('denies identity administration to an operator without the identity permissions', async () => {
    const { app, cookie } = await setup({
      permissions: ADMIN_PERMISSIONS.filter((permission) => !permission.startsWith('identity.'))
    });

    for (const [method, url, payload] of [
      ['GET', '/api/v1/identity', undefined],
      ['POST', '/api/v1/identity/operators', {
        operatorCode: 'OP105', displayName: 'Cajera', roleIds: [], reason: 'Alta'
      }],
      ['POST', '/api/v1/identity/roles', {
        code: 'AUDITOR', name: 'Auditor', permissionCodes: [], reason: 'Rol nuevo'
      }],
      ['POST', '/api/v1/identity/credential-enrollments', {
        operatorCode: 'OP001', reason: 'Reemplazo'
      }]
    ] as const) {
      const response = await app.inject({
        method, url, headers: { cookie }, ...(payload ? { payload } : {})
      });
      expect(response.statusCode, url).toBe(403);
      expect(response.json(), url).toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('keeps every PIN out of the identity responses', async () => {
    const { app, cookie } = await setup();
    const authorized = await app.inject({
      method: 'POST', url: '/api/v1/identity/credential-enrollments', headers: { cookie },
      payload: { operatorCode: 'OP001', reason: 'Reemplazo de credencial' }
    });
    const ticket = authorized.json<CredentialEnrollmentResponse>();
    const completed = await app.inject({
      method: 'POST', url: '/api/v1/auth/credential-enrollment',
      payload: { enrollmentToken: ticket.enrollmentToken, pin: '135790' }
    });
    const directory = await app.inject({
      method: 'GET', url: '/api/v1/identity', headers: { cookie }
    });

    expect(completed.statusCode).toBe(200);
    for (const body of [authorized.body, completed.body, directory.body]) {
      expect(body).not.toContain('135790');
      expect(body).not.toContain('123456');
      expect(body).not.toContain('scrypt');
    }
  });
});
