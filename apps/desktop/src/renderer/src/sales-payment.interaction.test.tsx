import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CashRegisterResponse, PaymentMethodResponse, SaleResponse, ShiftResponse
} from '@supermarket/shared';
import { type OperationApi } from './api-client.js';
import { SalesScreen } from './operation-screens.js';
import { click, mount, settle, type } from './testing/dom.js';

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
  { code: 'CASH', name: 'Efectivo', kind: 'CASH', currencyCode: 'USD', financialTransactionTaxBasisPoints: 0 },
  { code: 'CARD', name: 'Tarjeta', kind: 'CARD', currencyCode: 'USD', financialTransactionTaxBasisPoints: 300 }
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
  completeSale: vi.fn(async () => draft({ status: 'COMPLETED', paidTotalMinorUnits: 10000, balanceMinorUnits: 0 })),
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

    await click(screen.button('Resto'));

    expect(screen.get<HTMLInputElement>('.amount-field input').value).toBe('100.00');
    screen.unmount();
  });

  /**
   * El cobro mixto deja de pedir los dos importes a la vez: se agrega un pago,
   * el resto se recalcula y se agrega el siguiente. Las fichas se acumulan en
   * la pantalla y viajan juntas, porque el dominio acepta el lote una sola vez.
   */
  it('registra un cobro dividido agregando un pago a la vez', async () => {
    const api = operationApi();
    const screen = await openSale(api);

    await type(screen.get<HTMLInputElement>('.amount-field input'), '50.00');
    await click(screen.button('Agregar pago'));
    expect(screen.get('.tender').textContent).toContain('Efectivo');
    /** Con la mitad cubierta, la tarjeta precarga su resto más el IGTF. */
    await click(screen.get('input[name="paymentMethod"][value="CARD"]'));
    await settle();
    expect(screen.get<HTMLInputElement>('.amount-field input').value).toBe('51.50');

    await click(screen.button('Agregar pago'));
    await settle();
    /** Cubierto el saldo, la barra ofrece cerrar y envía el lote entero. */
    await click(screen.button('Completar venta'));
    await settle();

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
    expect(api.completeSale).toHaveBeenCalled();
    screen.unmount();
  });

  it('deja quitar una ficha y devuelve el resto a lo que era', async () => {
    const screen = await openSale(operationApi());
    await type(screen.get<HTMLInputElement>('.amount-field input'), '50.00');
    await click(screen.button('Agregar pago'));
    expect(screen.get('.sale-balance').textContent).toContain('50,00');

    await click(screen.get('button[aria-label="Quitar Efectivo"]'));
    await settle();

    expect(screen.query('.tender')).toBeNull();
    expect(screen.get('.tender-empty').textContent).toContain('Sin pagos agregados');
    expect(screen.get('.sale-balance').textContent).toContain('100,00');
    screen.unmount();
  });

  /**
   * La fila de fichas está siempre presente, con su vacío escrito: la altura de
   * la barra no puede cambiar entre un método y varios, porque empujaría el
   * ticket a mitad de una venta.
   */
  it('reserva la fila de pagos aunque todavía no haya ninguno', async () => {
    const screen = await openSale(operationApi());

    expect(screen.get('.checkout-bar .tender-row')).not.toBeNull();
    expect(screen.get('.tender-empty').textContent).toContain('Sin pagos agregados');
    screen.unmount();
  });

  it('dice cuánto falta cobrar y deja de decirlo cuando el saldo queda cubierto', async () => {
    const screen = await openSale(operationApi());
    expect(screen.get('.sale-balance').textContent).toContain('Falta cobrar');

    /** Dos fichas cubren el saldo sin cerrar todavía la venta. */
    await type(screen.get<HTMLInputElement>('.amount-field input'), '50.00');
    await click(screen.button('Agregar pago'));
    await settle();
    await click(screen.button('Agregar pago'));
    await settle();

    expect(screen.get('.sale-balance').textContent).toContain('Cobro cubierto');
    screen.unmount();
  });

  it('muestra el IGTF en el desglose solo cuando el cobro lo generó', async () => {
    const screen = await openSale(operationApi());
    /** Sin pagos el impuesto todavía no existe: depende de con qué se pague. */
    expect(screen.get('.checkout-breakdown').textContent).toContain('IGTF —');

    await click(screen.get('input[name="paymentMethod"][value="CARD"]'));
    await settle();
    await type(screen.get<HTMLInputElement>('.amount-field input'), '51.50');
    await click(screen.button('Agregar pago'));
    await settle();

    /** 1,50 es el 3% de los 50,00 que la tarjeta liquida, no de los 51,50. */
    expect(screen.get('.checkout-breakdown').textContent).toContain('1,50');
    expect(screen.get('.checkout-total').textContent).toContain('101,50');
    screen.unmount();
  });

  /**
   * El cobro era una columna de 320 px que no cabía junto al ticket y el
   * catálogo. Ahora es una barra de ancho completo al pie, con el total, la
   * captura y la acción en la misma línea de visión.
   */
  it('cobra desde una barra al pie y no desde una tercera columna', async () => {
    const screen = await openSale(operationApi());

    expect(screen.query('.sale-ticket')).toBeNull();
    const bar = screen.get('.checkout-bar');
    expect(bar.querySelector('.checkout-total')).not.toBeNull();
    expect(bar.querySelector('.method-chips')).not.toBeNull();
    expect(bar.querySelector('.complete-button')).not.toBeNull();
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

/**
 * La pantalla precarga lo que se cobra con un método gravado, sin que el cajero
 * calcule el IGTF. La enmienda de ADR-0031 del 2026-09-11 lo permite con dos
 * condiciones que estas pruebas fijan: la sugerencia es editable, y lo que el
 * cajero escribe llega al nodo sin que la pantalla lo toque.
 */
describe('cobro con un método gravado', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const selectCard = async (screen: Awaited<ReturnType<typeof openSale>>): Promise<void> => {
    await click(screen.get('input[name="paymentMethod"][value="CARD"]'));
    await settle();
  };

  it('marca el método que cobra IGTF', async () => {
    const screen = await openSale(operationApi());

    const chips = screen.all('.method-chips .chip');
    expect(chips[0]?.textContent).not.toContain('IGTF');
    expect(chips[1]?.textContent).toContain('+IGTF');
    screen.unmount();
  });

  it('precarga el bruto que ya incluye el impuesto al elegir ese método', async () => {
    const screen = await openSale(operationApi());

    await selectCard(screen);

    /** 100,00 de venta más el 3% que la tarjeta cobra dentro del importe. */
    expect(screen.get<HTMLInputElement>('.amount-field input').value).toBe('103.00');
    screen.unmount();
  });

  it('vuelve al saldo sin impuesto cuando el método no está gravado', async () => {
    const screen = await openSale(operationApi());

    await selectCard(screen);
    await click(screen.get('input[name="paymentMethod"][value="CASH"]'));
    await settle();

    expect(screen.get<HTMLInputElement>('.amount-field input').value).toBe('100.00');
    screen.unmount();
  });

  it('sugiere el mismo bruto con «Resto»', async () => {
    const screen = await openSale(operationApi());
    await selectCard(screen);
    await type(screen.get<HTMLInputElement>('.amount-field input'), '');

    await click(screen.button('Resto'));

    expect(screen.get<HTMLInputElement>('.amount-field input').value).toBe('103.00');
    screen.unmount();
  });

  it('envía sin alterar el importe que el cajero corrige a mano', async () => {
    const api = operationApi();
    const screen = await openSale(api);
    await selectCard(screen);

    /** El cajero baja la tarjeta a la mitad y cubre el resto en efectivo. */
    await type(screen.get<HTMLInputElement>('.amount-field input'), '51.50');
    await click(screen.button('Agregar pago'));
    await settle();
    await click(screen.get('input[name="paymentMethod"][value="CASH"]'));
    await settle();
    await click(screen.button('Agregar pago'));
    await settle();
    await click(screen.button('Completar venta'));
    await settle();

    expect(api.registerSalePayments).toHaveBeenCalledWith(
      'sale-001',
      {
        payments: [
          { methodCode: 'CARD', currencyCode: 'USD', amountMinorUnits: 5150 },
          { methodCode: 'CASH', currencyCode: 'USD', amountMinorUnits: 5000 }
        ]
      },
      expect.any(String)
    );
    screen.unmount();
  });

  it('no sugiere un bruto en una moneda distinta a la de la venta', async () => {
    const screen = await openSale(operationApi({
      listPaymentMethods: vi.fn(async () => [
        ...methods,
        {
          code: 'CARD_VES', name: 'Tarjeta VES', kind: 'CARD' as const, currencyCode: 'VES',
          financialTransactionTaxBasisPoints: 300
        }
      ])
    }));

    await click(screen.get('input[name="paymentMethod"][value="CARD_VES"]'));
    await settle();

    /**
     * Convertir exige una tasa explícita que la pantalla todavía no envía
     * (D-001), así que no inventa un bruto en otra moneda.
     */
    expect(screen.get<HTMLInputElement>('.amount-field input').value).toBe('100.00');
    screen.unmount();
  });
});
