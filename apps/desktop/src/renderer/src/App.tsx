import { Component, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { CapabilitiesResponse, SessionResponse } from '@supermarket/shared';
import { createDesktopApi, type DesktopApi, type OperationApi } from './api-client.js';
import { ApiProblemError } from './api-transport.js';
import { CredentialEnrollmentPanel, MandatoryPinChange } from './screens/credential.js';
import { routeScreen } from './operation-screens.js';
import { readStorage, writeStorage } from './screens/shared.js';
import {
  isRouteReachable,
  NAVIGATION_COLLAPSED_KEY,
  resolveRoute,
  shortcutHash,
  visibleNavigationGroups,
  type AppRoute
} from './navigation.js';

export const PRODUCT_NAME = 'Cullen';

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
  /** La sesión se relee: quien manda sobre el estado restringido es el nodo. */
  readonly onPinChanged: () => void;
  readonly showsEnrollment: boolean;
  readonly onToggleEnrollment: () => void;
  readonly navigationCollapsed: boolean;
  readonly onToggleNavigation: () => void;
  readonly api: DesktopApi;
};

const Brand = (): React.JSX.Element => (
  <div className="brand" aria-label={PRODUCT_NAME}>
    <strong>{PRODUCT_NAME}</strong>
    <small>Punto de venta</small>
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
          <strong>{item.label}</strong>
          <small>{item.description}</small>
        </a>
      ))}
    </nav>
    <section className="panel" aria-labelledby="station-status-title">
      <h2 id="station-status-title">Estado de la estación</h2>
      <dl className="detail-grid">
        <div>
          <dt>Modo fiscal</dt>
          <dd>{capabilities.fiscalMode === 'SIMULATION' ? 'Simulado' : capabilities.fiscalMode}</dd>
        </div>
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
  onPinChanged,
  showsEnrollment,
  onToggleEnrollment,
  navigationCollapsed,
  onToggleNavigation,
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
        {showsEnrollment
          ? <CredentialEnrollmentPanel api={api} onBack={onToggleEnrollment} />
          : (
            <form className="login-card" onSubmit={onLogin}>
              <div>
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
              <div className="login-alternative">
                <p>
                  <strong>¿Tienes un código de enrolamiento?</strong>
                  <span>Abre otro formulario para crear tu PIN en esta terminal.</span>
                </p>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={onToggleEnrollment}
                >
                  Usar código de enrolamiento
                </button>
              </div>
            </form>
          )}
      </main>
    );
  }

  /**
   * Sesión con credencial caducada: el nodo solo admite cambiar el PIN y cerrar
   * sesión (ADR-0028 D9). Ofrecer la operación normal sería simular una
   * capacidad que el servidor ya rechaza.
   */
  if (state.session.credentialMustChange) {
    return (
      <MandatoryPinChange
        api={api}
        displayName={state.session.displayName}
        onChanged={onPinChanged}
        onLogout={onLogout}
      />
    );
  }

  const shellClass = [
    'app-shell',
    route.id === 'sales' ? 'sales-shell' : null,
    navigationCollapsed ? 'is-nav-collapsed' : null
  ].filter((name) => name !== null).join(' ');

  return (
    <div className={shellClass}>
      {!navigationCollapsed && (
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
        </aside>
      )}
      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <button
              type="button"
              className="nav-toggle"
              onClick={onToggleNavigation}
              aria-expanded={!navigationCollapsed}
              aria-label={navigationCollapsed ? 'Mostrar navegación' : 'Ocultar navegación'}
              title={navigationCollapsed ? 'Mostrar navegación' : 'Ocultar navegación'}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M3 5h14M3 10h14M3 15h14" />
              </svg>
            </button>
            <div>
              <h1 id="workspace-title">{route.title}</h1>
              <p className="topbar-hint">{route.description}</p>
            </div>
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
              ? routeScreen(route.id, {
                api: api as OperationApi, capabilities: state.capabilities,
                permissionCodes: state.session.permissionCodes
              }) ?? (
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
  const [showsEnrollment, setShowsEnrollment] = useState(false);
  const [navigationCollapsed, setNavigationCollapsed] = useState(() => readStorage(NAVIGATION_COLLAPSED_KEY) === 'true');
  const toggleNavigation = (): void => {
    setNavigationCollapsed((collapsed) => {
      const next = !collapsed;
      writeStorage(NAVIGATION_COLLAPSED_KEY, String(next));
      return next;
    });
  };
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
      onPinChanged={() => { void loadSession(); }}
      showsEnrollment={showsEnrollment}
      onToggleEnrollment={() => setShowsEnrollment((value) => !value)}
      navigationCollapsed={navigationCollapsed}
      onToggleNavigation={toggleNavigation}
      api={api}
    />
  );
};
