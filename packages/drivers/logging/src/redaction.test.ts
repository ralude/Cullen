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
