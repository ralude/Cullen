import { describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';

/**
 * La garantía se comprueba sobre la salida real del logger compuesto, no sobre
 * su configuración: la prueba captura cada línea escrita y busca el secreto.
 */
describe('technical logging of the operator API', () => {
  const capture = () => {
    const lines: string[] = [];
    return {
      lines,
      destination: { write: (chunk: string): void => { lines.push(chunk); } }
    };
  };

  const failingApp = (thrown: (body: unknown) => unknown) => {
    const { lines, destination } = capture();
    const app = buildApp(undefined, { logDestination: destination });
    app.post('/test/failure', async (request) => {
      throw thrown(request.body);
    });
    return { app, lines };
  };

  const entries = (lines: readonly string[]): readonly Record<string, unknown>[] =>
    lines.map((line) => JSON.parse(line) as Record<string, unknown>);

  it('keeps every secret of a failed request out of the log', async () => {
    const { app, lines } = failingApp((body) => new Error('persistence failed', {
      cause: new Error('write rejected', { cause: { input: body } })
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/test/failure',
      headers: { authorization: 'Bearer session-token-value', cookie: 'pos_session=opaque-token' },
      payload: {
        operatorCode: 'OP001',
        pin: '123456',
        credentialHash: 'scrypt$16384$8$1$c2FsdA$a2V5',
        privateKey: 'BEGIN PRIVATE KEY',
        payment: { cardNumber: '4111111111111111' }
      }
    });
    await app.close();

    expect(response.statusCode).toBe(500);
    const logged = lines.join('\n');
    for (const secret of [
      '123456', 'scrypt$16384', 'BEGIN PRIVATE KEY', '4111111111111111',
      'session-token-value', 'opaque-token'
    ]) {
      expect(logged, secret).not.toContain(secret);
    }
    /** El dato no sensible de la misma entrada sigue sirviendo para diagnosticar. */
    expect(logged).toContain('OP001');
    expect(logged).toContain('INTERNAL_ERROR');
  });

  it('describes an unexpected error instead of logging it raw', async () => {
    const { app, lines } = failingApp(() => new Error('unexpected pin=123456'));

    const response = await app.inject({ method: 'POST', url: '/test/failure', payload: {} });
    await app.close();

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(response.body).not.toContain('unexpected');
    const unhandled = entries(lines).find((line) => line.msg === 'Unhandled request error');
    expect(unhandled?.error).toMatchObject({ type: 'Error', message: 'unexpected pin=[REDACTED]' });
    expect(unhandled?.err).toBeUndefined();
    expect(unhandled).toMatchObject({
      service: 'supermarket-server',
      module: 'http',
      actorId: null,
      terminalId: null,
      originNodeId: null,
      operation: 'POST /test/failure',
      errorCode: 'INTERNAL_ERROR'
    });
    expect(typeof unhandled?.correlationId).toBe('string');
    expect(JSON.stringify(unhandled)).not.toContain('123456');
  });

  it('redacts a known field name anywhere in a log entry, without extra configuration', async () => {
    const { lines, destination } = capture();
    const app = buildApp(undefined, { logDestination: destination });

    app.log.info({
      module: 'http',
      diagnostics: { attempt: { newPin: '987654' }, correlationId: 'abc12345' }
    }, 'Diagnostic entry');
    await app.close();

    const entry = entries(lines)[0] as {
      readonly diagnostics: { readonly attempt: unknown; readonly correlationId: string };
    } | undefined;
    expect(entry?.diagnostics.attempt).toEqual({ newPin: '[REDACTED]' });
    expect(entry?.diagnostics.correlationId).toBe('abc12345');
  });
});
