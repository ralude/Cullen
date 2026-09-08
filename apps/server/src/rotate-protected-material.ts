import { readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { AppError, ApplicationError } from '@supermarket/shared';
import {
  loadFileProtection,
  loadNodeIdentity,
  openSecretVault
} from '@supermarket/driver-security';
import {
  migrateNodeDatabase,
  prepareNodeStorage,
  readNodeStorage,
  sealLegacyMigrationBackups
} from './node-storage.ts';
import { rotateNodeProtectedMaterial } from './node-maintenance.ts';

const configuredMaterialPaths = (
  environment: Readonly<Record<string, string | undefined>>
): readonly string[] => {
  const single = [
    'SYNC_CLIENT_TLS_KEY_PATH',
    'SYNC_CLIENT_TLS_CERT_PATH',
    'SYNC_LISTENER_TLS_KEY_PATH',
    'SYNC_LISTENER_TLS_CERT_PATH'
  ].flatMap((name) => environment[name]?.trim() || []);
  const lists = [
    'SYNC_CLIENT_TLS_CA_PATHS',
    'SYNC_LISTENER_TLS_CLIENT_CA_PATHS'
  ].flatMap((name) => environment[name]?.split(';').map((path) => path.trim()).filter(Boolean) ?? []);
  return [...new Set([...single, ...lists].map((path) => resolve(path)))];
};

const run = async (): Promise<void> => {
  const reason = process.argv.slice(2).join(' ').trim();
  if (reason.length === 0) {
    throw new ApplicationError(
      'PROTECTION_ROTATION_REASON_REQUIRED',
      'The rotation requires a reason.'
    );
  }
  const identity = loadNodeIdentity(process.env.NODE_IDENTITY_PATH);
  const storage = readNodeStorage();
  prepareNodeStorage(storage);
  const vault = openSecretVault(storage.keystoreDirectory);
  const before = await loadFileProtection({
    vault, nodeId: identity.originNodeId, now: new Date()
  });
  sealLegacyMigrationBackups(storage, before);
  migrateNodeDatabase(storage, { backupProtection: before });

  const backupPrefix = `${basename(storage.databasePath)}.backup.`;
  const backups = readdirSync(storage.backupDirectory)
    .filter((name) => name.startsWith(backupPrefix))
    .map((name) => join(storage.backupDirectory, name));
  const secrets = configuredMaterialPaths(process.env);
  const references = new Set<string>();
  for (const path of [...backups, ...secrets]) {
    const keyId = before.keyIdOf(path);
    if (keyId === null) {
      throw new ApplicationError(
        'SECRET_MATERIAL_NOT_SEALED',
        'Configured protected material is not sealed.'
      );
    }
    references.add(keyId);
  }

  const rotated = await rotateNodeProtectedMaterial({
    databasePath: storage.databasePath,
    nodeIdentity: identity,
    vault,
    input: { reason, referencedKeyIds: [...references] }
  });

  /** Los respaldos conservan su clave hasta caducar; los secretos vivos migran ya. */
  const after = await loadFileProtection({
    vault, nodeId: identity.originNodeId, now: new Date()
  });
  for (const path of secrets) after.reseal(path);

  process.stdout.write(`Protection key rotated: ${rotated.keyId}\n`);
};

try {
  await run();
} catch (error) {
  const code = error instanceof AppError ? error.code : 'PROTECTION_ROTATION_FAILED';
  const message = error instanceof AppError ? error.message : 'Protected material rotation failed.';
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
}
