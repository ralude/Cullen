import { describe, expect, it } from 'vitest';
import { CashRegister, Shift } from '../../domain/cash/index.js';
import { PaymentMethod } from '../../domain/currency/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuditEntry,
  AuditWriter,
  AuthorizationService,
  BusinessEventStore,
  CashRegisterRepository,
  OutboxStore,
  PaymentMethodRepository,
  ShiftRepository,
  UnitOfWork
} from '../ports/index.js';
import { OpenShift } from './open-shift.js';

const context: ExecutionContext = {
  actorId: 'user-001',
  terminalId: 'terminal-001',
  originNodeId: 'node-001',
  correlationId: 'correlation-001'
};

const cashMethod = PaymentMethod.create({
  code: 'CASH_USD',
  name: 'Cash USD',
  kind: 'CASH',
  currencyCode: 'USD'
});

class FakeCashRegisterRepository implements CashRegisterRepository {
  constructor(readonly cashRegister: CashRegister | null) {}

  async findById(): Promise<CashRegister | null> {
    return this.cashRegister;
  }

  async findAll(): Promise<readonly CashRegister[]> {
    return this.cashRegister ? [this.cashRegister] : [];
  }
}

class FakePaymentMethodRepository implements PaymentMethodRepository {
  async findByCode(code: string): Promise<PaymentMethod | null> {
    return code === cashMethod.code ? cashMethod : null;
  }

  async findAll(): Promise<readonly PaymentMethod[]> {
    return [cashMethod];
  }
}

class FakeShiftRepository implements ShiftRepository {
  stored: Shift | null = null;
  openShift: Shift | null = null;
  saves = 0;

  async save(shift: Shift): Promise<void> {
    this.stored = shift;
    this.saves += 1;
  }

  async findById(): Promise<Shift | null> {
    return this.stored;
  }

  async findOpenByCashRegisterId(): Promise<Shift | null> {
    return this.openShift;
  }
}

function register(overrides: { terminalId?: string; isActive?: boolean } = {}): CashRegister {
  return CashRegister.create({
    id: 'register-001',
    name: 'Main register',
    terminalId: overrides.terminalId ?? 'terminal-001',
    originNodeId: 'node-001',
    ...(overrides.isActive === undefined ? {} : { isActive: overrides.isActive })
  });
}

function createUseCase(
  cashRegisterRepository: CashRegisterRepository,
  shiftRepository: ShiftRepository,
  authorization: AuthorizationService = { authorize: async () => true },
  observability: {
    transactionRuns: number[];
    ledger: Parameters<BusinessEventStore['append']>[0][];
    outbox: Parameters<OutboxStore['enqueue']>[0][];
    audit: AuditEntry[];
  } = { transactionRuns: [], ledger: [], outbox: [], audit: [] }
): OpenShift {
  const unitOfWork: UnitOfWork = {
    execute: async (work) => {
      observability.transactionRuns.push(1);
      return work();
    }
  };
  const eventStore: BusinessEventStore = {
    append: async (events) => { observability.ledger.push(events); },
    findByAggregate: async () => []
  };
  const outboxStore: OutboxStore = {
    enqueue: async (events) => { observability.outbox.push(events); },
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
  };
  const auditWriter: AuditWriter = {
    append: async (entries) => { observability.audit.push(...entries); }
  };
  return new OpenShift(
    cashRegisterRepository,
    shiftRepository,
    new FakePaymentMethodRepository(),
    authorization,
    { generate: () => 'shift-001' },
    { generate: () => 'movement-001' },
    { generate: () => 'event-001' },
    { now: () => new Date('2026-08-16T08:00:00.000Z') },
    unitOfWork,
    eventStore,
    outboxStore,
    auditWriter,
    { generate: () => 'audit-001' }
  );
}

describe('OpenShift', () => {
  it('opens one shift for the execution terminal with its opening float', async () => {
    const repository = new FakeShiftRepository();
    const authorizationCalls: Parameters<AuthorizationService['authorize']>[] = [];
    const observability: Parameters<typeof createUseCase>[3] = {
      transactionRuns: [], ledger: [], outbox: [], audit: []
    };
    const useCase = createUseCase(
      new FakeCashRegisterRepository(register()),
      repository,
      {
        authorize: async (...args) => {
          authorizationCalls.push(args);
          return true;
        }
      },
      observability
    );

    const result = await useCase.execute({
      cashRegisterId: 'register-001',
      openingFunds: [{
        paymentMethodCode: 'CASH_USD',
        currencyCode: 'USD',
        amountMinorUnits: 10_000
      }]
    }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('OPEN');
    expect(result.value.expectedBalances).toEqual([{
      paymentMethodCode: 'CASH_USD',
      currencyCode: 'USD',
      minorUnits: 10_000
    }]);
    expect(repository.stored?.movements[0]?.type).toBe('OPENING_FLOAT');
    expect(repository.stored?.domainEvents.map((event) => event.type)).toEqual(['ShiftOpened']);
    expect(repository.saves).toBe(1);
    expect(authorizationCalls).toEqual([[context, 'cash.shift.open']]);
    expect(observability.transactionRuns).toEqual([1]);
    expect(observability.ledger[0]?.map((event) => event.eventType)).toEqual(['ShiftOpened']);
    expect(observability.outbox[0]?.map((event) => event.eventType)).toEqual(['ShiftOpened']);
    expect(observability.audit).toMatchObject([{
      auditId: 'audit-001', action: 'SHIFT_OPENED', entityType: 'Shift', entityId: 'shift-001',
      actorId: 'user-001', terminalId: 'terminal-001', originNodeId: 'node-001'
    }]);
  });

  it('rejects a second open shift for the same cash register', async () => {
    const repository = new FakeShiftRepository();
    repository.openShift = Shift.open({
      id: 'shift-existing',
      cashRegister: register(),
      openingFunds: [],
      openedBy: 'user-001',
      openedAt: new Date('2026-08-16T07:00:00.000Z'),
      eventId: 'event-existing'
    });
    const useCase = createUseCase(new FakeCashRegisterRepository(register()), repository);

    const result = await useCase.execute({ cashRegisterId: 'register-001', openingFunds: [] }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SHIFT_ALREADY_OPEN');
    expect(repository.saves).toBe(0);
  });

  it('rejects an unauthorized or foreign cash register before saving', async () => {
    const unauthorizedRepository = new FakeShiftRepository();
    const unauthorized = createUseCase(
      new FakeCashRegisterRepository(register()),
      unauthorizedRepository,
      { authorize: async () => false }
    );
    const forbidden = await unauthorized.execute({ cashRegisterId: 'register-001', openingFunds: [] }, context);

    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(forbidden.error.code).toBe('FORBIDDEN');

    const foreignRepository = new FakeShiftRepository();
    const foreign = createUseCase(
      new FakeCashRegisterRepository(register({ terminalId: 'terminal-002' })),
      foreignRepository
    );
    const mismatch = await foreign.execute({ cashRegisterId: 'register-001', openingFunds: [] }, context);

    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error.code).toBe('CASH_REGISTER_OWNERSHIP_MISMATCH');
    expect(foreignRepository.saves).toBe(0);
  });

  it('rejects a missing or inactive cash register', async () => {
    const missing = await createUseCase(
      new FakeCashRegisterRepository(null),
      new FakeShiftRepository()
    ).execute({ cashRegisterId: 'register-missing', openingFunds: [] }, context);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('CASH_REGISTER_NOT_FOUND');

    const inactive = await createUseCase(
      new FakeCashRegisterRepository(register({ isActive: false })),
      new FakeShiftRepository()
    ).execute({ cashRegisterId: 'register-001', openingFunds: [] }, context);
    expect(inactive.ok).toBe(false);
    if (!inactive.ok) expect(inactive.error.code).toBe('CASH_REGISTER_INACTIVE');
  });
});
