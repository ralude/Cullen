import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopApi, OperationApi } from './api-client.js';
import {
  SalesScreen, CashScreen, CatalogScreen, InventoryScreen, ReportsScreen, SuppliersScreen,
  canManageConfig, canManageSuppliers, canWorkOnStockCounts, ConfigScreen, DEVICE_TYPE_LABELS,
  filterSuppliers, money, saleCompletionBlocker, StockCountsScreen, supplierTaxTypeFor,
  supplierUpdatePayload, toFiscalAddress, toSupplierForm
} from './operation-screens.js';
import type { SaleResponse, SupplierResponse } from '@supermarket/shared';

const draftSale = (overrides: Partial<SaleResponse> = {}): SaleResponse => ({
  id: 'sale-1', status: 'DRAFT', currencyCode: 'VES', scale: 2,
  subtotalMinorUnits: 10000, discountTotalMinorUnits: 0, taxTotalMinorUnits: 1600,
  totalMinorUnits: 11600, paidTotalMinorUnits: 0, balanceMinorUnits: 11600,
  items: [], payments: [], ...overrides
} as SaleResponse);

const supplier = (): SupplierResponse => ({
  id: 'supplier-1', code: 'SUP-000001', legalName: 'Distribuidora Los Andes',
  tradeName: 'Los Andes', fiscalAddress: null,
  taxIdentity: {
    country: 'VE', type: 'RIF', value: 'J-12345678-9', normalizedValue: 'J123456789'
  },
  status: 'ACTIVE', createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z', version: 1
});

const operationApi = (): OperationApi => {
  const base: DesktopApi = {
    currentSession: async () => ({
      actorId: 'actor', displayName: 'Operador', roleCodes: ['cashier'], permissionCodes: [],
      idleExpiresAt: '', absoluteExpiresAt: '', credentialMustChange: false
    }),
    login: async () => { throw new Error('unused'); },
    logout: async () => undefined,
    capabilities: async () => ({ fiscalMode: 'SIMULATION', simulatedReportsEnabled: false })
  };
  return Object.assign(base, {
    getSale: vi.fn(), startSale: vi.fn(), addSaleItem: vi.fn(), removeSaleItem: vi.fn(),
    applySaleDiscount: vi.fn(), registerSalePayments: vi.fn(), completeSale: vi.fn(), returnSale: vi.fn(), issueSaleInvoice: vi.fn(), createCashRegister: vi.fn(), voidSale: vi.fn(), setSaleRecipient: vi.fn(),
    getOpenShift: vi.fn(), openShift: vi.fn(), registerCashMovement: vi.fn(), closeShift: vi.fn(),
    findProductByBarcode: vi.fn(), listProducts: vi.fn(), getPriceHistory: vi.fn(), createProduct: vi.fn(), updatePrice: vi.fn(), getKardex: vi.fn(),
    receivePurchase: vi.fn(), registerStockAdjustment: vi.fn(), listSuppliers: vi.fn(), getCurrentExchangeRate: vi.fn(), getExchangeRateHistory: vi.fn(), getSuggestedExchangeRate: vi.fn(), updateExchangeRate: vi.fn(), printXReport: vi.fn(), printZReport: vi.fn(), listCategories: vi.fn(), listUnitsOfMeasure: vi.fn(), listPaymentMethods: vi.fn(), listCashRegisters: vi.fn(), createSupplier: vi.fn(), updateSupplier: vi.fn(), changeSupplierStatus: vi.fn(), correctSupplierTaxIdentity: vi.fn(), openStockCount: vi.fn(), recordStockCountLine: vi.fn(), closeStockCount: vi.fn(), approveStockCount: vi.fn(), rejectStockCount: vi.fn(), getStockCount: vi.fn(), listStockCounts: vi.fn(), createBranch: vi.fn(), updateBranch: vi.fn(), changeBranchStatus: vi.fn(), getBranch: vi.fn(), listBranches: vi.fn(), declareDevice: vi.fn(), updateDevice: vi.fn(), changeDeviceStatus: vi.fn(), listDevices: vi.fn()
  }) as OperationApi;
};

describe('operation screens', () => {
  const props = (permissionCodes: readonly string[] = []) => ({
    api: operationApi(), capabilities: { fiscalMode: 'SIMULATION' as const, simulatedReportsEnabled: false },
    permissionCodes
  });

  it('exposes the sale flow without client-side business totals', () => {
    const markup = renderToStaticMarkup(<SalesScreen {...props()} />);
    expect(markup).toContain('Abrir carrito');
    // El turno se resuelve contra el nodo; el render estático lo muestra consultándose.
    expect(markup).toContain('Consultando el turno de la caja');
    expect(markup).toContain('No se aceptan cálculos locales');
  });


  it('exposes cash, catalog, inventory and report operations', () => {
    expect(renderToStaticMarkup(<CashScreen {...props(['cash.shift.open'])} />)).toContain('Abrir caja');
    expect(renderToStaticMarkup(<CatalogScreen {...props()} />)).toContain('Buscar');
    expect(renderToStaticMarkup(<InventoryScreen {...props()} />)).toContain('Consultar kardex');
    const reports = renderToStaticMarkup(<ReportsScreen {...props(['fiscal.report.x'])} />);
    expect(reports).toContain('deshabilitados');
    /**
     * Un panel que solo dice «deshabilitado» deja al operador sin salida: el
     * nodo decide esto al arrancar, así que la pantalla nombra las dos
     * variables que lo habilitan y aclara que la interfaz no puede activarlo.
     */
    expect(reports).toContain('FISCAL_EXECUTION_TARGET=SIMULATOR');
    expect(reports).toContain('FISCAL_SIMULATED_REPORT_CONSENT=ALLOW_SIMULATED_X_AND_Z');
    expect(reports).toContain('la interfaz no puede activarla');
  });

  it('does not render cash commands that the session cannot execute', () => {
    const markup = renderToStaticMarkup(<CashScreen {...props(['cash.shift.read'])} />);
    expect(markup).not.toContain('Abrir turno');
    expect(markup).not.toContain('Registrar movimiento');
    expect(markup).not.toContain('Cerrar turno');
  });

  it('names the reason why a sale cannot be completed yet', () => {
    expect(saleCompletionBlocker(null, 2)).toBeNull();
    expect(saleCompletionBlocker(draftSale(), 2)).toContain('Agrega al menos una línea');

    const withItem = draftSale({ items: [{ id: 'item-1' }] as unknown as SaleResponse['items'] });
    expect(saleCompletionBlocker(withItem, 2)).toContain('Falta cobrar');
    expect(saleCompletionBlocker({ ...withItem, balanceMinorUnits: -500 }, 2)).toContain('supera el total');
    expect(saleCompletionBlocker({ ...withItem, balanceMinorUnits: 0 }, 2)).toBeNull();
    expect(saleCompletionBlocker({ ...withItem, status: 'COMPLETED' } as SaleResponse, 2)).toBeNull();
  });

  it('formats money without throwing on codes Intl does not know', () => {
    expect(money(11600, 'VES', 2)).toContain('116');
    expect(money(11600, 'xx', 2)).toContain('XX');
    expect(() => money(11600, '', 2)).not.toThrow();
  });

  it('searches receipt suppliers by code, name or normalized RIF', () => {
    expect(filterSuppliers([supplier()], 'andEs')).toHaveLength(1);
    expect(filterSuppliers([supplier()], 'J123456789')).toHaveLength(1);
    expect(filterSuppliers([supplier()], 'SUP-999')).toEqual([]);
  });

  it('only offers the supplier master to who can administer it', () => {
    expect(canManageSuppliers([])).toBe(false);
    expect(canManageSuppliers(['inventory.purchase.receive'])).toBe(false);
    expect(canManageSuppliers(['supplier.read'])).toBe(true);
    expect(canManageSuppliers(['supplier.create'])).toBe(true);
    expect(canManageSuppliers(['supplier.update'])).toBe(true);
    expect(canManageSuppliers(['supplier.tax_identity.correct'])).toBe(true);
  });

  it('sends only the supplier fields that actually changed', () => {
    const current = supplier();
    const form = toSupplierForm(current);

    expect(supplierUpdatePayload(current, { ...form, reason: 'Sin cambios' })).toBeNull();
    expect(supplierUpdatePayload(current, { ...form, tradeName: '', reason: 'Retiro' }))
      .toEqual({ tradeName: null, reason: 'Retiro' });
    expect(supplierUpdatePayload(current, {
      ...form, legalName: 'Distribuidora Andina', addressLine: ' Av. Bolívar ', reason: 'Mudanza'
    })).toEqual({
      legalName: 'Distribuidora Andina',
      fiscalAddress: { countryCode: 'VE', addressLine: 'Av. Bolívar' },
      reason: 'Mudanza'
    });
  });

  it('sends the fiscal address complete or not at all', () => {
    const located = { ...supplier(), fiscalAddress: { countryCode: 'VE', addressLine: 'Caracas' } };
    const form = toSupplierForm(located);

    expect(toFiscalAddress({ ...form, addressLine: '  ' })).toBeNull();
    expect(toFiscalAddress({ ...form, addressCountry: '' })).toBeNull();
    expect(supplierUpdatePayload(located, { ...form, addressLine: '', reason: 'Sin sede' }))
      .toEqual({ fiscalAddress: null, reason: 'Sin sede' });
    expect(supplierUpdatePayload(located, { ...form, reason: 'Sin cambios' })).toBeNull();
  });

  it('derives the tax identity type from the country instead of letting it be typed', () => {
    expect(supplierTaxTypeFor('ve')).toBe('RIF');
    expect(supplierTaxTypeFor(' co ')).toBe('TAX_ID');
    expect(supplierTaxTypeFor('')).toBe('TAX_ID');
  });

  it('hides the privileged tax correction from a supplier editor', () => {
    const editor = renderToStaticMarkup(<SuppliersScreen {...props(['supplier.update'])} />);
    const creator = renderToStaticMarkup(<SuppliersScreen {...props(['supplier.create'])} />);

    expect(editor).not.toContain('Corregir identidad fiscal');
    expect(editor).not.toContain('Nuevo proveedor');
    expect(creator).toContain('Nuevo proveedor');
  });

  it('only offers the stock count screen to who can count or approve', () => {
    expect(canWorkOnStockCounts([])).toBe(false);
    expect(canWorkOnStockCounts(['inventory.purchase.receive'])).toBe(false);
    expect(canWorkOnStockCounts(['inventory.count.read'])).toBe(true);
    expect(canWorkOnStockCounts(['inventory.count.perform'])).toBe(true);
    expect(canWorkOnStockCounts(['inventory.count.approve'])).toBe(true);
  });

  it('offers opening a count only with the perform permission', () => {
    const withPermission = renderToStaticMarkup(
      <StockCountsScreen {...props(['inventory.count.perform'])} />
    );
    const withoutPermission = renderToStaticMarkup(
      <StockCountsScreen {...props(['inventory.count.approve'])} />
    );

    expect(withPermission).toContain('Abrir conteo');
    expect(withoutPermission).not.toContain('Abrir conteo');
  });

  it('offers configuration for each explicit administrative permission', () => {
    expect(canManageConfig([])).toBe(false);
    expect(canManageConfig(['inventory.count.perform'])).toBe(false);
    expect(canManageConfig(['config.branch.manage'])).toBe(true);
    expect(canManageConfig(['config.device.manage'])).toBe(true);
    expect(canManageConfig(['catalog.product.update'])).toBe(true);
    expect(canManageConfig(['config.payment_method.manage'])).toBe(true);
    expect(canManageConfig(['config.tax.manage'])).toBe(true);
  });

  it('shows only the operational configuration sections granted to the session', () => {
    const tax = renderToStaticMarkup(<ConfigScreen {...props(['config.tax.manage'])} />);
    const payments = renderToStaticMarkup(<ConfigScreen {...props(['config.payment_method.manage'])} />);
    expect(tax).toContain('Descuento máximo');
    expect(tax).toContain('IGTF · SIMULACIÓN');
    expect(tax).not.toContain('Métodos de pago');
    expect(payments).toContain('Métodos de pago');
    expect(payments).not.toContain('Descuento máximo');
  });

  it('labels every device type and marks the fiscal printer as simulation', () => {
    expect(Object.keys(DEVICE_TYPE_LABELS)).toEqual([
      'FISCAL_PRINTER', 'BARCODE_SCANNER', 'SCALE', 'CASH_DRAWER'
    ]);
    const markup = renderToStaticMarkup(<ConfigScreen {...props(['config.device.manage'])} />);
    expect(markup).toContain('Declarar dispositivo');
    expect(markup).not.toContain('Registrar sucursal');
  });
});
