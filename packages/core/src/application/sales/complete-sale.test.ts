import { describe, expect, it } from 'vitest';
import { Money, Quantity, TaxRate } from '@supermarket/shared';
import { CashRegister, Shift } from '../../domain/cash/index.js';
import { ProductSnapshot } from '../../domain/catalog/index.js';
import { PaymentMethod } from '../../domain/currency/index.js';
import { Payment, Sale } from '../../domain/sales/index.js';
import { ApplySaleCompletedToShift } from '../cash/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuditEntry,
  AuditWriter,
  BusinessEventStore,
  IdempotencyRecord,
  IdempotencyStore,
  OutboxStore,
  PaymentMethodRepository,
  SaleRepository,
  ShiftRepository,
  UnitOfWork
} from '../ports/index.js';
import type { BusinessEventV1 } from '../events/index.js';
import { CompleteSale } from './complete-sale.js';

const context: ExecutionContext = {
  actorId: 'user-001', terminalId: 'terminal-001', originNodeId: 'node-001',
  correlationId: 'correlation-001', idempotencyKey: 'complete-001'
};

const cash = PaymentMethod.create({
  code: 'CASH_USD', name: 'Cash USD', kind: 'CASH', currencyCode: 'USD'
});

class FakeSaleRepository implements SaleRepository {
  stored: Sale;
  saves = 0;

  constructor() {
    this.stored = Sale.start({
      id: 'sale-001', shiftId: 'shift-001', currencyCode: 'USD', terminalId: 'terminal-001', originNodeId: 'node-001',
      startedBy: 'user-001', startedAt: new Date('2026-08-15T10:00:00.000Z'), eventId: 'event-001'
    });
    this.stored.addItem({
      id: 'item-001', snapshot: ProductSnapshot.create({ productId: 'product-001', description: 'Coffee', price: Money.fromMinorUnits(1000, 'USD'), taxRate: TaxRate.fromBasisPoints(0), unitCode: 'UNIT', unitScale: 0 }),
      quantity: Quantity.fromScaled(1, 0), occurredAt: new Date('2026-08-15T10:00:30.000Z'), eventId: 'event-002'
    });
    this.stored.registerPayments({
      payments: [Payment.create({ id: 'payment-001', method: cash, amount: Money.fromMinorUnits(1000, 'USD'), amountInSaleCurrency: Money.fromMinorUnits(1000, 'USD'), exchangeRate: null, registeredBy: 'user-001', registeredAt: new Date('2026-08-15T10:01:00.000Z') })],
      financialTransactionTax: Money.zero('USD'), occurredAt: new Date('2026-08-15T10:01:00.000Z'), eventIds: ['event-003']
    });
  }

  async save(sale: Sale): Promise<void> { this.stored = sale; this.saves += 1; }
  async findById(): Promise<Sale | null> { return this.stored; }
}

const openShift = (): Shift => Shift.open({
  id: 'shift-001',
  cashRegister: CashRegister.create({
    id: 'register-001', name: 'Main', terminalId: 'terminal-001', originNodeId: 'node-001'
  }),
  openingFunds: [], openedBy: 'user-001',
  openedAt: new Date('2026-08-15T09:00:00.000Z'), eventId: 'shift-event-001'
});

const outboxStoreOf = (enqueued: BusinessEventV1[]): OutboxStore => ({
  enqueue: async (events) => { enqueued.push(...events); },
  claimAvailable: async () => [],
  isClaimActive: async () => false,
  markPublished: async () => false,
  markFailed: async () => false,
  markBlocked: async () => false,
  markPaused: async () => false,
  resumeDelivery: async () => false,
  summarize: async (destinationNodeId: string) => ({
    destinationNodeId, pending: 0, paused: 0, blocked: 0,
    lastPublishedAt: null, lastError: null
  }),
  listPaused: async () => []
});

const eventStoreOf = (ledger: string[]): BusinessEventStore => ({
  append: async (events) => { ledger.push(...events.map((event) => event.eventType)); },
  findByAggregate: async () => []
});

/** Reproduce el `BEGIN IMMEDIATE -> COMMIT / ROLLBACK` de SQLite. */
const trackingUnitOfWork = (state: { rolledBack: boolean }): UnitOfWork => ({
  execute: async (work) => {
    try {
      return await work();
    } catch (error) {
      state.rolledBack = true;
      throw error;
    }
  }
});

const cashApplicationOf = (
  shift: Shift | null,
  evidence: { ledger: string[]; outbox: BusinessEventV1[]; audit: AuditEntry[] },
  shiftSaves: { count: number }
): ApplySaleCompletedToShift => {
  const shifts: ShiftRepository = {
    save: async () => { shiftSaves.count += 1; },
    findById: async () => shift,
    findOpenByCashRegisterId: async () => shift
  };
  const methods: PaymentMethodRepository = {
    findByCode: async () => cash, findAll: async () => [cash]
  };
  return new ApplySaleCompletedToShift(
    shifts, methods,
    { generate: () => 'cash-event-001' }, { generate: () => 'cash-audit-001' },
    { execute: (work) => work() } satisfies UnitOfWork,
    eventStoreOf(evidence.ledger),
    outboxStoreOf(evidence.outbox),
    { append: async (entries) => { evidence.audit.push(...entries); } } satisfies AuditWriter
  );
};

describe('CompleteSale', () => {
  it('completes exactly once for an idempotency key and books the payment in the shift', async () => {
    const repository = new FakeSaleRepository();
    const shift = openShift();
    const enqueued: BusinessEventV1[] = [];
    const ledger: string[] = [];
    const evidence = { ledger, outbox: enqueued, audit: [] as AuditEntry[] };
    const shiftSaves = { count: 0 };
    let idempotentRecord: IdempotencyRecord | null = null;
    const rollback = { rolledBack: false };
    const idempotencyStore: IdempotencyStore = {
      find: async () => idempotentRecord,
      save: async (record) => { idempotentRecord = record; }
    };
    const useCase = new CompleteSale(
      repository,
      { generate: () => 'event-004' },
      { now: () => new Date('2026-08-15T10:02:00.000Z') },
      cashApplicationOf(shift, evidence, shiftSaves),
      trackingUnitOfWork(rollback),
      eventStoreOf(ledger),
      outboxStoreOf(enqueued),
      idempotencyStore
    );

    const first = await useCase.execute({ saleId: 'sale-001' }, context);
    const second = await useCase.execute({ saleId: 'sale-001' }, context);

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(repository.saves).toBe(1);
    expect(repository.stored.status).toBe('COMPLETED');
    expect(rollback.rolledBack).toBe(false);
    expect(enqueued.map((event) => event.eventType))
      .toEqual(['SaleCompleted', 'CashMovementRegistered']);
    // El doble en memoria conserva su historia; solo `SaleCompleted` se selecciona.
    expect(ledger.slice(-2)).toEqual(['SaleCompleted', 'CashMovementRegistered']);

    // El dinero cobrado queda en el turno, disponible para retiro y arqueo.
    expect(shift.movements).toHaveLength(1);
    expect(shift.movements[0]).toMatchObject({ id: 'payment-001', type: 'SALE_PAYMENT' });
    expect(shift.balanceFor('CASH_USD', 'USD').minorUnits).toBe(1_000);
    expect(shiftSaves.count).toBe(1);
    expect(evidence.audit).toMatchObject([{
      action: 'SALE_PAYMENT_REGISTERED_IN_SHIFT', entityId: 'shift-001'
    }]);

    const conflict = await useCase.execute({ saleId: 'sale-002' }, context);
    expect(conflict).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
  });

  it('reverts the completion when the shift cannot take the payment', async () => {
    const repository = new FakeSaleRepository();
    const shift = openShift();
    shift.close({
      declaredBalances: [], closedBy: 'user-001', terminalId: 'terminal-001',
      originNodeId: 'node-001', closedAt: new Date('2026-08-15T09:30:00.000Z'),
      eventId: 'shift-event-002'
    });
    const enqueued: BusinessEventV1[] = [];
    const ledger: string[] = [];
    const shiftSaves = { count: 0 };
    const rollback = { rolledBack: false };
    const useCase = new CompleteSale(
      repository,
      { generate: () => 'event-004' },
      { now: () => new Date('2026-08-15T10:02:00.000Z') },
      cashApplicationOf(shift, { ledger, outbox: enqueued, audit: [] }, shiftSaves),
      trackingUnitOfWork(rollback),
      eventStoreOf(ledger),
      outboxStoreOf(enqueued),
      {
        find: async () => null,
        save: async () => undefined
      } satisfies IdempotencyStore
    );

    const result = await useCase.execute({ saleId: 'sale-001' }, context);

    expect(result).toMatchObject({ ok: false, error: { code: 'SHIFT_INVALID_STATE' } });
    expect(rollback.rolledBack).toBe(true);
    expect(shiftSaves.count).toBe(0);
    expect(shift.movements).toHaveLength(0);
  });

  it('reverts the completion when the shift is missing', async () => {
    const repository = new FakeSaleRepository();
    const enqueued: BusinessEventV1[] = [];
    const ledger: string[] = [];
    const rollback = { rolledBack: false };
    const useCase = new CompleteSale(
      repository,
      { generate: () => 'event-004' },
      { now: () => new Date('2026-08-15T10:02:00.000Z') },
      cashApplicationOf(null, { ledger, outbox: enqueued, audit: [] }, { count: 0 }),
      trackingUnitOfWork(rollback),
      eventStoreOf(ledger),
      outboxStoreOf(enqueued),
      { find: async () => null, save: async () => undefined } satisfies IdempotencyStore
    );

    const result = await useCase.execute({ saleId: 'sale-001' }, context);

    expect(result).toMatchObject({ ok: false, error: { code: 'SHIFT_NOT_FOUND' } });
    expect(rollback.rolledBack).toBe(true);
  });
});
