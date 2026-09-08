import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { ProtectionKey, SecretVault } from '@supermarket/core';
import { InfrastructureError } from '@supermarket/shared';
import { isSealed, open, readSealHeader, seal } from './envelope.js';

/**
 * Protección de archivos con la clave del nodo
 * ([ADR-0029](../../../../docs/architecture/adr/0029-proteccion-de-datos-en-reposo.md) D7.3).
 *
 * Trabaja sobre una foto inmutable del almacén tomada al arrancar, porque quien
 * la usa —la ruta de respaldo del arranque— es síncrona. Rotar cambia el
 * almacén, no esta foto: el proceso que rota vuelve a leerla.
 */
export type FileProtection = {
  /** Clave con la que se sella el material nuevo. */
  readonly keyId: string;
  readonly suffix: string;
  seal(sourcePath: string, targetPath: string): void;
  open(sourcePath: string, targetPath: string): void;
  /** Material de configuración: sellado se abre, en claro se devuelve tal cual. */
  read(path: string): string;
  /** Secreto de configuración: nunca admite el fallback histórico en claro. */
  readSecret(path: string): string;
  /** Vuelve a sellar un secreto existente con la clave activa. */
  reseal(path: string): void;
  /** Identifica la clave de un archivo sellado sin abrir su contenido. */
  keyIdOf(path: string): string | null;
};

export const SEALED_SUFFIX = '.sealed';

export const loadFileProtection = async (options: {
  readonly vault: SecretVault;
  readonly nodeId: string;
  readonly now: Date;
}): Promise<FileProtection> => {
  const active = await options.vault.activeKey(options.now);
  const summaries = await options.vault.list();
  const keys = new Map<string, ProtectionKey>([[active.keyId, active]]);
  for (const summary of summaries) {
    if (keys.has(summary.keyId)) continue;
    const key = await options.vault.keyById(summary.keyId);
    if (key) keys.set(key.keyId, key);
  }

  const keyFor = (sealed: Buffer): ProtectionKey => {
    const header = readSealHeader(sealed);
    const key = keys.get(header.keyId);
    if (!key) {
      /**
       * La clave que cifró este archivo ya no está en el almacén. No hay
       * recuperación posible y decirlo es parte de la honestidad del cifrado.
       */
      throw new InfrastructureError(
        'SEALED_MATERIAL_KEY_UNAVAILABLE',
        'The key that sealed this material is no longer available.'
      );
    }
    return key;
  };

  return {
    keyId: active.keyId,
    suffix: SEALED_SUFFIX,
    seal: (sourcePath, targetPath) => {
      writeFileSync(targetPath, seal(
        readFileSync(sourcePath), active, { nodeId: options.nodeId, now: options.now }
      ));
    },
    open: (sourcePath, targetPath) => {
      const sealed = readFileSync(sourcePath);
      try {
        writeFileSync(targetPath, open(sealed, keyFor(sealed), { nodeId: options.nodeId }));
      } catch (error) {
        /** Un destino a medio escribir sería peor que no restaurar nada. */
        rmSync(targetPath, { force: true });
        throw error;
      }
    },
    read: (path) => {
      const content = readFileSync(path);
      return isSealed(content)
        ? open(content, keyFor(content), { nodeId: options.nodeId }).toString('utf8')
        : content.toString('utf8');
    },
    readSecret: (path) => {
      const content = readFileSync(path);
      if (!isSealed(content)) {
        throw new InfrastructureError(
          'SECRET_MATERIAL_NOT_SEALED',
          'The configured secret material is not sealed.'
        );
      }
      return open(content, keyFor(content), { nodeId: options.nodeId }).toString('utf8');
    },
    reseal: (path) => {
      const content = readFileSync(path);
      if (!isSealed(content)) {
        throw new InfrastructureError(
          'SECRET_MATERIAL_NOT_SEALED',
          'The configured secret material is not sealed.'
        );
      }
      const plaintext = open(content, keyFor(content), { nodeId: options.nodeId });
      const staging = `${path}.${process.pid}-${randomUUID()}.staging`;
      try {
        writeFileSync(staging, seal(
          plaintext, active, { nodeId: options.nodeId, now: options.now }
        ));
        renameSync(staging, path);
      } finally {
        plaintext.fill(0);
        rmSync(staging, { force: true });
      }
    },
    keyIdOf: (path) => {
      const content = readFileSync(path);
      return isSealed(content) ? readSealHeader(content).keyId : null;
    }
  };
};
