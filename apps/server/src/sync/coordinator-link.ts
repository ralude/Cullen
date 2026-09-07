import type { CatalogReferenceProjection, CoordinatorLink } from '@supermarket/core';
import type { ObservedSyncConnectivity } from '@supermarket/driver-security';

/**
 * Enlace con el coordinador tal como lo conoce este nodo.
 *
 * Un nodo sin coordinador configurado es standalone: no hay coordinación que
 * exigir. Con coordinador, el enlace está utilizable solo cuando el worker
 * observó la última entrega como `ONLINE` **y** las referencias del coordinador
 * están aplicadas: sin catálogo ni concesiones no se puede operar en LAN,
 * aunque el socket abra.
 *
 * No hace ping por su cuenta: la conectividad es la que el worker registró al
 * intentar entregar, conforme ADR-0026 D6.
 */
export class ObservedCoordinatorLink implements CoordinatorLink {
  constructor(
    readonly coordinatorNodeId: string | null,
    private readonly connectivity: ObservedSyncConnectivity,
    private readonly references: CatalogReferenceProjection
  ) {}

  async isReachable(): Promise<boolean> {
    if (this.coordinatorNodeId === null) return false;
    const state = await this.connectivity.lastKnownState(this.coordinatorNodeId);
    if (state !== 'ONLINE') return false;
    return await this.references.countApplied() > 0;
  }
}
