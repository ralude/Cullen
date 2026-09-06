import { describe, expect, it } from 'vitest';
import { Money } from '@supermarket/shared';
import { CashRegister, Shift } from '../../domain/cash/index.js';
import { PaymentMethod } from '../../domain/currency/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuditEntry,
  AuditWriter,
  AuthorizationService,
  BusinessEventStore,
  OutboxStore,
  PaymentMethodRepository,
  ShiftRepository,
  UnitOfWork
} from '../ports/index.js';
import { CloseShift } from './close-shift.js';

const context: ExecutionContext = {
  actorId: 'user-001', terminalId: 'terminal-001', originNodeId: 'node-001',
  correlationId: 'correlation-001'
};

const usdCash = PaymentMethod.create({
  code: 'CASH_USD', name: 'Cash USD', kind: 'CASH', currencyCode: 'USD'
});

function shift(): Shift {
  return Shift.open({
    id: 'shift-001',
    cashRegister: CashRegister.create({
      id: 'register-001', name: 'Main register', terminalId: 'terminal-001', originNodeId: 'node-001'
    }),
    openingFunds: [{ id: 'opening-001', method: usdCash, amount: Money.fromMinorUnits(10_000, 'USD') }],
    openedBy: 'user-001', openedAt: new Date('2026-08-16T08:00:00.000Z'), eventId: 'event-001'
  });
}

class FakeShiftRepository implements ShiftRepository {
  saves = 0;
  constructor(public stored: Shift | null) {}
  async save(value: Shift): Promise<void> { this.stored = value; this.saves += 1; }
  async findById(): Promise<Shift | null> { return this.stored; }
  async findOpenByCashRegisterId(): Promise<Shift | null> { return this.stored; }
}

class FakePaymentMethodRepository implements PaymentMethodRepository {
  async findByCode(code: string): Promise<PaymentMethod | null> {
    return code === usdCash.code ? usdCash : null;
  }

  async findAll(): Promise<readonly PaymentMethod[]> {
    return [usdCash];
  }
}

function useCase(
  repository: ShiftRepository,
  authorization: AuthorizationService = { authorize: async () => true },
  evidence: { transactions: number; ledger: string[]; outbox: string[]; audit: AuditEntry[] } = {
    transactions: 0, ledger: [], outbox: [], audit: []
  }
): CloseShift {
  return new CloseShift(
    repository,
    new FakePaymentMethodRepository(),
    authorization,
    { generate: () => 'event-close' },
    { now: () => new Date('2026-08-16T18:00:00.000Z') },
    { execute: async (work) => { evidence.transactions += 1; return work(); } } satisfies UnitOfWork,
    {
      append: async (events) => { evidence.ledger.push(...events.map((event) => event.eventType)); },
      findByAggregate: async () => []
    } satisfies BusinessEventStore,
    {
      enqueue: async (events) => { evidence.outbox.push(...events.map((event) => event.eventType)); },
      claimAvailable: async () => [], markPublished: async () => undefined, markFailed: async () => undefined
    } satisfies OutboxStore,
    { append: async (entries) => { evidence.audit.push(...entries); } } satisfies AuditWriter,
    { generate: () => 'audit-close' }
  );
}

describe('CloseShift', () => {
  it('closes with expected, declared and difference snapshots', async () => {
    const repository = new FakeShiftRepository(shift());
    const authorizationCalls: Parameters<AuthorizationService['authorize']>[] = [];
    const evidence = { transactions: 0, ledger: [] as string[], outbox: [] as string[], audit: [] as AuditEntry[] };
    const result = await useCase(repository, {
      authorize: async (...args) => {
        authorizationCalls.push(args);
        return true;
      }
    }, evidence).execute({
      shiftId: 'shift-001',
      declaredBalances: [{
        paymentMethodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: 9_900
      }]
    }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('CLOSED');
    expect(result.value.closingBalances).toEqual([{
      paymentMethodCode: 'CASH_USD', currencyCode: 'USD',
      expectedMinorUnits: 10_000, declaredMinorUnits: 9_900, differenceMinorUnits: -100
    }]);
    expect(repository.stored?.domainEvents.at(-1)?.type).toBe('ShiftClosed');
    expect(authorizationCalls).toEqual([
      [context, 'cash.shift.close'],
      [context, 'cash.shift.close.difference']
    ]);
    expect(evidence).toMatchObject({
      transactions: 1,
      ledger: ['ShiftClosed'],
      outbox: ['ShiftClosed'],
      audit: [{ action: 'SHIFT_CLOSED', entityId: 'shift-001' }]
    });
  });

  it('rejects duplicate declared balance keys without saving', async () => {
    const repository = new FakeShiftRepository(shift());
    const result = await useCase(repository).execute({
      shiftId: 'shift-001',
      declaredBalances: [
        { paymentMethodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: 10_000 },
        { paymentMethodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: 10_000 }
      ]
    }, context);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SHIFT_CLOSING_BALANCE_DUPLICATE');
    expect(repository.saves).toBe(0);
  });

  it('rejects a second close and movements after closing', async () => {
    const repository = new FakeShiftRepository(shift());
    const service = useCase(repository);
    const first = await service.execute({ shiftId: 'shift-001', declaredBalances: [] }, context);
    expect(first.ok).toBe(true);

    const second = await service.execute({ shiftId: 'shift-001', declaredBalances: [] }, context);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('SHIFT_INVALID_STATE');

    expect(() => repository.stored?.registerMovement({
      id: 'movement-late', type: 'INCOME', method: usdCash,
      amount: Money.fromMinorUnits(100, 'USD'), reason: 'Late movement',
      registeredBy: 'user-001', terminalId: 'terminal-001', originNodeId: 'node-001',
      occurredAt: new Date('2026-08-16T18:01:00.000Z'), eventId: 'event-late'
    })).toThrowError('Only open shifts can be modified.');
  });

  it('treats an omitted expected balance as a zero declaration', async () => {
    const repository = new FakeShiftRepository(shift());
    const result = await useCase(repository).execute({
      shiftId: 'shift-001', declaredBalances: []
    }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.closingBalances).toEqual([{
      paymentMethodCode: 'CASH_USD', currencyCode: 'USD',
      expectedMinorUnits: 10_000, declaredMinorUnits: 0, differenceMinorUnits: -10_000
    }]);
  });

  it('rejects an unauthorized close or one requested by another owner', async () => {
    const forbiddenRepository = new FakeShiftRepository(shift());
    const forbidden = await useCase(forbiddenRepository, { authorize: async () => false }).execute({
      shiftId: 'shift-001', declaredBalances: []
    }, context);
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(forbidden.error.code).toBe('FORBIDDEN');

    const foreignRepository = new FakeShiftRepository(shift());
    const foreign = await useCase(foreignRepository).execute(
      { shiftId: 'shift-001', declaredBalances: [] },
      { ...context, terminalId: 'terminal-002' }
    );
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error.code).toBe('SHIFT_OWNERSHIP_MISMATCH');
    expect(foreignRepository.saves).toBe(0);

    const differenceRepository = new FakeShiftRepository(shift());
    const difference = await useCase(differenceRepository, {
      authorize: async (_context, permission) => permission !== 'cash.shift.close.difference'
    }).execute({
      shiftId: 'shift-001',
      declaredBalances: [{
        paymentMethodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: 9_900
      }]
    }, context);
    expect(difference.ok).toBe(false);
    if (!difference.ok) expect(difference.error.code).toBe('FORBIDDEN');
    expect(differenceRepository.stored?.status).toBe('OPEN');
    expect(differenceRepository.saves).toBe(0);
  });

  it('requires an explicit reason and supervisor authorization to close with a negative expected balance', async () => {
    const refunded = (): Shift => {
      const value = shift();
      value.registerMovement({
        id: 'refund-001', type: 'SALE_REFUND', method: usdCash,
        amount: Money.fromMinorUnits(12_000, 'USD'), reason: 'Return from a previous shift',
        registeredBy: 'user-001', terminalId: 'terminal-001', originNodeId: 'node-001',
        occurredAt: new Date('2026-08-16T09:00:00.000Z'), eventId: 'refund-event',
        reference: { sourceId: 'return-001', sourceEventId: 'return-event' }
      });
      return value;
    };

    const withoutReason = await useCase(new FakeShiftRepository(refunded())).execute({
      shiftId: 'shift-001',
      declaredBalances: [{ paymentMethodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: 0 }]
    }, context);
    expect(withoutReason).toMatchObject({
      ok: false, error: { code: 'SHIFT_NEGATIVE_EXPECTED_REASON_REQUIRED' }
    });

    const withoutSupervisor = await useCase(new FakeShiftRepository(refunded()), {
      authorize: async (_context, permission) => permission !== 'cash.shift.close.difference'
    }).execute({
      shiftId: 'shift-001', reason: 'Supervisor aportó efectivo para el reintegro',
      declaredBalances: [{ paymentMethodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: 0 }]
    }, context);
    expect(withoutSupervisor).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    const evidence = { transactions: 0, ledger: [] as string[], outbox: [] as string[], audit: [] as AuditEntry[] };
    const repository = new FakeShiftRepository(refunded());
    const closed = await useCase(repository, { authorize: async () => true }, evidence).execute({
      shiftId: 'shift-001', reason: 'Supervisor aportó efectivo para el reintegro',
      declaredBalances: [{ paymentMethodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: 0 }]
    }, context);
    expect(closed.ok).toBe(true);
    expect(repository.stored?.status).toBe('CLOSED');
    expect(evidence.audit).toMatchObject([{
      action: 'SHIFT_CLOSED',
      reason: 'Supervisor aportó efectivo para el reintegro',
      after: { negativeExpectedMethods: ['CASH_USD:USD'] }
    }]);
  });
});
