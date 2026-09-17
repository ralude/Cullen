/**
 * Navegación de la terminal: qué pantallas existen, cómo se agrupan, qué
 * sesión alcanza cada una y con qué atajo.
 *
 * Separada del shell por 12.05.06. Es lógica pura —sin estado, sin efectos y
 * sin React— así que agregar una pantalla o cambiar quién la ve se hace aquí,
 * sin leer el arranque de sesión, el formulario de ingreso ni el boundary de
 * errores. El servidor sigue siendo la autoridad: ocultar una ruta nunca
 * sustituye la autorización que el caso de uso vuelve a exigir.
 */
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
  voidSaleContract
} from '@supermarket/shared';
import {
  canAdministerIdentity,
  canManageConfig,
  canManageSuppliers,
  canReviewSync,
  canWorkOnStockCounts
} from './operation-screens.js';

/**
 * La navegación ocupa 236 px que la pantalla de venta necesita para el ticket
 * y el catálogo. Plegarla los devuelve al trabajo, y la preferencia sobrevive
 * al montaje porque es del puesto, no de la sesión.
 */
export const NAVIGATION_COLLAPSED_KEY = 'supermarket.navigation-collapsed.v1';

export type AppRoute = {
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
    id: 'identity', hash: '#/identity', label: 'Identidad', title: 'Operadores y roles',
    shortcut: 'i',
    description: 'Alta de operadores, roles, permisos y enrolamiento de credenciales.',
    isReachable: canAdministerIdentity
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
  { label: 'Administración', routes: ROUTES.filter(({ id }) => ['config', 'rates', 'identity'].includes(id)) },
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