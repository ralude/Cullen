import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import type {
  ProtectionKey,
  ProtectionKeySummary,
  SecretVault,
  SecretVaultProtection
} from '@supermarket/core';
import { InfrastructureError } from '@supermarket/shared';

/**
 * Almacén de claves del nodo
 * ([ADR-0029](../../../../docs/architecture/adr/0029-proteccion-de-datos-en-reposo.md) D7.3).
 *
 * La clave de datos se genera aquí y **nunca se escribe en claro**: se guarda
 * envuelta por el almacén del sistema operativo —DPAPI en ámbito de máquina—,
 * en un directorio distinto del que contiene el material cifrado. El archivo
 * copiado a otra máquina no sirve, porque la envoltura solo se abre en esta.
 *
 * Si el almacén no está disponible, el nodo no degrada a una clave en disco:
 * falla cerrado. La única excepción es de desarrollo, se selecciona con una
 * señal explícita, se rechaza en producción y queda declarada en `protection`
 * para que cada uso deje constancia auditable.
 */
const KEYSTORE_FILE = 'node-keys.json';
const KEY_LENGTH = 32;
const POWERSHELL_TIMEOUT_MS = 20_000;

type StoredKey = {
  readonly keyId: string;
  readonly state: 'ACTIVE' | 'RETIRED';
  readonly createdAt: string;
  readonly retiredAt: string | null;
  /** Material envuelto por el sistema, o en claro solo en la excepción de desarrollo. */
  readonly material: string;
};

type Keystore = {
  readonly version: 1;
  readonly protection: SecretVaultProtection;
  readonly keys: readonly StoredKey[];
};

export type SecretWrapper = {
  readonly protection: SecretVaultProtection;
  wrap(material: Buffer): string;
  unwrap(stored: string): Buffer;
};

const unavailable = (cause?: unknown): InfrastructureError => new InfrastructureError(
  'SECRET_VAULT_UNAVAILABLE',
  'The node key store is not available.',
  cause === undefined ? {} : { cause }
);

const powershell = (script: string): string => execFileSync(
  'powershell.exe',
  ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
  { encoding: 'utf8', windowsHide: true, timeout: POWERSHELL_TIMEOUT_MS }
).trim();

/** DPAPI en ámbito de máquina: el servicio desatendido abre la clave sin operador. */
const dpapi: SecretWrapper = {
  protection: 'OS_KEYSTORE',
  wrap: (material) => {
    try {
      return powershell([
        'Add-Type -AssemblyName System.Security;',
        `$b = [Convert]::FromBase64String('${material.toString('base64')}');`,
        '[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect(',
        '$b, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine))'
      ].join(' '));
    } catch (cause) { throw unavailable(cause); }
  },
  unwrap: (stored) => {
    try {
      return Buffer.from(powershell([
        'Add-Type -AssemblyName System.Security;',
        `$b = [Convert]::FromBase64String('${stored}');`,
        '[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect(',
        '$b, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine))'
      ].join(' ')), 'base64');
    } catch (cause) { throw unavailable(cause); }
  }
};

/**
 * Excepción de desarrollo prevista por el ADR: la clave queda legible junto a
 * su almacén. No protege nada y por eso se declara en `protection`, se rechaza
 * en producción y nunca se elige por descarte.
 */
const unprotected: SecretWrapper = {
  protection: 'UNPROTECTED_DEVELOPMENT',
  wrap: (material) => material.toString('base64'),
  unwrap: (stored) => Buffer.from(stored, 'base64')
};

export const DEVELOPMENT_VAULT_SIGNAL = 'CULLEN_SECRET_VAULT';
const DEVELOPMENT_VAULT_VALUE = 'UNPROTECTED_DEVELOPMENT';

export class FileSecretVault implements SecretVault {
  constructor(
    private readonly directory: string,
    private readonly wrapper: SecretWrapper
  ) {}

  get protection(): SecretVaultProtection {
    return this.wrapper.protection;
  }

  private get path(): string {
    return join(this.directory, KEYSTORE_FILE);
  }

  private read(): Keystore {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Keystore;
      if (parsed.version !== 1 || !Array.isArray(parsed.keys)) throw new Error('invalid');
      if (parsed.protection !== this.wrapper.protection) {
        throw new InfrastructureError(
          'SECRET_VAULT_PROTECTION_MISMATCH',
          'The key store was written under a different protection.'
        );
      }
      return parsed;
    } catch (error) {
      if (error instanceof InfrastructureError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 1, protection: this.wrapper.protection, keys: [] };
      }
      throw unavailable(error);
    }
  }

  /**
   * Publicación atómica. Existe un solo `node-keys.json` y perderlo a medias
   * vuelve irrecuperables el nodo y todos los respaldos que dependan de sus
   * claves, así que nunca se escribe sobre él: el contenido nuevo se escribe
   * completo en un intermedio del mismo directorio, se fuerza a disco y recién
   * entonces sustituye al publicado con un renombrado. Una caída durante el
   * arranque, la rotación o la purga deja el almacén anterior intacto y, a lo
   * sumo, un intermedio con la misma custodia que el publicado.
   */
  private write(keystore: Keystore): void {
    const staging = `${this.path}.${randomUUID()}.staging`;
    try {
      mkdirSync(this.directory, { recursive: true });
      const file = openSync(staging, 'wx');
      try {
        writeFileSync(file, JSON.stringify(keystore, null, 2));
        fsyncSync(file);
      } finally {
        closeSync(file);
      }
      renameSync(staging, this.path);
    } catch (cause) {
      try { rmSync(staging, { force: true }); } catch { /* el intermedio no manda */ }
      throw unavailable(cause);
    }
  }

  /** Un almacén que no responde no degrada a otra cosa: es indisponibilidad. */
  private guard<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      throw error instanceof InfrastructureError ? error : unavailable(error);
    }
  }

  private toKey(stored: StoredKey): ProtectionKey {
    return {
      keyId: stored.keyId,
      state: stored.state,
      createdAt: new Date(stored.createdAt),
      material: this.guard(() => this.wrapper.unwrap(stored.material))
    };
  }

  private create(now: Date): StoredKey {
    return {
      keyId: randomUUID(),
      state: 'ACTIVE',
      createdAt: now.toISOString(),
      retiredAt: null,
      material: this.guard(() => this.wrapper.wrap(randomBytes(KEY_LENGTH)))
    };
  }

  async activeKey(now: Date): Promise<ProtectionKey> {
    const keystore = this.read();
    const active = keystore.keys.find((key) => key.state === 'ACTIVE');
    if (active) return this.toKey(active);
    const created = this.create(now);
    this.write({ ...keystore, keys: [...keystore.keys, created] });
    return this.toKey(created);
  }

  async keyById(keyId: string): Promise<ProtectionKey | null> {
    const stored = this.read().keys.find((key) => key.keyId === keyId);
    return stored ? this.toKey(stored) : null;
  }

  async list(): Promise<readonly ProtectionKeySummary[]> {
    return this.read().keys.map((key) => ({
      keyId: key.keyId,
      state: key.state,
      createdAt: new Date(key.createdAt),
      retiredAt: key.retiredAt === null ? null : new Date(key.retiredAt)
    }));
  }

  /**
   * La clave anterior se retira, no se borra: mientras exista un respaldo
   * cifrado con ella, olvidarla sería perder ese respaldo.
   */
  async rotate(now: Date): Promise<{ readonly keyId: string; readonly retiredKeyId: string | null }> {
    const keystore = this.read();
    const previous = keystore.keys.find((key) => key.state === 'ACTIVE') ?? null;
    const created = this.create(now);
    this.write({
      ...keystore,
      keys: [
        ...keystore.keys.map((key) => (key.state === 'ACTIVE'
          ? { ...key, state: 'RETIRED' as const, retiredAt: now.toISOString() }
          : key)),
        created
      ]
    });
    return { keyId: created.keyId, retiredKeyId: previous?.keyId ?? null };
  }

  async forget(keyId: string): Promise<boolean> {
    const keystore = this.read();
    const stored = keystore.keys.find((key) => key.keyId === keyId);
    if (!stored || stored.state === 'ACTIVE') return false;
    this.write({ ...keystore, keys: keystore.keys.filter((key) => key.keyId !== keyId) });
    return true;
  }
}

/**
 * Selecciona la custodia. La excepción de desarrollo exige una señal explícita
 * y se rechaza en producción: no existe degradación silenciosa.
 */
export const openSecretVault = (
  directory: string,
  environment: Readonly<Record<string, string | undefined>> = process.env
): SecretVault => {
  const signal = environment[DEVELOPMENT_VAULT_SIGNAL]?.trim();
  if (signal === undefined || signal.length === 0) return new FileSecretVault(directory, dpapi);
  if (signal !== DEVELOPMENT_VAULT_VALUE) {
    throw new InfrastructureError(
      'SECRET_VAULT_SELECTION_INVALID',
      'The declared key store selection is unknown.'
    );
  }
  if ((environment.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
    throw new InfrastructureError(
      'SECRET_VAULT_UNPROTECTED_IN_PRODUCTION',
      'The unprotected key store cannot be used in production.'
    );
  }
  return new FileSecretVault(directory, unprotected);
};
