import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/**
 * Bundle de distribución del nodo (ADR-0030 D2).
 *
 * El servidor se ejecuta en producción como servicio de Windows sobre un
 * runtime Node embebido, no con `tsx` sobre el árbol de fuentes. `esbuild`
 * resuelve los `workspace:*` y las extensiones `.ts` explícitas que este
 * paquete usa, y deja `better-sqlite3` como externo: es un módulo nativo cuyo
 * binario el empaquetado reconstruye para el ABI del runtime embebido y copia
 * junto al bundle.
 */
const root = fileURLToPath(new URL('.', import.meta.url));
const outdir = fileURLToPath(new URL('./dist', import.meta.url));

rmSync(outdir, { recursive: true, force: true });

await build({
  absWorkingDir: root,
  entryPoints: [
    'src/index.ts',
    'src/backup.ts',
    'src/bootstrap-admin.ts',
    'src/generate-lan-material.ts'
  ],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  external: ['better-sqlite3'],
  /**
   * Node ESM no define `require`; alguna dependencia transitiva lo llama en
   * tiempo de ejecución. Se reconstruye desde `import.meta.url`.
   */
  banner: {
    js: "import { createRequire as __cullenCreateRequire } from 'node:module';"
      + "import { fileURLToPath as __cullenFileURLToPath } from 'node:url';"
      + "import { dirname as __cullenDirname } from 'node:path';"
      + 'const require = __cullenCreateRequire(import.meta.url);'
      + 'const __filename = __cullenFileURLToPath(import.meta.url);'
      + 'const __dirname = __cullenDirname(__filename);'
  },
  logLevel: 'info'
});
