import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CashRegisterResponse, SaleResponse, SaleReturnResponse, ShiftResponse
} from '@supermarket/shared';
import type { OperationApi } from './api-client.js';
import { SalesScreen } from './operation-screens.js';
import { click, mount, settle, type, unmountAll } from './testing/dom.js';

afterEach(() => { unmountAll(); });

const sale = (status: string): SaleResponse => ({
  id: 'sale-1', shiftId: 'shift-1', currencyCode: 'USD', terminalId: 'terminal-1',
  originNodeId: 'node-1', status, version: 4,
  items: [{
    id: 'item-1', productId: 'product-1', description: 'Café', quantityScaled: 1,
    quantityScale: 0, unitCode: 'UNIT', grossMinorUnits: 1000, discountMinorUnits: 0,
    taxableMinorUnits: 1000, taxMinorUnits: 160, totalMinorUnits: 1160, discountBasisPoints: null
  }],
  payments: [], subtotalMinorUnits: 1000, discountTotalMinorUnits: 0,
  taxableBaseMinorUnits: 1000, taxTotalMinorUnits: 160, financialTransactionTaxMinorUnits: 0,
  totalMinorUnits: 1160, paidTotalMinorUnits: 1160, balanceMinorUnits: 0,
  completedAt: null, voidedAt: null, voidReason: null, recipient: null
} as unknown as SaleResponse);

const openShift = (): ShiftResponse => ({
  id: 'shift-1', cashRegisterId: 'register-1', terminalId: 'terminal-1', originNodeId: 'node-1',
  status: 'OPEN', version: 1, openedBy: 'user-1', openedAt: '2026-09-07T09:14:00.000Z',
  closedBy: null, closedAt: null, movements: [], expectedBalances: [], closingBalances: null
} as unknown as ShiftResponse);

const register: CashRegisterResponse = { id: 'register-1', name: 'Caja 1' };

const apiWith = (overrides: Partial<OperationApi>): OperationApi => ({
  getSale: vi.fn(async () => sale('DRAFT')),
  startSale: vi.fn(async () => sale('DRAFT')),
  completeSale: vi.fn(async () => sale('COMPLETED')),
  listPaymentMethods: vi.fn(async () => []),
  listProducts: vi.fn(async () => []),
  listCashRegisters: vi.fn(async () => [register]),
  getOpenShift: vi.fn(async () => openShift()),
  ...overrides
} as unknown as OperationApi);

const PERMISSIONS = ['fiscal.document.issue', 'sale.return'];
const capabilities = { fiscalMode: 'SIMULATION' as const, simulatedReportsEnabled: false };

/** Lleva la pantalla hasta la vista de la venta ya completada. */
const completeASale = async (api: OperationApi) => {
  const screen = await mount(
    <SalesScreen api={api} capabilities={capabilities} permissionCodes={PERMISSIONS} />
  );
  await click(screen.button('Iniciar venta'));
  await settle();
  await click(screen.button('Completar venta'));
  await settle();
  return screen;
};

describe('factura de la venta completada', () => {
  it('emite la factura y muestra su número fiscal', async () => {
    const issueSaleInvoice = vi.fn(async () => ({
      fiscalMode: 'SIMULATION' as const,
      document: {
        id: 'document-1', status: 'ISSUED', version: 3, attempts: 1,
        fiscalNumber: 'INV-000001', lastErrorCode: null, lastEvidence: null
      }
    }));
    const screen = await completeASale(apiWith({ issueSaleInvoice }));

    expect(screen.text()).toContain('Venta completada');
    await click(screen.button('Emitir factura'));
    await settle();

    expect(issueSaleInvoice).toHaveBeenCalledWith(
      'sale-1', expect.any(String), expect.any(String)
    );
    expect(screen.text()).toContain('INV-000001');
    // Emitida una vez, el comando no se ofrece de nuevo para el mismo hecho.
    expect(screen.button('Factura emitida').disabled).toBe(true);
  });

  /**
   * Antes de existir el comando de factura, este botón siempre fallaba con
   * `SALE_RETURN_DOCUMENT_NOT_ISSUED`: ahora la pantalla explica la precondición
   * en lugar de dejar que el nodo la rechace.
   */
  it('bloquea la devolución mientras la venta no tenga factura y explica por qué', async () => {
    const returnSale = vi.fn();
    const screen = await completeASale(apiWith({ returnSale }));

    expect(screen.text()).toContain('todavía no tiene factura emitida');
    const reason = screen.get<HTMLInputElement>('.danger-panel input');
    await type(reason, 'Cliente devuelve');
    await settle();

    expect(screen.button('Registrar devolución').disabled).toBe(true);
    expect(returnSale).not.toHaveBeenCalled();
  });

  it('habilita la devolución una vez emitida la factura', async () => {
    const returnSale = vi.fn(async () => ({
      id: 'return-1', saleId: 'sale-1', creditNoteId: 'credit-1', creditNoteStatus: 'ISSUED',
      creditNoteFiscalNumber: 'NC-000002', refundMinorUnits: 1160, lines: []
    } as unknown as SaleReturnResponse));
    const screen = await completeASale(apiWith({
      returnSale,
      issueSaleInvoice: vi.fn(async () => ({
        fiscalMode: 'SIMULATION' as const,
        document: {
          id: 'document-1', status: 'ISSUED', version: 3, attempts: 1,
          fiscalNumber: 'INV-000001', lastErrorCode: null, lastEvidence: null
        }
      }))
    }));

    await click(screen.button('Emitir factura'));
    await settle();
    await type(screen.get<HTMLInputElement>('.danger-panel input'), 'Cliente devuelve');
    await settle();
    await click(screen.button('Registrar devolución'));
    await settle();

    expect(returnSale).toHaveBeenCalledOnce();
    expect(screen.text()).toContain('NC-000002');
  });
});
