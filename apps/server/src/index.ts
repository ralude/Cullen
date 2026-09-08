import { buildApp } from './app.ts';
import { application } from '@supermarket/core';
import { technicalLogContext } from '@supermarket/driver-logging';
import {
  HttpsRemoteApplicationProbe,
  HttpsRemoteSaleIssueProbe,
  HttpsSyncEventPublisher,
  loadFileProtection,
  loadNodeIdentity,
  openSecretVault
} from '@supermarket/driver-security';
import {
  migrateNodeDatabase,
  prepareNodeStorage,
  readNodeStorage,
  sealLegacyMigrationBackups
} from './node-storage.ts';
import { runNodeStartupMaintenance } from './node-maintenance.ts';
import { createSecurityRuntime } from './runtime.ts';
import { resolveOperatorHost } from './session-transport.ts';
import { createDestinationRelays, fixedDestination } from './sync/destination-relays.ts';
import { readSyncClientConfiguration, readSyncWorkerInterval } from './sync/lan-client.ts';
import { readSyncListenerConfiguration, toTransportDependencies } from './sync/lan-listener.ts';
import { buildSyncApp } from './sync/sync-app.ts';
import { SyncWorker } from './sync/sync-worker.ts';

/**
 * Se resuelve antes de componer nada: un host no permitido aborta el arranque
 * sin abrir listeners ni tocar la base.
 */
const host = resolveOperatorHost();
const port = Number.parseInt(process.env.SERVER_PORT ?? '3000', 10);
const nodeIdentity = loadNodeIdentity(process.env.NODE_IDENTITY_PATH);

/**
 * Perímetro protegido, clave del nodo y actualización recuperable, en ese
 * orden y antes de componer nada (ADR-0029, 11.04). El nodo verifica la ACL
 * efectiva de donde escribe, abre su almacén de claves —sin degradar a una
 * clave en disco si no está disponible—, sella el respaldo antes de publicarlo
 * y aborta restaurando si la actualización deja la base inválida.
 */
const storage = readNodeStorage();
prepareNodeStorage(storage);
const secretVault = openSecretVault(storage.keystoreDirectory);
const materialProtection = await loadFileProtection({
  vault: secretVault, nodeId: nodeIdentity.originNodeId, now: new Date()
});
sealLegacyMigrationBackups(storage, materialProtection);
migrateNodeDatabase(storage, { backupProtection: materialProtection });
await runNodeStartupMaintenance({
  databasePath: storage.databasePath,
  nodeIdentity,
  protection: secretVault.protection
});

/** El material TLS de LAN se abre en memoria; no se copia en claro a disco. */
const clientConfiguration = readSyncClientConfiguration(process.env, materialProtection.readSecret);
const remoteApplicationProbe = clientConfiguration
  ? new HttpsRemoteApplicationProbe(clientConfiguration)
  : undefined;

const runtime = createSecurityRuntime(
  storage.databasePath,
  nodeIdentity,
  {
    ...(process.env.FISCAL_EXECUTION_TARGET
      ? { executionTarget: process.env.FISCAL_EXECUTION_TARGET }
      : {}),
    ...(process.env.FISCAL_SIMULATED_REPORT_CONSENT
      ? { reportConsent: process.env.FISCAL_SIMULATED_REPORT_CONSENT }
      : {})
  },
  clientConfiguration?.destinationNodeId ?? null,
  clientConfiguration ? new HttpsRemoteSaleIssueProbe(clientConfiguration) : undefined,
  remoteApplicationProbe
);
const app = buildApp(runtime.dependencies);

/**
 * El listener técnico de LAN se compone en el mismo proceso dueño de SQLite.
 * Una configuración incompleta aborta el arranque: no se degrada a un
 * transporte sin autenticación mutua ni se expone la API de operadores.
 */
const syncConfiguration = readSyncListenerConfiguration(process.env, materialProtection.readSecret);
const syncApp = syncConfiguration
  ? buildSyncApp(toTransportDependencies({
    ...runtime.syncReception,
    /**
     * Solo el nodo que aplica hechos ajenos reporta progreso: es la lectura
     * con la que el origen de una operación distribuida concilia su intención.
     */
    applicationProgress: runtime.syncDelivery.applicationProgress,
    /**
     * La salida aplicada solo la reporta quien es autoridad de stock: es la
     * evidencia con la que una devolución restituye lote y costo originales.
     */
    saleIssueEvidence: runtime.syncDelivery.saleIssueEvidence
  }, syncConfiguration))
  : null;

/**
 * Worker de entrega y aplicación del mismo proceso. Un ciclo por destino, con
 * claims durables y sin llamadas de red dentro de transacciones. La ruta de
 * venta no lo espera: la salida local ya está confirmada cuando el worker
 * arranca su ciclo.
 */
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
    /**
     * Una terminal concilia sus operaciones distribuidas contra su
     * coordinador. Un nodo sin coordinador no tiene paso remoto que esperar.
     */
    ...(remoteApplicationProbe ? {
      reconciliation: {
        operations: runtime.coordinatedOperations,
        probe: remoteApplicationProbe
      }
    } : {}),
    /**
     * Solo el coordinador reemite concesiones: es la autoridad de
     * autorización de la LAN. Un nodo que solo entrega a un destino fijo es
     * una terminal y no emite ninguna.
     */
    ...(syncConfiguration ? {
      grants: {
        publisher: runtime.syncDelivery.renewOperatorGrants,
        context: {
          actorId: nodeIdentity.originNodeId,
          actorRoleCodes: [],
          terminalId: nodeIdentity.terminalId,
          originNodeId: nodeIdentity.originNodeId,
          correlationId: 'sync-worker-grant-renewal'
        }
      }
    } : {}),
    onError: (error, destinationNodeId) => {
      app.log.error({
        ...technicalLogContext({
          service: 'supermarket-server',
          module: 'sync',
          correlationId: 'sync-worker',
          actorId: nodeIdentity.originNodeId,
          terminalId: nodeIdentity.terminalId,
          originNodeId: nodeIdentity.originNodeId,
          operation: 'SYNC_WORKER_CYCLE',
          errorCode: error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN'
        }),
        ...(destinationNodeId ? { destinationNodeId } : {}),
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
