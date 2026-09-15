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

  it('mide la jornada completa y publica los asientos que dejó', async () => {
    const result = await run(['--scenario', 'sale-journey', '--warmup', '1', '--sample', '2']);
    expect(result.succeeded, result.stderr).toBe(true);
    const report = JSON.parse(readFileSync(resolve(result.directory!, 'summary.json'), 'utf8'));
    /**
     * Tres jornadas —una de warm-up y dos medidas—, cada una con su documento
     * emitido, sus dos cobros asentados en el turno y su salida de inventario.
     */
    expect(report.environment.checks).toEqual({
      'sale-journey': { sales: 3, issuedDocuments: 3, shiftPostings: 6, stockIssues: 3 }
    });
    expect(report.environment.fiscalMode).toBe('SIMULATION');
    expect(report.summaries).toEqual([expect.objectContaining({
      scenario: 'sale-journey', sample: 2
    })]);
  }, 60_000);

  it('mide la apertura de caja sobre una caja propia por repetición', async () => {
    const result = await run(['--scenario', 'cash-shift-open', '--warmup', '0', '--sample', '2']);
    expect(result.succeeded, result.stderr).toBe(true);
    const report = JSON.parse(readFileSync(resolve(result.directory!, 'summary.json'), 'utf8'));
    /** Dos aperturas medidas más la del turno que prepara la estación. */
    expect(report.environment.checks).toEqual({ 'cash-shift-open': { openShifts: 3 } });
    expect(report.summaries).toEqual([expect.objectContaining({
      scenario: 'cash-shift-open', sample: 2
    })]);
  }, 60_000);

  it.runIf(process.platform === 'win32')(
    'mide el renderer real desde Electron hasta el shell y recupera la sesión',
    async () => {
      const result = await run([
        '--scenario', 'login-and-shell', '--warmup', '0', '--sample', '1'
      ]);
      expect(result.succeeded, result.stderr).toBe(true);
      expect(result.directory).toBeDefined();
      const report = JSON.parse(readFileSync(resolve(result.directory!, 'summary.json'), 'utf8'));
      expect(report.environment.checks).toEqual({
        'login-and-shell': { loginForms: 1, authorizedShells: 1, recoveredSessions: 1 }
      });
      expect(report.environment).toMatchObject({
        renderer: 'electron', transport: 'http-loopback', sample: 1,
        desktopArtifactHashes: {
          electronMain: expect.stringMatching(/^[0-9a-f]{64}$/),
          rendererHtml: expect.stringMatching(/^[0-9a-f]{64}$/)
        }
      });
      expect(report.summaries.map((entry: { readonly scenario: string }) => entry.scenario))
        .toEqual(['desktop-to-login', 'login-to-shell', 'session-recovery']);
      for (const summary of report.summaries) {
        expect(summary).toMatchObject({ sample: 1, medianMs: expect.any(Number) });
        expect(summary).not.toHaveProperty('p90Ms');
      }
      const raw = readFileSync(resolve(result.directory!, 'observations.json'), 'utf8');
      expect(JSON.parse(raw).observations).toHaveLength(3);
      for (const forbidden of ['"123456"', 'PERF01', 'set-cookie', 'operatorCode', 'pin']) {
        expect(raw).not.toContain(forbidden);
      }
    },
    120_000
  );

  it('separa custodia y aplicación del ciclo LAN después de una reconexión real', async () => {
    const result = await run([
      '--scenario', 'lan-cycle', '--warmup', '0', '--sample', '1'
    ]);
    expect(result.succeeded, result.stderr).toBe(true);
    expect(result.directory).toBeDefined();
    const report = JSON.parse(readFileSync(resolve(result.directory!, 'summary.json'), 'utf8'));
    expect(report.environment).toMatchObject({
      transport: 'https-mtls', nodes: 2, sample: 1,
      checks: {
        'lan-cycle': {
          interruptedDeliveries: 1,
          durableReceipts: 1,
          appliedEvents: 1,
          authoritativeMovements: 1
        }
      }
    });
    expect(report.summaries.map((entry: { readonly scenario: string }) => entry.scenario))
      .toEqual(['lan-delivery', 'lan-application']);
    for (const summary of report.summaries) {
      expect(summary).toMatchObject({ sample: 1, medianMs: expect.any(Number) });
      expect(summary).not.toHaveProperty('p90Ms');
    }
    const raw = readFileSync(resolve(result.directory!, 'observations.json'), 'utf8');
    expect(JSON.parse(raw).observations).toHaveLength(2);
    expect(result.stdout).not.toContain('Sync event reception completed');
    for (const forbidden of ['PRIVATE KEY', 'certificatePem', 'privateKeyPem', 'payload']) {
      expect(raw).not.toContain(forbidden);
    }
  }, 120_000);
});
