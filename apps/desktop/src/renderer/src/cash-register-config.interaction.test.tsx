import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CashRegisterResponse } from '@supermarket/shared';
import type { OperationApi } from './api-client.js';
import { CashScreen, ConfigScreen } from './operation-screens.js';
import { click, mount, settle, type, unmountAll } from './testing/dom.js';

afterEach(() => { unmountAll(); });

const capabilities = { fiscalMode: 'SIMULATION' as const, simulatedReportsEnabled: false };
const emptyMasterData = { categories: [], units: [], paymentMethods: [] };

const configApi = (overrides: Partial<OperationApi> = {}): OperationApi => ({
  listBranches: vi.fn(async () => []),
  listDevices: vi.fn(async () => []),
  listOperationalMasterData: vi.fn(async () => emptyMasterData),
  listCashRegisters: vi.fn(async () => [] as readonly CashRegisterResponse[]),
  ...overrides
} as unknown as OperationApi);

describe('alta de cajas desde la aplicación', () => {
  it('registra la caja de esta terminal con su motivo', async () => {
    const createCashRegister = vi.fn(async () => ({
      id: 'register-1', name: 'Caja 1', terminalId: 'terminal-1',
      originNodeId: 'node-1', isActive: true
    }));
    const screen = await mount(
      <ConfigScreen api={configApi({ createCashRegister })} capabilities={capabilities}
        permissionCodes={['config.cash_register.manage']} />
    );

    expect(screen.text()).toContain('Cajas de esta terminal');
    // Sin motivo el comando no se ofrece: toda configuración queda auditada.
    expect(screen.button('Registrar caja').disabled).toBe(true);

    await type(screen.get<HTMLInputElement>('input'), 'Alta de la estación');
    await settle();
    const [, nameField] = screen.all<HTMLInputElement>('input');
    await type(nameField!, 'Caja 1');
    await settle();
    await click(screen.button('Registrar caja'));
    await settle();

    expect(createCashRegister).toHaveBeenCalledWith(
      { name: 'Caja 1', reason: 'Alta de la estación' }, expect.any(String)
    );
    expect(screen.text()).toContain('Ya puedes abrir turno');
  });

  /**
   * Antes, un nodo sin cajas mostraba un campo vacío que nunca podía funcionar,
   * porque la única vía de alta era un comando de línea de órdenes.
   */
  it('explica en Caja que el nodo no tiene ninguna caja registrada', async () => {
    const screen = await mount(
      <CashScreen
        api={{
          listPaymentMethods: vi.fn(async () => []),
          listCashRegisters: vi.fn(async () => [])
        } as unknown as OperationApi}
        capabilities={capabilities} permissionCodes={['cash.shift.open']} />
    );

    expect(screen.text()).toContain('no tiene ninguna caja registrada');
    expect(screen.get<HTMLAnchorElement>('a[href="#/config"]')).toBeTruthy();
  });

  it('no muestra el aviso mientras el nodo todavía no respondió', async () => {
    let resolveList: (value: readonly CashRegisterResponse[]) => void = () => undefined;
    const pending = new Promise<readonly CashRegisterResponse[]>((resolve) => {
      resolveList = resolve;
    });
    const screen = await mount(
      <CashScreen
        api={{
          listPaymentMethods: vi.fn(async () => []),
          listCashRegisters: vi.fn(() => pending)
        } as unknown as OperationApi}
        capabilities={capabilities} permissionCodes={['cash.shift.open']} />
    );

    expect(screen.text()).not.toContain('no tiene ninguna caja registrada');

    resolveList([{ id: 'register-1', name: 'Caja 1' }]);
    await settle();

    expect(screen.text()).not.toContain('no tiene ninguna caja registrada');
  });
});
