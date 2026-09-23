import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CashRegisterResponse, ExchangeRateResponse, PaymentMethodResponse, SaleResponse, ShiftResponse
} from '@supermarket/shared';
import type { OperationApi } from './api-client.js';
import { ApiProblemError } from './api-transport.js';
import { CashScreen, SalesScreen } from './operation-screens.js';
import { click, mount, select, settle, unmountAll } from './testing/dom.js';

/**
 * Tasa USD/VES visible en caja (etapa ET del plan de pagos). Lo que se fija
 * es que el cajero vea con qué tasa trabaja y cuándo puede estar vencida, sin
 * que esa lectura decida nada: ni bloquea la apertura ni toca el cobro.
 */

afterEach(() => { unmountAll(); });
beforeEach(() => { window.localStorage.clear(); });

const DAY = 24 * 60 * 60 * 1000;
const props = {
  capabilities: { fiscalMode: 'SIMULATION' as const, simulatedReportsEnabled: false },
  permissionCodes: ['cash.shift.open']
};

const rate = (validFrom: Date, overrides: Partial<ExchangeRateResponse> = {}): ExchangeRateResponse => ({
  id: 'rate-001', baseCurrency: 'USD', quoteCurrency: 'VES', rateValue: 40000, rateScale: 2,
  source: 'BCV · dólar oficial', validFrom: validFrom.toISOString(), validUntil: null,
  registeredBy: 'user-001', ...overrides
});

const problem = (code: string, status: number): ApiProblemError => new ApiProblemError({
  type: 'urn:supermarket:problem:test', title: code, status, code, correlationId: 'correlation-1'
});

const cashApi = (getCurrentExchangeRate: OperationApi['getCurrentExchangeRate']): OperationApi => ({
  listPaymentMethods: vi.fn(async () => []),
  listCashRegisters: vi.fn(async () => []),
  getCurrentExchangeRate: vi.fn(getCurrentExchangeRate)
} as unknown as OperationApi);

const mountCash = async (api: OperationApi) => {
  const screen = await mount(<CashScreen api={api} {...props} />);
  await settle();
  return screen;
};

describe('aviso de tasa en Caja', () => {
  it('avisa sin bloquear cuando la tasa vigente es de un día anterior', async () => {
    const api = cashApi(async () => rate(new Date(Date.now() - 2 * DAY)));
    const screen = await mountCash(api);

    expect(api.getCurrentExchangeRate).toHaveBeenCalledWith({ baseCurrency: 'USD', quoteCurrency: 'VES' });
    const notice = screen.get<HTMLElement>('[data-testid="reference-rate-notice"]');
    expect(notice.textContent).toContain('Tasa USD/VES del');
    expect(notice.textContent).toContain('400,00');
    expect(notice.textContent).toContain('BCV · dólar oficial');
    expect(notice.querySelector('a')?.getAttribute('href')).toBe('#/rates');
  });

  it('deja abrir turno aunque la tasa esté vencida', async () => {
    const api = {
      ...cashApi(async () => rate(new Date(Date.now() - 2 * DAY))),
      listPaymentMethods: vi.fn(async () => methods),
      listCashRegisters: vi.fn(async () => [register])
    } as unknown as OperationApi;
    const screen = await mountCash(api);
    await select(screen.get<HTMLSelectElement>('select'), 'CASH');

    expect(screen.query('[data-testid="reference-rate-notice"]')).toBeTruthy();
    /** El aviso informa: abrir turno sigue dependiendo solo de caja y método. */
    expect(screen.button('Abrir turno').disabled).toBe(false);
  });

  it('no avisa cuando la tasa vigente es de hoy', async () => {
    const screen = await mountCash(cashApi(async () => rate(new Date())));

    expect(screen.query('[data-testid="reference-rate-notice"]')).toBeNull();
  });

  it('dice que no hay tasa registrada cuando el nodo no tiene ninguna', async () => {
    const screen = await mountCash(cashApi(async () => { throw problem('CURRENCY_RATE_MISSING', 404); }));

    const notice = screen.get<HTMLElement>('[data-testid="reference-rate-notice"]');
    expect(notice.textContent).toContain('No hay tasa USD/VES registrada');
    expect(notice.querySelector('a')?.getAttribute('href')).toBe('#/rates');
  });

  it('no disfraza un fallo de consulta como falta de tasa ni como tasa al día', async () => {
    const screen = await mountCash(cashApi(async () => { throw new TypeError('network'); }));

    const notice = screen.get<HTMLElement>('[data-testid="reference-rate-notice"]');
    expect(notice.textContent).toContain('No se pudo comprobar la tasa USD/VES');
    expect(notice.textContent).not.toContain('No hay tasa');
  });
});

const register = {
  id: 'register-001', name: 'Caja 1', terminalId: 'terminal-001', originNodeId: 'node-001'
} as unknown as CashRegisterResponse;

const openShift: ShiftResponse = {
  id: 'shift-001', cashRegisterId: 'register-001', terminalId: 'terminal-001',
  originNodeId: 'node-001', status: 'OPEN', version: 1, openedBy: 'user-001',
  openedAt: '2026-09-07T13:14:00.000Z', closedBy: null, closedAt: null,
  movements: [], expectedBalances: [], closingBalances: null
};

const methods: readonly PaymentMethodResponse[] = [
  { code: 'CASH', name: 'Efectivo', kind: 'CASH', currencyCode: 'USD', financialTransactionTaxBasisPoints: 0 }
];

/** Venta de 100,00 con una línea, tal como la devuelve el nodo. */
const draft = (overrides: Partial<SaleResponse> = {}): SaleResponse => ({
  id: 'sale-001', status: 'DRAFT', currencyCode: 'USD',
  items: [{
    id: 'item-001', productId: 'product-001', description: 'Café', unitCode: 'UNIT',
    quantityScaled: 1, quantityScale: 0, grossMinorUnits: 10000, discountMinorUnits: 0,
    taxableMinorUnits: 10000, taxMinorUnits: 0, totalMinorUnits: 10000, discountBasisPoints: null
  }],
  payments: [],
  subtotalMinorUnits: 10000, discountTotalMinorUnits: 0, taxableBaseMinorUnits: 10000,
  taxTotalMinorUnits: 0, financialTransactionTaxMinorUnits: 0, totalMinorUnits: 10000,
  paidTotalMinorUnits: 0, balanceMinorUnits: 10000, recipient: null,
  ...overrides
} as unknown as SaleResponse);

const salesApi = (
  getCurrentExchangeRate: OperationApi['getCurrentExchangeRate'],
  sale: SaleResponse = draft()
): OperationApi => ({
  listPaymentMethods: vi.fn(async () => methods),
  listProducts: vi.fn(async () => []),
  listCashRegisters: vi.fn(async () => [register]),
  getOpenShift: vi.fn(async () => openShift),
  startSale: vi.fn(async () => sale),
  getSale: vi.fn(async () => sale),
  completeSale: vi.fn(async () => draft({ status: 'COMPLETED', paidTotalMinorUnits: 10000, balanceMinorUnits: 0 })),
  registerSalePayments: vi.fn(async () => draft({
    payments: [{ id: 'payment-001' }] as unknown as SaleResponse['payments'],
    paidTotalMinorUnits: 10000, balanceMinorUnits: 0
  })),
  getCurrentExchangeRate: vi.fn(getCurrentExchangeRate)
} as unknown as OperationApi);

const openSale = async (api: OperationApi) => {
  const screen = await mount(<SalesScreen api={api} {...props} />);
  await settle();
  await click(screen.button('Iniciar venta'));
  await settle();
  return screen;
};

const equivalent = (screen: Awaited<ReturnType<typeof mount>>): HTMLElement | null =>
  screen.query<HTMLElement>('[data-testid="reference-equivalent"]');

describe('equivalente en bolívares en la barra de cobro', () => {
  it('muestra el total en bolívares con la tasa, su fuente y su vigencia', async () => {
    const validFrom = new Date();
    const screen = await openSale(salesApi(async () => rate(validFrom)));

    const line = equivalent(screen);
    expect(line?.textContent).toContain('40.000,00');
    expect(line?.textContent).toContain('tasa 400,00');
    expect(line?.textContent).toContain('BCV · dólar oficial');
    expect(line?.textContent).toContain(validFrom.toLocaleDateString('es-VE'));
  });

  it('dice que falta la tasa en lugar de inventar un equivalente', async () => {
    const screen = await openSale(salesApi(async () => { throw problem('CURRENCY_RATE_MISSING', 404); }));

    expect(equivalent(screen)?.textContent).toContain('Sin tasa USD/VES');
  });

  it('no muestra equivalente en una venta que no es en dólares', async () => {
    const screen = await openSale(salesApi(async () => rate(new Date()), draft({ currencyCode: 'VES' })));

    expect(equivalent(screen)).toBeNull();
  });

  it('no altera el lote enviado ni el botón de cobro', async () => {
    const api = salesApi(async () => rate(new Date()));
    const screen = await openSale(api);

    expect(screen.button('Cobrar y completar').disabled).toBe(false);
    await click(screen.button('Cobrar y completar'));
    await settle();

    expect(api.registerSalePayments).toHaveBeenCalledWith(
      'sale-001',
      { payments: [{ methodCode: 'CASH', currencyCode: 'USD', amountMinorUnits: 10000 }] },
      expect.any(String)
    );
  });
});
