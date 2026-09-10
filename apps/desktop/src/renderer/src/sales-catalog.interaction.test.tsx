import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CashRegisterResponse, ProductResponse, SaleResponse, ShiftResponse
} from '@supermarket/shared';
import type { OperationApi } from './api-client.js';
import { SalesScreen } from './operation-screens.js';
import { click, mount, settle, submit, type } from './testing/dom.js';

const register: CashRegisterResponse = {
  id: 'register-001', name: 'Caja 1', terminalId: 'terminal-001', originNodeId: 'node-001'
} as unknown as CashRegisterResponse;

const shift: ShiftResponse = {
  id: 'shift-001', cashRegisterId: register.id, terminalId: 'terminal-001',
  originNodeId: 'node-001', status: 'OPEN', version: 1, openedBy: 'operator-001',
  openedAt: '2026-09-09T13:14:00.000Z', closedBy: null, closedAt: null,
  movements: [], expectedBalances: [], closingBalances: null
};

const coffee: ProductResponse = {
  id: 'product-coffee', name: 'Café molido', description: 'Bolsa de 500 g',
  categoryId: 'category-grocery', unitCode: 'UNIT', unitScale: 0,
  barcodes: ['759000000001'], price: { amountMinorUnits: 725, currencyCode: 'USD' },
  taxRateBasisPoints: 1600, isActive: true, version: 1,
  snapshot: {
    productId: 'product-coffee', description: 'Café molido', priceMinorUnits: 725,
    currencyCode: 'USD', taxRateBasisPoints: 1600, unitCode: 'UNIT', unitScale: 0
  }
};

const draft = (items: SaleResponse['items'] = []): SaleResponse => ({
  id: 'sale-001', shiftId: shift.id, status: 'DRAFT', currencyCode: 'USD', scale: 2,
  items, payments: [], subtotalMinorUnits: items.length ? 725 : 0,
  discountTotalMinorUnits: 0, taxableBaseMinorUnits: items.length ? 725 : 0,
  taxTotalMinorUnits: 0, financialTransactionTaxMinorUnits: 0,
  totalMinorUnits: items.length ? 725 : 0, paidTotalMinorUnits: 0,
  balanceMinorUnits: items.length ? 725 : 0, recipient: null
} as unknown as SaleResponse);

const coffeeLine = {
  id: 'item-coffee', productId: coffee.id, description: coffee.name,
  quantityScaled: 1, quantityScale: 0, unitCode: coffee.unitCode,
  grossMinorUnits: 725, discountMinorUnits: 0, taxableMinorUnits: 725,
  taxMinorUnits: 0, totalMinorUnits: 725, discountBasisPoints: null
} as SaleResponse['items'][number];

const operationApi = (overrides: Partial<OperationApi> = {}): OperationApi => ({
  listPaymentMethods: vi.fn(async () => []),
  listProducts: vi.fn(async () => [coffee]),
  listCashRegisters: vi.fn(async () => [register]),
  getOpenShift: vi.fn(async () => shift),
  startSale: vi.fn(async () => draft()),
  addSaleItem: vi.fn(async () => draft([coffeeLine])),
  ...overrides
} as unknown as OperationApi);

const props = {
  capabilities: { fiscalMode: 'SIMULATION' as const, simulatedReportsEnabled: false },
  permissionCodes: []
};

describe('catálogo de acceso rápido en la venta', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('agrega un producto publicado usando su barcode y la cantidad elegida', async () => {
    const api = operationApi();
    const screen = await mount(<SalesScreen api={api} {...props} />);
    await settle();
    await click(screen.button('Iniciar venta'));
    await settle();

    expect(screen.get('.sale-catalog').textContent).toContain('Café molido');
    expect(screen.get('.sale-catalog').textContent).toContain('7,25');
    await type(screen.get<HTMLInputElement>('.sale-scan input[inputmode="decimal"]'), '2');
    await click(screen.button('Café molido'));
    await settle();

    expect(api.addSaleItem).toHaveBeenCalledWith(
      'sale-001',
      { barcode: '759000000001', quantityScaled: 2, quantityScale: 0 },
      expect.any(String)
    );
    expect(screen.get('.sale-lines').textContent).toContain('Café molido');
    screen.unmount();
  });

  it('busca dentro del catálogo sin convertir el fallo en un bloqueo del escáner', async () => {
    const listProducts = vi.fn(async (query = '') => {
      if (query) throw new Error('CATALOG_UNAVAILABLE');
      return [coffee];
    });
    const api = operationApi({ listProducts });
    const screen = await mount(<SalesScreen api={api} {...props} />);
    await settle();
    await click(screen.button('Iniciar venta'));
    await type(screen.get<HTMLInputElement>('.catalog-search input'), 'café');
    await submit(screen.get('.catalog-search'));
    await settle();

    expect(listProducts).toHaveBeenLastCalledWith('café');
    expect(screen.get('.sale-catalog').textContent).toContain('Puedes seguir usando el lector');
    expect(screen.get('.sale-scan input')).not.toBeNull();
    screen.unmount();
  });
});
