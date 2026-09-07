/**
 * Representación JSON serializable compartida por los contratos transversales.
 * Vive en `shared` porque el sobre de sincronización y el ledger de negocio
 * describen el mismo valor de cable; duplicar el tipo permitiría que ambos
 * lados divergieran en silencio.
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | {
  readonly [key: string]: JsonValue;
};

export type JsonObject = { readonly [key: string]: JsonValue };

/**
 * Serializa con claves ordenadas para comparar dos hechos por contenido.
 * El orden de las claves de un objeto no distingue dos JSON equivalentes, pero
 * el orden de un arreglo sí es parte del hecho y se conserva.
 */
export const canonicalJson = (value: JsonValue): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`);
  return `{${entries.join(',')}}`;
};
