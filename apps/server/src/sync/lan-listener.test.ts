import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readSyncListenerConfiguration } from './lan-listener.ts';
import { issueNodeCertificate } from './testing/certificates.ts';

const identity = issueNodeCertificate('node-coordinator');
const terminal = issueNodeCertificate('node-terminal-1');
let directory: string;
let keyPath: string;
let certPath: string;
let caPath: string;

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'sync-listener-'));
  keyPath = join(directory, 'node.key.pem');
  certPath = join(directory, 'node.cert.pem');
  caPath = join(directory, 'clients.pem');
  writeFileSync(keyPath, identity.privateKeyPem);
  writeFileSync(certPath, identity.certificatePem);
  writeFileSync(caPath, terminal.certificatePem);
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

const complete = (): Record<string, string> => ({
  SYNC_LISTENER_PORT: '7443',
  SYNC_LISTENER_TLS_KEY_PATH: keyPath,
  SYNC_LISTENER_TLS_CERT_PATH: certPath,
  SYNC_LISTENER_TLS_CLIENT_CA_PATHS: caPath
});

describe('configuración del listener de LAN', () => {
  it('no escucha en LAN cuando el nodo no la declara', () => {
    expect(readSyncListenerConfiguration({})).toBeNull();
  });

  it('carga material completo y expone la escucha declarada', () => {
    const configuration = readSyncListenerConfiguration({
      ...complete(), SYNC_LISTENER_HOST: '192.168.1.10'
    });

    expect(configuration).toMatchObject({ host: '192.168.1.10', port: 7443 });
    expect(configuration?.https.cert).toContain('BEGIN CERTIFICATE');
    expect(configuration?.https.ca).toHaveLength(1);
  });

  it.each([
    ['sin certificado', 'SYNC_LISTENER_TLS_CERT_PATH'],
    ['sin clave', 'SYNC_LISTENER_TLS_KEY_PATH'],
    ['sin autoridades de cliente', 'SYNC_LISTENER_TLS_CLIENT_CA_PATHS'],
    ['sin puerto', 'SYNC_LISTENER_PORT']
  ])('falla cerrado %s', (_case, missing) => {
    const environment = complete();
    delete environment[missing];

    expect(() => readSyncListenerConfiguration(environment)).toThrow(
      expect.objectContaining({ code: 'SYNC_LISTENER_CONFIGURATION_INCOMPLETE' })
    );
  });

  it('falla cerrado ante un puerto inválido', () => {
    expect(() => readSyncListenerConfiguration({ ...complete(), SYNC_LISTENER_PORT: '0' }))
      .toThrow(expect.objectContaining({ code: 'SYNC_LISTENER_PORT_INVALID' }));
  });

  it('falla cerrado si el material declarado no puede leerse', () => {
    expect(() => readSyncListenerConfiguration({
      ...complete(), SYNC_LISTENER_TLS_KEY_PATH: join(directory, 'ausente.pem')
    })).toThrow(expect.objectContaining({ code: 'SYNC_LISTENER_MATERIAL_UNREADABLE' }));
  });
});
