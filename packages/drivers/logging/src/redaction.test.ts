import { describe, expect, it } from 'vitest';
import {
  createRedactionOptions,
  describeError,
  isSensitiveFieldName,
  redactText,
  redactValue,
  REDACTION_CENSOR
} from './index.js';

describe('technical log redaction', () => {
  it('recognises a secret by field name and not by position', () => {
    for (const name of [
      'pin', 'PIN', 'pinHash', 'pin_hash', 'newPin', 'password', 'passphrase',
      'token', 'sessionToken', 'secret', 'credentialHash', 'authorization',
      'cookie', 'apiKey', 'private-key', 'key', 'cardNumber', 'card_number',
      'creditCard', 'pan', 'cvv', 'hash', 'signature'
    ]) {
      expect(isSensitiveFieldName(name), name).toBe(true);
    }
    for (const name of [
      'correlationId', 'terminalId', 'operation', 'errorCode', 'displayName',
      'operatorCode', 'eventHash', 'shipping', 'spinner', 'discardedCount'
    ]) {
      expect(isSensitiveFieldName(name), name).toBe(false);
    }
  });

  it('redacts a sensitive field at any depth and preserves the rest', () => {
    expect(redactValue({
      operatorCode: 'OP001',
      credentials: { pin: '123456', card: { cardNumber: '4111111111111111' } },
      attempts: [{ token: 'opaque-token', outcome: 'FAILED' }]
    })).toEqual({
      operatorCode: 'OP001',
      credentials: REDACTION_CENSOR,
      attempts: [{ token: REDACTION_CENSOR, outcome: 'FAILED' }]
    });
  });

  it('does not loop on a circular structure', () => {
    const entry: Record<string, unknown> = { module: 'http' };
    entry.self = entry;

    expect(redactValue(entry)).toEqual({ module: 'http', self: '[CIRCULAR]' });
  });

  it('censors an assignment inside free text', () => {
    expect(redactText('login failed for OP001 with pin=123456'))
      .toBe(`login failed for OP001 with pin=${REDACTION_CENSOR}`);
    expect(redactText('{"operatorCode":"OP001","pin":"123456"}'))
      .toBe(`{"operatorCode":"OP001","pin":${REDACTION_CENSOR}}`);
    expect(redactText('statusCode=500')).toBe('statusCode=500');
    /** Redactar dos veces no envuelve el censor: el formateador puede repasar una descripción ya segura. */
    expect(redactText(redactText('pin=123456'))).toBe(`pin=${REDACTION_CENSOR}`);
  });

  it('censors the path of protected material and keeps the rest of the diagnosis', () => {
    for (const path of [
      String.raw`C:\ProgramData\Cullen\keys\node-keys.json`,
      String.raw`C:\ProgramData\Cullen\tls\sync-client.pem.sealed`,
      '/etc/cullen/certs/ca.crt',
      String.raw`\\estacion\material\ca.key`,
      '/var/lib/cullen/secrets/vault.dat'
    ]) {
      expect(redactText(`ENOENT: no such file or directory, open '${path}'`), path)
        .toBe(`ENOENT: no such file or directory, open '${REDACTION_CENSOR}'`);
    }
    /** Lo que no es material sigue sirviendo para diagnosticar. */
    for (const path of [
      String.raw`C:\ProgramData\Cullen\data\node.sqlite`,
      '/var/log/cullen/server.log',
      'and/or'
    ]) {
      expect(redactText(`no se pudo abrir ${path}`), path).toBe(`no se pudo abrir ${path}`);
    }
    /** Redactar dos veces no vuelve a envolver el censor. */
    expect(redactText(redactText(String.raw`open C:\Cullen\keys\node-keys.json`)))
      .toBe(`open ${REDACTION_CENSOR}`);
  });

  it('censors a protected path inside the message, the stack and the cause chain', () => {
    const root = Object.assign(
      new Error(String.raw`EPERM: operation not permitted, open 'C:\Cullen\keys\node-keys.json'`),
      { code: 'EPERM' }
    );
    root.stack = [
      `Error: ${root.message}`,
      String.raw`    at read (C:\Users\op\cullen\packages\drivers\security\src\secret-vault.ts:120:5)`,
      String.raw`    at open (C:\Cullen\keys\node-keys.json:1:1)`
    ].join('\n');
    const wrapper = new Error('the node key store is not available.', { cause: root });

    const described = describeError(wrapper);
    const serialized = JSON.stringify(described);

    expect(serialized).not.toContain('node-keys.json');
    expect(serialized).not.toContain('Cullen\\\\keys');
    /** El archivo de código del stack no es material: se conserva. */
    expect(described.cause).toMatchObject({ code: 'EPERM' });
    expect(JSON.stringify(described.cause)).toContain('secret-vault.ts:120:5');
  });

  it('describes an error with a stable code and a redacted cause chain', () => {
    const root = new Error('credential rejected with pin=123456');
    const wrapper = Object.assign(
      new Error('authentication failed', { cause: root }),
      { code: 'AUTHENTICATION_FAILED' }
    );
    Object.assign(root, { cause: { operatorCode: 'OP001', pin: '123456' } });

    const description = describeError(wrapper);

    expect(description.type).toBe('Error');
    expect(description.code).toBe('AUTHENTICATION_FAILED');
    expect(description.message).toBe('authentication failed');
    expect(JSON.stringify(description)).not.toContain('123456');
    expect(JSON.stringify(description)).toContain('OP001');
  });

  it('ignores an unstable code and keeps a non-error throwable readable', () => {
    expect(describeError(Object.assign(new Error('boom'), { code: 42 })).code).toBeUndefined();
    expect(describeError('pin=123456')).toEqual({
      type: 'string', message: `pin=${REDACTION_CENSOR}`
    });
  });

  it('exposes a pino configuration that redacts entries and headers', () => {
    const options = createRedactionOptions(['req.body']);

    expect(options.redact.censor).toBe(REDACTION_CENSOR);
    expect(options.redact.paths).toContain('req.headers.cookie');
    expect(options.redact.paths).toContain('req.body');
    expect(options.formatters.log({ module: 'http', context: { pin: '123456' } }))
      .toEqual({ module: 'http', context: { pin: REDACTION_CENSOR } });
  });

  it('leaves a class instance to the serializer of the logger', () => {
    class Socket {
      readonly remoteAddress = '127.0.0.1';
    }
    const socket = new Socket();

    expect((redactValue({ socket }) as { readonly socket: Socket }).socket).toBe(socket);
  });
});
