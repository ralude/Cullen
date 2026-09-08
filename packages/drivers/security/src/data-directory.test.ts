import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '@supermarket/shared';
import { assertProtectedDirectory, currentAccountSid } from './data-directory.js';

/**
 * Verificación de la ACL del directorio de datos (ADR-0029 D7.2).
 *
 * El archivo operativo no se cifra, así que esta comprobación es la única
 * frontera entre «cualquier cuenta de la máquina lee los hashes de PIN» y
 * «solo el servicio y quien ya es administrador». Se verifica el permiso
 * efectivo del sistema, no bits POSIX que Windows no aplica, y si no se puede
 * verificar, el nodo no abre.
 */
const windows = process.platform === 'win32';

describe('directorio de datos protegido', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  const temporary = (): string => {
    const directory = mkdtempSync(join(tmpdir(), 'cullen-acl-'));
    directories.push(directory);
    return directory;
  };

  /** Deja el directorio como debe dejarlo el instalador del nodo. */
  const harden = (directory: string): string => {
    execFileSync('icacls', [
      directory, '/inheritance:r',
      '/grant', '*S-1-5-18:(OI)(CI)F',
      '/grant', '*S-1-5-32-544:(OI)(CI)F',
      '/grant', `*${currentAccountSid()}:(OI)(CI)F`
    ], { stdio: 'ignore', windowsHide: true });
    return directory;
  };

  const codeOf = (run: () => void): string => {
    try { run(); } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      /** Ningún mensaje público nombra la ruta ni la salida del sistema. */
      expect((error as AppError).message).not.toMatch(/[\\/]/);
      return (error as AppError).code;
    }
    return 'NO_ERROR';
  };

  it.runIf(windows)('acepta un directorio restringido al servicio y a los administradores', () => {
    expect(() => assertProtectedDirectory(harden(temporary()))).not.toThrow();
  });

  it.runIf(windows)('rechaza un directorio legible por cualquier cuenta', () => {
    const directory = harden(temporary());
    execFileSync('icacls', [directory, '/grant', '*S-1-1-0:(OI)(CI)R'], {
      stdio: 'ignore', windowsHide: true
    });

    expect(codeOf(() => assertProtectedDirectory(directory))).toBe('DATA_DIRECTORY_NOT_PROTECTED');
  });

  it.runIf(windows)('rechaza el grupo de usuarios de la máquina', () => {
    const directory = harden(temporary());
    execFileSync('icacls', [directory, '/grant', '*S-1-5-32-545:(OI)(CI)R'], {
      stdio: 'ignore', windowsHide: true
    });

    expect(codeOf(() => assertProtectedDirectory(directory))).toBe('DATA_DIRECTORY_NOT_PROTECTED');
  });

  it.runIf(windows)('rechaza un directorio que no existe en vez de suponerlo seguro', () => {
    expect(codeOf(() => assertProtectedDirectory(join(temporary(), 'ausente'))))
      .toBe('DATA_DIRECTORY_PROTECTION_UNVERIFIABLE');
  });

  it('rechaza una plataforma en la que no puede verificar nada', () => {
    expect(codeOf(() => assertProtectedDirectory(temporary(), { platform: 'linux' })))
      .toBe('DATA_DIRECTORY_PLATFORM_UNSUPPORTED');
  });
});
