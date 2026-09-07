import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    /**
     * Todas las pruebas de este paquete son del renderer, que corre en un
     * navegador. `jsdom` habilita la interacción real —efectos, eventos y
     * estado— sin cambiar las pruebas de render estático, que siguen valiendo.
     */
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts']
  }
});
