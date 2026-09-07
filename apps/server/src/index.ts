import { buildApp } from './app.ts';
import { application } from '@supermarket/core';
import { HttpsSyncEventPublisher, loadNodeIdentity } from '@supermarket/driver-security';
import { createSecurityRuntime } from './runtime.ts';
import { createDestinationRelays, fixedDestination } from './sync/destination-relays.ts';
import { readSyncClientConfiguration, readSyncWorkerInterval } from './sync/lan-client.ts';
import { readSyncListenerConfiguration, toTransportDependencies } from './sync/lan-listener.ts';
import { buildSyncApp } from './sync/sync-app.ts';
import { SyncWorker } from './sync/sync-worker.ts';

const host = process.env.SERVER_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.SERVER_PORT ?? '3000', 10);
const nodeIdentity = loadNodeIdentity(process.env.NODE_IDENTITY_PATH);
const runtime = createSecurityRuntime(
  process.env.DATABASE_PATH ?? 'supermarket-node.sqlite',
  nodeIdentity,
  {
    ...(process.env.FISCAL_EXECUTION_TARGET
      ? { executionTarget: process.env.FISCAL_EXECUTION_TARGET }
      : {}),
    ...(process.env.FISCAL_SIMULATED_REPORT_CONSENT
      ? { reportConsent: process.env.FISCAL_SIMULATED_REPORT_CONSENT }
      : {})
  }
);
const app = buildApp(runtime.dependencies);

/**
 * El listener técnico de LAN se compone en el mismo proceso dueño de SQLite.
 * Una configuración incompleta aborta el arranque: no se degrada a un
 * transporte sin autenticación mutua ni se expone la API de operadores.
 */
const syncConfiguration = readSyncListenerConfiguration();
const syncApp = syncConfiguration
  ? buildSyncApp(toTransportDependencies(runtime.syncReception, syncConfiguration))
  : null;

/**
 * Worker de entrega y aplicación del mismo proceso. Un ciclo por destino, con
 * claims durables y sin llamadas de red dentro de transacciones. La ruta de
 * venta no lo espera: la salida local ya está confirmada cuando el worker
 * arranca su ciclo.
 */
const clientConfiguration = readSyncClientConfiguration();

/**
 * Un nodo que escucha en LAN entrega además a los destinos que su registro
 * confiable declara, reutilizando su propia identidad de transporte y las
 * autoridades que ya acepta como cliente. Los destinos se resuelven en cada
 * ciclo: un alta o una revocación no esperan a un reinicio.
 */
const destinationCycles = clientConfiguration
  ? fixedDestination({
    destinationNodeId: clientConfiguration.destinationNodeId,
    relay: new application.OutboxRelay(
      clientConfiguration.destinationNodeId,
      runtime.syncDelivery.outboxStore,
      new HttpsSyncEventPublisher(clientConfiguration),
      runtime.syncDelivery.unitOfWork,
      runtime.syncDelivery.clock
    )
  })
  : syncConfiguration
    ? createDestinationRelays({
      senderNodeId: runtime.syncReception.receiverNodeId,
      registry: runtime.syncDelivery.nodeRegistry,
      outbox: runtime.syncDelivery.outboxStore,
      unitOfWork: runtime.syncDelivery.unitOfWork,
      clock: runtime.syncDelivery.clock,
      material: {
        key: syncConfiguration.https.key,
        cert: syncConfiguration.https.cert,
        ca: syncConfiguration.https.ca
      }
    })
    : null;

const worker = destinationCycles
  ? new SyncWorker(destinationCycles, {
    intervalMilliseconds: readSyncWorkerInterval(),
    inbox: runtime.syncDelivery.processInbox,
    onError: (error, destinationNodeId) => {
      app.log.error({
        service: 'supermarket-server',
        module: 'sync',
        ...(destinationNodeId ? { destinationNodeId } : {}),
        errorCode: error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN'
      }, 'Sync worker cycle failed');
    }
  })
  : null;

let shuttingDown = false;

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, 'Shutting down server');

  try {
    await worker?.stop();
    await syncApp?.close();
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, 'Server shutdown failed');
    process.exitCode = 1;
  }
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host, port });
  app.log.info({ host, port }, 'Server listening');
  if (syncApp && syncConfiguration) {
    await syncApp.listen({ host: syncConfiguration.host, port: syncConfiguration.port });
    app.log.info({
      host: syncConfiguration.host,
      port: syncConfiguration.port,
      receiverNodeId: runtime.syncReception.receiverNodeId
    }, 'LAN sync listener started');
  }
  if (worker) {
    worker.start();
    app.log.info({
      ...(clientConfiguration
        ? { destinationNodeId: clientConfiguration.destinationNodeId }
        : { destinations: 'registro confiable' })
    }, 'LAN sync worker started');
  }
} catch (error) {
  app.log.error({ err: error }, 'Server startup failed');
  await worker?.stop();
  await syncApp?.close();
  await app.close();
  process.exitCode = 1;
}
