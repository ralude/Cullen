import { describe, expect, it } from 'vitest';
import { AppError } from '@supermarket/shared';
import {
  OPERATOR_SESSION_COOKIE,
  expiredSessionCookie,
  resolveOperatorHost,
  sessionCookie
} from './session-transport.ts';

/**
 * Transporte de la API de operadores (11.03, cortes 1 y 2).
 *
 * El loopback no es un valor por omisión afortunado sino una obligación de
 * `apps/server/AGENTS.md` y ADR-0026 D1: una variable de entorno no puede
 * exponer las operaciones en LAN, y tener TLS para sincronización no cambia esa
 * regla porque es otro transporte, otro puerto y otra autoridad.
 */
describe('host de la API de operadores', () => {
  it('conserva el loopback actual cuando no se declara host', () => {
    expect(resolveOperatorHost({})).toBe('127.0.0.1');
    expect(resolveOperatorHost({ SERVER_HOST: '   ' })).toBe('127.0.0.1');
  });

  it.each(['127.0.0.1', 'localhost', '::1', '127.0.0.5'])('acepta %s', (host) => {
    expect(resolveOperatorHost({ SERVER_HOST: host })).toBe(host);
  });

  it.each([
    '0.0.0.0', '::', '192.168.1.10', 'lan.tienda.local', '127.0.0.1.attacker.example'
  ])('rechaza %s con un código estable', (host) => {
    let thrown: unknown;
    try { resolveOperatorHost({ SERVER_HOST: host }); } catch (error) { thrown = error; }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('SERVER_HOST_NOT_LOOPBACK');
    /** El mensaje público no repite el valor recibido ni sugiere cómo evadirlo. */
    expect((thrown as AppError).message).not.toContain(host);
  });

  it('rechaza igual aunque el nodo tenga material TLS de sincronización', () => {
    expect(() => resolveOperatorHost({
      SERVER_HOST: '0.0.0.0',
      SYNC_LISTENER_PORT: '8443',
      SYNC_LISTENER_TLS_KEY_PATH: 'key.pem',
      SYNC_LISTENER_TLS_CERT_PATH: 'cert.pem',
      SYNC_LISTENER_TLS_CLIENT_CA_PATHS: 'ca.pem'
    })).toThrow(AppError);
  });
});

describe('cookie de sesión', () => {
  it('emite y borra la misma cookie con la misma política', () => {
    const issued = sessionCookie('token-abc');
    const cleared = expiredSessionCookie();

    for (const value of [issued, cleared]) {
      expect(value.startsWith(`${OPERATOR_SESSION_COOKIE}=`)).toBe(true);
      expect(value).toContain('HttpOnly');
      expect(value).toContain('SameSite=Strict');
      expect(value).toContain('Path=/api/v1');
    }
    expect(issued).toContain('Max-Age=28800');
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).not.toContain('token-abc');
  });

  it('codifica el token para que no pueda inyectar atributos', () => {
    expect(sessionCookie('a b;Path=/')).toContain('pos_session=a%20b%3BPath%3D%2F;');
  });

  /**
   * `Secure` se deriva del transporte permitido, no de una variable: el único
   * transporte de la API de operadores es loopback HTTP, donde el navegador
   * descartaría una cookie `Secure` y la sesión dejaría de funcionar. ADR-0011
   * lo declara como decisión y no como olvido.
   */
  it('no marca Secure sobre el único transporte permitido', () => {
    expect(sessionCookie('token-abc')).not.toContain('Secure');
    expect(expiredSessionCookie()).not.toContain('Secure');
  });
});
