import { describe, expect, it } from 'vitest';
import { Money } from '@supermarket/shared';
import { PaymentMethod } from '../currency/index.js';
import { CashRegister, Shift } from './index.js';

const usdCash = PaymentMethod.create({
  code: 'CASH_USD', name: 'Cash USD', kind: 'CASH', currencyCode: 'USD'
});
const vesCash = PaymentMethod.create({
  code: 'CASH_VES', name: 'Cash VES', kind: 'CASH', currencyCode: 'VES'
});
const usdCard = PaymentMethod.create({
  code: 'CARD_USD', name: 'Card USD', kind: 'CARD', currencyCode: 'USD'
});

function cashRegister(): CashRegister {
  return CashRegister.create({
    id: 'register-001', name: 'Main register', terminalId: 'terminal-001', originNodeId: 'node-001'
  });
}

describe('Shift', () => {
  it('keeps independent balances and sequential immutable events', () => {
    const openedAt = new Date('2026-08-16T08:00:00.000Z');
    const shift = Shift.open({
      id: 'shift-001', cashRegister: cashRegister(),
      openingFunds: [
        { id: 'movement-001', method: usdCash, amount: Money.fromMinorUnits(10_000, 'USD') },
        { id: 'movement-002', method: vesCash, amount: Money.fromMinorUnits(50_000, 'VES') }
      ],
      openedBy: 'user-001', openedAt, eventId: 'event-001'
    });
    openedAt.setUTCFullYear(2030);
    shift.registerMovement({
      id: 'movement-003', type: 'WITHDRAWAL', method: usdCash,
      amount: Money.fromMinorUnits(2_000, 'USD'), reason: 'Safe drop',
      registeredBy: 'user-001', terminalId: 'terminal-001', originNodeId: 'node-001',
      occurredAt: new Date('2026-08-16T09:00:00.000Z'), eventId: 'event-002'
    });

    expect(shift.openedAt.toISOString()).toBe('2026-08-16T08:00:00.000Z');
    expect(shift.balanceFor('CASH_USD', 'USD').minorUnits).toBe(8_000);
    expect(shift.balanceFor('CASH_VES', 'VES').minorUnits).toBe(50_000);
    expect(shift.domainEvents.map((event) => event.aggregateVersion)).toEqual([1, 2]);
  });

  it('rejects duplicate opening balances and movement identifiers', () => {
    expect(() => Shift.open({
      id: 'shift-001', cashRegister: cashRegister(),
      openingFunds: [
        { id: 'movement-001', method: usdCash, amount: Money.fromMinorUnits(100, 'USD') },
        { id: 'movement-002', method: usdCash, amount: Money.fromMinorUnits(200, 'USD') }
      ],
      openedBy: 'user-001', openedAt: new Date('2026-08-16T08:00:00.000Z'), eventId: 'event-001'
    })).toThrowError('Opening balance must be unique by payment method and currency.');

    const shift = Shift.open({
      id: 'shift-001', cashRegister: cashRegister(),
      openingFunds: [{ id: 'movement-001', method: usdCash, amount: Money.fromMinorUnits(100, 'USD') }],
      openedBy: 'user-001', openedAt: new Date('2026-08-16T08:00:00.000Z'), eventId: 'event-001'
    });
    expect(() => shift.registerMovement({
      id: 'movement-001', type: 'INCOME', method: usdCash,
      amount: Money.fromMinorUnits(100, 'USD'), reason: 'Duplicate',
      registeredBy: 'user-001', terminalId: 'terminal-001', originNodeId: 'node-001',
      occurredAt: new Date('2026-08-16T09:00:00.000Z'), eventId: 'event-002'
    })).toThrowError('Cash movement already exists.');
  });

  it('rejects operations from another owner and timestamps before opening', () => {
    const shift = Shift.open({
      id: 'shift-001', cashRegister: cashRegister(), openingFunds: [],
      openedBy: 'user-001', openedAt: new Date('2026-08-16T08:00:00.000Z'), eventId: 'event-001'
    });
    expect(() => shift.registerMovement({
      id: 'movement-001', type: 'INCOME', method: usdCash,
      amount: Money.fromMinorUnits(100, 'USD'), reason: 'Foreign terminal',
      registeredBy: 'user-001', terminalId: 'terminal-002', originNodeId: 'node-001',
      occurredAt: new Date('2026-08-16T09:00:00.000Z'), eventId: 'event-002'
    })).toThrowError('Shift belongs to another terminal or node.');

    expect(() => shift.registerMovement({
      id: 'movement-002', type: 'INCOME', method: usdCash,
      amount: Money.fromMinorUnits(100, 'USD'), reason: 'Clock error',
      registeredBy: 'user-001', terminalId: 'terminal-001', originNodeId: 'node-001',
      occurredAt: new Date('2026-08-16T07:59:59.000Z'), eventId: 'event-003'
    })).toThrowError('Shift operation cannot occur before opening.');
  });

  it('registers a sale payment once and rejects a conflicting redelivery', () => {
    const shift = Shift.open({
      id: 'shift-001', cashRegister: cashRegister(), openingFunds: [],
      openedBy: 'user-001', openedAt: new Date('2026-08-16T08:00:00.000Z'), eventId: 'event-001'
    });
    const input = {
      id: 'payment-001', type: 'SALE_PAYMENT' as const, method: usdCard,
      amount: Money.fromMinorUnits(2_500, 'USD'), reason: 'Sale payment',
      registeredBy: 'user-002', terminalId: 'terminal-001', originNodeId: 'node-001',
      occurredAt: new Date('2026-08-16T09:00:00.000Z'), eventId: 'event-002',
      reference: { sourceId: 'sale-001', sourceEventId: 'sale-event-001' }
    };
    shift.registerMovement(input);
    shift.registerMovement(input);

    expect(shift.balanceFor('CARD_USD', 'USD').minorUnits).toBe(2_500);
    expect(shift.movements).toHaveLength(1);
    expect(shift.domainEvents).toHaveLength(2);
    expect(() => shift.registerMovement({
      ...input,
      amount: Money.fromMinorUnits(2_501, 'USD')
    })).toThrowError('Sale payment identifier conflicts with another movement.');
  });

  it('keeps a negative expected balance when the current shift refunds an earlier sale', () => {
    const shift = Shift.open({
      id: 'shift-refund', cashRegister: cashRegister(), openingFunds: [],
      openedBy: 'user-001', openedAt: new Date('2026-08-16T08:00:00.000Z'), eventId: 'open-event'
    });
    shift.registerMovement({
      id: 'refund-001', type: 'SALE_REFUND', method: usdCash,
      amount: Money.fromMinorUnits(2_500, 'USD'), reason: 'Return from previous shift',
      registeredBy: 'user-002', terminalId: 'terminal-001', originNodeId: 'node-001',
      occurredAt: new Date('2026-08-16T09:00:00.000Z'), eventId: 'refund-event',
      reference: { sourceId: 'return-001', sourceEventId: 'return-event' }
    });

    expect(shift.balanceFor('CASH_USD', 'USD')).toEqual(Money.fromMinorUnits(-2_500, 'USD'));
  });
});
