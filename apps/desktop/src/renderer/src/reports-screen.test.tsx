import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createDesktopApi, type DesktopApi, type OperationApi } from './api-client.js';
import { ReportsScreen, loadOperationalReports, toCsv, toReportQuery } from './operation-screens.js';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' }
});

const problem = (code: string, status: number) => ({
  type: 'urn:supermarket:problem:' + code.toLowerCase(), title: 'Denied.',
  status, code, correlationId: 'correlation-1'
});

const closure = {
  shiftId: 'shift-1', cashRegisterId: 'register-1', terminalId: 'terminal-001',
  originNodeId: 'node-001', openedBy: 'user-1', openedAt: '2026-09-01T08:00:00.000Z',
  closedBy: 'user-2', closedAt: '2026-09-01T16:00:00.000Z', movementCount: 2,
  balances: [{
    paymentMethodCode: 'CASH', currencyCode: 'USD', expectedMinorUnits: 5000,
    declaredMinorUnits: 4900, differenceMinorUnits: -100
  }]
};

const filters = { from: '2026-09-01', to: '2026-09-01', limit: '50', cashRegisterId: 'register-1' };
const allReportPermissions = [
  'reports.cash.read', 'reports.audit.read', 'reports.fiscal.read', 'reports.margin.read',
  'reports.sales.read', 'reports.inventory.read'
];

describe('reports screen over simulated HTTP transport', () => {
  const transport = (routes: Readonly<Record<string, () => Response>>) => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const route = Object.entries(routes).find(([path]) => url.startsWith(path));
      return route ? route[1]() : json(problem('RESOURCE_NOT_FOUND', 404), 404);
    });
    return { calls, api: createDesktopApi(fetcher as unknown as typeof fetch) };
  };

  it('queries the six authorized projections without touching a fiscal command', async () => {
    const { calls, api } = transport({
      '/api/v1/reports/cash-closures': () => json([closure]),
      '/api/v1/reports/audit': () => json([{
        auditId: 'audit-1', actorId: 'user-1', actorRoleCodes: ['supervisor'],
        action: 'sale.void', entityType: 'Sale', entityId: 'sale-1', reason: 'Cliente desistió',
        terminalId: 'terminal-001', originNodeId: 'node-001',
        occurredAt: '2026-09-01T10:00:00.000Z', correlationId: 'correlation-1'
      }]),
      '/api/v1/reports/fiscal-operations': () => json({ fiscalMode: 'SIMULATION', operations: [] }),
      '/api/v1/reports/margin': () => json([{
        productId: 'product-1', currencyCode: 'USD', quantitySoldScaled: 4,
        quantityReturnedScaled: 0, quantityScale: 0, discountMinorUnits: 0,
        returnRevenueMinorUnits: 0, returnCostMinorUnits: 0,
        revenueMinorUnits: 600, costMinorUnits: 400, marginMinorUnits: 200
      }]),
      '/api/v1/reports/sales': () => json([{
        currencyCode: 'USD', quantityScale: 0, salesCount: 1, lineCount: 1,
        quantitySoldScaled: 4, grossMinorUnits: 600, discountMinorUnits: 0, netMinorUnits: 600
      }]),
      '/api/v1/reports/inventory': () => json([])
    });

    const reports = await loadOperationalReports(api, filters, allReportPermissions);

    expect(reports.closures).toEqual({ ok: true, value: [closure] });
    expect(reports.audit?.ok ? reports.audit.value[0]?.action : null).toBe('sale.void');
    expect(reports.fiscal).toEqual({ ok: true, value: { fiscalMode: 'SIMULATION', operations: [] } });
    expect(reports.margin?.ok ? reports.margin.value[0]?.marginMinorUnits : null).toBe(200);
    expect(reports.sales?.ok ? reports.sales.value[0]?.netMinorUnits : null).toBe(600);
    expect(reports.inventory).toEqual({ ok: true, value: [] });
    expect(calls).toEqual([
      '/api/v1/reports/cash-closures?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-01T23%3A59%3A59.999Z&limit=50&cashRegisterId=register-1',
      '/api/v1/reports/audit?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-01T23%3A59%3A59.999Z&limit=50',
      '/api/v1/reports/fiscal-operations?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-01T23%3A59%3A59.999Z&limit=50',
      '/api/v1/reports/margin?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-01T23%3A59%3A59.999Z&limit=50',
      '/api/v1/reports/sales?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-01T23%3A59%3A59.999Z&limit=50',
      '/api/v1/reports/inventory?asOf=2026-09-01T23%3A59%3A59.999Z&limit=50'
    ]);
    expect(calls.some((url) => url.includes('/fiscal/reports/'))).toBe(false);
  });

  it('queries only projections granted to the profile', async () => {
    const { calls, api } = transport({
      '/api/v1/reports/cash-closures': () => json([closure])
    });

    const reports = await loadOperationalReports(api, filters, ['reports.cash.read']);

    expect(reports.closures?.ok).toBe(true);
    expect(reports.audit).toBeNull();
    expect(reports.fiscal).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('omits absent filters instead of sending empty parameters', () => {
    expect(toReportQuery({ from: '', to: '', limit: '', cashRegisterId: '' })).toEqual({});
  });

  it('escapes quotes and neutralizes spreadsheet formulas in the exported CSV', () => {
    expect(toCsv([['turno', 'motivo'], ['shift-1', '=SUM(A1)'], ['shift-2', 'Dijo "listo"']]))
      .toBe('"turno","motivo"\n"shift-1","\'=SUM(A1)"\n"shift-2","Dijo ""listo"""');
  });

  const screenApi = (): OperationApi => {
    const api = Object.assign({
      currentSession: async () => { throw new Error('unused'); },
      login: async () => { throw new Error('unused'); },
      logout: async () => undefined,
      capabilities: async () => ({ fiscalMode: 'SIMULATION' as const, simulatedReportsEnabled: false })
    } satisfies DesktopApi, {
      getSale: vi.fn(), startSale: vi.fn(), addSaleItem: vi.fn(), removeSaleItem: vi.fn(),
      applySaleDiscount: vi.fn(), registerSalePayments: vi.fn(), completeSale: vi.fn(), returnSale: vi.fn(), issueSaleInvoice: vi.fn(), createCashRegister: vi.fn(),
      voidSale: vi.fn(), setSaleRecipient: vi.fn(), getOpenShift: vi.fn(), openShift: vi.fn(), registerCashMovement: vi.fn(),
      closeShift: vi.fn(), findProductByBarcode: vi.fn(), listProducts: vi.fn(),
      getPriceHistory: vi.fn(), createProduct: vi.fn(), updatePrice: vi.fn(), getKardex: vi.fn(),
      receivePurchase: vi.fn(), registerStockAdjustment: vi.fn(), getCashClosureReport: vi.fn(),
      getAuditReport: vi.fn(), getFiscalOperationsReport: vi.fn(), getMarginReport: vi.fn(),
      listOperationalMasterData: vi.fn(), saveCategory: vi.fn(), saveUnit: vi.fn(),
      savePaymentMethod: vi.fn(), activateDiscountPolicy: vi.fn(), activateTaxPolicy: vi.fn(),
      getSalesReport: vi.fn(), getInventoryReport: vi.fn(), getShift: vi.fn(), getSaleHistory: vi.fn(),
      startPurchaseReceipt: vi.fn(), completePurchaseReceipt: vi.fn(), reversePurchaseReceipt: vi.fn(),
      getCurrentExchangeRate: vi.fn(), getExchangeRateHistory: vi.fn(), getSuggestedExchangeRate: vi.fn(), updateExchangeRate: vi.fn(), printXReport: vi.fn(), printZReport: vi.fn(), listCategories: vi.fn(), listUnitsOfMeasure: vi.fn(), listPaymentMethods: vi.fn(), listCashRegisters: vi.fn(), listSuppliers: vi.fn(), createSupplier: vi.fn(), updateSupplier: vi.fn(), changeSupplierStatus: vi.fn(), correctSupplierTaxIdentity: vi.fn(), openStockCount: vi.fn(), recordStockCountLine: vi.fn(), closeStockCount: vi.fn(), approveStockCount: vi.fn(), rejectStockCount: vi.fn(), getStockCount: vi.fn(), listStockCounts: vi.fn(), createBranch: vi.fn(), updateBranch: vi.fn(), changeBranchStatus: vi.fn(), getBranch: vi.fn(), listBranches: vi.fn(), declareDevice: vi.fn(), updateDevice: vi.fn(), changeDeviceStatus: vi.fn(), listDevices: vi.fn(), getSyncStatus: vi.fn(), listSyncNodes: vi.fn(), listCoordinatedOperations: vi.fn()
    }) as OperationApi;
    return api;
  };

  const fiscalReportPermissions = ['fiscal.report.x', 'fiscal.report.z'];

  it('hides the simulated X and Z action while the capability is disabled', () => {
    const markup = renderToStaticMarkup(
      <ReportsScreen
        api={screenApi()} capabilities={{ fiscalMode: 'SIMULATION', simulatedReportsEnabled: false }}
        permissionCodes={fiscalReportPermissions}
      />
    );

    expect(markup).toContain('Acciones fiscales simuladas');
    expect(markup).toContain('deshabilitados');
    expect(markup).not.toContain('Solicitar Z simulado');
    expect(markup).toContain('pertenece a la Fase 10');
    expect(markup).not.toContain('SYNCED');
  });

  it('requires an explicit simulation consent before enabling X and Z', () => {
    const markup = renderToStaticMarkup(
      <ReportsScreen
        api={screenApi()} capabilities={{ fiscalMode: 'SIMULATION', simulatedReportsEnabled: true }}
        permissionCodes={fiscalReportPermissions}
      />
    );

    expect(markup).toContain('Confirmo que ejecutaré una simulación');
    expect(markup).toContain('<button type="button" disabled="">Solicitar X simulado</button>');
    expect(markup).toContain('<button class="primary-button" type="button" disabled="">Solicitar Z simulado</button>');
    expect(markup).not.toContain('cierre fiscal real');
  });

  it('does not offer command controls to a read-only management profile', () => {
    const markup = renderToStaticMarkup(
      <ReportsScreen
        api={screenApi()} capabilities={{ fiscalMode: 'SIMULATION', simulatedReportsEnabled: true }}
        permissionCodes={['reports.sales.read', 'reports.inventory.read', 'reports.audit.read']}
      />
    );

    expect(markup).not.toContain('Solicitar X simulado');
    expect(markup).not.toContain('Solicitar Z simulado');
    expect(markup).not.toContain('Acciones fiscales simuladas');
  });

  it('offers shift and sale review only with their read permissions', () => {
    const supervisor = renderToStaticMarkup(
      <ReportsScreen
        api={screenApi()} capabilities={{ fiscalMode: 'SIMULATION', simulatedReportsEnabled: false }}
        permissionCodes={['cash.shift.read', 'sale.history.read']}
      />
    );
    const manager = renderToStaticMarkup(
      <ReportsScreen
        api={screenApi()} capabilities={{ fiscalMode: 'SIMULATION', simulatedReportsEnabled: false }}
        permissionCodes={['reports.sales.read']}
      />
    );

    expect(supervisor).toContain('Consultar arqueo');
    expect(supervisor).toContain('Revisar historia');
    expect(manager).not.toContain('Consultar arqueo');
    expect(manager).not.toContain('Revisar historia');
  });
});
