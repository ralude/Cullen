import { describe, expect, it } from 'vitest';
import { Money } from '@supermarket/shared';
import { CashRegister, Shift } from '../../domain/cash/index.js';
import { PaymentMethod } from '../../domain/currency/index.js';
import type { ExecutionContext } from '../execution-context.js';
import { permissionAlternatives } from '../ports/index.js';
import type { AuthorizationService, ShiftRepository } from '../ports/index.js';
import { GetShift } from './get-shift.js';
import { CASH_PERMISSIONS } from './permissions.js';

const usdCash = PaymentMethod.create({ code: 'CASH_USD', name: 'Cash USD', kind: 'CASH', currencyCode: 'USD' });

const shift = (openedBy: string, originNodeId = 'node-001'): Shift => Shift.open({
  id: 'shift-001',
  cashRegister: CashRegister.create({
    id: 'register-001', name: 'Main', terminalId: 'terminal-001', originNodeId
  }),
  openingFunds: [{ id: 'opening-001', method: usdCash, amount: Money.fromMinorUnits(10_000, 'USD') }],
  openedBy, openedAt: new Date('2026-08-16T08:00:00.000Z'), eventId: 'event-001'
});

const context: ExecutionContext = {
  actorId: 'cashier-1', terminalId: 'terminal-001', originNodeId: 'node-001', correlationId: 'c-1'
};

const repo = (stored: Shift | null): ShiftRepository => ({
  save: async () => {}, findById: async () => stored, findOpenByCashRegisterId: async () => stored
});

const allow = (...permissions: string[]): AuthorizationService => ({
  authorize: async (_context, permission) =>
    permissionAlternatives(permission).some((code) => permissions.includes(code))
});

describe('GetShift', () => {
  it('denies the read without the base shift-read permission and never touches the repository', async () => {
    let touched = false;
    const guarded: ShiftRepository = {
      save: async () => {},
      findById: async () => { touched = true; return null; },
      findOpenByCashRegisterId: async () => null
    };
    const result = await new GetShift(guarded, allow()).execute('shift-001', context);
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(touched).toBe(false);
  });

  it('returns a shift the actor opened with only the base permission', async () => {
    const result = await new GetShift(repo(shift('cashier-1')), allow(CASH_PERMISSIONS.READ_SHIFT))
      .execute('shift-001', context);
    expect(result).toMatchObject({ ok: true, value: { id: 'shift-001', openedBy: 'cashier-1' } });
  });

  it('requires cash.shift.read.any for a shift opened by someone else', async () => {
    const foreign = repo(shift('cashier-2'));
    const denied = await new GetShift(foreign, allow(CASH_PERMISSIONS.READ_SHIFT))
      .execute('shift-001', context);
    expect(denied).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    const allowed = await new GetShift(foreign,
      allow(CASH_PERMISSIONS.READ_SHIFT, CASH_PERMISSIONS.READ_SHIFT_ANY))
      .execute('shift-001', context);
    expect(allowed).toMatchObject({ ok: true, value: { openedBy: 'cashier-2' } });
  });

  it('hides a shift that belongs to another node', async () => {
    const result = await new GetShift(repo(shift('cashier-1', 'node-999')),
      allow(CASH_PERMISSIONS.READ_SHIFT, CASH_PERMISSIONS.READ_SHIFT_ANY))
      .execute('shift-001', context);
    expect(result).toMatchObject({ ok: false, error: { code: 'SHIFT_NOT_FOUND' } });
  });
});
