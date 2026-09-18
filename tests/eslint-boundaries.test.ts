import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('renderer import boundary', () => {
  /**
   * El primero de estos casos paga el arranque en frío de ESLint —construir la
   * configuración del repositorio y cargar el parser de TypeScript—, que los demás
   * ya no pagan. Aislado tarda 1,3 s, pero dentro de la suite completa, con los
   * trabajadores compitiendo por CPU, no entraba en los 5 s por omisión: de ahí su
   * propia espera, como ya la declaran las pruebas lentas del arnés.
   */
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
  }, 20_000);
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

/**
 * Fronteras que 12.05 introdujo al repartir los hubs. Cada corte dejó un dueño
 * concreto —el contrato y los helpers HTTP aparte del registrador, un archivo
 * por feature del cliente, la navegación aparte del shell— y estas pruebas
 * comprueban las dos mitades: que la violación representativa falla y que el
 * uso legítimo pasa. Una regla que sólo prohíbe no demuestra que deja trabajar.
 */
describe('composition boundaries', () => {
  /** Una sola instancia: construir la configuración del repositorio no es barato. */
  const eslint = new ESLint();
  const lint = async (filePath: string, dependency: string): Promise<readonly string[]> => {
    const [result] = await eslint.lintText(`import '${dependency}';`, { filePath });
    return (result?.messages ?? [])
      .filter((message) => message.ruleId === 'no-restricted-imports')
      .map((message) => message.message);
  };

  it.each([
    ['apps/server/src/routes/probe.ts', '../app.ts'],
    ['apps/server/src/routes/probe.ts', '../app.js'],
    ['apps/server/src/routes/probe.ts', '../runtime.ts'],
    ['apps/server/src/http-context.ts', './runtime.ts'],
    ['apps/server/src/server-dependencies.ts', './runtime.ts'],
    ['apps/server/src/reports-composition.ts', './runtime.ts'],
    ['apps/desktop/src/renderer/src/api-sales.ts', './api-client.js'],
    ['apps/desktop/src/renderer/src/api-cash.ts', '@supermarket/driver-db'],
    ['apps/desktop/src/renderer/src/navigation.ts', './App.js']
  ])('rejects %s importing %s', async (filePath, dependency) => {
    expect(await lint(filePath, dependency)).not.toEqual([]);
  }, 30_000);

  it.each([
    ['apps/server/src/routes/probe.ts', '../http-context.ts'],
    ['apps/server/src/routes/probe.ts', '../server-dependencies.ts'],
    ['apps/server/src/reports-composition.ts', './server-dependencies.ts'],
    ['apps/desktop/src/renderer/src/api-sales.ts', './api-transport.js'],
    ['apps/desktop/src/renderer/src/api-sales.ts', '@supermarket/shared'],
    ['apps/desktop/src/renderer/src/navigation.ts', './operation-screens.js']
  ])('accepts %s importing %s', async (filePath, dependency) => {
    expect(await lint(filePath, dependency)).toEqual([]);
  }, 30_000);
});
