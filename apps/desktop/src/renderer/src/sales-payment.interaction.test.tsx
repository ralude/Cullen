import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CashRegisterResponse, PaymentMethodResponse, SaleResponse, ShiftResponse
} from '@supermarket/shared';
import { type OperationApi } from './api-client.js';
import { SalesScreen } from './operation-screens.js';
import { click, mount, settle, submit, type } from './testing/dom.js';

/**
 * Cobro de la venta desde la pantalla.
 *
 * Lo que se fija aquí no es el aspecto sino lo que el cajero puede hacer sin
 * salir de la vista: elegir el método de un golpe, completar el importe exacto,
 * dividir en dos métodos y cerrar la venta. El total y el botón de completar
 * viven en la columna del ticket precisamente para no exigir desplazamiento.
 */

const register: CashRegisterResponse = {
  id: 'register-001', name: 'Caja 1', terminalId: 'terminal-001', originNodeId: 'node-001'
} as unknown as CashRegisterResponse;

const openShift: ShiftResponse = {
  id: 'shift-001', cashRegisterId: 'register-001', terminalId: 'terminal-001',
  originNodeId: 'node-001', status: 'OPEN', version: 1, openedBy: 'user-001',
  openedAt: '2026-09-07T13:14:00.000Z', closedBy: null, closedAt: null,
  movements: [], expectedBalances: [], closingBalances: null
};

const methods: readonly PaymentMethodResponse[] = [
  { code: 'CASH', name: 'Efectivo', kind: 'CASH', currencyCode: 'USD' },
  { code: 'CARD', name: 'Tarjeta', kind: 'CARD', currencyCode: 'USD' }
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

const operationApi = (overrides: Partial<OperationApi> = {}): OperationApi => ({
  listPaymentMethods: vi.fn(async () => methods),
  listProducts: vi.fn(async () => []),
  listCashRegisters: vi.fn(async () => [register]),
  getOpenShift: vi.fn(async () => openShift),
  startSale: vi.fn(async () => draft()),
  getSale: vi.fn(async () => draft()),
  registerSalePayments: vi.fn(async () => draft({
    payments: [{ id: 'payment-001' }] as unknown as SaleResponse['payments'],
    paidTotalMinorUnits: 10000, balanceMinorUnits: 0
  })),
  ...overrides
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

describe('cobro de la venta', () => {
  /** La estación recuerda su venta activa: sin limpiar, cada prueba heredaría la anterior. */
  beforeEach(() => { window.localStorage.clear(); });

  it('ofrece los métodos como botones, no dentro de una lista desplegable', async () => {
    const screen = await openSale(operationApi());

    const chips = screen.all('.method-chips .chip');
    expect(chips.map((chip) => chip.textContent)).toEqual([
      expect.stringContaining('Efectivo'), expect.stringContaining('Tarjeta')
    ]);
    /** Efectivo viene preseleccionado: es el caso habitual de una caja. */
    expect(screen.get<HTMLInputElement>('input[name="paymentMethod"][value="CASH"]').checked)
      .toBe(true);
    screen.unmount();
  });

  it('completa el importe pendiente con un solo gesto', async () => {
    const screen = await openSale(operationApi());
    const amount = screen.get<HTMLInputElement>('.amount-field input');
    await type(amount, '');

    await click(screen.button('Exacto'));

    expect(screen.get<HTMLInputElement>('.amount-field input').value).toBe('100.00');
    screen.unmount();
  });

  it('registra un cobro dividido entre dos métodos', async () => {
    const api = operationApi();
    const screen = await openSale(api);

    await click(screen.button('Dividir en dos métodos'));
    await click(screen.get('input[name="paymentMethod2"][value="CARD"]'));
    const amounts = screen.all<HTMLInputElement>('.amount-field input');
    await type(amounts[0]!, '50.00');
    await type(amounts[1]!, '51.50');
    await submit(screen.get<HTMLFormElement>('#sale-payment-form'));

    expect(api.registerSalePayments).toHaveBeenCalledWith(
      'sale-001',
      {
        payments: [
          { methodCode: 'CASH', currencyCode: 'USD', amountMinorUnits: 5000 },
          { methodCode: 'CARD', currencyCode: 'USD', amountMinorUnits: 5150 }
        ]
      },
      expect.any(String)
    );
    screen.unmount();
  });

  it('dice cuánto falta cobrar y deja de decirlo cuando el saldo queda cubierto', async () => {
    const screen = await openSale(operationApi());
    expect(screen.get('.sale-balance').textContent).toContain('Falta cobrar');

    await submit(screen.get<HTMLFormElement>('#sale-payment-form'));

    expect(screen.get('.sale-balance').textContent).toContain('Cobro cubierto');
    screen.unmount();
  });

  it('muestra el IGTF en el ticket solo cuando el cobro lo generó', async () => {
    const withTax = operationApi({
      registerSalePayments: vi.fn(async () => draft({
        financialTransactionTaxMinorUnits: 150, totalMinorUnits: 10150,
        paidTotalMinorUnits: 10150, balanceMinorUnits: 0
      }))
    });
    const screen = await openSale(withTax);
    /** Se mira el desglose, no la pantalla entera: la ayuda del cobro lo nombra siempre. */
    expect(screen.get('.totals').textContent).not.toContain('IGTF');

    await submit(screen.get<HTMLFormElement>('#sale-payment-form'));

    expect(screen.get('.totals').textContent).toContain('IGTF');
    expect(screen.get('.totals').textContent).toContain('101,50');
    screen.unmount();
  });

  /**
   * El botón de completar vivía al final de una columna de seis paneles: cerrar
   * una venta ya cobrada exigía desplazarse. Ahora comparte la columna pegada
   * del ticket con el total.
   */
  it('mantiene el total y el botón de completar en la columna del ticket', async () => {
    const screen = await openSale(operationApi());

    const ticket = screen.get('.sale-ticket');
    expect(ticket.querySelector('.totals-panel')).not.toBeNull();
    expect(ticket.querySelector('.complete-button')).not.toBeNull();
    screen.unmount();
  });

  it('abre el receptor como diálogo en vez de empujar la pantalla', async () => {
    const screen = await openSale(operationApi());
    expect(screen.query('[role="dialog"]')).toBeNull();

    await click(screen.button('Agregar receptor'));

    const dialog = screen.get('[role="dialog"]');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('Identificación');
    screen.unmount();
  });
});
