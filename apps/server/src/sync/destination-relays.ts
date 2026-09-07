import { application, type Clock, type OutboxStore, type UnitOfWork } from '@supermarket/core';
import type { SyncNodeRegistry } from '@supermarket/core';
import { HttpsSyncEventPublisher } from '@supermarket/driver-security';
import type { SyncWorkerCycle, SyncWorkerCycles } from './sync-worker.ts';

export type DestinationTransportMaterial = {
  /** Identidad de cliente del nodo que entrega; es la misma que usa al escuchar. */
  readonly key: string;
  readonly cert: string;
  /** Autoridades que emiten los certificados de los destinos. */
  readonly ca: readonly string[];
  readonly timeoutMilliseconds?: number;
};

export type DestinationRelayDependencies = {
  readonly senderNodeId: string;
  readonly registry: SyncNodeRegistry;
  readonly outbox: OutboxStore;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly material: DestinationTransportMaterial;
};

/**
 * Resuelve los destinos de entrega desde el registro confiable en cada ciclo.
 *
 * La dirección y la confianza viven juntas: un nodo revocado, con credencial
 * vencida o sin dirección deja de ser destino sin tocar configuración. Retirarlo
 * detiene entregas nuevas y **no** convierte sus pendientes en publicados,
 * porque sus filas de `sync_delivery` permanecen con su estado.
 *
 * Los relays se memorizan por destino y dirección: reconstruirlos en cada vuelta
 * perdería nada de estado —vive en la base— pero abriría conexiones nuevas sin
 * necesidad. Un cambio de dirección crea un relay distinto.
 */
export const createDestinationRelays = (
  dependencies: DestinationRelayDependencies
): SyncWorkerCycles => {
  const relays = new Map<string, SyncWorkerCycle>();

  return async (): Promise<readonly SyncWorkerCycle[]> => {
    const self = await dependencies.registry.findByNodeId(dependencies.senderNodeId);
    if (!self) return [];

    const now = dependencies.clock.now();
    const destinations = await dependencies.registry.deliveryDestinations(self.storeId, now);
    const cycles: SyncWorkerCycle[] = [];

    for (const destination of destinations) {
      if (destination.nodeId === dependencies.senderNodeId) continue;
      const host = destination.addressHost;
      const port = destination.addressPort;
      if (host === null || port === null) continue;

      const key = `${destination.nodeId}:${host}:${String(port)}`;
      const cached = relays.get(key);
      if (cached) {
        cycles.push(cached);
        continue;
      }

      const cycle: SyncWorkerCycle = {
        destinationNodeId: destination.nodeId,
        relay: new application.OutboxRelay(
          destination.nodeId,
          dependencies.outbox,
          new HttpsSyncEventPublisher({
            host,
            port,
            destinationNodeId: destination.nodeId,
            key: dependencies.material.key,
            cert: dependencies.material.cert,
            ca: dependencies.material.ca,
            ...(dependencies.material.timeoutMilliseconds === undefined
              ? {}
              : { timeoutMilliseconds: dependencies.material.timeoutMilliseconds })
          }),
          dependencies.unitOfWork,
          dependencies.clock
        )
      };
      relays.set(key, cycle);
      cycles.push(cycle);
    }
    return cycles;
  };
};

/** Destino único y fijo, para el nodo que solo entrega a su coordinador. */
export const fixedDestination = (cycle: SyncWorkerCycle): SyncWorkerCycles =>
  async (): Promise<readonly SyncWorkerCycle[]> => [cycle];
