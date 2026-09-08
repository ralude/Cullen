import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ProtectionKey } from '@supermarket/core';
import { InfrastructureError } from '@supermarket/shared';

/**
 * Sobre cifrado del material que puede salir de la máquina
 * ([ADR-0029](../../../../docs/architecture/adr/0029-proteccion-de-datos-en-reposo.md) D7.3).
 *
 * No hay criptografía propia: AES-256-GCM de `node:crypto`, nonce aleatorio de
 * 96 bits por archivo y encabezado versionado que viaja **autenticado** como
 * AAD. Manipular el encabezado —cambiar el nodo, la clave o la versión— rompe
 * la verificación igual que manipular el ciphertext.
 *
 *   magic(11) | version(1) | headerLength(2) | header | nonce(12) | tag(16) | ciphertext
 */
const MAGIC = Buffer.from('CULLEN-SEAL', 'ascii');
const VERSION = 1;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const PREFIX_LENGTH = MAGIC.length + 1 + 2;

export type SealHeader = {
  readonly keyId: string;
  readonly nodeId: string;
  readonly algorithm: 'aes-256-gcm';
  readonly sealedAt: string;
};

const invalid = (code: string, message: string, cause?: unknown): InfrastructureError =>
  new InfrastructureError(code, message, cause === undefined ? {} : { cause });

/** Un archivo sellado se reconoce por su encabezado, no por su extensión. */
export const isSealed = (content: Buffer): boolean =>
  content.length > PREFIX_LENGTH && content.subarray(0, MAGIC.length).equals(MAGIC);

export const seal = (
  plaintext: Buffer,
  key: ProtectionKey,
  context: { readonly nodeId: string; readonly now: Date }
): Buffer => {
  const header: SealHeader = {
    keyId: key.keyId,
    nodeId: context.nodeId,
    algorithm: 'aes-256-gcm',
    sealedAt: context.now.toISOString()
  };
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const prefix = Buffer.concat([MAGIC, Buffer.from([VERSION]), Buffer.alloc(2)]);
  prefix.writeUInt16BE(headerBytes.length, MAGIC.length + 1);

  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key.material, nonce);
  cipher.setAAD(Buffer.concat([prefix, headerBytes]));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([prefix, headerBytes, nonce, cipher.getAuthTag(), ciphertext]);
};

export const readSealHeader = (sealed: Buffer): SealHeader => {
  if (!isSealed(sealed) || sealed[MAGIC.length] !== VERSION) {
    throw invalid('SEALED_MATERIAL_FORMAT_UNKNOWN', 'The sealed material has an unknown format.');
  }
  const headerLength = sealed.readUInt16BE(MAGIC.length + 1);
  if (sealed.length < PREFIX_LENGTH + headerLength + NONCE_LENGTH + TAG_LENGTH) {
    throw invalid('SEALED_MATERIAL_FORMAT_UNKNOWN', 'The sealed material is truncated.');
  }
  try {
    return JSON.parse(
      sealed.subarray(PREFIX_LENGTH, PREFIX_LENGTH + headerLength).toString('utf8')
    ) as SealHeader;
  } catch (cause) {
    throw invalid('SEALED_MATERIAL_FORMAT_UNKNOWN', 'The sealed material header is invalid.', cause);
  }
};

export const open = (
  sealed: Buffer,
  key: ProtectionKey,
  context: { readonly nodeId: string }
): Buffer => {
  const header = readSealHeader(sealed);
  if (header.nodeId !== context.nodeId) {
    throw invalid('SEALED_MATERIAL_NODE_MISMATCH', 'The sealed material belongs to another node.');
  }
  if (header.keyId !== key.keyId) {
    throw invalid('SEALED_MATERIAL_KEY_MISMATCH', 'The sealed material was sealed with another key.');
  }
  const headerLength = sealed.readUInt16BE(MAGIC.length + 1);
  const nonceAt = PREFIX_LENGTH + headerLength;
  const tagAt = nonceAt + NONCE_LENGTH;
  const bodyAt = tagAt + TAG_LENGTH;

  const decipher = createDecipheriv(
    'aes-256-gcm', key.material, sealed.subarray(nonceAt, tagAt)
  );
  decipher.setAAD(sealed.subarray(0, nonceAt));
  decipher.setAuthTag(sealed.subarray(tagAt, bodyAt));
  try {
    return Buffer.concat([decipher.update(sealed.subarray(bodyAt)), decipher.final()]);
  } catch (cause) {
    /** Tag inválido: el archivo fue manipulado o no corresponde a esta clave. */
    throw invalid('SEALED_MATERIAL_TAMPERED', 'The sealed material failed authentication.', cause);
  }
};
