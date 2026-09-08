import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    /**
     * Las pruebas de contrato del servidor autentican de verdad: scrypt es
     * deliberadamente costoso y varias corren en paralelo sobre SQLite. Con el
     * límite de 5 s por omisión, una estación cargada las hacía fallar por
     * tiempo y no por comportamiento. El margen no relaja ninguna aserción.
     */
    testTimeout: 30_000
  }
});
