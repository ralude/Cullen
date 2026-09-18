import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import { configs as hooksConfigs } from 'eslint-plugin-react-hooks';

const publicPackageImportGuard = {
  group: ['@supermarket/*/src/**'],
  message: 'Consume otros paquetes mediante sus exports publicos, no mediante archivos internos.'
};

const infrastructureLibraries = [
  'electron',
  'electron/**',
  'fastify',
  'fastify/**',
  'react',
  'react/**',
  'react-dom',
  'react-dom/**',
  'drizzle-orm',
  'drizzle-orm/**',
  'better-sqlite3'
];

/**
 * Fronteras que 12.05 introdujo al repartir los hubs. Cada corte dejó un dueño
 * concreto; estas reglas impiden que el hub vuelva por la puerta de atrás.
 */
const serverRegistrarGuard = {
  group: ['../app.ts', '../app.js', '**/app.ts', '**/app.js'],
  message: 'Una ruta usa el contrato y los helpers HTTP, no el registrador: importa de'
    + ' server-dependencies.ts y http-context.ts.'
};

const serverRuntimeGuard = {
  group: ['../runtime.ts', '../runtime.js', '**/runtime.ts', '**/runtime.js'],
  message: 'La composicion del nodo se inyecta, no se importa: un modulo no alcanza el runtime.'
};

const desktopApiClientGuard = {
  group: ['./api-client.js', './api-client.ts', '**/api-client.js', '**/api-client.ts'],
  message: 'Un grupo de operaciones no importa el ensamblador que lo reune.'
};

const desktopShellGuard = {
  group: ['./App.js', './App.tsx', '**/App.js', '**/App.tsx'],
  message: 'La navegacion es logica pura y no depende del shell que la consume.'
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      'pnpm-lock.yaml',
      /**
       * Skills instaladas desde fuera del proyecto: skills-lock.json fija su
       * origen y su hash, este repositorio no escribe ese codigo y sus reglas
       * no lo gobiernan.
       */
      '.agents/skills/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [publicPackageImportGuard] }]
    }
  },
  {
    files: ['**/*.config.{js,ts}', 'apps/server/**/*.ts', 'packages/**/*.ts'],
    languageOptions: {
      globals: globals.node
    }
  },
  {
    files: ['packages/shared/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            publicPackageImportGuard,
            {
              group: [
                '@supermarket/core',
                '@supermarket/core/**',
                '@supermarket/driver-*',
                '@supermarket/driver-*/**',
                ...infrastructureLibraries
              ],
              message: 'shared no puede depender de core, drivers ni infraestructura.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['packages/core/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            publicPackageImportGuard,
            {
              group: [
                '**/application/**',
                '@supermarket/driver-*',
                '@supermarket/driver-*/**',
                ...infrastructureLibraries
              ],
              message: 'core/domain solo puede depender del dominio y de primitivas shared.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['packages/core/src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            publicPackageImportGuard,
            {
              group: ['@supermarket/driver-*', '@supermarket/driver-*/**', ...infrastructureLibraries],
              message: 'core/application define puertos y no importa adaptadores ni transportes.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['apps/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            publicPackageImportGuard,
            {
              group: ['drizzle-orm', 'drizzle-orm/**', 'better-sqlite3'],
              message: 'apps compone dependencias y no accede a SQLite o Drizzle directamente.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['apps/desktop/src/main/**/*.ts', 'apps/desktop/src/preload/**/*.ts'],
    languageOptions: {
      globals: globals.node
    }
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      ...hooksConfigs.recommended.rules,
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            publicPackageImportGuard,
            {
              group: [
                'node:*',
                'electron',
                'electron/**',
                '@supermarket/core',
                '@supermarket/core/**',
                'drizzle-orm',
                'drizzle-orm/**',
                'better-sqlite3',
                '@supermarket/driver-*',
                '@supermarket/driver-*/**'
              ],
              message: 'El renderer no puede importar core, Node.js, Electron, base de datos ni drivers.'
            }
          ]
        }
      ]
    },
    languageOptions: {
      globals: globals.browser
    }
  },
  {
    /** Rutas: consumen el contrato y los helpers, nunca el registrador ni el runtime. */
    files: ['apps/server/src/routes/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [publicPackageImportGuard, serverRegistrarGuard, serverRuntimeGuard] }
      ]
    }
  },
  {
    /** Contrato, helpers HTTP y composiciones locales: nada de ellos alcanza el root. */
    files: [
      'apps/server/src/server-dependencies.ts',
      'apps/server/src/http-context.ts',
      'apps/server/src/*-composition.ts'
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [publicPackageImportGuard, serverRuntimeGuard] }
      ]
    }
  },
  {
    /** Grupos de operaciones del cliente HTTP: no importan el ensamblador. */
    files: ['apps/desktop/src/renderer/src/api-*.ts'],
    ignores: [
      'apps/desktop/src/renderer/src/api-client.ts',
      'apps/desktop/src/renderer/src/api-transport.ts',
      '**/*.test.ts'
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            publicPackageImportGuard,
            desktopApiClientGuard,
            {
              group: [
                'node:*',
                'electron',
                'electron/**',
                '@supermarket/core',
                '@supermarket/core/**',
                '@supermarket/driver-*',
                '@supermarket/driver-*/**'
              ],
              message: 'El renderer no puede importar core, Node.js, Electron ni drivers.'
            }
          ]
        }
      ]
    }
  },
  {
    /** Navegacion: logica pura, sin el shell que la consume. */
    files: ['apps/desktop/src/renderer/src/navigation.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [publicPackageImportGuard, desktopShellGuard] }
      ]
    }
  }
);
