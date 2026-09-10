/**
 * Fachada de re-exportación. Cada pantalla vive en su propio módulo bajo
 * `./screens/`; este archivo solo compone la navegación por identificador de
 * ruta y conserva la superficie pública que ya consumían `App.tsx` y las
 * pruebas, sin lógica propia.
 */
import { CashScreen } from './screens/cash.js';
import { CatalogScreen } from './screens/catalog.js';
import { CurrencyScreen } from './screens/currency.js';
import { InventoryScreen } from './screens/inventory.js';
import { ReportsScreen } from './screens/reports.js';
import { SalesScreen } from './screens/sales.js';
import { SuppliersScreen } from './screens/suppliers.js';
import { StockCountsScreen } from './screens/stock-counts.js';
import { ConfigScreen } from './screens/config.js';
import { IdentityScreen } from './screens/identity.js';
import { SyncScreen } from './screens/sync.js';
import type { ScreenProps } from './screens/shared.js';

export const routeScreen = (routeId: string, props: ScreenProps): React.JSX.Element | null => {
  if (routeId === 'sales') return <SalesScreen {...props} />;
  if (routeId === 'cash') return <CashScreen {...props} />;
  if (routeId === 'catalog') return <CatalogScreen {...props} />;
  if (routeId === 'inventory') return <InventoryScreen {...props} />;
  if (routeId === 'suppliers') return <SuppliersScreen {...props} />;
  if (routeId === 'counts') return <StockCountsScreen {...props} />;
  if (routeId === 'config') return <ConfigScreen {...props} />;
  if (routeId === 'identity') return <IdentityScreen {...props} />;
  if (routeId === 'reports') return <ReportsScreen {...props} />;
  if (routeId === 'rates') return <CurrencyScreen {...props} />;
  if (routeId === 'sync') return <SyncScreen {...props} />;
  return null;
};

export { money } from './screens/shared.js';
export type { ReportSection } from './screens/shared.js';
export { activeShiftLabel, saleCompletionBlocker, SalesScreen } from './screens/sales.js';
export { CashScreen } from './screens/cash.js';
export { CatalogScreen } from './screens/catalog.js';
export { filterSuppliers, InventoryScreen } from './screens/inventory.js';
export {
  ProductPicker, filterProducts, productLabel, useProductCatalog
} from './screens/product-picker.js';
export {
  SuppliersScreen, canManageSuppliers, supplierTaxTypeFor, supplierUpdatePayload,
  toFiscalAddress, toSupplierForm, SUPPLIER_STATUS_HINTS, SUPPLIER_STATUS_LABELS,
  type SupplierForm
} from './screens/suppliers.js';
export {
  StockCountsScreen, canWorkOnStockCounts, STOCK_COUNT_STATUS_LABELS
} from './screens/stock-counts.js';
export { ConfigScreen, canManageConfig, DEVICE_TYPE_LABELS } from './screens/config.js';
export {
  IdentityScreen, canAdministerIdentity, localAccessOf, toggleCode,
  LOCAL_ACCESS_HINTS, LOCAL_ACCESS_LABELS, type LocalAccessState
} from './screens/identity.js';
export {
  ReportsScreen, loadOperationalReports, shiftOptionLabel, toCsv, toReportQuery,
  type OperationalReports
} from './screens/reports.js';
export {
  SyncScreen, canReviewSync, referenceAge, referenceRows, validityLabel,
  DELIVERY_STATE_LABELS, SYNC_STATUS_HINTS, SYNC_STATUS_LABELS
} from './screens/sync.js';
export {
  CurrencyScreen, ageLabel, confirmManualRate, loadCurrentAndHistory, loadSuggestion,
  suggestionToManualForm, type CurrencyPairReads, type ManualRateForm
} from './screens/currency.js';
