import { Component, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  applySaleDiscountContract,
  closeShiftContract,
  createProductContract,
  getInventoryReportContract,
  getKardexContract,
  getMarginReportContract,
  getAuditReportContract,
  getCashClosureReportContract,
  getFiscalOperationsReportContract,
  getSaleHistoryContract,
  getSalesReportContract,
  getShiftContract,
  isPermissionGranted,
  openShiftContract,
  receivePurchaseContract,
  registerCashMovementContract,
  registerStockAdjustmentContract,
  returnSaleContract,
  updateExchangeRateContract,
  updatePriceContract,
  voidSaleContract,
  type CapabilitiesResponse,
  type SessionResponse
} from '@supermarket/shared';
import { ApiProblemError, createDesktopApi, type DesktopApi, type OperationApi } from './api-client.js';
import {
  canManageConfig, canManageSuppliers, canReviewSync, canWorkOnStockCounts, routeScreen
} from './operation-screens.js';

export const PRODUCT_NAME = 'Cullen';

type AppRoute = {
  readonly id: string;
  readonly hash: string;
  readonly label: string;
  readonly title: string;
  readonly shortcut: string;
  readonly description: string;
  /**
   * Cuándo la sesión puede alcanzar esta pantalla. Ausente = alcanzable con
   * cualquier sesión válida. La mayoría de las pantallas mezclan lecturas sin
   * permiso con comandos que sí lo exigen, así que ocultar la pantalla entera
   * solo es correcto cuando ninguna de sus acciones es de solo sesión — hoy
   * ocurre en Reportes, en Proveedores (cuya lectura solo existe para el
   * selector de recepción), en Conteos (cuya lectura solo tiene sentido para
   * quien cuenta o aprueba) y en Config. (sucursales y dispositivos son
   * administración pura, sin trabajo de solo lectura para el resto).
   */
  readonly isReachable?: (permissionCodes: readonly string[]) => boolean;
};

const REPORTS_READ_CONTRACTS = [
  getCashClosureReportContract, getAuditReportContract, getFiscalOperationsReportContract,
  getMarginReportContract, getSalesReportContract, getInventoryReportContract,
  getShiftContract, getSaleHistoryContract
] as const;

type PermissionContract = { readonly permission: string | null };
const grantsAny = (
  contracts: readonly PermissionContract[], permissionCodes: readonly string[]
): boolean => contracts.some(
  (contract) => contract.permission !== null
    && isPermissionGranted(contract.permission, permissionCodes)
);

const CASH_WORK_CONTRACTS = [
  openShiftContract, closeShiftContract, registerCashMovementContract, getShiftContract,
  applySaleDiscountContract, voidSaleContract, returnSaleContract, getSaleHistoryContract
] as const;
const CATALOG_WORK_CONTRACTS = [createProductContract, updatePriceContract] as const;
const INVENTORY_WORK_CONTRACTS = [
  getKardexContract, receivePurchaseContract, registerStockAdjustmentContract
] as const;

const canWorkCash = (permissionCodes: readonly string[]): boolean =>
  grantsAny(CASH_WORK_CONTRACTS, permissionCodes);
const canWorkCatalog = (permissionCodes: readonly string[]): boolean =>
  canWorkCash(permissionCodes) || grantsAny(CATALOG_WORK_CONTRACTS, permissionCodes);
const canWorkInventory = (permissionCodes: readonly string[]): boolean =>
  grantsAny(INVENTORY_WORK_CONTRACTS, permissionCodes)
  || canManageSuppliers(permissionCodes)
  || canWorkOnStockCounts(permissionCodes);

const ROUTES: readonly AppRoute[] = [
  {
    id: 'home', hash: '#/', label: 'Inicio', title: 'Inicio', shortcut: '1',
    description: 'Resumen de la estación y accesos directos a la operación diaria.'
  },
  {
    id: 'sales', hash: '#/sales', label: 'Venta', title: 'Punto de venta', shortcut: '2',
    description: 'Escanea productos, cobra y completa la venta del turno abierto.',
    isReachable: canWorkCash
  },
  {
    id: 'cash', hash: '#/cash', label: 'Caja', title: 'Operación de caja', shortcut: '3',
    description: 'Apertura de turno, movimientos de efectivo y cierre con arqueo.',
    isReachable: canWorkCash
  },
  {
    id: 'catalog', hash: '#/catalog', label: 'Catálogo', title: 'Catálogo', shortcut: '4',
    description: 'Consulta productos por barcode y administra precios auditados.',
    isReachable: canWorkCatalog
  },
  {
    id: 'inventory', hash: '#/inventory', label: 'Inventario', title: 'Inventario', shortcut: '5',
    description: 'Kardex, recepciones de compra y ajustes autorizados de existencia.',
    isReachable: canWorkInventory
  },
  {
    id: 'suppliers', hash: '#/suppliers', label: 'Proveedores', title: 'Proveedores',
    shortcut: '6',
    description: 'Maestro de proveedores con identidad fiscal, estados y auditoría.',
    isReachable: canManageSuppliers
  },
  {
    id: 'counts', hash: '#/counts', label: 'Conteos', title: 'Conteos físicos', shortcut: '7',
    description: 'Conteo de existencia, diferencias congeladas y aprobación con ajuste.',
    isReachable: canWorkOnStockCounts
  },
  {
    id: 'reports', hash: '#/reports', label: 'Reportes', title: 'Reportes y cierres', shortcut: '8',
    description: 'Cierres de caja, auditoría y estados fiscales del período.',
    isReachable: (permissionCodes) => grantsAny(REPORTS_READ_CONTRACTS, permissionCodes)
  },
  {
    id: 'config', hash: '#/config', label: 'Config.', title: 'Configuración operativa', shortcut: '0',
    description: 'Administra maestros, políticas, sucursales y dispositivos.',
    isReachable: canManageConfig
  },
  {
    id: 'sync', hash: '#/sync', label: 'Sync', title: 'Sincronización entre nodos',
    shortcut: 's',
    description: 'Estado del enlace, antigüedad de las referencias y operaciones pendientes.',
    isReachable: canReviewSync
  },
  {
    id: 'rates', hash: '#/rates', label: 'Tasas', title: 'Tasas de cambio', shortcut: '9',
    description: 'Tasa vigente, histórico local y confirmación de sugerencias externas.',
    isReachable: (permissionCodes) => isPermissionGranted(
      updateExchangeRateContract.permission, permissionCodes
    )
  }
];

type NavigationGroup = {
  readonly label: string;
  readonly routes: readonly AppRoute[];
};

const NAVIGATION_GROUPS: readonly NavigationGroup[] = [
  { label: 'General', routes: ROUTES.filter(({ id }) => id === 'home') },
  { label: 'Caja', routes: ROUTES.filter(({ id }) => ['sales', 'cash', 'catalog'].includes(id)) },
  { label: 'Inventario', routes: ROUTES.filter(({ id }) => ['inventory', 'suppliers', 'counts'].includes(id)) },
  { label: 'Administración', routes: ROUTES.filter(({ id }) => ['config', 'rates'].includes(id)) },
  { label: 'Supervisión y gerencia', routes: ROUTES.filter(({ id }) => ['reports', 'sync'].includes(id)) }
];

export const resolveRoute = (hash: string): AppRoute =>
  ROUTES.find((route) => route.hash === hash) ?? ROUTES[0]!;

/**
 * El servidor sigue siendo la autoridad: esto solo decide qué ofrece la
 * interfaz. Ocultar una ruta nunca sustituye la autorización que el caso de
 * uso vuelve a exigir en cada intento.
 */
export const isRouteReachable = (route: AppRoute, permissionCodes: readonly string[]): boolean =>
  route.isReachable === undefined || route.isReachable(permissionCodes);

/**
 * Un perfil es la unión de capacidades concedidas. Los nombres de rol no
 * participan y una ruta aparece una sola vez aunque varios permisos la habiliten.
 */
export const visibleNavigationGroups = (
  permissionCodes: readonly string[]
): readonly NavigationGroup[] => NAVIGATION_GROUPS
  .map((group) => ({
    ...group,
    routes: group.routes.filter((route) => isRouteReachable(route, permissionCodes))
  }))
  .filter((group) => group.routes.length > 0);

/** Atajo de teclado del POS: Alt + dígito lleva a la pantalla correspondiente. */
export const shortcutHash = (key: string): string | null =>
  ROUTES.find((route) => route.shortcut === key)?.hash ?? null;

export type AppViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'signed-out'; readonly message: string | null }
  | { readonly kind: 'error' }
  | {
    readonly kind: 'ready';
    readonly session: SessionResponse;
    readonly capabilities: CapabilitiesResponse;
  };

/**
 * Distingue una respuesta del servidor (aunque sea un error de negocio) de una
 * falla de transporte genuina: `fetch` solo lanza un `ApiProblemError` una vez
 * que la respuesta llegó. Todo lo demás — el nodo apagado, la red caída — no
 * pasó de ahí.
 */
export type NodeConnection = 'checking' | 'online' | 'offline';
const connectionFrom = (error: unknown): NodeConnection =>
  error instanceof ApiProblemError ? 'online' : 'offline';

export type SessionLoadResult = { readonly state: AppViewState; readonly connection: NodeConnection };

export const loadInitialState = async (api: DesktopApi): Promise<SessionLoadResult> => {
  try {
    const session = await api.currentSession();
    const capabilities = await api.capabilities();
    return { state: { kind: 'ready', session, capabilities }, connection: 'online' };
  } catch (error) {
    const state: AppViewState = error instanceof ApiProblemError && error.problem.status === 401
      ? { kind: 'signed-out', message: null }
      : { kind: 'error' };
    return { state, connection: connectionFrom(error) };
  }
};

/**
 * Evita que un fallo de render deje la ventana en blanco: aísla la pantalla
 * activa y ofrece recuperación sin reiniciar la estación.
 */
export class ScreenErrorBoundary extends Component<
  { readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="panel" role="alert">
        <h2>No pudimos dibujar esta pantalla</h2>
        <p className="muted">
          La operación en el nodo no se vio afectada. Vuelve a intentarlo o cambia de pantalla.
        </p>
        <div className="button-row">
          <button
            className="primary-button"
            type="button"
            onClick={() => this.setState({ failed: false })}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }
}

type AppViewProps = {
  readonly state: AppViewState;
  readonly connection: NodeConnection;
  readonly route: AppRoute;
  readonly platform: string;
  readonly operatorCode: string;
  readonly pin: string;
  readonly onOperatorCodeChange: (value: string) => void;
  readonly onPinChange: (value: string) => void;
  readonly onLogin: (event: FormEvent<HTMLFormElement>) => void;
  readonly onLogout: () => void;
  readonly onRetry: () => void;
  readonly api?: DesktopApi;
};

const Brand = (): React.JSX.Element => (
  <div className="brand" aria-label={PRODUCT_NAME}>
    <span className="brand-mark" aria-hidden="true">CU</span>
    <span><strong>{PRODUCT_NAME}</strong><small>Punto de venta</small></span>
  </div>
);

const HomeScreen = ({ capabilities, permissionCodes }: {
  readonly capabilities: CapabilitiesResponse;
  readonly permissionCodes: readonly string[];
}): React.JSX.Element => (
  <div className="operation-screen">
    <p className="screen-note">
      {PRODUCT_NAME} está conectado al nodo local. Elige una operación para comenzar.
    </p>
    <nav className="quick-actions" aria-label="Accesos directos">
      {visibleNavigationGroups(permissionCodes).flatMap((group) => group.routes)
        .filter((item) => item.id !== 'home').map((item) => (
        <a key={item.id} className="quick-action" href={item.hash}>
          <span className="quick-action-key" aria-hidden="true">Alt+{item.shortcut}</span>
          <strong>{item.label}</strong>
          <small>{item.description}</small>
        </a>
      ))}
    </nav>
    <section className="panel" aria-labelledby="station-status-title">
      <h2 id="station-status-title">Estado de la estación</h2>
      <dl className="detail-grid">
        <div><dt>Sesión</dt><dd>Activa</dd></div>
        <div><dt>API</dt><dd>v1</dd></div>
        <div><dt>Modo fiscal</dt><dd>{capabilities.fiscalMode}</dd></div>
        <div>
          <dt>Reportes X/Z</dt>
          <dd>{capabilities.simulatedReportsEnabled ? 'Simulados habilitados' : 'Deshabilitados'}</dd>
        </div>
      </dl>
    </section>
  </div>
);

export const AppView = ({
  state,
  connection,
  route,
  platform,
  operatorCode,
  pin,
  onOperatorCodeChange,
  onPinChange,
  onLogin,
  onLogout,
  onRetry,
  api
}: AppViewProps): React.JSX.Element => {
  if (state.kind === 'loading') {
    return (
      <main className="centered-state" aria-live="polite" aria-busy="true">
        <Brand />
        <span className="spinner" aria-hidden="true" />
        <h1>Conectando con el nodo</h1>
        <p>Estamos verificando la sesión local.</p>
      </main>
    );
  }

  if (state.kind === 'error') {
    return (
      <main className="centered-state" role="alert">
        <Brand />
        <span className="state-symbol" aria-hidden="true">!</span>
        <h1>No pudimos conectar con el nodo</h1>
        <p>Comprueba que el servidor local esté iniciado e inténtalo nuevamente.</p>
        <button className="primary-button" type="button" onClick={onRetry}>Reintentar</button>
      </main>
    );
  }

  if (state.kind === 'signed-out') {
    return (
      <main className="access-page">
        <section className="access-intro" aria-labelledby="access-title">
          <Brand />
          <p className="eyebrow">Nodo local · {platform}</p>
          <h1 id="access-title">Ingresar a {PRODUCT_NAME}</h1>
          <p>Usa tu código de operador y PIN. La sesión permanece protegida en una cookie local.</p>
          <span className="simulation-label">Fiscal · SIMULACIÓN</span>
        </section>
        <form className="login-card" onSubmit={onLogin}>
          <div>
            <p className="eyebrow">Acceso operativo</p>
            <h2>Identificación</h2>
          </div>
          <label>
            Código de operador
            <input
              name="operatorCode"
              value={operatorCode}
              onChange={(event) => onOperatorCodeChange(event.target.value)}
              autoComplete="username"
              maxLength={64}
              required
              autoFocus
            />
          </label>
          <label>
            PIN
            <input
              name="pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{6,12}"
              minLength={6}
              maxLength={12}
              value={pin}
              onChange={(event) => onPinChange(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {state.message && <p className="form-error" role="alert">{state.message}</p>}
          <button className="primary-button" type="submit">Ingresar</button>
        </form>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav aria-label="Navegación principal">
          {visibleNavigationGroups(state.session.permissionCodes).map((group) => (
            <div className="navigation-group" key={group.label}>
              {group.label !== 'General' && <p>{group.label}</p>}
              {group.routes.map((item) => (
                <a
                  key={item.id}
                  href={item.hash}
                  aria-current={route.id === item.id ? 'page' : undefined}
                  title={item.description}
                >
                  <span>{item.label}</span>
                  <kbd aria-hidden="true">Alt+{item.shortcut}</kbd>
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span>Entorno</span>
          <strong>Electron · {platform}</strong>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <h1 id="workspace-title">{route.title}</h1>
            <p className="topbar-hint">{route.description}</p>
          </div>
          <div className="topbar-actions">
            <span className={connection === 'offline' ? 'simulation-label' : 'status-label'}>
              <i aria-hidden="true" />
              {connection === 'offline' ? 'Sin conexión con el nodo' : 'Servidor conectado'}
            </span>
            <span className="simulation-label">Fiscal · SIMULACIÓN</span>
            <div className="account">
              <span><small>Operador</small><strong>{state.session.displayName}</strong></span>
              <button type="button" onClick={onLogout}>Salir</button>
            </div>
          </div>
        </header>
        <section className="workspace-content" aria-labelledby="workspace-title">
          <ScreenErrorBoundary key={route.id}>
            {isRouteReachable(route, state.session.permissionCodes)
              ? (api
                ? routeScreen(route.id, {
                  api: api as OperationApi, capabilities: state.capabilities,
                  permissionCodes: state.session.permissionCodes
                })
                : null) ?? (
                <HomeScreen capabilities={state.capabilities} permissionCodes={state.session.permissionCodes} />
              )
              : (
                <div className="panel" role="alert">
                  <h2>No tienes autorización para esta pantalla</h2>
                  <p className="muted">
                    Tu perfil no incluye los permisos necesarios. Cambia de pantalla o solicita
                    acceso al administrador.
                  </p>
                </div>
              )}
          </ScreenErrorBoundary>
        </section>
      </main>
    </div>
  );
};

const defaultApi = createDesktopApi();

export const App = ({ api = defaultApi }: { readonly api?: DesktopApi }): React.JSX.Element => {
  const [state, setState] = useState<AppViewState>({ kind: 'loading' });
  const [connection, setConnection] = useState<NodeConnection>('checking');
  const [operatorCode, setOperatorCode] = useState('');
  const [pin, setPin] = useState('');
  const [route, setRoute] = useState(() => resolveRoute(
    typeof window === 'undefined' ? '#/' : window.location.hash || '#/'
  ));
  const platform = typeof window === 'undefined' ? 'unknown' : window.desktop?.platform ?? 'unknown';

  const loadSession = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });
    const result = await loadInitialState(api);
    setConnection(result.connection);
    setState(result.state);
  }, [api]);

  useEffect(() => { void loadSession(); }, [loadSession]);
  useEffect(() => {
    const updateRoute = (): void => setRoute(resolveRoute(window.location.hash || '#/'));
    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);
  useEffect(() => {
    const navigate = (event: KeyboardEvent): void => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const hash = shortcutHash(event.key);
      if (!hash || state.kind !== 'ready'
        || !isRouteReachable(resolveRoute(hash), state.session.permissionCodes)) return;
      event.preventDefault();
      window.location.hash = hash;
    };
    window.addEventListener('keydown', navigate);
    return () => window.removeEventListener('keydown', navigate);
  }, [state]);

  const login = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setState({ kind: 'loading' });
    try {
      const session = await api.login({ operatorCode, pin });
      setPin('');
      const capabilities = await api.capabilities();
      setConnection('online');
      setState({ kind: 'ready', session, capabilities });
    } catch (error) {
      setPin('');
      setConnection(connectionFrom(error));
      setState(error instanceof ApiProblemError && error.problem.code === 'AUTHENTICATION_FAILED'
        ? { kind: 'signed-out', message: 'Código de operador o PIN incorrecto.' }
        : { kind: 'error' });
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await api.logout();
      setOperatorCode('');
      setPin('');
      setConnection('online');
      setState({ kind: 'signed-out', message: null });
    } catch (error) {
      setConnection(connectionFrom(error));
      setState({ kind: 'error' });
    }
  };

  return (
    <AppView
      state={state}
      connection={connection}
      route={route}
      platform={platform}
      operatorCode={operatorCode}
      pin={pin}
      onOperatorCodeChange={setOperatorCode}
      onPinChange={setPin}
      onLogin={(event) => { void login(event); }}
      onLogout={() => { void logout(); }}
      onRetry={() => { void loadSession(); }}
      api={api}
    />
  );
};
