import { describe, expect, it, vi } from 'vitest';
import type {
  CoordinatedOperationResponse,
  SyncDestinationStatusResponse,
  SyncNodeResponse
} from '@supermarket/shared';
import { ApiProblemError, type OperationApi } from './api-client.js';
import { SyncScreen } from './operation-screens.js';
import { click, deferred, mount, select, settle, submit } from './testing/dom.js';

/**
 * Interacción real de la pantalla de sincronización (CA-04-06, CA-04-07 y
 * CA-04-11). A diferencia de las pruebas de render estático, aquí corren los
 * efectos, los manejadores de eventos y las transiciones de estado ocupado.
 *
 * La pantalla es de lectura: consultarla no confirma entregas ni ejecuta
 * reanudaciones. Lo que se verifica es que el operador vea el estado con su
 * evidencia y que un fallo no se presente como éxito.
 */

const entry = (overrides: Partial<SyncDestinationStatusResponse['references']['catalog']> = {}) => ({
  publishedBy: 'node-coordinator',
  publishedAt: '2026-09-07T10:00:00.000Z',
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
      expiresAt: '2026-09-07T18:00:00.000Z',
      expired: false
    },
    stockAvailability: entry({ count: 30 })
  },
  lastPublishedAt: '2026-09-07T11:59:00.000Z',
  lastError: null,
  observedAt: '2026-09-07T12:00:00.000Z',
  ...overrides
});

const nodes: readonly SyncNodeResponse[] = [
  {
    nodeId: 'node-coordinator',
    role: 'COORDINATOR',
    status: 'ACTIVE',
    terminalId: null,
    branchId: null,
    coordinatorNodeId: null,
    address: null,
    registeredAt: '2026-09-06T09:00:00.000Z',
    revokedAt: null
  },
  {
    nodeId: 'node-terminal-2',
    role: 'TERMINAL',
    status: 'ACTIVE',
    terminalId: 'terminal-002',
    branchId: null,
    coordinatorNodeId: 'node-coordinator',
    address: null,
    registeredAt: '2026-09-06T09:05:00.000Z',
    revokedAt: null
  }
] as unknown as readonly SyncNodeResponse[];

const pendingReturn: CoordinatedOperationResponse = {
  operationId: 'operation-1',
  kind: 'SALE_RETURN',
  status: 'PENDING_RECONCILIATION',
  fingerprint: 'sale-001',
  coordinatorNodeId: 'node-coordinator',
  reason: 'Producto defectuoso.',
  startedAt: '2026-09-07T11:00:00.000Z',
  updatedAt: '2026-09-07T11:00:00.000Z',
  steps: [
    {
      step: 'LOCAL_EFFECT', state: 'APPLIED', nodeId: 'node-terminal-1',
      recordedAt: '2026-09-07T11:00:01.000Z'
    },
    {
      step: 'COORDINATOR_EFFECT', state: 'PENDING', nodeId: 'node-coordinator',
      recordedAt: '2026-09-07T11:00:00.000Z'
    }
  ]
};

const screenApi = (overrides: Partial<OperationApi> = {}): OperationApi => ({
  listSyncNodes: vi.fn(async () => nodes),
  getSyncStatus: vi.fn(async () => status()),
  listCoordinatedOperations: vi.fn(async () => [pendingReturn]),
  ...overrides
} as unknown as OperationApi);

const render = (api: OperationApi, permissionCodes = ['sync.reception.review', 'sync.node.manage']) =>
  mount(
    <SyncScreen
      api={api}
      capabilities={{ fiscalMode: 'SIMULATION', simulatedReportsEnabled: false }}
      permissionCodes={permissionCodes}
    />
  );

describe('interacción de la pantalla de sincronización', () => {
  it('carga los nodos al montar y preselecciona el primero sin consultar nada', async () => {
    const api = screenApi();
    const screen = await render(api);

    expect(api.listSyncNodes).toHaveBeenCalledTimes(1);
    expect(screen.get<HTMLSelectElement>('select').value).toBe('node-coordinator');
    /** Montar la pantalla no consulta un estado: el operador decide cuándo. */
    expect(api.getSyncStatus).not.toHaveBeenCalled();
    expect(screen.text()).toContain('Consulta un destino para ver su estado.');
  });

  it('consulta el destino elegido y muestra su estado con la conectividad aparte', async () => {
    const api = screenApi();
    const screen = await render(api);

    await select(screen.get<HTMLSelectElement>('select'), 'node-terminal-2');
    await submit(screen.get<HTMLFormElement>('form'));

    expect(api.getSyncStatus).toHaveBeenCalledWith('node-terminal-2');
    expect(api.listCoordinatedOperations).toHaveBeenCalledWith('PENDING_RECONCILIATION');
    const text = screen.text();
    expect(text).toContain('Al día');
    expect(text).toContain('En línea');
    expect(text).toContain('El último ciclo verificado no dejó trabajo pendiente conocido');
    expect(text).toContain('Lectura tomada el');
  });

  it('muestra la antigüedad de cada referencia y una concesión vencida como vencida', async () => {
    const expired = status({
      status: 'ATTENTION_REQUIRED',
      references: {
        ...status().references,
        catalog: {
          publishedBy: null, publishedAt: null, version: null, count: 0, ageMilliseconds: null
        },
        operatorGrants: {
          ...entry({ count: 4 }),
          expiresAt: '2026-09-07T09:00:00.000Z',
          expired: true
        }
      }
    });
    const screen = await render(screenApi({ getSyncStatus: vi.fn(async () => expired) }));

    await submit(screen.get<HTMLFormElement>('form'));

    const text = screen.text();
    /** Ausente es «nunca recibida», no vacía; vencida no vuelve a ser vigente. */
    expect(text).toContain('Nunca recibida');
    expect(text).toContain('Vencida el');
    expect(text).toContain('Requiere atención');
    expect(screen.findByText('span.simulation-label', 'Vencida el')).not.toBeNull();
  });

  it('lista las operaciones pendientes de conciliación con el estado de cada paso', async () => {
    const screen = await render(screenApi());

    await submit(screen.get<HTMLFormElement>('form'));

    const row = screen.findByText('tbody tr', 'Devolución de venta');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('sale-001');
    expect(row?.textContent).toContain('Efectos locales: Aplicado');
    expect(row?.textContent).toContain('Efectos del coordinador: Pendiente');
  });

  it('anuncia el estado ocupado mientras la lectura viaja y lo libera al responder', async () => {
    const inflight = deferred<SyncDestinationStatusResponse>();
    const screen = await render(screenApi({
      getSyncStatus: vi.fn(() => inflight.promise)
    }));

    await submit(screen.get<HTMLFormElement>('form'));

    const busy = screen.button('Consultando…');
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(busy.disabled).toBe(true);

    inflight.resolve(status());
    await settle();

    const ready = screen.button('Consultar estado');
    expect(ready.getAttribute('aria-busy')).toBeNull();
    expect(ready.disabled).toBe(false);
  });

  it('explica un fallo con su correlación y no lo presenta como estado válido', async () => {
    const screen = await render(screenApi({
      getSyncStatus: vi.fn(async () => {
        throw new ApiProblemError({
          type: 'urn:supermarket:problem:forbidden',
          title: 'Forbidden',
          status: 403,
          code: 'FORBIDDEN',
          correlationId: 'correlation-123'
        });
      })
    }));

    await submit(screen.get<HTMLFormElement>('form'));

    const alert = screen.get('[role="alert"]');
    expect(alert.textContent).toContain('No tienes autorización para esta operación.');
    expect(alert.textContent).toContain('correlation-123');
    /** Un fallo no deja un estado a medias: la pantalla sigue sin lectura. */
    expect(screen.text()).toContain('Consulta un destino para ver su estado.');

    await click(screen.button('Descartar'));
    expect(screen.query('[role="alert"]')).toBeNull();
  });

  it('sin permiso de revisión no ofrece una consulta que el servidor rechazaría', async () => {
    const api = screenApi({ listSyncNodes: vi.fn(async () => []) });
    const screen = await render(api, ['sale.void']);

    expect(api.listSyncNodes).not.toHaveBeenCalled();
    expect(screen.text()).toContain('no tiene permiso para revisar la recepción');
    expect(screen.button('Consultar estado').disabled).toBe(true);

    /** Aunque se fuerce el envío, el renderer no inventa una lectura. */
    await submit(screen.get<HTMLFormElement>('form'));
    expect(api.getSyncStatus).not.toHaveBeenCalled();
  });
});
