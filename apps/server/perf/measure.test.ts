import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
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
      warmup: { mode: 'fixed', runs: 0 },
      sample: 1, profile: 'crecimiento', completedSales: 300,
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

  it('calienta cada escenario en proporción a lo que cuesta y publica las repeticiones que usó', async () => {
    /**
     * Un escenario de microsegundos agota el tope de repeticiones; uno de
     * decenas de milisegundos agota antes el presupuesto de tiempo. Un warm-up
     * fijo serviría a uno y arruinaría al otro: con 5 repeticiones el barcode
     * mide código sin optimizar, y con 200 el kardex profundo tardaría minutos.
     */
    const quick = await run(['--scenario', 'catalog-barcode', '--sample', '2']);
    expect(quick.succeeded, quick.stderr).toBe(true);
    const quickReport = JSON.parse(readFileSync(resolve(quick.directory!, 'summary.json'), 'utf8'));
    expect(quickReport.environment.warmup).toMatchObject({
      mode: 'auto', runs: 200, maxRuns: 200, budgetMs: 1_000
    });

    const slow = await run(['--scenario', 'catalog-list', '--sample', '2']);
    expect(slow.succeeded, slow.stderr).toBe(true);
    const slowReport = JSON.parse(readFileSync(resolve(slow.directory!, 'summary.json'), 'utf8'));
    expect(slowReport.environment.warmup.mode).toBe('auto');
    expect(slowReport.environment.warmup.runs).toBeGreaterThanOrEqual(5);
    expect(slowReport.environment.warmup.runs).toBeLessThan(200);

    /** El warm-up no entra a las observaciones: sólo la muestra declarada. */
    expect(JSON.parse(readFileSync(resolve(slow.directory!, 'observations.json'), 'utf8')).observations)
      .toHaveLength(2);
  }, 120_000);

  it('conserva un warm-up explícito cuando la comparación lo exige', async () => {
    const result = await run(['--scenario', 'catalog-barcode', '--warmup', '3', '--sample', '2']);
    expect(result.succeeded, result.stderr).toBe(true);
    const report = JSON.parse(readFileSync(resolve(result.directory!, 'summary.json'), 'utf8'));
    expect(report.environment.warmup).toEqual({ mode: 'fixed', runs: 3 });
  }, 60_000);

  it('registra CPU, memoria y tamaño de base sobre el mismo intervalo que la latencia', async () => {
    const result = await run(['--scenario', 'cash-shift-open', '--warmup', '1', '--sample', '2']);
    expect(result.succeeded, result.stderr).toBe(true);
    const report = JSON.parse(readFileSync(resolve(result.directory!, 'summary.json'), 'utf8'));
    const resources = report.resources['cash-shift-open'];
    /**
     * El costo del instrumento queda fuera de lo medido: la semilla, el
     * warm-up y la verificación consumen CPU del proceso que el escenario no
     * reclama. La diferencia entre ambos consumos es ese costo.
     */
    expect(resources.cpu.measuredUserMs + resources.cpu.measuredSystemMs)
      .toBeLessThan(resources.cpu.processUserMs + resources.cpu.processSystemMs);
    expect(resources.cpu.measuredUserMs).toBeGreaterThanOrEqual(0);
    expect(resources.memory.baselineRssBytes).toBeGreaterThan(0);
    expect(resources.memory.peakRssBytes).toBeGreaterThanOrEqual(resources.memory.baselineRssBytes);
    expect(resources.memory.peakHeapUsedBytes).toBeGreaterThan(0);
    /** La base se lee antes de cerrarla y crece con lo que la serie asentó. */
    expect(resources.database.seededBytes).toBeGreaterThan(0);
    expect(resources.database.finalBytes).toBeGreaterThanOrEqual(resources.database.seededBytes);
    expect(resources.database.walBytes).toBeGreaterThanOrEqual(0);

    const raw = JSON.parse(readFileSync(resolve(result.directory!, 'observations.json'), 'utf8'));
    expect(raw.resources).toEqual(report.resources);
    expect(raw.observations).toHaveLength(2);
    for (const observation of raw.observations) {
      expect(observation.cpuUserMs).toBeGreaterThanOrEqual(0);
      expect(observation.cpuSystemMs).toBeGreaterThanOrEqual(0);
      expect(observation.rssBytes).toBeGreaterThan(0);
    }
  }, 60_000);

  it('separa primera instalación, nuevo proceso sobre la base y ejecución caliente', async () => {
    const result = await run([
      '--scenario', 'node-startup', '--warmup', '0', '--sample', '1'
    ]);
    expect(result.succeeded, result.stderr).toBe(true);
    const report = JSON.parse(readFileSync(resolve(result.directory!, 'summary.json'), 'utf8'));
    expect(report.environment.checks).toEqual({
      'node-startup': { firstInstallProcesses: 1, existingDatabaseProcesses: 1, hotHealthChecks: 1 }
    });
    expect(report.environment.startupArtifactSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.summaries.map((entry: { readonly scenario: string }) => entry.scenario))
      .toEqual(['node-first-install', 'node-existing-start', 'node-hot-health']);
    expect(JSON.parse(readFileSync(resolve(result.directory!, 'observations.json'), 'utf8')).observations)
      .toHaveLength(3);
    expect(readdirSync(result.directory!)).toEqual(['observations.json', 'summary.json']);
    expect(result.stdout).not.toContain('HTTP request completed');

    /**
     * Cada repetición es un proceso entero: su CPU y su RSS son los del hijo,
     * no los del arnés que lo lanzó, y el segundo arranque lee una base que la
     * primera instalación ya migró.
     */
    const resources = report.resources['node-startup'];
    expect(resources['node-first-install'].medianCpuUserMs).toBeGreaterThan(0);
    expect(resources['node-first-install'].peakRssBytes).toBeGreaterThan(0);
    expect(resources['node-existing-start'].medianCpuUserMs).toBeGreaterThan(0);
    expect(resources['node-existing-start'].peakRssBytes).toBeGreaterThan(0);
    expect(resources.database.firstInstallBytes).toBeGreaterThan(0);
    expect(resources.database.existingBytes)
      .toBeGreaterThanOrEqual(resources.database.firstInstallBytes);
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
      /**
       * La memoria suma todos los procesos de Electron; el CPU acumulado sólo
       * existe para el principal, y el tráfico es el de Chromium contra
       * Fastify por loopback, renderer y API juntos.
       */
      const resources = report.resources['login-and-shell'];
      expect(resources.electron.medianMainCpuUserMs).toBeGreaterThan(0);
      expect(resources.electron.processCount).toBeGreaterThan(1);
      expect(resources.electron.peakWorkingSetBytes)
        .toBeGreaterThanOrEqual(resources.electron.medianWorkingSetBytes);
      expect(resources.traffic.medianBytesRead).toBeGreaterThan(0);
      expect(resources.traffic.medianBytesWritten).toBeGreaterThan(0);

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
    /**
     * El tráfico se mide en el socket del coordinador, así que cuenta los
     * bytes cifrados que viajaron por la LAN, no el tamaño del JSON. Cada nodo
     * conserva su propia base.
     */
    const resources = report.resources['lan-cycle'];
    expect(resources.traffic.medianDeliveryBytesRead).toBeGreaterThan(0);
    expect(resources.traffic.medianDeliveryBytesWritten).toBeGreaterThan(0);
    expect(resources.database.coordinatorBytes).toBeGreaterThan(0);
    expect(resources.database.terminalBytes).toBeGreaterThan(0);
    expect(resources.memory.peakRssBytes).toBeGreaterThan(0);

    const raw = readFileSync(resolve(result.directory!, 'observations.json'), 'utf8');
    expect(JSON.parse(raw).observations).toHaveLength(2);
    expect(result.stdout).not.toContain('Sync event reception completed');
    for (const forbidden of ['PRIVATE KEY', 'certificatePem', 'privateKeyPem', 'payload']) {
      expect(raw).not.toContain(forbidden);
    }
  }, 120_000);
});
