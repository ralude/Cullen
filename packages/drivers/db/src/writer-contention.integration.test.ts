/**
 * Escenario 6 de 12.03: competir por el writer de forma controlada.
 *
 * `sync-reception.integration.test.ts` ya cubre la contención en el camino de
 * recepción, donde el fallo se traduce a `SYNC_RECEIVER_UNAVAILABLE`. Aquí se
 * fija el camino general: qué código sale, qué queda escrito y si el nodo puede
 * seguir trabajando cuando el otro writer suelta el archivo.
 *
 * El bloqueo se fuerza con `busy_timeout = 0` para no esperar los cinco
 * segundos que fija `connection.ts` —esa espera la cubre `connection.test.ts`—:
 * lo que se prueba aquí es la traducción, la ausencia de trabajo parcial y la
 * recuperación, no la duración de la espera. Tampoco se introduce reintento:
 * FS-004 conserva esa brecha hasta que su dueño se acuerde explícitamente.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { Category } from '@supermarket/core';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleCategoryRepository } from './catalog-repositories.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

const directories: string[] = [];
const handles: DatabaseHandle[] = [];
const blockers: Database.Database[] = [];

afterEach(() => {
  for (const blocker of blockers.splice(0)) {
    if (blocker.inTransaction) blocker.exec('rollback');
    blocker.close();
  }
  for (const handle of handles.splice(0)) if (handle.sqlite.open) handle.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Un nodo con su archivo y un segundo writer que compite por él. */
const openContended = (): { handle: DatabaseHandle; blocker: Database.Database } => {
  const directory = mkdtempSync(join(tmpdir(), 'writer-contention-'));
  directories.push(directory);
  const handle = openDatabase(join(directory, 'node.sqlite'));
  handles.push(handle);
  applyMigrations(handle.sqlite);
  const blocker = new Database(join(directory, 'node.sqlite'));
  blockers.push(blocker);
  handle.sqlite.pragma('busy_timeout = 0');
  blocker.pragma('busy_timeout = 0');
  return { handle, blocker };
};

const categories = (handle: DatabaseHandle): number =>
  Number(handle.sqlite.prepare('select count(*) from categories').pluck().get() ?? 0);

const save = (handle: DatabaseHandle, id: string): Promise<void> =>
  new SqliteUnitOfWork(handle.sqlite).execute(async () => {
    await new DrizzleCategoryRepository(handle).save(Category.create({ id, name: 'Víveres' }));
  });

describe('competencia por el writer de SQLite', () => {
  it('traduce el lock a DATABASE_BUSY sin dejar trabajo parcial', async () => {
    const { handle, blocker } = openContended();
    blocker.exec('begin immediate');

    await expect(save(handle, 'category-001')).rejects.toMatchObject({ code: 'DATABASE_BUSY' });

    expect(categories(handle)).toBe(0);
    /** Ni éxito falso ni transacción colgada: el nodo queda fuera de transacción. */
    expect(handle.sqlite.inTransaction).toBe(false);
  });

  it('vuelve a escribir en cuanto el otro writer suelta el archivo', async () => {
    const { handle, blocker } = openContended();
    blocker.exec('begin immediate');
    await expect(save(handle, 'category-001')).rejects.toMatchObject({ code: 'DATABASE_BUSY' });

    blocker.exec('rollback');
    await save(handle, 'category-001');

    expect(categories(handle)).toBe(1);
  });

  it('no bloquea la lectura mientras el otro writer tiene el archivo', async () => {
    const { handle, blocker } = openContended();
    await save(handle, 'category-001');
    blocker.exec('begin immediate');

    /** WAL: un writer no detiene a los lectores, y por eso la caja sigue consultando. */
    expect(categories(handle)).toBe(1);
  });

  it('conserva lo que el otro writer confirmó y no lo sobrescribe', async () => {
    const { handle, blocker } = openContended();
    blocker.exec('begin immediate');
    blocker.prepare('insert into categories ("id", "name", "is_active") values (?, ?, ?)')
      .run('category-remote', 'Bebidas', 1);
    await expect(save(handle, 'category-001')).rejects.toMatchObject({ code: 'DATABASE_BUSY' });
    blocker.exec('commit');

    await save(handle, 'category-001');

    expect(categories(handle)).toBe(2);
  });
});
