import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from './connection.js';

/**
 * Respaldo de la base del nodo.
 *
 * Vive fuera de `migrations.ts` porque tiene dos consumidores con políticas
 * distintas: la migración de arranque —que respalda antes de actualizar y
 * conserva las cinco copias de
 * [ADR-0029](../../../../docs/architecture/adr/0029-proteccion-de-datos-en-reposo.md) D8— y el
 * respaldo operativo periódico de
 * [ADR-0030](../../../../docs/architecture/adr/0030-empaquetado-y-runtime-del-nodo.md) D7, con
 * su propia cadencia y retención. El driver produce y purga copias; **no**
 * decide la política, que pertenece al composition root.
 */

/**
 * Protección del respaldo antes de publicarlo. La copia que `vacuum into`
 * produce es texto claro y sale de la máquina en un pendrive o una carpeta
 * compartida; el composition root la sella con la clave del nodo (ADR-0029
 * D7.3). Sin protección declarada el comportamiento es el anterior.
 */
export type BackupProtection = {
  readonly suffix: string;
  seal(sourcePath: string, targetPath: string): void;
  open(sourcePath: string, targetPath: string): void;
};

export type DatabaseBackupOptions = {
  readonly directory: string;
  /** Distingue familias de respaldo dentro de un mismo directorio. */
  readonly prefix: string;
  readonly protection?: BackupProtection;
};

export const assertDatabaseIntegrity = (sqlite: Database.Database): void => {
  const integrity = sqlite.pragma('integrity_check', { simple: true });
  const foreignKeyFailures = sqlite.pragma('foreign_key_check') as unknown[];
  if (integrity !== 'ok' || foreignKeyFailures.length > 0) {
    throw new Error('SQLite integrity validation failed.');
  }
};

export const removeSidecars = (databasePath: string): void => {
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${databasePath}${suffix}`;
    if (existsSync(sidecar)) unlinkSync(sidecar);
  }
};

/** Nombre con el que una familia de respaldos se reconoce en su directorio. */
export const migrationBackupPrefix = (databasePath: string): string =>
  `${basename(databasePath)}.backup.`;

/**
 * Copia consistente, validada y —si hay protección— sellada. No purga: la
 * retención la aplica quien conoce la política (`pruneDatabaseBackups`).
 */
export const createDatabaseBackup = (
  sqlite: Database.Database,
  databasePath: string,
  options: DatabaseBackupOptions
): string => {
  mkdirSync(options.directory, { recursive: true });
  const stamp = `${Date.now()}-${randomUUID()}`;
  /**
   * El intermedio en claro vive junto a la base, dentro del perímetro
   * protegido, y se borra antes de publicar el respaldo —también si el sellado
   * falla—. El borrado es el del sistema de archivos: no se promete un borrado
   * físico que el medio no garantiza.
   */
  const stagingPath = options.protection
    ? `${databasePath}.backup-${stamp}.staging`
    : join(options.directory, `${options.prefix}${stamp}.sqlite`);
  sqlite.prepare('vacuum into ?').run(stagingPath);

  const backup = openDatabase(stagingPath);
  try {
    assertDatabaseIntegrity(backup.sqlite);
  } finally {
    backup.close();
  }

  if (!options.protection) return stagingPath;

  const backupPath = join(
    options.directory, `${options.prefix}${stamp}.sqlite${options.protection.suffix}`
  );
  try {
    options.protection.seal(stagingPath, backupPath);
  } finally {
    removeSidecars(stagingPath);
    if (existsSync(stagingPath)) unlinkSync(stagingPath);
  }
  return backupPath;
};

/** Copias de una familia, de la más reciente a la más antigua. */
export const listDatabaseBackups = (
  directory: string,
  prefix: string
): readonly string[] => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.startsWith(prefix))
    .map((name) => join(directory, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
};

/**
 * Conserva las `keep` copias más recientes y nunca menos de una: una retención
 * de cero copias es no tener respaldo.
 */
export const pruneDatabaseBackups = (
  directory: string,
  prefix: string,
  keep: number
): readonly string[] => {
  const expired = listDatabaseBackups(directory, prefix).slice(Math.max(1, keep));
  for (const backup of expired) unlinkSync(backup);
  return expired;
};
