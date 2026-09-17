/**
 * Operaciones de sincronización del cliente HTTP.
 * Estado de sincronización, diagnóstico operativo, nodos y operaciones LAN.
 *
 * Grupo propio desde 12.05.04: cambiar una de estas operaciones se hace aquí y
 * no dentro de las noventa y dos de todas las features. `createDesktopApi` las
 * esparce, así que la superficie pública no cambia.
 */
import {
  getSyncStatusContract,
  getOperationalDiagnosticsContract,
  listSyncNodesContract,
  listCoordinatedOperationsContract,
  type CoordinatedOperationResponse,
  type SyncDestinationStatusResponse,
  type OperationalDiagnosticsResponse,
  type SyncNodeResponse
} from '@supermarket/shared';
import { path, requestJson } from './api-transport.js';

export const syncOperations = (fetcher: typeof fetch) => ({
  getSyncStatus: (destinationNodeId: string): Promise<SyncDestinationStatusResponse> => requestJson(
    fetcher,
    path(getSyncStatusContract.path, destinationNodeId),
    { method: getSyncStatusContract.method }
  ),
  getOperationalDiagnostics: (
    destinationNodeId: string, correlationId?: string
  ): Promise<OperationalDiagnosticsResponse> => requestJson(
    fetcher,
    `${path(getOperationalDiagnosticsContract.path, destinationNodeId)}${
      correlationId ? `?correlationId=${encodeURIComponent(correlationId)}` : ''
    }`,
    { method: getOperationalDiagnosticsContract.method }
  ),
  listSyncNodes: (): Promise<readonly SyncNodeResponse[]> => requestJson(
    fetcher, listSyncNodesContract.path, { method: listSyncNodesContract.method }
  ),
  listCoordinatedOperations: (
    status: 'PENDING_RECONCILIATION' | 'COMPLETED' | 'NEEDS_REVIEW'
  ): Promise<readonly CoordinatedOperationResponse[]> => requestJson(
    fetcher,
    path(listCoordinatedOperationsContract.path, status),
    { method: listCoordinatedOperationsContract.method }
  )
});