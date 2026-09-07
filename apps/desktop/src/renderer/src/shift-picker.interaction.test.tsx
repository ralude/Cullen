import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CashClosureReportResponse } from '@supermarket/shared';
import type { OperationApi } from './api-client.js';
import { ReportsScreen, shiftOptionLabel } from './operation-screens.js';
import { click, mount, settle, unmountAll } from './testing/dom.js';

afterEach(() => { unmountAll(); });

const closure = (): CashClosureReportResponse => ({
  shiftId: '01a07e33-993b-75fd-83ab-f1920c264751', cashRegisterId: 'register-1',
  terminalId: 'terminal-1', originNodeId: 'node-1', openedBy: 'user-1',
  openedAt: '2026-09-07T09:14:00.000Z', closedBy: 'user-1',
  closedAt: '2026-09-07T18:00:00.000Z', movementCount: 3, balances: []
} as unknown as CashClosureReportResponse);

const reportsApi = (): OperationApi => ({
  listProducts: vi.fn(async () => []),
  getCashClosureReport: vi.fn(async () => [closure()]),
  getAuditReport: vi.fn(async () => []),
  getFiscalOperationsReport: vi.fn(async () => ({ fiscalMode: 'SIMULATION', operations: [] })),
  getMarginReport: vi.fn(async () => []),
  getSalesReport: vi.fn(async () => []),
  getInventoryReport: vi.fn(async () => []),
  getShift: vi.fn()
} as unknown as OperationApi);

const capabilities = { fiscalMode: 'SIMULATION' as const, simulatedReportsEnabled: false };

describe('supervisión de caja sin escribir el identificador del turno', () => {
  it('nombra el turno por su jornada y no solo por su UUID', () => {
    const label = shiftOptionLabel(closure());
    expect(label).toContain('cerrado');
    expect(label).toContain('01a07e33');
    expect(label).not.toBe(closure().shiftId);
  });

  it('ofrece los turnos del período consultado en lugar de un campo libre', async () => {
    const screen = await mount(
      <ReportsScreen api={reportsApi()} capabilities={capabilities}
        permissionCodes={['reports.cash.read', 'cash.shift.read']} />
    );

    // Antes de consultar el período no hay turnos que ofrecer: el campo lo dice.
    expect(screen.get<HTMLInputElement>('input[placeholder*="Consulta el período"]')).toBeTruthy();

    await click(screen.button('Consultar reportes'));
    await settle();

    const picker = screen.get<HTMLSelectElement>('select');
    expect([...picker.options].map((option) => option.value)).toEqual([
      '', '01a07e33-993b-75fd-83ab-f1920c264751'
    ]);
    expect(picker.options[1]!.textContent).toContain('cerrado');
  });
});
