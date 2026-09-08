import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  CoordinatedOperationResponse,
  OperationalDiagnosticsResponse,
  SyncDestinationStatusResponse
} from '@supermarket/shared';
import type { OperationApi } from './api-client.js';
import {
  canReviewSync,
  referenceAge,
  referenceRows,
  SyncScreen,
  SYNC_STATUS_LABELS,
  validityLabel
} from './operation-screens.js';

/**
 * Presentación del estado de sincronización y de la antigüedad de las
 * referencias (ADR-0026 D5, CA-04-06 y CA-04-07).
 *
 * Un dato ausente se muestra como **nunca recibido** y uno vencido como
 * vencido: la pantalla no convierte ninguno de los dos en vigente.
 */

const entry = (overrides: Partial<SyncDestinationStatusResponse['references']['catalog']> = {}) => ({
  publishedBy: 'node-coordinator',
  publishedAt: '2026-09-06T10:00:00.000Z',
  version: 3,
  count: 12,
  ageMilliseconds: 7_200_000,
  ...overrides
});

const status = (
  overrides: Partial<SyncDestinationStatusResponse> = {}
): SyncDestinationStatusResponse => ({
  destinationNodeId: 'node-coordinator',
  status: 'SYNCED',
  connectivity: 'ONLINE',
  pendingDeliveries: 0,
  pausedDeliveries: 0,
  blockedDeliveries: 0,
  pendingApplications: 0,
  openDiscrepancies: 0,
  referencesUsable: true,
  pendingReferences: 0,
  references: {
    catalog: entry(),
    exchangeRate: { ...entry({ count: 2 }), validUntil: null, expired: false },
    operatorGrants: {
      ...entry({ count: 4 }),
      expiresAt: '2026-09-06T18:00:00.000Z',
      expired: false
    },
    stockAvailability: entry({ count: 30 })
  },
  lastPublishedAt: '2026-09-06T11:59:00.000Z',
  lastError: null,
  observedAt: '2026-09-06T12:00:00.000Z',
  ...overrides
});

const pendingOperation: CoordinatedOperationResponse = {
  operationId: 'operation-1',
  kind: 'SALE_RETURN',
  status: 'PENDING_RECONCILIATION',
  fingerprint: 'sale-001',
  coordinatorNodeId: 'node-coordinator',
  reason: 'Producto defectuoso.',
  startedAt: '2026-09-06T11:00:00.000Z',
  updatedAt: '2026-09-06T11:00:00.000Z',
  steps: [
    { step: 'LOCAL_EFFECT', state: 'APPLIED', nodeId: 'node-terminal-1', recordedAt: '2026-09-06T11:00:01.000Z' },
    { step: 'COORDINATOR_EFFECT', state: 'PENDING', nodeId: 'node-coordinator', recordedAt: '2026-09-06T11:00:00.000Z' }
  ]
};

const diagnostics = (): OperationalDiagnosticsResponse => ({
  observedAt: '2026-09-06T12:00:00.000Z',
  deliveries: [], salesAttention: [], trace: null
});

const screenApi = (overrides: Partial<OperationApi> = {}): OperationApi => ({
  getSyncStatus: vi.fn(async () => status()),
  getOperationalDiagnostics: vi.fn(async () => diagnostics()),
  listSyncNodes: vi.fn(async () => []),
  listCoordinatedOperations: vi.fn(async () => [pendingOperation]),
  ...overrides
} as unknown as OperationApi);

const render = (permissionCodes: readonly string[]): string => renderToStaticMarkup(
  <SyncScreen
    api={screenApi()}
    capabilities={{ fiscalMode: 'SIMULATION', simulatedReportsEnabled: false }}
    permissionCodes={permissionCodes}
  />
);

describe('presentación del estado de sincronización', () => {
  it('describe cada rótulo sin prometer actualidad global', () => {
    expect(SYNC_STATUS_LABELS.SYNCED).toBe('Al día');
    expect(SYNC_STATUS_LABELS.ATTENTION_REQUIRED).toBe('Requiere atención');
    expect(SYNC_STATUS_LABELS.OFFLINE).toBe('Sin contacto');
  });

  it('distingue una referencia nunca recibida de una recién llegada', () => {
    expect(referenceAge(null)).toBe('Nunca recibida');
    expect(referenceAge(0)).toBe('hace instantes');
    expect(referenceAge(7_200_000)).toBe('hace 2 h');
    expect(referenceAge(3 * 24 * 3_600_000)).toBe('hace 3 d');
  });

  it('no presenta como vigente una concesión vencida', () => {
    expect(validityLabel(null, false)).toBe('Sin vigencia declarada');
    expect(validityLabel('2026-09-06T18:00:00.000Z', false)).toContain('Vigente hasta');
    expect(validityLabel('2026-09-06T09:00:00.000Z', true)).toContain('Vencida el');
  });

  it('lista las cuatro referencias con su fuente, versión y antigüedad', () => {
    const rows = referenceRows(status().references);

    expect(rows.map(({ label }) => label)).toEqual([
      'Catálogo', 'Tasa de cambio', 'Concesiones de operador', 'Disponibilidad'
    ]);
    expect(rows[0]?.entry).toMatchObject({ publishedBy: 'node-coordinator', version: 3 });
    expect(rows[3]?.note).toContain('no reserva existencias');
  });

  it('muestra una referencia ausente como nunca recibida, no como vacía', () => {
    const rows = referenceRows(status({
      references: {
        ...status().references,
        catalog: { publishedBy: null, publishedAt: null, version: null, count: 0, ageMilliseconds: null }
      }
    }).references);

    expect(referenceAge(rows[0]!.entry.ageMilliseconds)).toBe('Nunca recibida');
    expect(rows[0]?.entry.publishedBy).toBeNull();
  });

  it('solo es alcanzable con permiso de revisión de la recepción', () => {
    expect(canReviewSync(['sync.reception.review'])).toBe(true);
    expect(canReviewSync(['sync.node.manage'])).toBe(true);
    expect(canReviewSync(['sale.void'])).toBe(false);
  });

  it('advierte que consultar el estado no confirma ninguna entrega', () => {
    const markup = render(['sync.reception.review']);

    expect(markup).toContain('no confirma ninguna entrega');
    expect(markup).toContain('Una cola vacía no basta para estar al día');
  });

  it('explica la falta de permiso en lugar de ofrecer una consulta que fallará', () => {
    const markup = render(['sale.void']);

    expect(markup).toContain('no tiene permiso para revisar la recepción');
  });
});
