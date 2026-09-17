
/**
 * Ensamblador del cliente HTTP de la terminal.
 *
 * Desde 12.05.04 no declara operaciones: las reúne. Cada feature tiene su
 * archivo con sus contratos, y aquí sólo se esparcen sobre un mismo objeto para
 * que la superficie pública siga siendo la misma que consumen las pantallas y
 * los mocks. Agregar una operación se hace en su grupo, no aquí.
 */
import { salesOperations } from './api-sales.js';
import { cashOperations } from './api-cash.js';
import { catalogOperations } from './api-catalog.js';
import { configOperations } from './api-config.js';
import { currencyOperations } from './api-currency.js';
import { identityOperations } from './api-identity.js';
import { inventoryOperations } from './api-inventory.js';
import { purchasingOperations } from './api-purchasing.js';
import { reportOperations } from './api-reports.js';
import { sessionOperations } from './api-session.js';
import { syncOperations } from './api-sync.js';

export const createDesktopApi = (fetcher: typeof fetch = globalThis.fetch) => ({
  ...sessionOperations(fetcher),
  ...salesOperations(fetcher),
  ...cashOperations(fetcher),
  ...catalogOperations(fetcher),
  ...purchasingOperations(fetcher),
  ...inventoryOperations(fetcher),
  ...configOperations(fetcher),
  ...reportOperations(fetcher),
  ...currencyOperations(fetcher),
  ...identityOperations(fetcher),
  ...syncOperations(fetcher),
});

type FullDesktopApi = ReturnType<typeof createDesktopApi>;

/**
 * Superficie del ciclo de vida de la sesión: siempre presente porque el shell
 * la necesita antes de conocer ningún permiso. Cambiar el PIN propio y canjear
 * un enrolamiento entran aquí y no en las pantallas: la primera es lo único que
 * una sesión con credencial caducada puede hacer y la segunda ocurre cuando
 * todavía no hay sesión (ADR-0028).
 */
type SessionApiKeys = 'currentSession' | 'login' | 'logout' | 'capabilities'
  | 'changeOwnPin' | 'completeCredentialEnrollment';
export type DesktopApi = Pick<FullDesktopApi, SessionApiKeys> &
  Partial<Omit<FullDesktopApi, SessionApiKeys>>;
export type OperationApi = Required<Omit<DesktopApi, SessionApiKeys>>;
