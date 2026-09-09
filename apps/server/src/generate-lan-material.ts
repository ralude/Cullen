import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError, ApplicationError } from '@supermarket/shared';

/**
 * Emisión del material TLS de la LAN con una autoridad interna
 * ([ADR-0026](../../../docs/architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md)
 * exige autenticación mutua; ADR-0029 D9 fija su rotación).
 *
 * Se envuelve el `openssl` del sistema en lugar de agregar una dependencia de
 * criptografía: Node no emite certificados X.509 y AGENTS.md prohíbe sumar
 * dependencias sin necesidad concreta. Si `openssl` no está, la herramienta
 * falla con un código estable en vez de improvisar.
 *
 * Emite **material en claro** en un directorio administrativo temporal. El
 * sellado con la clave de cada nodo es un paso local posterior, porque la clave
 * que protege un archivo vive en el almacén del nodo que lo usará y no viaja:
 * ver `docs/operacion/emision-material-lan.md`.
 *
 * Cada certificado sirve para las dos puntas —`serverAuth` y `clientAuth`—
 * porque en una LAN operativa un nodo escucha y entrega con la misma
 * identidad.
 */

const DEFAULT_DAYS = 825;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export type LanNodeRequest = {
  /** Nombre del archivo y `CN` del certificado: `coordinator`, `terminal-01`. */
  readonly name: string;
  /** Nombres por los que la otra punta lo alcanzará: IP de LAN u hostname. */
  readonly hosts: readonly string[];
};

export type LanMaterialRequest = {
  readonly directory: string;
  readonly nodes: readonly LanNodeRequest[];
  readonly caCommonName?: string;
  readonly days?: number;
};

export type LanMaterialResult = {
  readonly caCertPath: string;
  readonly caKeyPath: string;
  readonly nodes: readonly {
    readonly name: string;
    readonly keyPath: string;
    readonly certPath: string;
  }[];
};

const openssl = (args: readonly string[], code: string): void => {
  try {
    execFileSync('openssl', [...args], { stdio: 'ignore', windowsHide: true });
  } catch (cause) {
    throw new ApplicationError(code, 'The OpenSSL command failed.', { cause });
  }
};

export const assertOpenSslAvailable = (): void => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore', windowsHide: true });
  } catch (cause) {
    throw new ApplicationError(
      'OPENSSL_NOT_AVAILABLE',
      'OpenSSL is required to issue LAN material and was not found.',
      { cause }
    );
  }
};

const privateKey = (path: string, code: string): void => openssl(
  ['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', path], code
);

/** Extensiones del certificado de nodo: hoja, mTLS y los nombres que responde. */
const leafExtensions = (hosts: readonly string[]): string => {
  const names = hosts.map((host, index) => (IPV4.test(host)
    ? `IP.${index + 1} = ${host}`
    : `DNS.${index + 1} = ${host}`));
  return [
    '[v3_leaf]',
    'basicConstraints = critical, CA:FALSE',
    'keyUsage = critical, digitalSignature, keyEncipherment',
    'extendedKeyUsage = serverAuth, clientAuth',
    'subjectAltName = @alt_names',
    '',
    '[alt_names]',
    ...names,
    ''
  ].join('\n');
};

export const generateLanMaterial = (request: LanMaterialRequest): LanMaterialResult => {
  if (request.nodes.length === 0) {
    throw new ApplicationError(
      'LAN_MATERIAL_NODES_REQUIRED', 'At least one node must be issued.'
    );
  }
  for (const node of request.nodes) {
    if (node.hosts.length === 0) {
      throw new ApplicationError(
        'LAN_MATERIAL_HOSTS_REQUIRED', 'Each node needs at least one host name or address.'
      );
    }
  }
  assertOpenSslAvailable();

  const days = String(request.days ?? DEFAULT_DAYS);
  const directory = request.directory;
  mkdirSync(directory, { recursive: true });

  const caKeyPath = join(directory, 'ca.key');
  const caCertPath = join(directory, 'ca.pem');
  privateKey(caKeyPath, 'LAN_MATERIAL_CA_KEY_FAILED');
  openssl([
    'req', '-x509', '-new', '-key', caKeyPath, '-sha256', '-days', days,
    '-subj', `/CN=${request.caCommonName ?? 'Cullen LAN CA'}`,
    '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    '-out', caCertPath
  ], 'LAN_MATERIAL_CA_FAILED');

  const nodes = request.nodes.map((node) => {
    const keyPath = join(directory, `${node.name}.key`);
    const certPath = join(directory, `${node.name}.pem`);
    const requestPath = join(directory, `${node.name}.csr`);
    const extensionsPath = join(directory, `${node.name}.cnf`);

    privateKey(keyPath, 'LAN_MATERIAL_NODE_KEY_FAILED');
    openssl([
      'req', '-new', '-key', keyPath, '-subj', `/CN=${node.name}`, '-out', requestPath
    ], 'LAN_MATERIAL_REQUEST_FAILED');
    writeFileSync(extensionsPath, leafExtensions(node.hosts));
    openssl([
      'x509', '-req', '-in', requestPath, '-CA', caCertPath, '-CAkey', caKeyPath,
      '-CAcreateserial', '-sha256', '-days', days,
      '-extfile', extensionsPath, '-extensions', 'v3_leaf', '-out', certPath
    ], 'LAN_MATERIAL_SIGN_FAILED');

    /** El CSR y las extensiones son insumos; no forman parte del entregable. */
    rmSync(requestPath, { force: true });
    rmSync(extensionsPath, { force: true });
    return { name: node.name, keyPath, certPath };
  });

  return { caCertPath, caKeyPath, nodes };
};

const usage = [
  'Uso: generate-lan-material --out <directorio> <nombre>=<host>[,<host>] ...',
  '',
  '  --out <directorio>   Destino del material en claro (ACL restringida).',
  '  --days <n>           Vigencia de los certificados; 825 por omisión.',
  '  --ca-name <texto>    CN de la autoridad; «Cullen LAN CA» por omisión.',
  '',
  'Ejemplo:',
  '  generate-lan-material --out C:\\material --days 825 \\',
  '    coordinator=192.168.1.10 terminal-01=192.168.1.21 terminal-02=192.168.1.22'
].join('\n');

const parse = (argv: readonly string[]): LanMaterialRequest => {
  let directory: string | undefined;
  let days: number | undefined;
  let caCommonName: string | undefined;
  const nodes: LanNodeRequest[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--out') { directory = argv[index += 1]; continue; }
    if (argument === '--ca-name') { caCommonName = argv[index += 1]; continue; }
    if (argument === '--days') {
      const declared = argv[index += 1];
      if (declared === undefined || !/^[1-9]\d*$/.test(declared)) {
        throw new ApplicationError('LAN_MATERIAL_ARGUMENTS_INVALID', usage);
      }
      days = Number.parseInt(declared, 10);
      continue;
    }
    const [name, hosts] = argument.split('=');
    if (!name || !hosts) throw new ApplicationError('LAN_MATERIAL_ARGUMENTS_INVALID', usage);
    nodes.push({ name, hosts: hosts.split(',').map((host) => host.trim()).filter(Boolean) });
  }

  if (directory === undefined || nodes.length === 0) {
    throw new ApplicationError('LAN_MATERIAL_ARGUMENTS_INVALID', usage);
  }
  return {
    directory, nodes,
    ...(days === undefined ? {} : { days }),
    ...(caCommonName === undefined ? {} : { caCommonName })
  };
};

/** `tsx src/generate-lan-material.ts` como CLI; importable desde una prueba. */
const invokedDirectly = process.argv[1] !== undefined
  && /generate-lan-material\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  try {
    const result = generateLanMaterial(parse(process.argv.slice(2)));
    process.stdout.write(`Autoridad: ${result.caCertPath}\n`);
    for (const node of result.nodes) process.stdout.write(`Nodo ${node.name}: ${node.certPath}\n`);
    process.stdout.write(
      '\nMaterial en claro. Séllalo en cada nodo antes de configurarlo y borra el original:\n'
      + 'ver docs/operacion/emision-material-lan.md\n'
    );
  } catch (error) {
    const code = error instanceof AppError ? error.code : 'LAN_MATERIAL_FAILED';
    const message = error instanceof AppError ? error.message : 'LAN material could not be issued.';
    process.stderr.write(`${code}: ${message}\n`);
    process.exitCode = 1;
  }
}
