import { performance } from 'node:perf_hooks';
import { buildApp } from '../src/app.ts';
import { createSecurityRuntime } from '../src/runtime.ts';

const databasePath = process.env.CULLEN_PERFORMANCE_DATABASE_PATH;
if (!databasePath) throw new Error('PERF_STARTUP_DATABASE_PATH_MISSING');

const discard = { write: (): void => undefined };
const runtime = createSecurityRuntime(databasePath, {
  terminalId: 'terminal-001', originNodeId: 'node-001'
});
const app = buildApp(runtime.dependencies, { logDestination: discard });

const close = async (): Promise<void> => {
  await app.close();
  runtime.handle.close();
  if (process.send) {
    process.send({ type: 'closed' }, () => process.disconnect());
  }
};

process.on('message', (message: unknown) => {
  if (message === 'health') {
    void (async () => {
      const started = performance.now();
      const response = await app.inject({ method: 'GET', url: '/health' });
      const ms = performance.now() - started;
      if (response.statusCode !== 200) throw new Error('PERF_STARTUP_HEALTH_FAILED');
      process.send?.({ type: 'health', ms });
    })();
  } else if (message === 'close') {
    void close();
  }
});

await app.ready();
/**
 * El consumo se lee en el propio hijo: su CPU acumulada y su RSS al quedar
 * listo son exactamente el costo del arranque que se está midiendo, sin el
 * arnés que lo lanzó.
 */
const usage = process.cpuUsage();
process.send?.({
  type: 'ready',
  at: performance.timeOrigin + performance.now(),
  cpuUserMicros: usage.user,
  cpuSystemMicros: usage.system,
  rssBytes: process.memoryUsage().rss
});
