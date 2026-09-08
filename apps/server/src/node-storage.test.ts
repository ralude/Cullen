import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '@supermarket/shared';
import { openDatabase } from '@supermarket/driver-db';
import { migrateNodeDatabase, readNodeStorage } from './node-storage.ts';

/**
 * Arranque recuperable del nodo (11.04, corte 2).
 *
 * La transacción de una migración no sustituye la recuperación de una
 * actualización completa: el arranque real tiene que pasar por la ruta con
 * respaldo, validación y restauración, y negarse a servir si no puede
 * respaldar. ADR-0029 D8 fija la retención en cinco copias y nunca menos de una.
 */
describe('almacenamiento del nodo', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  const temporary = (): string => {
    const directory = mkdtempSync(join(tmpdir(), 'cullen-storage-'));
    directories.push(directory);
    return directory;
  };

  it('deriva rutas y retención con los valores normativos por omisión', () => {
    const directory = temporary();
    const storage = readNodeStorage({ DATABASE_PATH: join(directory, 'node.sqlite') });

    expect(storage.databasePath).toBe(join(directory, 'node.sqlite'));
    expect(storage.backupDirectory).toBe(join(directory, 'backups'));
    expect(storage.backupRetention).toBe(5);
  });

  it('acepta un directorio y una retención declarados, y nunca menos de una copia', () => {
    const directory = temporary();
    const storage = readNodeStorage({
      DATABASE_PATH: join(directory, 'node.sqlite'),
      DATABASE_BACKUP_PATH: join(directory, 'custom'),
      DATABASE_BACKUP_RETENTION: '2'
    });
    expect(storage.backupDirectory).toBe(join(directory, 'custom'));
    expect(storage.backupRetention).toBe(2);

    for (const retention of ['0', '-1', 'muchas', '']) {
      let thrown: unknown;
      try {
        readNodeStorage({
          DATABASE_PATH: join(directory, 'node.sqlite'), DATABASE_BACKUP_RETENTION: retention
        });
      } catch (error) { thrown = error; }
      expect((thrown as AppError).code, retention).toBe('DATABASE_BACKUP_RETENTION_INVALID');
    }
  });

  it('migra una base nueva sin respaldo y respalda la siguiente actualización', () => {
    const directory = temporary();
    const storage = readNodeStorage({ DATABASE_PATH: join(directory, 'node.sqlite') });

    const created = migrateNodeDatabase(storage);
    expect(created.appliedVersions.length).toBeGreaterThan(0);
    expect(created.backupPath).toBeUndefined();

    const again = migrateNodeDatabase(storage);
    expect(again.appliedVersions).toEqual([]);
    expect(again.backupPath).toBeDefined();

    /** El respaldo se abre y se valida por su cuenta: existir no basta. */
    const backup = openDatabase(again.backupPath!);
    try {
      expect(backup.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(backup.sqlite.prepare(
        "select count(*) from sqlite_master where name = 'identity_users'"
      ).pluck().get()).toBe(1);
    } finally {
      backup.close();
    }
  });

  it('purga por retención sin quedarse nunca sin copias', () => {
    const directory = temporary();
    const storage = readNodeStorage({
      DATABASE_PATH: join(directory, 'node.sqlite'), DATABASE_BACKUP_RETENTION: '2'
    });
    for (let attempt = 0; attempt < 5; attempt += 1) migrateNodeDatabase(storage);

    const backups = readdirSync(storage.backupDirectory);
    expect(backups.length).toBeGreaterThanOrEqual(1);
    expect(backups.length).toBeLessThanOrEqual(2);
  });

  it('aborta cuando el directorio de respaldos no se puede escribir', () => {
    const directory = temporary();
    /** Un archivo donde debería ir el directorio: no hay dónde respaldar. */
    writeFileSync(join(directory, 'backups'), 'no soy un directorio');
    const storage = readNodeStorage({ DATABASE_PATH: join(directory, 'node.sqlite') });

    let thrown: unknown;
    try { migrateNodeDatabase(storage); } catch (error) { thrown = error; }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('DATABASE_BACKUP_DIRECTORY_UNWRITABLE');
    /** El mensaje público no describe la ruta ni el error del sistema. */
    expect((thrown as AppError).message).not.toMatch(/[\\/]/);
  });

  it('restaura y aborta cuando la actualización deja la base inválida', () => {
    const directory = temporary();
    const storage = readNodeStorage({ DATABASE_PATH: join(directory, 'node.sqlite') });
    migrateNodeDatabase(storage);

    const seeded = openDatabase(storage.databasePath);
    seeded.sqlite.prepare('insert into categories (id, name, is_active) values (?, ?, ?)')
      .run('category-001', 'Café', 1);
    seeded.close();

    let thrown: unknown;
    try {
      migrateNodeDatabase(storage, {
        validate: () => { throw new Error('validación inyectada'); }
      });
    } catch (error) { thrown = error; }

    expect((thrown as AppError).code).toBe('DATABASE_MIGRATION_VALIDATION_FAILED');
    expect((thrown as AppError).message).not.toMatch(/[\\/]/);

    /** La base quedó íntegra y con su contenido: el nodo puede volver a abrir. */
    const restored = openDatabase(storage.databasePath);
    try {
      expect(restored.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(restored.sqlite.prepare('select name from categories where id = ?')
        .pluck().get('category-001')).toBe('Café');
    } finally {
      restored.close();
    }
  });

  it('deja el directorio de respaldos creado si no existía', () => {
    const directory = temporary();
    const storage = readNodeStorage({
      DATABASE_PATH: join(directory, 'node.sqlite'),
      DATABASE_BACKUP_PATH: join(directory, 'nested', 'backups')
    });
    mkdirSync(join(directory, 'nested'), { recursive: true });
    migrateNodeDatabase(storage);
    expect(readdirSync(join(directory, 'nested'))).toContain('backups');
  });
});
