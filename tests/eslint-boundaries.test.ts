import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('renderer import boundary', () => {
  it.each([
    '@supermarket/core',
    '@supermarket/driver-db',
    'node:fs',
    'electron',
    'drizzle-orm',
    'better-sqlite3'
  ])('rejects %s', async (dependency) => {
    const [result] = await new ESLint().lintText(`import '${dependency}';`, {
      filePath: 'apps/desktop/src/renderer/src/forbidden-probe.ts'
    });
    expect(result?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'no-restricted-imports', severity: 2 })
    ]));
  });
});

/**
 * Capas de la administración de identidad. El caso de uso decide y el
 * adaptador ejecuta: si alguna de estas importaciones dejara de estar
 * prohibida, la autorización podría empezar a resolverse dentro de un driver
 * o del dominio, donde ninguna prueba de contrato la vigila.
 */
describe('identity layer boundary', () => {
  it.each([
    ['packages/core/src/application/identity/probe.ts', '@supermarket/driver-db'],
    ['packages/core/src/application/identity/probe.ts', 'better-sqlite3'],
    ['packages/core/src/application/identity/probe.ts', 'fastify'],
    ['packages/core/src/domain/identity/probe.ts', '../../application/identity/index.js'],
    ['packages/shared/src/http/v1/probe.ts', '@supermarket/core']
  ])('rejects %s importing %s', async (filePath, dependency) => {
    const [result] = await new ESLint().lintText(`import '${dependency}';`, { filePath });
    expect(result?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'no-restricted-imports', severity: 2 })
    ]));
  });
});
