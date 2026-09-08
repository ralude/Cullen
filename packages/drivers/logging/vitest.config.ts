import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: '@supermarket/driver-logging', environment: 'node' }
});
