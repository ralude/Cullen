import { execFile } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const serverDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactsRoot = resolve(serverDirectory, '../../.perf');
const artifacts: string[] = [];

/** Solo se eliminan las series que esta prueba creó dentro de .perf. */
afterEach(() => {
  for (const directory of artifacts.splice(0)) {
    const child = relative(artifactsRoot, directory);
    if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) {
      throw new Error('Directorio de prueba fuera de .perf.');
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

const run = async (args: readonly string[]) => {
  try {
    const { stdout, stderr } = await execute(process.execPath, ['--import', 'tsx', 'perf/measure.ts', ...args], {
      cwd: serverDirectory, windowsHide: true, timeout: 60_000, maxBuffer: 512 * 1024
    });
    const directories = [...stdout.matchAll(/Crudos en (.+)/g)].map((match) => match[1]!.trim());
    for (const directory of directories) artifacts.push(resolve(directory));
    const rawDirectory = directories[0];
    return { succeeded: true, stdout, stderr, directory: rawDirectory };
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string };
    return { succeeded: false, stdout: result.stdout ?? '', stderr: result.stderr ?? '', directory: undefined };
  }
};

describe('comando público de medición de 12.01', () => {
  it.each([
    ['--scenario', 'inexistente'],
    ['--profile', 'inexistente'],
    ['--sample', '0'],
    ['--sample', '3x'],
    ['--warmup', '-1'],
    ['--depths', '100,error'],
    ['--scenario', 'report-sales']
  ])('rechaza opciones sin una medición válida: %s %s', async (option, value) => {
    const result = await run([
      '--scenario', 'catalog-barcode', ...(option === '--sample' ? [] : ['--sample', '1']), option, value
    ]);
    expect(result.succeeded).toBe(false);
    expect(result.stdout).not.toContain('Crudos en');
    expect(result.stderr).toContain('PERF_INVALID_ARGUMENT');
  });

  it('ejecuta escenarios múltiples en procesos distintos con sus propios artefactos', async () => {
    const result = await run([
      '--scenario', 'catalog-barcode', '--scenario', 'report-inventory', '--warmup', '0', '--sample', '1'
    ]);
    expect(result.succeeded, result.stderr).toBe(true);
    expect(artifacts).toHaveLength(2);
    const reports = artifacts.map((directory) => JSON.parse(readFileSync(resolve(directory, 'summary.json'), 'utf8')));
    expect(reports.map((report) => report.summaries.map((entry: { scenario: string }) => entry.scenario)))
      .toEqual([['catalog-barcode'], ['report-inventory']]);
    expect(new Set(reports.map((report) => report.environment.processId)).size).toBe(2);
  }, 60_000);

  it('mide ventas sembradas con período vigente, muestra explícita y procedencia del código', async () => {
    const result = await run([
      '--profile', 'crecimiento', '--depths', '1', '--scenario', 'report-sales',
      '--warmup', '0', '--sample', '1'
    ]);
    expect(result.succeeded, result.stderr).toBe(true);
    expect(result.directory).toBeDefined();
    const report = JSON.parse(readFileSync(resolve(result.directory!, 'summary.json'), 'utf8'));
    expect(report.environment).toMatchObject({
      warmup: 0, sample: 1, profile: 'crecimiento', completedSales: 300,
      products: 201, historyDepths: [1], fiscalMode: 'SIMULATION',
      revision: { commit: expect.stringMatching(/^[0-9a-f]{40}$/), dirty: expect.any(Boolean) }
    });
    expect(report.environment.reportPeriod.from < report.environment.measuredAt).toBe(true);
    expect(report.environment.reportPeriod.to > report.environment.measuredAt).toBe(true);
    expect(report.summaries).toEqual([expect.objectContaining({
      scenario: 'report-sales', sample: 1, medianMs: expect.any(Number)
    })]);
    expect(report.summaries[0]).not.toHaveProperty('p90Ms');
    expect(result.stdout).toContain('SIMULACION');
    const raw = readFileSync(resolve(result.directory!, 'observations.json'), 'utf8');
    expect(JSON.parse(raw).observations).toHaveLength(1);
    for (const forbidden of ['"123456"', 'PERF01', 'set-cookie', 'operatorCode', 'amountMinorUnits']) {
      expect(raw).not.toContain(forbidden);
    }
  }, 60_000);
});
