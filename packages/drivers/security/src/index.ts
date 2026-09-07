import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Clock, IdGenerator, PinHasher, SessionTokenService } from '@supermarket/core';
import { InfrastructureError } from '@supermarket/shared';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

const derive = (pin: string, salt: Buffer): Promise<Buffer> => new Promise((resolveKey, reject) => {
  scrypt(pin, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (error, key) => {
    if (error) reject(error);
    else resolveKey(key);
  });
});

export class ScryptPinHasher implements PinHasher {
  async hash(pin: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await derive(pin, salt);
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
  }

  async verify(pin: string, encodedHash: string): Promise<boolean> {
    const [algorithm, n, r, p, saltText, keyText] = encodedHash.split('$');
    if (algorithm !== 'scrypt' || Number(n) !== SCRYPT_N || Number(r) !== SCRYPT_R
      || Number(p) !== SCRYPT_P || !saltText || !keyText) {
      throw new InfrastructureError('AUTH_CREDENTIAL_HASH_INVALID', 'Credential hash is invalid.');
    }
    const expected = Buffer.from(keyText, 'base64url');
    const actual = await derive(pin, Buffer.from(saltText, 'base64url'));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  async verifyDummy(pin: string): Promise<void> {
    await derive(pin, Buffer.from('c3VwZXJtYXJrZXQtZHVtbXk', 'base64url'));
  }
}

export class CryptoSessionTokenService implements SessionTokenService {
  generate(): { readonly raw: string; readonly hash: string } {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: this.hash(raw) };
  }

  hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class UuidV7Generator implements IdGenerator {
  generate(): string {
    const bytes = randomBytes(16);
    const timestamp = BigInt(Date.now());
    for (let index = 5; index >= 0; index -= 1) {
      bytes[index] = Number((timestamp >> BigInt((5 - index) * 8)) & 0xffn);
    }
    bytes[6] = (bytes[6]! & 0x0f) | 0x70;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}

export type NodeIdentity = {
  readonly terminalId: string;
  readonly originNodeId: string;
};

const requireId = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InfrastructureError('NODE_IDENTITY_INVALID', 'Node identity is invalid.', {
      details: { field }
    });
  }
  return value.trim();
};

export const defaultNodeIdentityPath = (): string => {
  const programData = process.env.ProgramData;
  if (!programData) {
    throw new InfrastructureError('NODE_IDENTITY_PATH_UNAVAILABLE', 'ProgramData is unavailable.');
  }
  return join(programData, 'SupermarketPlatform', 'node-identity.json');
};

export const loadNodeIdentity = (path = defaultNodeIdentityPath()): NodeIdentity => {
  try {
    const parsed = JSON.parse(readFileSync(resolve(path), 'utf8')) as Record<string, unknown>;
    return {
      terminalId: requireId(parsed.terminalId, 'terminalId'),
      originNodeId: requireId(parsed.originNodeId, 'originNodeId')
    };
  } catch (error) {
    if (error instanceof InfrastructureError) throw error;
    throw new InfrastructureError('NODE_IDENTITY_LOAD_FAILED', 'Node identity could not be loaded.', {
      cause: error
    });
  }
};


export {
  HttpsRemoteApplicationProbe,
  HttpsRemoteSaleIssueProbe,
  HttpsSyncEventPublisher,
  ObservedSyncConnectivity,
  SYNC_DESTINATION_HEADER
} from './sync-transport.js';
export type { SyncTransportConfiguration } from './sync-transport.js';
