import { ApplicationError } from '@supermarket/shared';

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Transporte de la API de operadores. Es el único lugar donde se decide dónde
 * escucha y con qué política viaja la sesión, para que emisión y borrado no
 * puedan divergir.
 */
export const OPERATOR_SESSION_COOKIE = 'pos_session';

/** Ventana absoluta de la sesión (ADR-0011): ocho horas. */
const SESSION_MAX_AGE_SECONDS = 28_800;

const LOOPBACK_HOSTS = new Set(['localhost', '::1', '[::1]']);

const isLoopback = (host: string): boolean =>
  LOOPBACK_HOSTS.has(host.toLowerCase()) || /^127(?:\.\d{1,3}){3}$/.test(host);

/**
 * Host de la API de operadores. `apps/server/AGENTS.md` y
 * [ADR-0026](../../../docs/architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md) D1
 * obligan a loopback: las operaciones no se exponen en LAN. Disponer de material
 * TLS para la sincronización no habilita una excepción, porque ese es otro
 * transporte, con otro puerto y otra autoridad.
 *
 * Falla cerrado antes de abrir ningún listener y sin repetir el valor recibido:
 * el mensaje público de un error de arranque no describe la configuración.
 */
export const resolveOperatorHost = (environment: Environment = process.env): string => {
  const declared = environment.SERVER_HOST?.trim();
  if (declared === undefined || declared.length === 0) return '127.0.0.1';
  if (!isLoopback(declared)) {
    throw new ApplicationError(
      'SERVER_HOST_NOT_LOOPBACK',
      'The operator API only listens on loopback.'
    );
  }
  return declared;
};

/**
 * Atributos de la cookie de sesión. `HttpOnly` mantiene el token fuera del
 * renderer, `SameSite=Strict` impide que otro origen la envíe y `Path` la limita
 * a la API.
 *
 * `Secure` se deriva del transporte permitido y no de una variable: el único
 * transporte de esta API es loopback HTTP —lo impone `resolveOperatorHost`—, y
 * un navegador descarta una cookie `Secure` recibida por HTTP, de modo que
 * marcarla dejaría la estación sin sesión. ADR-0011 lo declara como decisión.
 * Si algún día se permitiera un transporte TLS para operadores, este es el
 * único punto donde derivarlo.
 */
const attributes = (maxAgeSeconds: number): string =>
  `HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=${maxAgeSeconds}`;

export const sessionCookie = (token: string): string =>
  `${OPERATOR_SESSION_COOKIE}=${encodeURIComponent(token)}; ${attributes(SESSION_MAX_AGE_SECONDS)}`;

/** Borrado: misma cookie, mismo path y misma protección, sin valor. */
export const expiredSessionCookie = (): string =>
  `${OPERATOR_SESSION_COOKIE}=; ${attributes(0)}`;

/**
 * Token presentado por la petición, o cadena vacía si no hay uno utilizable.
 *
 * Una cookie mal formada —`pos_session=%`— hace que `decodeURIComponent` lance
 * `URIError`. Eso es una credencial inválida, no un fallo del servidor: se
 * trata como ausencia de sesión para que la respuesta sea 401 y no 500, sin
 * distinguir públicamente entre no presentar sesión, presentarla ilegible o
 * presentar una desconocida.
 */
export const sessionTokenOf = (header: string | undefined): string => {
  const cookie = header?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${OPERATOR_SESSION_COOKIE}=`));
  if (cookie === undefined) return '';
  try {
    return decodeURIComponent(cookie.slice(OPERATOR_SESSION_COOKIE.length + 1));
  } catch {
    return '';
  }
};
