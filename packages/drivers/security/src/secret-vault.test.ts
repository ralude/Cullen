import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '@supermarket/shared';
import { isSealed, open, readSealHeader, seal } from './envelope.js';
import { loadFileProtection } from './protected-material.js';
import { FileSecretVault, openSecretVault } from './secret-vault.js';

/**
 * Custodia y sobre cifrado (ADR-0029 D7.3).
 *
 * Lo que se fija aquí es que la clave no aparezca nunca en claro donde vive el
 * material que protege, que el sobre detecte cualquier manipulación —incluida
 * la del encabezado, que viaja autenticado— y que la excepción de desarrollo
 * exija una señal explícita y quede declarada.
 */
const windows = process.platform === 'win32';
const DEVELOPMENT = { CULLEN_SECRET_VAULT: 'UNPROTECTED_DEVELOPMENT' };

describe('almacén de claves del nodo', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  const temporary = (): string => {
    const directory = mkdtempSync(join(tmpdir(), 'cullen-vault-'));
    directories.push(directory);
    return directory;
  };

  const codeOf = (run: () => unknown): string => {
    try {
      const result = run();
      if (result instanceof Promise) throw new Error('usa codeOfAsync');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      return (error as AppError).code;
    }
    return 'NO_ERROR';
  };

  const codeOfAsync = async (run: () => Promise<unknown>): Promise<string> => {
    try { await run(); } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      return (error as AppError).code;
    }
    return 'NO_ERROR';
  };

  it('exige una señal explícita para la excepción de desarrollo', () => {
    const directory = temporary();
    expect(openSecretVault(directory, DEVELOPMENT).protection).toBe('UNPROTECTED_DEVELOPMENT');
    expect(codeOf(() => openSecretVault(directory, { CULLEN_SECRET_VAULT: 'sin-proteger' })))
      .toBe('SECRET_VAULT_SELECTION_INVALID');
    expect(codeOf(() => openSecretVault(directory, {
      ...DEVELOPMENT, NODE_ENV: 'production'
    }))).toBe('SECRET_VAULT_UNPROTECTED_IN_PRODUCTION');
  });

  it('conserva las claves retiradas y solo olvida las que ya no cifran nada', async () => {
    const vault = openSecretVault(temporary(), DEVELOPMENT);
    const first = await vault.activeKey(new Date('2026-09-08T10:00:00.000Z'));
    const rotated = await vault.rotate(new Date('2026-09-08T11:00:00.000Z'));

    expect(rotated.retiredKeyId).toBe(first.keyId);
    expect(rotated.keyId).not.toBe(first.keyId);
    expect((await vault.activeKey(new Date())).keyId).toBe(rotated.keyId);
    expect((await vault.keyById(first.keyId))?.state).toBe('RETIRED');
    /** Una clave activa no se olvida: sigue cifrando material nuevo. */
    expect(await vault.forget(rotated.keyId)).toBe(false);
    expect(await vault.forget(first.keyId)).toBe(true);
    expect(await vault.keyById(first.keyId)).toBeNull();
    expect((await vault.list()).map((key) => key.keyId)).toEqual([rotated.keyId]);
  });

  it.runIf(windows)('envuelve la clave con el sistema y no la escribe en claro', async () => {
    const directory = temporary();
    const vault = openSecretVault(directory, {});
    expect(vault.protection).toBe('OS_KEYSTORE');

    const key = await vault.activeKey(new Date('2026-09-08T10:00:00.000Z'));
    expect(key.material).toHaveLength(32);

    const stored = readFileSync(join(directory, 'node-keys.json'), 'utf8');
    expect(stored).not.toContain(Buffer.from(key.material).toString('base64'));
    expect(stored).not.toContain(Buffer.from(key.material).toString('hex'));

    /** El material se recupera igual en una lectura posterior del mismo nodo. */
    const reopened = await openSecretVault(directory, {}).keyById(key.keyId);
    expect(Buffer.from(reopened!.material).equals(Buffer.from(key.material))).toBe(true);
  });

  it.runIf(windows)('no acepta un almacén escrito bajo otra custodia', async () => {
    const directory = temporary();
    await openSecretVault(directory, DEVELOPMENT).activeKey(new Date());

    expect(await codeOfAsync(() => openSecretVault(directory, {}).activeKey(new Date())))
      .toBe('SECRET_VAULT_PROTECTION_MISMATCH');
  });

  it('conserva el almacén publicado cuando la publicación no puede completarse', async () => {
    const directory = temporary();
    const vault = openSecretVault(directory, DEVELOPMENT);
    const first = await vault.activeKey(new Date('2026-09-08T10:00:00.000Z'));
    const path = join(directory, 'node-keys.json');
    const published = readFileSync(path, 'utf8');
    /** Publicado de solo lectura en Windows, directorio cerrado en POSIX. */
    chmodSync(path, 0o444);
    chmodSync(directory, 0o555);

    const code = await codeOfAsync(() => vault.rotate(new Date('2026-09-08T11:00:00.000Z')));

    chmodSync(directory, 0o755);
    chmodSync(path, 0o644);
    expect(code).toBe('SECRET_VAULT_UNAVAILABLE');
    /** Ni truncado, ni sustituido a medias, ni con intermedios abandonados. */
    expect(readFileSync(path, 'utf8')).toBe(published);
    expect(readdirSync(directory)).toEqual(['node-keys.json']);
    expect((await vault.activeKey(new Date())).keyId).toBe(first.keyId);
  });

  it('falla cerrado cuando el almacén del sistema no responde', async () => {
    const vault = new FileSecretVault(temporary(), {
      protection: 'OS_KEYSTORE',
      wrap: () => { throw new Error('almacén ausente'); },
      unwrap: () => { throw new Error('almacén ausente'); }
    });

    expect(await codeOfAsync(() => vault.activeKey(new Date())))
      .toBe('SECRET_VAULT_UNAVAILABLE');
  });
});

describe('sobre cifrado', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  const vaultOf = () => {
    const directory = mkdtempSync(join(tmpdir(), 'cullen-seal-'));
    directories.push(directory);
    return openSecretVault(directory, DEVELOPMENT);
  };

  const codeOf = (run: () => unknown): string => {
    try { run(); } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      return (error as AppError).code;
    }
    return 'NO_ERROR';
  };

  it('cierra y abre conservando el contenido exacto', async () => {
    const key = await vaultOf().activeKey(new Date('2026-09-08T10:00:00.000Z'));
    const plaintext = Buffer.from('PIN-hash y otras cosas que no deben salir', 'utf8');

    const sealed = seal(plaintext, key, { nodeId: 'node-001', now: new Date() });

    expect(isSealed(sealed)).toBe(true);
    expect(sealed.includes(plaintext)).toBe(false);
    expect(readSealHeader(sealed)).toMatchObject({
      keyId: key.keyId, nodeId: 'node-001', algorithm: 'aes-256-gcm'
    });
    expect(open(sealed, key, { nodeId: 'node-001' }).equals(plaintext)).toBe(true);
  });

  it('rechaza manipulación, nodo ajeno, clave distinta y formato desconocido', async () => {
    const vault = vaultOf();
    const key = await vault.activeKey(new Date('2026-09-08T10:00:00.000Z'));
    const other = await vault.rotate(new Date('2026-09-08T11:00:00.000Z'));
    const otherKey = (await vault.keyById(other.keyId))!;
    const sealed = seal(Buffer.from('contenido'), key, { nodeId: 'node-001', now: new Date() });

    const tampered = Buffer.from(sealed);
    tampered.writeUInt8(tampered.readUInt8(tampered.length - 1) ^ 0xff, tampered.length - 1);
    expect(codeOf(() => open(tampered, key, { nodeId: 'node-001' })))
      .toBe('SEALED_MATERIAL_TAMPERED');

    /** El encabezado viaja autenticado: cambiar el nodo también rompe el sobre. */
    const relabelled = Buffer.from(
      sealed.toString('binary').replace('node-001', 'node-999'), 'binary'
    );
    expect(['SEALED_MATERIAL_NODE_MISMATCH', 'SEALED_MATERIAL_TAMPERED'])
      .toContain(codeOf(() => open(relabelled, key, { nodeId: 'node-999' })));

    expect(codeOf(() => open(sealed, key, { nodeId: 'node-002' })))
      .toBe('SEALED_MATERIAL_NODE_MISMATCH');
    expect(codeOf(() => open(sealed, otherKey, { nodeId: 'node-001' })))
      .toBe('SEALED_MATERIAL_KEY_MISMATCH');
    expect(codeOf(() => open(Buffer.from('no soy un sobre'), key, { nodeId: 'node-001' })))
      .toBe('SEALED_MATERIAL_FORMAT_UNKNOWN');
    expect(isSealed(Buffer.from('no soy un sobre'))).toBe(false);
  });

  it('no deja el contenido reconocible en el archivo publicado', async () => {
    const key = await vaultOf().activeKey(new Date());
    const directory = mkdtempSync(join(tmpdir(), 'cullen-file-'));
    directories.push(directory);
    const path = join(directory, 'material.sealed');

    writeFileSync(path, seal(
      Buffer.from('-----BEGIN PRIVATE KEY-----secreto-----END PRIVATE KEY-----'),
      key, { nodeId: 'node-001', now: new Date() }
    ));

    const published = readFileSync(path, 'utf8');
    expect(published).not.toContain('BEGIN PRIVATE KEY');
    expect(published).not.toContain('secreto');
    expect(readdirSync(directory)).toEqual(['material.sealed']);
  });

  it('vuelve a sellar secretos con la clave activa y rechaza texto claro', async () => {
    const vault = vaultOf();
    const directory = mkdtempSync(join(tmpdir(), 'cullen-reseal-'));
    directories.push(directory);
    const source = join(directory, 'source.pem');
    const protectedPath = join(directory, 'secret.pem.sealed');
    writeFileSync(source, 'secreto-configurado');

    const first = await loadFileProtection({
      vault, nodeId: 'node-001', now: new Date('2026-01-01T00:00:00.000Z')
    });
    first.seal(source, protectedPath);
    expect(first.keyIdOf(protectedPath)).toBe(first.keyId);
    expect(() => first.readSecret(source)).toThrowError(expect.objectContaining({
      code: 'SECRET_MATERIAL_NOT_SEALED'
    }));

    await vault.rotate(new Date('2026-09-08T12:00:00.000Z'));
    const second = await loadFileProtection({
      vault, nodeId: 'node-001', now: new Date('2026-09-08T12:00:00.000Z')
    });
    second.reseal(protectedPath);

    expect(second.keyIdOf(protectedPath)).toBe(second.keyId);
    expect(second.readSecret(protectedPath)).toBe('secreto-configurado');
    expect(readdirSync(directory).filter((name) => name.endsWith('.staging'))).toEqual([]);
  });
});
