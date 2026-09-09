import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AppError, ApplicationError } from '@supermarket/shared';
import { assertProtectedDirectory, currentAccountSid } from '@supermarket/driver-security';
import { readNodeStorage } from './node-storage.ts';

/**
 * Perímetro protegido para correr el nodo en una máquina de desarrollo.
 *
 * El arranque verifica la ACL efectiva de donde escribe y falla cerrado
 * ([ADR-0029](../../../docs/architecture/adr/0029-proteccion-de-datos-en-reposo.md) D7.2). En una
 * instalación esa ACL la aplica el instalador MSI; en desarrollo no hay
 * instalador, así que el directorio hereda los permisos del árbol de trabajo
 * —legible por cualquier cuenta de la máquina— y el nodo se niega a arrancar,
 * como debe.
 *
 * Esta herramienta aplica localmente la misma restricción que el MSI, con una
 * sola diferencia: concede a la cuenta que desarrolla en lugar de a la cuenta
 * de servicio. No relaja la verificación ni introduce una excepción de
 * desarrollo: la ACL que deja es la que el arranque exige.
 *
 *   pnpm --filter @supermarket/server prepare-development-storage
 */

const ICACLS_TIMEOUT_MS = 20_000;

const icacls = (args: readonly string[]): void => {
  try {
    execFileSync('icacls.exe', [...args], {
      encoding: 'utf8', windowsHide: true, timeout: ICACLS_TIMEOUT_MS, stdio: 'pipe'
    });
  } catch (cause) {
    throw new ApplicationError(
      'DEVELOPMENT_STORAGE_ACL_FAILED',
      'The development data perimeter could not be restricted.',
      { cause }
    );
  }
};

/**
 * La restricción se aplica al **directorio**, con herencia hacia lo que
 * contiene. `(OI)(CI)` son marcas de herencia y solo significan algo en un
 * contenedor: aplicarlas a los archivos con `/T` les quitaría la herencia sin
 * concederles nada y dejaría la base ilegible incluso para su dueño.
 *
 * Los archivos que ya existen vuelven a heredar en vez de recibir una ACL
 * propia, para que la herramienta pueda repetirse sobre un perímetro vivo.
 */
const restrict = (directory: string, accountSid: string): void => {
  icacls([
    directory,
    '/inheritance:r',
    '/grant:r', `*${accountSid}:(OI)(CI)F`,
    '/grant:r', '*S-1-5-18:(OI)(CI)F',
    '/grant:r', '*S-1-5-32-544:(OI)(CI)F'
  ]);
  if (readdirSync(directory).length > 0) icacls([join(directory, '*'), '/inheritance:e', '/T']);
};

const run = (): void => {
  if (process.platform !== 'win32') {
    throw new ApplicationError(
      'DEVELOPMENT_STORAGE_PLATFORM_UNSUPPORTED',
      'The data perimeter is only verifiable on the packaged platform.'
    );
  }
  const storage = readNodeStorage();
  const directories = [
    dirname(storage.databasePath), storage.backupDirectory, storage.keystoreDirectory
  ];
  const accountSid = currentAccountSid();

  for (const directory of directories) {
    mkdirSync(directory, { recursive: true });
    restrict(directory, accountSid);
    /** Se comprueba con la misma verificación del arranque, no con otra propia. */
    assertProtectedDirectory(directory);
    process.stdout.write(`Protected: ${directory}\n`);
  }
};

try {
  run();
} catch (error) {
  const failure = error instanceof AppError
    ? `${error.code}: ${error.message}`
    : String(error);
  process.stderr.write(`${failure}\n`);
  process.exitCode = 1;
}
