import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { InfrastructureError } from '@supermarket/shared';

/**
 * Protección del directorio de datos del nodo
 * ([ADR-0029](../../../../docs/architecture/adr/0029-proteccion-de-datos-en-reposo.md) D7.2).
 *
 * El archivo SQLite operativo no se cifra, de modo que esta verificación es la
 * frontera real entre «cualquier cuenta de la máquina lee los hashes de PIN» y
 * «solo el servicio y quien ya es administrador». Se consulta el permiso
 * efectivo que aplica el sistema —no bits POSIX, que Windows ignora— y se falla
 * cerrado cuando es amplio, indeterminable o no verificable.
 */

/** Cuentas que sí pueden leer el directorio: el sistema, los administradores y el servicio. */
const ALLOWED_SIDS = new Set(['S-1-5-18', 'S-1-5-32-544', 'S-1-3-0']);

const POWERSHELL_TIMEOUT_MS = 20_000;

type AccessEntry = { readonly sid: string; readonly type: string };

const powershell = (script: string): string => execFileSync(
  'powershell.exe',
  ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
  { encoding: 'utf8', windowsHide: true, timeout: POWERSHELL_TIMEOUT_MS }
).trim();

const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** SID de la cuenta con la que corre este proceso: es la del servicio del nodo. */
export const currentAccountSid = (): string => {
  try {
    return powershell('[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value');
  } catch (cause) {
    throw new InfrastructureError(
      'DATA_DIRECTORY_PROTECTION_UNVERIFIABLE',
      'The account of the running node could not be determined.',
      { cause }
    );
  }
};

const readAccess = (directory: string): readonly AccessEntry[] => {
  const script = [
    '$ErrorActionPreference = \'Stop\';',
    `$acl = ([System.IO.DirectoryInfo]::new(${literal(directory)})).GetAccessControl();`,
    '$entries = @($acl.Access | ForEach-Object {',
    '  $id = $_.IdentityReference;',
    '  $sid = if ($id -is [System.Security.Principal.SecurityIdentifier])',
    '    { $id.Value } else { $id.Translate([System.Security.Principal.SecurityIdentifier]).Value };',
    '  [pscustomobject]@{ sid = $sid; type = $_.AccessControlType.ToString() } });',
    'ConvertTo-Json -InputObject $entries -Compress'
  ].join(' ');

  let output: string;
  try {
    output = powershell(script);
  } catch (cause) {
    throw new InfrastructureError(
      'DATA_DIRECTORY_PROTECTION_UNVERIFIABLE',
      'The data directory protection could not be verified.',
      { cause }
    );
  }
  try {
    const parsed = JSON.parse(output === '' ? '[]' : output) as AccessEntry | AccessEntry[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (cause) {
    throw new InfrastructureError(
      'DATA_DIRECTORY_PROTECTION_UNVERIFIABLE',
      'The data directory protection could not be read.',
      { cause }
    );
  }
};

/**
 * El servicio tiene que poder escribir donde guarda su base, sus respaldos
 * temporales y sus secretos. Se comprueba escribiendo, no preguntando: en
 * Windows `fs.access` responde por el modo del archivo y no por la ACL.
 */
const assertWritable = (directory: string): void => {
  const probe = join(directory, `.protection-probe-${process.pid}`);
  try {
    writeFileSync(probe, '');
  } catch (cause) {
    throw new InfrastructureError(
      'DATA_DIRECTORY_UNWRITABLE',
      'The node cannot write in its data directory.',
      { cause }
    );
  } finally {
    rmSync(probe, { force: true });
  }
};

export const assertProtectedDirectory = (
  directory: string,
  options: { readonly platform?: NodeJS.Platform } = {}
): void => {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    /**
     * No se declara una garantía que no se puede verificar. El MVP soportado es
     * Windows; en otra plataforma el nodo se niega en vez de suponer una ACL.
     */
    throw new InfrastructureError(
      'DATA_DIRECTORY_PLATFORM_UNSUPPORTED',
      'Data directory protection is only supported on the packaged platform.'
    );
  }

  const allowed = new Set([...ALLOWED_SIDS, currentAccountSid()]);
  const granted = readAccess(directory)
    .filter((entry) => entry.type === 'Allow' && !allowed.has(entry.sid));
  if (granted.length > 0) {
    throw new InfrastructureError(
      'DATA_DIRECTORY_NOT_PROTECTED',
      'The data directory grants access beyond the node service and local administrators.'
    );
  }
  assertWritable(directory);
};
