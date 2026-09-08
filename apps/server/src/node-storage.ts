import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ApplicationError } from '@supermarket/shared';
import { migrateDatabase, type DatabaseHandle, type MigrationResult } from '@supermarket/driver-db';

type Environment = Readonly<Record<string, string | undefined>>;

export type NodeStorage = {
  readonly databasePath: string;
  /** Fuera del archivo operativo, para que una copia sobreviva a su corrupción. */
  readonly backupDirectory: string;
  readonly backupRetention: number;
};

/** Retención normativa de los respaldos de migración (ADR-0029 D8). */
const DEFAULT_BACKUP_RETENTION = 5;

/**
 * Rutas y retención del almacenamiento del nodo. Un valor declarado que no
 * puede cumplir la política aborta el arranque en vez de degradarla en
 * silencio: una retención de cero copias es no tener respaldo.
 */
export const readNodeStorage = (environment: Environment = process.env): NodeStorage => {
  const databasePath = resolve(environment.DATABASE_PATH ?? 'supermarket-node.sqlite');
  const declared = environment.DATABASE_BACKUP_RETENTION?.trim();
  if (declared !== undefined && !/^[1-9]\d*$/.test(declared)) {
    throw new ApplicationError(
      'DATABASE_BACKUP_RETENTION_INVALID',
      'The backup retention must keep at least one copy.'
    );
  }
  return {
    databasePath,
    backupDirectory: resolve(
      environment.DATABASE_BACKUP_PATH ?? join(dirname(databasePath), 'backups')
    ),
    backupRetention: declared === undefined ? DEFAULT_BACKUP_RETENTION : Number.parseInt(declared, 10)
  };
};

/**
 * Comprueba que el nodo puede escribir donde va a respaldar, antes de tocar la
 * base. Un directorio que no existe se crea; uno que no admite escritura aborta
 * el arranque, porque migrar sin respaldo es exactamente lo que este corte
 * viene a impedir.
 */
const assertWritable = (directory: string): void => {
  const probe = join(directory, `.write-probe-${process.pid}`);
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(probe, '');
  } catch (cause) {
    throw new ApplicationError(
      'DATABASE_BACKUP_DIRECTORY_UNWRITABLE',
      'The backup directory is not writable.',
      { cause }
    );
  } finally {
    rmSync(probe, { force: true });
  }
};

/**
 * Migración del arranque real: respalda, valida y restaura. La transacción de
 * una migración individual protege esa migración; esto protege la
 * actualización completa, que es lo que la auditoría 2026-09-04 dejó abierto.
 *
 * Si la validación falla, `migrateDatabase` restaura el respaldo y lanza
 * `DATABASE_MIGRATION_VALIDATION_FAILED`: el arranque termina ahí y el servidor
 * no llega a escuchar con una base a medio migrar.
 */
export const migrateNodeDatabase = (
  storage: NodeStorage,
  options: { readonly validate?: (handle: DatabaseHandle) => void } = {}
): MigrationResult => {
  assertWritable(storage.backupDirectory);
  return migrateDatabase(storage.databasePath, {
    backupDirectory: storage.backupDirectory,
    backupRetention: storage.backupRetention,
    ...(options.validate ? { validate: options.validate } : {})
  });
};
