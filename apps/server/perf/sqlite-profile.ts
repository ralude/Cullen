/**
 * Conteo de sentencias y tiempo dentro de SQLite, para 12.03.
 *
 * 12.01 dejó esta brecha declarada y la asignó aquí: el driver no expone un
 * hook de perfilado, y contar sentencias exige interceptar la preparación. Por
 * eso el instrumento es **opt-in y corre en su propia serie**: activarlo dentro
 * de la serie de latencia contaminaría el número que esa serie publica.
 *
 * Intercepta `prepare` sobre el mismo objeto `Database` que usan tanto Drizzle
 * como las consultas directas, así que ve todo lo que el nodo ejecuta. Registra
 * únicamente el SQL preparado —con sus marcadores, nunca los valores, que
 * viajan aparte en `run`, `get`, `all` e `iterate`— y su duración.
 */
import { performance } from 'node:perf_hooks';

export type SqliteProfile = {
  readonly statements: number;
  readonly totalMs: number;
  readonly byStatement: readonly {
    readonly sql: string;
    readonly count: number;
    readonly ms: number;
  }[];
};

/** Un SQL larguísimo vuelve el artefacto ilegible sin aportar nada decidible. */
const SQL_LIMIT = 200;

const shorten = (sql: string): string => {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length <= SQL_LIMIT ? flat : flat.slice(0, SQL_LIMIT) + '…';
};

type Runner = (...parameters: readonly unknown[]) => unknown;

type Preparable = {
  prepare: (sql: string) => Record<string, unknown>;
};

/**
 * Envuelve `prepare` y los métodos que ejecutan. Devuelve el informe y la
 * función que restaura el original: el arnés lo deja como estaba al cerrar.
 */
export const profileSqlite = (handle: { readonly sqlite: unknown }): {
  readonly report: () => SqliteProfile;
  readonly restore: () => void;
} => {
  const database = handle.sqlite as Preparable;
  const original = database.prepare.bind(database);
  const counts = new Map<string, { count: number; ms: number }>();

  const record = (sql: string, elapsed: number): void => {
    const key = shorten(sql);
    const bucket = counts.get(key) ?? { count: 0, ms: 0 };
    bucket.count += 1;
    bucket.ms += elapsed;
    counts.set(key, bucket);
  };

  database.prepare = (sql: string): Record<string, unknown> => {
    const statement = original(sql);
    /**
     * `pluck` y `raw` quedan fuera: configuran y devuelven el mismo statement
     * para encadenar, así que no ejecutan nada y conservan estos envoltorios.
     */
    for (const method of ['run', 'get', 'all', 'iterate'] as const) {
      const existing = statement[method];
      if (typeof existing !== 'function') continue;
      const runner = existing.bind(statement) as Runner;
      statement[method] = (...parameters: readonly unknown[]): unknown => {
        const started = performance.now();
        try {
          return runner(...parameters);
        } finally {
          record(sql, performance.now() - started);
        }
      };
    }
    return statement;
  };

  return {
    report: (): SqliteProfile => {
      const entries = [...counts.entries()]
        .map(([sql, bucket]) => ({
          sql,
          count: bucket.count,
          ms: Number(bucket.ms.toFixed(3))
        }))
        .sort((left, right) => right.ms - left.ms);
      return {
        statements: entries.reduce((total, { count }) => total + count, 0),
        totalMs: Number(entries.reduce((total, { ms }) => total + ms, 0).toFixed(3)),
        byStatement: entries
      };
    },
    restore: (): void => { database.prepare = original; }
  };
};
