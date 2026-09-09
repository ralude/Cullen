import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppError, ApplicationError } from '@supermarket/shared';
import { openDatabase, removeSidecars } from '@supermarket/driver-db';
import {
  loadFileProtection,
  loadNodeIdentity,
  openSecretVault
} from '@supermarket/driver-security';
import { prepareNodeStorage, readNodeStorage } from './node-storage.ts';
import { readOperationalBackupPolicy, runOperationalBackup } from './operational-backup.ts';

/**
 * Respaldo operativo bajo demanda y su restauración (ADR-0030 D7).
 *
 * La cadencia desatendida la ejecuta el propio servicio; esta herramienta
 * cubre el respaldo a petición —antes de una intervención— y el ensayo de
 * restauración. Como cualquier otra herramienta local del nodo, reclama la
 * propiedad del archivo: **exige el servicio detenido**, igual que la rotación
 * de material protegido. Dos procesos dueños de la misma base es justamente lo
 * que `DATABASE_NODE_LOCKED` impide.
 *
 *   pnpm --filter @supermarket/server backup
 *   pnpm --filter @supermarket/server backup -- --restore <respaldo>
 */

const usage = 'Uso: backup [--restore <ruta del respaldo>]';

const run = async (): Promise<void> => {
  const [flag, target] = process.argv.slice(2);
  if (flag !== undefined && flag !== '--restore') {
    throw new ApplicationError('BACKUP_ARGUMENTS_INVALID', usage);
  }

  const identity = loadNodeIdentity(process.env.NODE_IDENTITY_PATH);
  const storage = readNodeStorage();
  prepareNodeStorage(storage);
  const vault = openSecretVault(storage.keystoreDirectory);
  const protection = await loadFileProtection({
    vault, nodeId: identity.originNodeId, now: new Date()
  });

  if (flag === '--restore') {
    if (target === undefined) throw new ApplicationError('BACKUP_ARGUMENTS_INVALID', usage);
    const source = resolve(target);
    if (!existsSync(source)) {
      throw new ApplicationError('BACKUP_NOT_FOUND', 'The backup to restore does not exist.');
    }
    /**
     * Los sidecars de la base anterior describen un WAL que el respaldo no
     * conoce; dejarlos convierte una restauración en una base incoherente.
     */
    removeSidecars(storage.databasePath);
    protection.open(source, storage.databasePath);
    const restored = openDatabase(storage.databasePath);
    try {
      const integrity = restored.sqlite.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') {
        throw new ApplicationError(
          'BACKUP_RESTORE_INVALID', 'The restored database did not pass its integrity check.'
        );
      }
    } finally {
      restored.close();
    }
    process.stdout.write(`Backup restored from ${source}\n`);
    return;
  }

  const handle = openDatabase(storage.databasePath);
  try {
    const result = runOperationalBackup({
      sqlite: handle.sqlite,
      storage,
      policy: readOperationalBackupPolicy(),
      protection
    });
    process.stdout.write(`Operational backup: ${result.dailyPath}\n`);
    if (result.weeklyPath) process.stdout.write(`Weekly copy: ${result.weeklyPath}\n`);
    if (result.externalPath) process.stdout.write(`External copy: ${result.externalPath}\n`);
  } finally {
    handle.close();
  }
};

try {
  await run();
} catch (error) {
  const code = error instanceof AppError ? error.code : 'OPERATIONAL_BACKUP_FAILED';
  const message = error instanceof AppError ? error.message : 'The operational backup failed.';
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
}
