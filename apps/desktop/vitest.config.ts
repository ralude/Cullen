import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    /**
     * `jsdom` habilita la interacción del renderer y el montaje de `App` en el
     * E2E de sistema. Ese E2E compone Fastify/SQLite desde código de prueba
     * fuera del renderer; la aplicación de producción conserva su frontera.
     */
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts']
  }
});
