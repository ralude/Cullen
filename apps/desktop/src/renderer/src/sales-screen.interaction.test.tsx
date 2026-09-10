import { describe, expect, it, vi } from 'vitest';
import type { CashRegisterResponse, SaleResponse, ShiftResponse } from '@supermarket/shared';
import { ApiProblemError, type OperationApi } from './api-client.js';
import { activeShiftLabel, SalesScreen } from './operation-screens.js';
import { click, mount, settle } from './testing/dom.js';

/**
 * El turno que la Venta usa lo resuelve el nodo desde la caja de la estación.
 * Estas pruebas fijan esa dependencia: la pantalla no ofrece escribir un
 * `shiftId`, muestra la caja y la hora de apertura, y abre el carrito contra el
 * turno que el servidor confirmó, no contra una copia guardada en el navegador.
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

const draft: SaleResponse = {
  id: 'sale-001', status: 'DRAFT', currencyCode: 'USD', scale: 2,
  subtotalMinorUnits: 0, discountTotalMinorUnits: 0, taxTotalMinorUnits: 0,
  totalMinorUnits: 0, paidTotalMinorUnits: 0, balanceMinorUnits: 0,
  items: [], payments: []
} as unknown as SaleResponse;

const shiftNotFound = new ApiProblemError({
  type: 'urn:supermarket:problem:shift-not-found', title: 'Shift was not found.',
  status: 404, code: 'SHIFT_NOT_FOUND', correlationId: 'correlation-001'
});

const operationApi = (overrides: Partial<OperationApi> = {}): OperationApi => ({
  listPaymentMethods: vi.fn(async () => []),
  listProducts: vi.fn(async () => []),
  listCashRegisters: vi.fn(async () => [register]),
  getOpenShift: vi.fn(async () => openShift),
  startSale: vi.fn(async () => draft),
  ...overrides
} as unknown as OperationApi);

const props = { capabilities: { fiscalMode: 'SIMULATION' as const, simulatedReportsEnabled: false }, permissionCodes: [] };

describe('turno activo en la pantalla de Venta', () => {
  it('nombra la caja y la hora de apertura en lugar del identificador del turno', async () => {
    const api = operationApi();
    const screen = await mount(<SalesScreen api={api} {...props} />);
    await settle();

    expect(screen.text()).toContain('Caja 1 · turno abierto');
    expect(screen.text()).not.toContain('shift-001');
    // El turno dejó de ser un campo que el cajero pueda escribir o corregir.
    expect(screen.query('input[placeholder="Se completa desde Caja"]')).toBeNull();
    expect(api.getOpenShift).toHaveBeenCalledWith('register-001');
    screen.unmount();
  });

  it('abre el carrito contra el turno que el nodo confirmó', async () => {
    const api = operationApi();
    const screen = await mount(<SalesScreen api={api} {...props} />);
    await settle();

    await click(screen.button('Iniciar venta'));

    expect(api.startSale).toHaveBeenCalledWith(
      { shiftId: 'shift-001', currencyCode: 'USD' }, expect.any(String)
    );
    screen.unmount();
  });

  it('manda a Caja cuando la estación no tiene un turno abierto', async () => {
    const api = operationApi({
      getOpenShift: vi.fn(async () => { throw shiftNotFound; })
    });
    const screen = await mount(<SalesScreen api={api} {...props} />);
    await settle();

    expect(screen.text()).toContain('no tiene un turno abierto');
    expect(screen.button('Iniciar venta').disabled).toBe(true);
    // Un turno ausente no es un fallo que reportar: es el estado normal antes de abrir caja.
    expect(screen.text()).not.toContain('No pudimos completar la operación');
    screen.unmount();
  });

  it('describe el turno solo mientras siga abierto', () => {
    expect(activeShiftLabel(openShift, 'Caja 1')).toContain('Caja 1 · turno abierto');
    expect(activeShiftLabel(openShift, null)).toContain('Caja · turno abierto');
    expect(activeShiftLabel({ ...openShift, status: 'CLOSED' }, 'Caja 1')).toBeNull();
    expect(activeShiftLabel(null, 'Caja 1')).toBeNull();
  });
});
