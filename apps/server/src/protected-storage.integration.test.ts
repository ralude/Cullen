import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '@supermarket/shared';
import { openDatabase } from '@supermarket/driver-db';
import {
  currentAccountSid,
  isSealed,
  loadFileProtection,
  openSecretVault,
  readSealHeader
} from '@supermarket/driver-security';
import {
  migrateNodeDatabase,
  prepareNodeStorage,
  readNodeStorage,
  sealLegacyMigrationBackups
} from './node-storage.ts';
import { readSyncListenerConfiguration } from './sync/lan-listener.ts';
import { rotateNodeProtectedMaterial } from './node-maintenance.ts';

/**
 * Protección del material en reposo sobre el arranque real (11.04, cortes 3 y 4).
 *
 * El archivo operativo no se cifra —ADR-0029 D7.1— y por eso lo que se prueba
 * aquí es lo que sí sale de la máquina: el respaldo publicado y el material de
 * configuración. Se recorre el camino completo y después se busca contenido
 * sensible en lo publicado, en vez de confiar en que el sellado ocurrió.
 */
const windows = process.platform === 'win32';
const DEVELOPMENT = { CULLEN_SECRET_VAULT: 'UNPROTECTED_DEVELOPMENT' };

describe('material protegido del nodo', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  const temporary = (): string => {
    const directory = mkdtempSync(join(tmpdir(), 'cullen-protected-'));
    directories.push(directory);
    return directory;
  };

  /** Deja el directorio como lo deja el instalador del nodo. */
  const harden = (directory: string): string => {
    mkdirSync(directory, { recursive: true });
    execFileSync('icacls', [
      directory, '/inheritance:r',
      '/grant', '*S-1-5-18:(OI)(CI)F',
      '/grant', '*S-1-5-32-544:(OI)(CI)F',
      '/grant', `*${currentAccountSid()}:(OI)(CI)F`
    ], { stdio: 'ignore', windowsHide: true });
    return directory;
  };

  const storageIn = (root: string) => readNodeStorage({
    DATABASE_PATH: join(root, 'data', 'node.sqlite'),
    DATABASE_BACKUP_PATH: join(root, 'data', 'backups'),
    NODE_KEYSTORE_PATH: join(root, 'keys')
  });

  const protectionFor = async (keystoreDirectory: string) => loadFileProtection({
    vault: openSecretVault(keystoreDirectory, DEVELOPMENT),
    nodeId: 'node-001',
    now: new Date('2026-09-08T12:00:00.000Z')
  });

  const seedOperator = (databasePath: string): void => {
    const handle = openDatabase(databasePath);
    try {
      handle.sqlite.prepare(`
        insert into identity_users (id, operator_code, display_name, is_active,
          authorization_version, created_at) values (?, ?, ?, 1, 1, ?)
      `).run('user-001', 'OP001', 'Administrador', Date.now());
      handle.sqlite.prepare(`
        insert into identity_credentials (user_id, pin_hash, version, updated_at)
        values (?, ?, 1, ?)
      `).run('user-001', 'scrypt$16384$8$1$sal$hash-secretisimo', Date.now());
    } finally {
      handle.close();
    }
  };

  it('publica el respaldo sellado y no deja copia en claro', async () => {
    const root = temporary();
    const storage = storageIn(root);
    mkdirSync(dirname(storage.databasePath), { recursive: true });
    migrateNodeDatabase(storage);
    seedOperator(storage.databasePath);

    const protection = await protectionFor(storage.keystoreDirectory);
    const result = migrateNodeDatabase(storage, { backupProtection: protection });

    expect(result.backupPath).toBeDefined();
    const published = readFileSync(result.backupPath!);
    expect(isSealed(published)).toBe(true);
    expect(published.toString('binary')).not.toContain('hash-secretisimo');
    expect(published.toString('binary')).not.toContain('SQLite format 3');

    /** El intermedio en claro vivió dentro del perímetro y ya no existe. */
    const dataFiles = readdirSync(dirname(storage.databasePath));
    expect(dataFiles.filter((name) => name.includes('.staging'))).toEqual([]);
    for (const name of readdirSync(storage.backupDirectory)) {
      expect(isSealed(readFileSync(join(storage.backupDirectory, name)))).toBe(true);
    }
  });

  it('sella los respaldos históricos antes de conservarlos', async () => {
    const root = temporary();
    const storage = storageIn(root);
    mkdirSync(dirname(storage.databasePath), { recursive: true });
    migrateNodeDatabase(storage);
    const legacy = migrateNodeDatabase(storage).backupPath!;
    expect(readFileSync(legacy).toString('binary')).toContain('SQLite format 3');

    const protection = await protectionFor(storage.keystoreDirectory);
    const converted = sealLegacyMigrationBackups(storage, protection);

    expect(converted).toHaveLength(1);
    expect(readdirSync(storage.backupDirectory)).not.toContain(legacy.split(/[\\/]/).at(-1));
    expect(isSealed(readFileSync(converted[0]!))).toBe(true);
  });

  it('restaura desde el respaldo sellado cuando la actualización falla', async () => {
    const root = temporary();
    const storage = storageIn(root);
    mkdirSync(dirname(storage.databasePath), { recursive: true });
    migrateNodeDatabase(storage);
    seedOperator(storage.databasePath);
    const protection = await protectionFor(storage.keystoreDirectory);

    let thrown: unknown;
    try {
      migrateNodeDatabase(storage, {
        backupProtection: protection,
        validate: () => { throw new Error('validación inyectada'); }
      });
    } catch (error) { thrown = error; }

    expect((thrown as AppError).code).toBe('DATABASE_MIGRATION_VALIDATION_FAILED');
    const restored = openDatabase(storage.databasePath);
    try {
      expect(restored.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(restored.sqlite.prepare('select operator_code from identity_users where id = ?')
        .pluck().get('user-001')).toBe('OP001');
    } finally {
      restored.close();
    }
    /** La restauración tampoco deja intermedios en claro. */
    expect(readdirSync(dirname(storage.databasePath))
      .filter((name) => name.includes('.staging'))).toEqual([]);
  });

  it('rota sin inutilizar respaldos anteriores y cifra los nuevos con la clave activa', async () => {
    const root = temporary();
    const storage = storageIn(root);
    mkdirSync(dirname(storage.databasePath), { recursive: true });
    migrateNodeDatabase(storage);
    const vault = openSecretVault(storage.keystoreDirectory, DEVELOPMENT);
    const before = await loadFileProtection({
      vault, nodeId: 'node-001', now: new Date('2026-01-01T00:00:00.000Z')
    });
    const previousBackup = migrateNodeDatabase(storage, { backupProtection: before }).backupPath!;

    const rotated = await rotateNodeProtectedMaterial({
      databasePath: storage.databasePath,
      nodeIdentity: { originNodeId: 'node-001', terminalId: 'terminal-001' },
      vault,
      input: { reason: 'Rotación anual.', referencedKeyIds: [before.keyId] }
    });
    const after = await loadFileProtection({
      vault, nodeId: 'node-001', now: new Date('2026-09-08T12:00:00.000Z')
    });

    expect(rotated.retiredKeyId).toBe(before.keyId);
    expect(after.keyId).not.toBe(before.keyId);
    const restored = join(root, 'previous.sqlite');
    after.open(previousBackup, restored);
    const restoredHandle = openDatabase(restored);
    try {
      expect(restoredHandle.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      restoredHandle.close();
    }
    const nextBackup = migrateNodeDatabase(storage, { backupProtection: after }).backupPath!;
    expect(readSealHeader(readFileSync(previousBackup)).keyId).toBe(before.keyId);
    expect(readSealHeader(readFileSync(nextBackup)).keyId).toBe(after.keyId);

    const audit = openDatabase(storage.databasePath);
    try {
      expect(audit.sqlite.prepare(`
        select action from audit_log where action = 'SECURITY_PROTECTION_KEY_ROTATED'
      `).pluck().get()).toBe('SECURITY_PROTECTION_KEY_ROTATED');
    } finally {
      audit.close();
    }
  });

  it('rechaza un respaldo manipulado, de otro nodo o con clave ausente', async () => {
    const root = temporary();
    const storage = storageIn(root);
    mkdirSync(dirname(storage.databasePath), { recursive: true });
    migrateNodeDatabase(storage);
    const protection = await protectionFor(storage.keystoreDirectory);
    const sealed = migrateNodeDatabase(storage, { backupProtection: protection }).backupPath!;
    const target = join(root, 'restored.sqlite');

    const tampered = readFileSync(sealed);
    tampered.writeUInt8(tampered.readUInt8(tampered.length - 1) ^ 0xff, tampered.length - 1);
    const tamperedPath = join(root, 'tampered.sealed');
    writeFileSync(tamperedPath, tampered);
    expect(() => protection.open(tamperedPath, target))
      .toThrowError(expect.objectContaining({ code: 'SEALED_MATERIAL_TAMPERED' }));

    const foreign = await loadFileProtection({
      vault: openSecretVault(storage.keystoreDirectory, DEVELOPMENT),
      nodeId: 'node-999',
      now: new Date()
    });
    expect(() => foreign.open(sealed, target))
      .toThrowError(expect.objectContaining({ code: 'SEALED_MATERIAL_NODE_MISMATCH' }));

    /** Otro almacén no tiene la clave: el respaldo es irrecuperable, y se dice. */
    const stranger = await loadFileProtection({
      vault: openSecretVault(join(root, 'other-keys'), DEVELOPMENT),
      nodeId: 'node-001',
      now: new Date()
    });
    expect(() => stranger.open(sealed, target))
      .toThrowError(expect.objectContaining({ code: 'SEALED_MATERIAL_KEY_UNAVAILABLE' }));
    /** Ningún intento deja un destino a medio escribir. */
    expect(readdirSync(root)).not.toContain('restored.sqlite');
  });

  it('abre el material TLS sellado en memoria sin publicarlo en claro', async () => {
    const root = temporary();
    const storage = storageIn(root);
    mkdirSync(dirname(storage.databasePath), { recursive: true });
    const protection = await protectionFor(storage.keystoreDirectory);
    const material = join(root, 'material');
    mkdirSync(material, { recursive: true });

    const plainKey = join(material, 'key.pem');
    writeFileSync(plainKey, '-----BEGIN PRIVATE KEY-----clave-lan-----END PRIVATE KEY-----');
    const sealedKey = join(material, 'key.pem.sealed');
    protection.seal(plainKey, sealedKey);
    rmSync(plainKey);
    const certificate = join(material, 'cert.pem.sealed');
    const plainCertificate = join(material, 'cert.pem');
    writeFileSync(plainCertificate, '-----BEGIN CERTIFICATE-----publico-----END CERTIFICATE-----');
    protection.seal(plainCertificate, certificate);
    rmSync(plainCertificate);

    const configuration = readSyncListenerConfiguration({
      SYNC_LISTENER_PORT: '8443',
      SYNC_LISTENER_TLS_KEY_PATH: sealedKey,
      SYNC_LISTENER_TLS_CERT_PATH: certificate,
      SYNC_LISTENER_TLS_CLIENT_CA_PATHS: certificate
    }, protection.readSecret);

    expect(configuration?.https.key).toContain('clave-lan');
    /** El archivo publicado sigue sellado: solo la memoria vio la clave. */
    expect(readFileSync(sealedKey, 'utf8')).not.toContain('clave-lan');
    expect(readdirSync(material)).not.toContain('key.pem');
  });

  it('rechaza material TLS en claro en el arranque protegido', async () => {
    const root = temporary();
    const protection = await protectionFor(join(root, 'keys'));
    const plain = join(root, 'key.pem');
    writeFileSync(plain, '-----BEGIN PRIVATE KEY-----secreto-----END PRIVATE KEY-----');

    expect(() => readSyncListenerConfiguration({
      SYNC_LISTENER_PORT: '8443',
      SYNC_LISTENER_TLS_KEY_PATH: plain,
      SYNC_LISTENER_TLS_CERT_PATH: plain,
      SYNC_LISTENER_TLS_CLIENT_CA_PATHS: plain
    }, protection.readSecret)).toThrowError(expect.objectContaining({
      code: 'SYNC_LISTENER_MATERIAL_UNREADABLE'
    }));
  });

  it.runIf(windows)('verifica la ACL del perímetro antes de escribir', () => {
    const root = temporary();
    const storage = storageIn(root);
    harden(dirname(storage.databasePath));
    harden(storage.backupDirectory);
    harden(storage.keystoreDirectory);

    expect(() => prepareNodeStorage(storage)).not.toThrow();

    execFileSync('icacls', [storage.backupDirectory, '/grant', '*S-1-1-0:(OI)(CI)R'], {
      stdio: 'ignore', windowsHide: true
    });
    let thrown: unknown;
    try { prepareNodeStorage(storage); } catch (error) { thrown = error; }
    expect((thrown as AppError).code).toBe('DATA_DIRECTORY_NOT_PROTECTED');
    expect((thrown as AppError).message).not.toMatch(/[\\/]/);
  });

  it('no admite el almacén de claves dentro del directorio de respaldos', () => {
    const root = temporary();
    let thrown: unknown;
    try {
      readNodeStorage({
        DATABASE_PATH: join(root, 'node.sqlite'),
        DATABASE_BACKUP_PATH: join(root, 'backups'),
        NODE_KEYSTORE_PATH: join(root, 'backups', 'keys')
      });
    } catch (error) { thrown = error; }
    expect((thrown as AppError).code).toBe('NODE_KEYSTORE_PATH_INVALID');
  });
});
