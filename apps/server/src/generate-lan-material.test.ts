import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadFileProtection, openSecretVault } from '@supermarket/driver-security';
import { generateLanMaterial } from './generate-lan-material.ts';
import { readSyncListenerConfiguration } from './sync/lan-listener.ts';
import { readSyncClientConfiguration } from './sync/lan-client.ts';

/**
 * Emisión del material TLS de la LAN.
 *
 * Lo que hay que demostrar no es que se escriban archivos, sino que el
 * resultado **sirve para el transporte que ya existe**: cadena verificable
 * contra la autoridad, los nombres que la otra punta va a exigir, uso para las
 * dos puntas del mTLS, y que el arranque lo acepta una vez sellado —y sólo
 * entonces, porque `SECRET_MATERIAL_NOT_SEALED` rechaza el texto claro—.
 */
const DEVELOPMENT = { CULLEN_SECRET_VAULT: 'UNPROTECTED_DEVELOPMENT' };

describe('emisión de material TLS para la LAN', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  const temporary = (): string => {
    const directory = mkdtempSync(join(tmpdir(), 'cullen-lan-'));
    directories.push(directory);
    return directory;
  };

  const issue = (root: string) => generateLanMaterial({
    directory: join(root, 'material'),
    caCommonName: 'Cullen LAN CA de prueba',
    days: 90,
    nodes: [
      { name: 'coordinator', hosts: ['192.168.1.10', 'coordinador.tienda.local'] },
      { name: 'terminal-01', hosts: ['192.168.1.21'] }
    ]
  });

  it('emite una autoridad y certificados de nodo verificables contra ella', () => {
    const material = issue(temporary());

    const authority = new X509Certificate(readFileSync(material.caCertPath));
    expect(authority.ca).toBe(true);

    for (const node of material.nodes) {
      const certificate = new X509Certificate(readFileSync(node.certPath));
      expect(certificate.ca).toBe(false);
      expect(certificate.verify(authority.publicKey)).toBe(true);
      expect(certificate.issuer).toContain('Cullen LAN CA de prueba');
      /** Un nodo escucha y entrega con la misma identidad: sirve a las dos puntas. */
      expect(certificate.keyUsage).toEqual(
        expect.arrayContaining(['1.3.6.1.5.5.7.3.1', '1.3.6.1.5.5.7.3.2'])
      );
    }

    const [coordinator, terminal] = material.nodes;
    const coordinatorCertificate = new X509Certificate(readFileSync(coordinator!.certPath));
    expect(coordinatorCertificate.checkIP('192.168.1.10')).toBe('192.168.1.10');
    expect(coordinatorCertificate.checkHost('coordinador.tienda.local'))
      .toBe('coordinador.tienda.local');
    expect(coordinatorCertificate.checkIP('192.168.1.21')).toBeUndefined();

    const terminalCertificate = new X509Certificate(readFileSync(terminal!.certPath));
    expect(terminalCertificate.checkIP('192.168.1.21')).toBe('192.168.1.21');
    /** Cada nodo tiene su propia clave: comprometer una no compromete la LAN. */
    expect(readFileSync(coordinator!.keyPath, 'utf8'))
      .not.toBe(readFileSync(terminal!.keyPath, 'utf8'));
  });

  it('produce material que el arranque acepta sólo después de sellarlo', async () => {
    const root = temporary();
    const material = issue(root);
    const protection = await loadFileProtection({
      vault: openSecretVault(join(root, 'keys'), DEVELOPMENT),
      nodeId: '01991992-a860-7000-8000-000000000202',
      now: new Date('2026-09-09T12:00:00.000Z')
    });
    const [coordinator, terminal] = material.nodes;

    /** En claro, el nodo se niega: es la garantía que ADR-0029 D7.3 promete. */
    expect(() => readSyncListenerConfiguration({
      SYNC_LISTENER_PORT: '8443',
      SYNC_LISTENER_TLS_KEY_PATH: coordinator!.keyPath,
      SYNC_LISTENER_TLS_CERT_PATH: coordinator!.certPath,
      SYNC_LISTENER_TLS_CLIENT_CA_PATHS: material.caCertPath
    }, protection.readSecret)).toThrowError(expect.objectContaining({
      code: 'SYNC_LISTENER_MATERIAL_UNREADABLE'
    }));

    const seal = (path: string): string => {
      const sealed = `${path}${protection.suffix}`;
      protection.seal(path, sealed);
      return sealed;
    };

    const listener = readSyncListenerConfiguration({
      SYNC_LISTENER_PORT: '8443',
      SYNC_LISTENER_TLS_KEY_PATH: seal(coordinator!.keyPath),
      SYNC_LISTENER_TLS_CERT_PATH: seal(coordinator!.certPath),
      SYNC_LISTENER_TLS_CLIENT_CA_PATHS: seal(material.caCertPath)
    }, protection.readSecret);
    expect(listener?.https.cert).toContain('BEGIN CERTIFICATE');
    expect(listener?.https.ca).toHaveLength(1);

    const client = readSyncClientConfiguration({
      SYNC_COORDINATOR_NODE_ID: 'node-coordinator',
      SYNC_COORDINATOR_HOST: '192.168.1.10',
      SYNC_COORDINATOR_PORT: '8443',
      SYNC_CLIENT_TLS_KEY_PATH: seal(terminal!.keyPath),
      SYNC_CLIENT_TLS_CERT_PATH: seal(terminal!.certPath),
      SYNC_CLIENT_TLS_CA_PATHS: `${material.caCertPath}${protection.suffix}`
    }, protection.readSecret);
    expect(client?.destinationNodeId).toBe('node-coordinator');
  });

  it('exige un nombre por el que alcanzar cada nodo', () => {
    expect(() => generateLanMaterial({
      directory: join(temporary(), 'material'),
      nodes: [{ name: 'coordinator', hosts: [] }]
    })).toThrowError(expect.objectContaining({ code: 'LAN_MATERIAL_HOSTS_REQUIRED' }));

    expect(() => generateLanMaterial({
      directory: join(temporary(), 'material'), nodes: []
    })).toThrowError(expect.objectContaining({ code: 'LAN_MATERIAL_NODES_REQUIRED' }));
  });
});
