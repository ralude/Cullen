import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabaseBackup, type BackupProtection } from './backup.js';

/**
 * Higiene del intermedio del respaldo (ADR-0029 D7.3).
 *
 * La copia que `vacuum into` produce es la base entera en texto claro y solo
 * vive mientras se la sella. Ninguna salida —fallo al abrirla, al validarla o
 * al sellarla— puede dejarla publicada.
 */
describe('respaldo con protección declarada', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  const temporary = (): string => {
    const directory = mkdtempSync(join(tmpdir(), 'cullen-backup-'));
    directories.push(directory);
    return directory;
  };

  /** Doble que deja un intermedio ilegible donde `vacuum into` publicaría el suyo. */
  const unreadableVacuum = (): Database.Database => ({
    prepare: () => ({
      run: (target: string) => { writeFileSync(target, 'no soy una base'); }
    })
  }) as unknown as Database.Database;

  it('no deja la copia en claro cuando el intermedio no puede validarse', () => {
    const root = temporary();
    const directory = join(root, 'backups');
    let sealed = 0;
    const protection: BackupProtection = {
      suffix: '.sealed',
      seal: () => { sealed += 1; },
      open: () => undefined
    };

    expect(() => createDatabaseBackup(unreadableVacuum(), join(root, 'node.sqlite'), {
      directory, prefix: 'node.sqlite.backup.', protection
    })).toThrow();

    /** El fallo ocurre antes de sellar: no hay respaldo publicado que conservar. */
    expect(sealed).toBe(0);
    expect(readdirSync(directory)).toEqual([]);
    expect(readdirSync(root).filter((name) => name.includes('staging'))).toEqual([]);
  });
});
