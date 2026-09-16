import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export type StartupArtifact = {
  readonly path: string;
  readonly sha256: string;
  readonly temporaryDirectory: string;
};

export type StartupMeasurement = {
  readonly firstInstallMs: number;
  readonly existingDatabaseMs: number;
  readonly hotHealthMs: number;
};

type WorkerMessage =
  | { readonly type: 'ready'; readonly at: number }
  | { readonly type: 'health'; readonly ms: number }
  | { readonly type: 'closed' };

const runProcess = (
  artifactPath: string,
  databasePath: string,
  measureHealth: boolean
): Promise<{ readonly startupMs: number; readonly healthMs?: number }> => {
  const startedAt = performance.timeOrigin + performance.now();
  return new Promise((resolve, reject) => {
    const child = fork(artifactPath, [], {
      /** El artefacto ya es JavaScript ESM: ningún loader de desarrollo entra en la medición. */
      execArgv: [],
      env: { ...process.env, CULLEN_PERFORMANCE_DATABASE_PATH: databasePath },
      silent: true
    });
    child.stdout?.resume();
    child.stderr?.resume();
    let startupMs: number | undefined;
    let healthMs: number | undefined;
    let closed = false;
    const timeout = setTimeout(() => child.kill(), 30_000);
    child.on('message', (raw: unknown) => {
      const message = raw as WorkerMessage;
      if (message.type === 'ready') {
        startupMs = message.at - startedAt;
        child.send(measureHealth ? 'health' : 'close');
      } else if (message.type === 'health') {
        healthMs = message.ms;
        child.send('close');
      } else if (message.type === 'closed') {
        closed = true;
      }
    });
    child.once('error', () => {
      clearTimeout(timeout);
      reject(new Error('PERF_STARTUP_PROCESS_FAILED'));
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0 || !closed || startupMs === undefined || startupMs <= 0
        || (measureHealth && (healthMs === undefined || healthMs <= 0))) {
        reject(new Error(
          'PERF_STARTUP_RESULT_INVALID'
          + `: code=${String(code)} closed=${String(closed)}`
          + ` startup=${String(startupMs)} health=${String(healthMs)}`
        ));
        return;
      }
      resolve({ startupMs, ...(healthMs === undefined ? {} : { healthMs }) });
    });
  });
};

/**
 * Compila una vez, fuera de los intervalos medidos, con el mismo contrato de
 * distribución definido por ADR-0030 y `esbuild.config.js`.
 */
export const prepareStartupArtifact = async (): Promise<StartupArtifact> => {
  const serverDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  /**
   * Igual que `dist`, el temporal vive bajo el paquete del servidor para que
   * el módulo nativo externo se resuelva desde `apps/server/node_modules`.
   */
  const temporaryDirectory = mkdtempSync(join(serverDirectory, '.perf-startup-'));
  const path = join(temporaryDirectory, 'node-startup.mjs');
  try {
    await build({
      entryPoints: [fileURLToPath(new URL('./startup-run.ts', import.meta.url))],
      outfile: path,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node24',
      sourcemap: false,
      external: ['better-sqlite3'],
      banner: {
        js: "import { createRequire as __cullenCreateRequire } from 'node:module';"
          + "import { fileURLToPath as __cullenFileURLToPath } from 'node:url';"
          + "import { dirname as __cullenDirname } from 'node:path';"
          + 'const require = __cullenCreateRequire(import.meta.url);'
          + 'const __filename = __cullenFileURLToPath(import.meta.url);'
          + 'const __dirname = __cullenDirname(__filename);'
      },
      logLevel: 'silent'
    });
    return {
      path,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      temporaryDirectory
    };
  } catch (error) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
};

export const removeStartupArtifact = (artifact: StartupArtifact): void => {
  rmSync(artifact.temporaryDirectory, { recursive: true, force: true });
};

export const measureStartup = async (
  artifactsDirectory: string,
  artifactPath: string,
  run: number
): Promise<StartupMeasurement> => {
  const databasePath = join(artifactsDirectory, 'startup-' + run + '.sqlite');
  const child = relative(artifactsDirectory, databasePath);
  if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) {
    throw new Error('PERF_STARTUP_ARTIFACT_PATH_INVALID');
  }
  try {
    const first = await runProcess(artifactPath, databasePath, false);
    const existing = await runProcess(artifactPath, databasePath, true);
    return {
      firstInstallMs: first.startupMs,
      existingDatabaseMs: existing.startupMs,
      hotHealthMs: existing.healthMs as number
    };
  } finally {
    rmSync(databasePath, { force: true });
    rmSync(databasePath + '-shm', { force: true });
    rmSync(databasePath + '-wal', { force: true });
  }
};
