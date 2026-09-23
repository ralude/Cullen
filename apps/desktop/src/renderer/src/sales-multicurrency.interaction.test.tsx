import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CashRegisterResponse, ExchangeRateResponse, PaymentMethodResponse, SaleResponse, ShiftResponse
} from '@supermarket/shared';
import type { OperationApi } from './api-client.js';
import { ApiProblemError } from './api-transport.js';
import { SalesScreen } from './operation-screens.js';
import { click, mount, settle, type, unmountAll } from './testing/dom.js';

/**
 * Cobro en otra moneda desde la barra (spec de pagos, CA-PM-01 a 04; ADR-0033).
 * El caso que se fija es el de todos los días: una venta en dólares pagada
 * con efectivo en dólares y pago móvil en bolívares, a la tasa vigente que la
 * pantalla muestra y envía.
 */

afterEach(() => { unmountAll(); });
beforeEach(() => { window.localStorage.clear(); });

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
  { code: 'CASH_USD', name: 'Efectivo USD', kind: 'CASH', currencyCode: 'USD', financialTransactionTaxBasisPoints: 0 },
  { code: 'MOBILE_VES', name: 'Pago móvil', kind: 'MOBILE_PAYMENT', currencyCode: 'VES', financialTransactionTaxBasisPoints: 0 },
  { code: 'CASH_CLP', name: 'Efectivo CLP', kind: 'CASH', currencyCode: 'CLP', financialTransactionTaxBasisPoints: 0 }
];

const rate = (quoteCurrency: string, rateValue: number, rateScale: number): ExchangeRateResponse => ({
  id: 'rate-usd-' + quoteCurrency.toLowerCase(), baseCurrency: 'USD', quoteCurrency, rateValue, rateScale,
  source: 'Tasa de prueba', validFrom: new Date().toISOString(), validUntil: null, registeredBy: 'user-001'
});

const missing = (): never => {
  throw new ApiProblemError({
    type: 'urn:supermarket:problem:currency_rate_missing', title: 'Missing', status: 404,
    code: 'CURRENCY_RATE_MISSING', correlationId: 'correlation-1'
  });
};

/** Venta de 100,00 USD con una línea, tal como la devuelve el nodo. */
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

const operationApi = (
  getCurrentExchangeRate: OperationApi['getCurrentExchangeRate']
): OperationApi => ({
  listPaymentMethods: vi.fn(async () => methods),
  listProducts: vi.fn(async () => []),
  listCashRegisters: vi.fn(async () => [register]),
  getOpenShift: vi.fn(async () => openShift),
  startSale: vi.fn(async () => draft()),
  getSale: vi.fn(async () => draft()),
  completeSale: vi.fn(async () => draft({ status: 'COMPLETED', paidTotalMinorUnits: 10000, balanceMinorUnits: 0 })),
  registerSalePayments: vi.fn(async () => draft({
    payments: [{ id: 'payment-001' }] as unknown as SaleResponse['payments'],
    paidTotalMinorUnits: 10000, balanceMinorUnits: 0
  })),
  getCurrentExchangeRate: vi.fn(getCurrentExchangeRate)
} as unknown as OperationApi);

const props = {
  capabilities: { fiscalMode: 'SIMULATION' as const, simulatedReportsEnabled: false },
  permissionCodes: []
};

const openSale = async (api: OperationApi) => {
  const screen = await mount(<SalesScreen api={api} {...props} />);
  await settle();
  await click(screen.button('Iniciar venta'));
  await settle();
  return screen;
};

const chooseMethod = async (screen: Awaited<ReturnType<typeof mount>>, code: string): Promise<void> => {
  await click(screen.get(`input[name="paymentMethod"][value="${code}"]`));
  await settle();
};

const amountField = (screen: Awaited<ReturnType<typeof mount>>): HTMLInputElement =>
  screen.get<HTMLInputElement>('.amount-field input');

describe('cobro en otra moneda', () => {
  it('cobra una venta en dólares con efectivo en dólares y pago móvil en bolívares', async () => {
    const api = operationApi(async (pair) => pair.quoteCurrency === 'VES' ? rate('VES', 47858, 2) : missing());
    const screen = await openSale(api);

    await type(amountField(screen), '40.00');
    await click(screen.button('Agregar pago'));
    await chooseMethod(screen, 'MOBILE_VES');

    /** CA-PM-04: el resto de 60,00 se sugiere en la moneda del método, a la tasa vigente. */
    expect(amountField(screen).value).toBe('28714.80');
    const note = screen.get<HTMLElement>('[data-testid="payment-rate"]');
    expect(note.textContent).toContain('Tasa USD/VES 478,58');
    expect(note.textContent).toContain('Tasa de prueba');

    await click(screen.button('Agregar pago'));
    await settle();
    const chips = screen.all<HTMLElement>('.tender').map((chip) => chip.textContent ?? '');
    expect(chips[1]).toContain('28.714,80');
    expect(chips[1]).toContain('60,00');

    await click(screen.button('Completar venta'));
    await settle();

    /** CA-PM-01: el pago en bolívares viaja con el identificador de la tasa mostrada. */
    expect(api.registerSalePayments).toHaveBeenCalledWith(
      'sale-001',
      {
        payments: [
          { methodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: 4000 },
          { methodCode: 'MOBILE_VES', currencyCode: 'VES', amountMinorUnits: 2871480, exchangeRateId: 'rate-usd-ves' }
        ]
      },
      expect.any(String)
    );
  });

  it('no deja agregar un pago en otra moneda sin tasa vigente del par', async () => {
    const api = operationApi(async () => missing());
    const screen = await openSale(api);

    await chooseMethod(screen, 'MOBILE_VES');
    await type(amountField(screen), '1000.00');
    await settle();

    /** CA-PM-03: se dice por qué, y nunca se envía un lote que el nodo rechazaría. */
    expect(screen.get<HTMLElement>('[data-testid="payment-rate"]').textContent)
      .toContain('No hay tasa USD/VES');
    expect(screen.button('Agregar pago').disabled).toBe(true);
    expect(api.registerSalePayments).not.toHaveBeenCalled();
  });

  it('lee cada importe con los decimales de su propia moneda', async () => {
    const api = operationApi(async (pair) => pair.quoteCurrency === 'CLP' ? rate('CLP', 900, 0) : missing());
    const screen = await openSale(api);

    await chooseMethod(screen, 'CASH_CLP');
    /** CA-PM-02: el peso chileno no tiene decimales; 100,00 USD a 900 son 90.000 CLP. */
    expect(amountField(screen).value).toBe('90000');

    await type(amountField(screen), '900');
    await click(screen.button('Agregar pago'));
    await settle();

    const chip = screen.get<HTMLElement>('.tender').textContent ?? '';
    expect(chip).toContain('900');
    expect(chip).toContain('1,00');
    expect(screen.get('.sale-balance').textContent).toContain('99,00');
  });

  it('ya no pide una escala: los decimales salen de la moneda', async () => {
    const screen = await mount(<SalesScreen api={operationApi(async () => missing())} {...props} />);
    await settle();

    expect(screen.text()).not.toContain('Escala visible');
  });
});
