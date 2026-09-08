import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { ApplicationError } from '@supermarket/shared';
import {
  migrateDatabase,
  type BackupProtection,
  type DatabaseHandle,
  type MigrationResult
} from '@supermarket/driver-db';
import { assertProtectedDirectory } from '@supermarket/driver-security';

type Environment = Readonly<Record<string, string | undefined>>;

export type NodeStorage = {
  readonly databasePath: string;
  /** Fuera del archivo operativo, para que una copia sobreviva a su corrupción. */
  readonly backupDirectory: string;
  readonly backupRetention: number;
  /**
   * Almacén de claves. Vive fuera del directorio de respaldos a propósito: una
   * clave junto al material que protege no agrega ninguna frontera
   * (ADR-0029 D7.3).
   */
  readonly keystoreDirectory: string;
};

const contains = (parent: string, child: string): boolean => {
  const distance = relative(parent, child);
  return distance === '' || (!distance.startsWith('..') && !/^[A-Za-z]:/.test(distance));
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
  const backupDirectory = resolve(
    environment.DATABASE_BACKUP_PATH ?? join(dirname(databasePath), 'backups')
  );
  const keystoreDirectory = resolve(
    environment.NODE_KEYSTORE_PATH ?? join(dirname(databasePath), 'keys')
  );
  if (contains(backupDirectory, keystoreDirectory)) {
    throw new ApplicationError(
      'NODE_KEYSTORE_PATH_INVALID',
      'The key store cannot live inside the backup directory.'
    );
  }
  return {
    databasePath,
    backupDirectory,
    backupRetention: declared === undefined ? DEFAULT_BACKUP_RETENTION : Number.parseInt(declared, 10),
    keystoreDirectory
  };
};

/**
 * Prepara y verifica el perímetro protegido antes de escribir nada: la base y
 * sus temporales, los respaldos y el almacén de claves. Crear el directorio
 * hereda la ACL de su padre —la que fija el instalador—, y verificarla es lo
 * que impide arrancar sobre una carpeta que cualquier cuenta puede leer
 * (ADR-0029 D7.2).
 */
export const prepareNodeStorage = (storage: NodeStorage): void => {
  for (const directory of [
    dirname(storage.databasePath), storage.backupDirectory, storage.keystoreDirectory
  ]) {
    assertWritable(directory);
    assertProtectedDirectory(directory);
  }
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
  options: {
    readonly validate?: (handle: DatabaseHandle) => void;
    /** Sella el respaldo antes de publicarlo y lo abre para restaurarlo. */
    readonly backupProtection?: BackupProtection;
  } = {}
): MigrationResult => {
  assertWritable(storage.backupDirectory);
  return migrateDatabase(storage.databasePath, {
    backupDirectory: storage.backupDirectory,
    backupRetention: storage.backupRetention,
    ...(options.validate ? { validate: options.validate } : {}),
    ...(options.backupProtection ? { backupProtection: options.backupProtection } : {})
  });
};
