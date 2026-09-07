import { describe, expect, it } from 'vitest';
import { Money } from '@supermarket/shared';
import { CashRegister, Shift } from '../../domain/cash/index.js';
import { PaymentMethod } from '../../domain/currency/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuditEntry, AuditWriter, AuthorizationService, BusinessEventStore, OutboxStore,
  PaymentMethodRepository, ShiftRepository, UnitOfWork
} from '../ports/index.js';
import { RegisterCashMovement } from './register-cash-movement.js';

const context: ExecutionContext = {
  actorId: 'user-001',
  terminalId: 'terminal-001',
  originNodeId: 'node-001',
  correlationId: 'correlation-001'
};

const method = PaymentMethod.create({
  code: 'CASH_USD', name: 'Cash USD', kind: 'CASH', currencyCode: 'USD'
});

function openShift(): Shift {
  return Shift.open({
    id: 'shift-001',
    cashRegister: CashRegister.create({
      id: 'register-001', name: 'Main register', terminalId: 'terminal-001', originNodeId: 'node-001'
    }),
    openingFunds: [{ id: 'opening-001', method, amount: Money.fromMinorUnits(10_000, 'USD') }],
    openedBy: 'user-001',
    openedAt: new Date('2026-08-16T08:00:00.000Z'),
    eventId: 'event-001'
  });
}

class FakeShiftRepository implements ShiftRepository {
  saves = 0;
  constructor(public stored: Shift | null) {}
  async save(shift: Shift): Promise<void> { this.stored = shift; this.saves += 1; }
  async findById(): Promise<Shift | null> { return this.stored; }
  async findOpenByCashRegisterId(): Promise<Shift | null> { return this.stored; }
}

class FakePaymentMethodRepository implements PaymentMethodRepository {
  async findByCode(): Promise<PaymentMethod | null> { return method; }
  async findAll(): Promise<readonly PaymentMethod[]> { return [method]; }
}

function useCase(
  repository: ShiftRepository,
  authorization: AuthorizationService = { authorize: async () => true },
  evidence: { transactions: number; ledger: string[]; outbox: string[]; audit: AuditEntry[] } = {
    transactions: 0, ledger: [], outbox: [], audit: []
  }
): RegisterCashMovement {
  let movementSequence = 1;
  let eventSequence = 1;
  return new RegisterCashMovement(
    repository,
    new FakePaymentMethodRepository(),
    authorization,
    { generate: () => `movement-${++movementSequence}` },
    { generate: () => `event-${++eventSequence}` },
    { now: () => new Date('2026-08-16T09:00:00.000Z') },
    { execute: async (work) => { evidence.transactions += 1; return work(); } } satisfies UnitOfWork,
    {
      append: async (events) => { evidence.ledger.push(...events.map((event) => event.eventType)); },
      findByAggregate: async () => []
    } satisfies BusinessEventStore,
    {
      enqueue: async (events) => { evidence.outbox.push(...events.map((event) => event.eventType)); },
      claimAvailable: async () => [], isClaimActive: async () => false,
      markPublished: async () => false, markFailed: async () => false,
    markBlocked: async () => false,
    markPaused: async () => false,
    resumeDelivery: async () => false,
    summarize: async (destinationNodeId: string) => ({
      destinationNodeId, pending: 0, paused: 0, blocked: 0,
      lastPublishedAt: null, lastError: null
    }),
    listPaused: async () => []
    } satisfies OutboxStore,
    { append: async (entries) => { evidence.audit.push(...entries); } } satisfies AuditWriter,
    { generate: () => 'audit-001' }
  );
}

describe('RegisterCashMovement', () => {
  it('registers an income and updates the matching balance', async () => {
    const repository = new FakeShiftRepository(openShift());
    const authorizationCalls: Parameters<AuthorizationService['authorize']>[] = [];
    const evidence = { transactions: 0, ledger: [] as string[], outbox: [] as string[], audit: [] as AuditEntry[] };
    const result = await useCase(repository, {
      authorize: async (...args) => {
        authorizationCalls.push(args);
        return true;
      }
    }, evidence).execute({
      shiftId: 'shift-001',
      type: 'INCOME',
      paymentMethodCode: 'CASH_USD',
      currencyCode: 'USD',
      amountMinorUnits: 2_500,
      reason: 'Additional change'
    }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.expectedBalances[0]?.minorUnits).toBe(12_500);
    expect(repository.stored?.movements.at(-1)?.registeredBy).toBe('user-001');
    expect(repository.stored?.domainEvents.at(-1)?.type).toBe('CashMovementRegistered');
    expect(authorizationCalls).toEqual([[context, 'cash.movement.income']]);
    expect(evidence).toMatchObject({
      transactions: 1,
      ledger: ['CashMovementRegistered'],
      outbox: ['CashMovementRegistered'],
      audit: [{ action: 'CASH_INCOME_REGISTERED', reason: 'Additional change' }]
    });
  });

  it('registers a withdrawal and rejects one above the available balance', async () => {
    const repository = new FakeShiftRepository(openShift());
    const authorizationCalls: Parameters<AuthorizationService['authorize']>[] = [];
    const service = useCase(repository, {
      authorize: async (...args) => {
        authorizationCalls.push(args);
        return true;
      }
    });
    const withdrawn = await service.execute({
      shiftId: 'shift-001', type: 'WITHDRAWAL', paymentMethodCode: 'CASH_USD',
      currencyCode: 'USD', amountMinorUnits: 4_000, reason: 'Safe drop'
    }, context);

    expect(withdrawn.ok).toBe(true);
    if (!withdrawn.ok) return;
    expect(withdrawn.value.expectedBalances[0]?.minorUnits).toBe(6_000);

    const excessive = await service.execute({
      shiftId: 'shift-001', type: 'WITHDRAWAL', paymentMethodCode: 'CASH_USD',
      currencyCode: 'USD', amountMinorUnits: 6_001, reason: 'Safe drop'
    }, context);
    expect(excessive.ok).toBe(false);
    if (!excessive.ok) expect(excessive.error.code).toBe('CASH_WITHDRAWAL_INSUFFICIENT_FUNDS');
    expect(authorizationCalls).toEqual([
      [context, 'cash.movement.withdrawal'],
      [context, 'cash.movement.withdrawal']
    ]);
  });

  it('rejects a movement without permission or reason', async () => {
    const forbiddenRepository = new FakeShiftRepository(openShift());
    const forbidden = await useCase(forbiddenRepository, { authorize: async () => false }).execute({
      shiftId: 'shift-001', type: 'WITHDRAWAL', paymentMethodCode: 'CASH_USD',
      currencyCode: 'USD', amountMinorUnits: 100, reason: 'Safe drop'
    }, context);
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(forbidden.error.code).toBe('FORBIDDEN');

    const repository = new FakeShiftRepository(openShift());
    const missingReason = await useCase(repository).execute({
      shiftId: 'shift-001', type: 'INCOME', paymentMethodCode: 'CASH_USD',
      currencyCode: 'USD', amountMinorUnits: 100, reason: '  '
    }, context);
    expect(missingReason.ok).toBe(false);
    if (!missingReason.ok) expect(missingReason.error.code).toBe('CASH_MOVEMENT_REASON_REQUIRED');
  });

  it('rejects a missing shift and a non-positive amount', async () => {
    const missing = await useCase(new FakeShiftRepository(null)).execute({
      shiftId: 'shift-missing', type: 'INCOME', paymentMethodCode: 'CASH_USD',
      currencyCode: 'USD', amountMinorUnits: 100, reason: 'Additional change'
    }, context);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('SHIFT_NOT_FOUND');

    const repository = new FakeShiftRepository(openShift());
    const invalidAmount = await useCase(repository).execute({
      shiftId: 'shift-001', type: 'INCOME', paymentMethodCode: 'CASH_USD',
      currencyCode: 'USD', amountMinorUnits: 0, reason: 'Additional change'
    }, context);
    expect(invalidAmount.ok).toBe(false);
    if (!invalidAmount.ok) expect(invalidAmount.error.code).toBe('CASH_MOVEMENT_INVALID_AMOUNT');
    expect(repository.saves).toBe(0);
  });
});
