import { afterEach, describe, expect, it } from 'vitest';
import { AuthenticateOperator, type PinHasher } from '@supermarket/core';
import { applyMigrations } from './migrations.js';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { SqliteAuthenticationStore, SqliteAuthorizationService } from './authentication-store.js';

/**
 * Vigencia de las concesiones en la terminal (ADR-0026 D5).
 *
 * La concesión gobierna cuando existe: vencida o revocada deniega sesión nueva,
 * invalida la sesión viva y deniega una acción protegida, **además** de los
 * límites idle y absoluto de ADR-0011, que no se sustituyen.
 *
 * Un nodo sin concesión —el caso standalone— conserva su autorización local.
 */

const ISSUED_AT = new Date('2026-09-06T10:00:00.000Z');
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const EXPIRES_AT = new Date(ISSUED_AT.getTime() + EIGHT_HOURS_MS);

/** Verificador de PIN de prueba: el hash real pertenece al driver de seguridad. */
const pinHasher: PinHasher = {
  hash: async (pin) => `encoded:${pin}`,
  verify: async (pin, encodedHash) => encodedHash === `encoded:${pin}`,
  verifyDummy: async () => undefined
};

const tokenService = {
  generate: () => ({ raw: 'raw-token', hash: 'token-hash' }),
  hash: (raw: string) => raw === 'raw-token' ? 'token-hash' : `other:${raw}`
};

describe('vigencia de las concesiones de operador', () => {
  const handles: DatabaseHandle[] = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.close();
  });

  const setup = async () => {
    const handle = openDatabase(':memory:');
    handles.push(handle);
    applyMigrations(handle.sqlite);
    const store = new SqliteAuthenticationStore(handle);
    await store.provisionInitialAdmin({
      userId: 'user-local-001', roleId: 'role-admin', operatorCode: 'CAJA01',
      displayName: 'Operador local', pinHash: 'encoded:123456',
      permissions: ['sale.void'], now: ISSUED_AT
    });
    return { handle, store };
  };

  /**
   * La concesión llega por la proyección de referencias, con el `userId` del
   * coordinador: la unión con el usuario local es el código de operador.
   */
  const projectGrant = (handle: DatabaseHandle, overrides: {
    readonly isActive?: number;
    readonly permissionCodes?: readonly string[];
    readonly expiresAt?: Date;
    readonly version?: number;
  } = {}): void => {
    handle.sqlite.prepare(`
      insert into identity_operator_grant (
        user_id, operator_code, display_name, role_codes, permission_codes,
        is_active, version, expires_at, published_by, published_at, applied_at
      ) values (?, 'CAJA01', 'Cajera 1', ?, ?, ?, ?, ?, 'node-coordinator', ?, ?)
      on conflict(user_id) do update set
        permission_codes = excluded.permission_codes,
        is_active = excluded.is_active,
        version = excluded.version,
        expires_at = excluded.expires_at
    `).run(
      'user-coordinator-001',
      JSON.stringify(['CASHIER']),
      JSON.stringify([...(overrides.permissionCodes ?? ['sale.void'])]),
      overrides.isActive ?? 1,
      overrides.version ?? 1,
      (overrides.expiresAt ?? EXPIRES_AT).getTime(),
      ISSUED_AT.getTime(),
      ISSUED_AT.getTime()
    );
  };

  const authenticate = (store: SqliteAuthenticationStore, now: Date) =>
    new AuthenticateOperator(store, pinHasher, tokenService, { now: () => now }).execute({
      operatorCode: 'CAJA01', pin: '123456',
      terminalId: 'terminal-001', originNodeId: 'node-terminal-1'
    });

  it('sin concesión conserva la autorización local del nodo standalone', async () => {
    const { store } = await setup();

    const session = await authenticate(store, ISSUED_AT);
    expect(session.ok).toBe(true);
    await expect(new SqliteAuthorizationService(store, { now: () => ISSUED_AT }).authorize({
      actorId: 'user-local-001', terminalId: 'terminal-001',
      originNodeId: 'node-terminal-1', correlationId: 'correlation-001'
    }, 'sale.void')).resolves.toBe(true);
  });

  it('con concesión vigente autoriza por el conjunto que publicó el coordinador', async () => {
    const { handle, store } = await setup();
    projectGrant(handle, { permissionCodes: ['sales.complete'] });
    const authorization = new SqliteAuthorizationService(store, { now: () => ISSUED_AT });
    const context = {
      actorId: 'user-local-001', terminalId: 'terminal-001',
      originNodeId: 'node-terminal-1', correlationId: 'correlation-001'
    };

    /** El permiso local ya no basta: manda la concesión. */
    await expect(authorization.authorize(context, 'sale.void')).resolves.toBe(false);
    await expect(authorization.authorize(context, 'sales.complete')).resolves.toBe(true);

    const session = await authenticate(store, ISSUED_AT);
    expect(session.ok && session.value.principal).toMatchObject({
      roleCodes: ['CASHIER'], permissionCodes: ['sales.complete']
    });
  });

  it('una concesión vencida deniega la sesión nueva aunque el PIN sea correcto', async () => {
    const { handle, store } = await setup();
    projectGrant(handle);

    const result = await authenticate(store, new Date(EXPIRES_AT.getTime() + 1));

    expect(result.ok ? null : result.error.code).toBe('AUTH_GRANT_UNAVAILABLE');
    expect(handle.sqlite.prepare('select count(*) from auth_sessions').pluck().get()).toBe(0);
    /** El intento no se cuenta como PIN incorrecto: no hay bloqueo por reintentos. */
    expect(handle.sqlite.prepare(
      'select count(*) from auth_lockouts where failed_count > 0'
    ).pluck().get()).toBe(0);
  });

  it('una concesión revocada deniega igual que una vencida y conserva su fila', async () => {
    const { handle, store } = await setup();
    projectGrant(handle, { isActive: 0 });

    const result = await authenticate(store, ISSUED_AT);

    expect(result.ok ? null : result.error.code).toBe('AUTH_GRANT_UNAVAILABLE');
    expect(handle.sqlite.prepare(
      'select count(*) from identity_operator_grant'
    ).pluck().get()).toBe(1);
  });

  it('no revela un operador inexistente con el código de concesión', async () => {
    const { store } = await setup();
    const denied = await new AuthenticateOperator(
      store, pinHasher, tokenService, { now: () => ISSUED_AT }
    ).execute({
      operatorCode: 'NOEXISTE', pin: '123456',
      terminalId: 'terminal-001', originNodeId: 'node-terminal-1'
    });

    expect(denied.ok ? null : denied.error.code).toBe('AUTHENTICATION_FAILED');
  });

  it('vence la sesión viva al expirar la concesión, dentro de los límites de ADR-0011', async () => {
    const { handle, store } = await setup();
    /**
     * Concesión corta a propósito: al vencer, la sesión sigue dentro de sus
     * treinta minutos idle y de sus ocho horas absolutas de ADR-0011, así que
     * lo único que la invalida es la concesión.
     */
    const grantExpiry = new Date(ISSUED_AT.getTime() + 10 * 60_000);
    projectGrant(handle, { expiresAt: grantExpiry });
    const session = await authenticate(store, ISSUED_AT);
    expect(session.ok).toBe(true);

    const before = new Date(grantExpiry.getTime() - 60_000);
    await expect(store.verifyAndTouchSession('token-hash', before)).resolves.toMatchObject({
      actorId: 'user-local-001'
    });

    const after = new Date(grantExpiry.getTime() + 1);
    await expect(store.verifyAndTouchSession('token-hash', after)).resolves.toBeNull();
    expect(handle.sqlite.prepare(
      'select revoked_at as revokedAt from auth_sessions where token_hash = ?'
    ).get('token-hash')).toEqual({ revokedAt: after.getTime() });
  });

  it('atrasar el reloj no amplía la ventana ya vencida de una concesión nueva', async () => {
    const { handle, store } = await setup();
    /** Concesión posterior, emitida y vencida antes del instante que se evalúa. */
    projectGrant(handle, {
      version: 2,
      expiresAt: new Date(ISSUED_AT.getTime() - 60_000)
    });

    const denied = await authenticate(store, ISSUED_AT);
    expect(denied.ok ? null : denied.error.code).toBe('AUTH_GRANT_UNAVAILABLE');

    /** Retroceder el reloj del nodo no la vuelve utilizable a futuro. */
    const rewound = new Date(ISSUED_AT.getTime() - 3_600_000);
    await expect(new SqliteAuthorizationService(store, { now: () => rewound }).authorize({
      actorId: 'user-local-001', terminalId: 'terminal-001',
      originNodeId: 'node-terminal-1', correlationId: 'correlation-001'
    }, 'sale.void')).resolves.toBe(false);
  });
});
