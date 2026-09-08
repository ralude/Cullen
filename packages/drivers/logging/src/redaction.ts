/**
 * Redacción de logs técnicos.
 *
 * ADR-0006 exige redacción de secretos y `docs/architecture/10-logs.md` fija la
 * lista de datos que nunca se registran. La redacción de este módulo actúa por
 * nombre de campo y no por posición: un campo nuevo llamado `pin`, `token` o
 * `cardNumber` queda censurado sin tocar la configuración del logger, esté
 * donde esté dentro del objeto registrado.
 *
 * El módulo no decide qué se registra —eso pertenece a quien compone el
 * logger—, solo garantiza que lo registrado no arrastre un secreto.
 */

export const REDACTION_CENSOR = '[REDACTED]';

/**
 * Nombres que describen un secreto. Se comparan por palabra, después de
 * separar `camelCase`, `snake_case` y `kebab-case`, de modo que `pinHash`,
 * `pin_hash` y `PIN` coinciden mientras `spinner` o `shipping` no.
 */
const SENSITIVE_WORDS: ReadonlySet<string> = new Set([
  'password', 'passwords', 'passphrase',
  'pin', 'pins',
  'token', 'tokens',
  'secret', 'secrets',
  'credential', 'credentials',
  'authorization',
  'cookie', 'cookies',
  'key', 'keys', 'apikey', 'privatekey',
  'card', 'pan', 'cvv', 'cvc',
  'otp'
]);

/**
 * Nombres sensibles solo cuando son el campo completo. `hash` suelto puede ser
 * un secreto; `eventHash` es un identificador técnico que sirve para
 * diagnosticar.
 */
const SENSITIVE_NAMES: ReadonlySet<string> = new Set([
  'hash', 'auth', 'signature', 'certificate'
]);

const STABLE_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

/**
 * Asignaciones dentro de un texto libre: `pin=1234`, `"token": "abc"`. Es la
 * forma en que un secreto llega al mensaje de un error de infraestructura. El
 * censor es una alternativa explícita del valor para que redactar un texto ya
 * redactado no lo vuelva a envolver.
 */
const TEXT_ASSIGNMENT = new RegExp(
  `(["']?)([A-Za-z0-9_.-]+)\\1(\\s*[:=]\\s*)(${
    REDACTION_CENSOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }|"[^"]*"|'[^']*'|[^\\s,;)}\\]]+)`,
  'g'
);

const wordsOf = (name: string): readonly string[] => name
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .split(/[^A-Za-z0-9]+/)
  .filter((word) => word.length > 0)
  .map((word) => word.toLowerCase());

export const isSensitiveFieldName = (name: string): boolean => {
  const normalized = name.replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
  if (SENSITIVE_NAMES.has(normalized)) return true;
  return wordsOf(name).some((word) => SENSITIVE_WORDS.has(word));
};

/**
 * Censura el valor de una asignación sensible dentro de un texto. Conserva el
 * resto del mensaje, que es lo que sirve para diagnosticar.
 */
export const redactText = (text: string): string => text.replace(
  TEXT_ASSIGNMENT,
  (match, quote: string, name: string, separator: string, value: string) => (
    isSensitiveFieldName(name) && value !== REDACTION_CENSOR
      ? `${quote}${name}${quote}${separator}${REDACTION_CENSOR}`
      : match
  )
);

export type SafeErrorDescription = {
  readonly type: string;
  readonly code?: string;
  readonly message: string;
  readonly stack?: string;
  readonly cause?: unknown;
};

const isPlainObject = (value: object): value is Record<string, unknown> => {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const redact = (value: unknown, path: Set<object>): unknown => {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return describe(value, path);
  /**
   * Solo se recorren objetos planos y arreglos, que son la forma que produce
   * este nodo al construir una línea de log. Un objeto de clase —una petición
   * Fastify, un socket— llega intacto al serializador de Pino, que lo cura, y
   * sus cabeceras sensibles las cubre la lista de rutas del logger.
   */
  if (!Array.isArray(value) && !isPlainObject(value)) return value;
  if (path.has(value)) return '[CIRCULAR]';
  path.add(value);
  const result = Array.isArray(value)
    ? value.map((entry) => redact(entry, path))
    : Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveFieldName(key) ? REDACTION_CENSOR : redact(entry, path)
    ]));
  path.delete(value);
  return result;
};

const describe = (error: unknown, path: Set<object>): SafeErrorDescription => {
  if (!(error instanceof Error)) {
    return { type: typeof error, message: redactText(String(error)) };
  }
  if (path.has(error)) return { type: error.name, message: '[CIRCULAR]' };
  path.add(error);
  const code: unknown = (error as { readonly code?: unknown }).code;
  const cause: unknown = error.cause;
  const description: SafeErrorDescription = {
    type: error.name,
    ...(typeof code === 'string' && STABLE_ERROR_CODE.test(code) ? { code } : {}),
    message: redactText(error.message),
    /**
     * El stack se conserva para diagnóstico local y nunca sale al cliente,
     * como ya garantiza la respuesta `application/problem+json`. Se redacta
     * porque su primera línea repite el mensaje del error.
     */
    ...(typeof error.stack === 'string' ? { stack: redactText(error.stack) } : {}),
    ...(cause === undefined ? {} : { cause: redact(cause, path) })
  };
  path.delete(error);
  return description;
};

/**
 * Describe un error sin registrarlo crudo: tipo, código estable cuando existe,
 * mensaje seguro y la cadena de causas ya redactada.
 */
export const describeError = (error: unknown): SafeErrorDescription => describe(error, new Set());

/** Redacta cualquier valor destinado a un log técnico. */
export const redactValue = (value: unknown): unknown => redact(value, new Set());

/**
 * Rutas que Pino censura por posición. Cubren las cabeceras que el propio
 * framework puede registrar y que no pasan por el formateador.
 */
const DEFAULT_REDACTED_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers.set-cookie'
];

/**
 * Forma que espera Pino. Los campos quedan mutables a propósito: el tipo debe
 * coincidir con las opciones del logger para que Fastify resuelva su firma.
 */
export type RedactionLoggerOptions = {
  redact: { paths: string[]; censor: string };
  formatters: { log: (entry: Record<string, unknown>) => Record<string, unknown> };
};

/**
 * Configuración de redacción reutilizable para un logger Pino. `additionalPaths`
 * agrega censuras por posición propias de un transporte concreto.
 */
export const createRedactionOptions = (
  additionalPaths: readonly string[] = []
): RedactionLoggerOptions => ({
  redact: { paths: [...DEFAULT_REDACTED_PATHS, ...additionalPaths], censor: REDACTION_CENSOR },
  formatters: {
    log: (entry: Record<string, unknown>): Record<string, unknown> =>
      redact(entry, new Set()) as Record<string, unknown>
  }
});
