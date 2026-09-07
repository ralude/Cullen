import { describe, expect, it } from 'vitest';
import { CashRegister, Shift } from '../../domain/cash/index.js';
import { PaymentMethod } from '../../domain/currency/index.js';
import type { BusinessEventV1 } from '../events/index.js';
import type {
  AuditEntry, AuditWriter, BusinessEventStore, OutboxStore,
  PaymentMethodRepository, ShiftRepository, UnitOfWork
} from '../ports/index.js';
import { ApplySaleCompletedToShift } from './apply-sale-completed-to-shift.js';

const card = PaymentMethod.create({
  code: 'CARD_USD', name: 'Card USD', kind: 'CARD', currencyCode: 'USD'
});

const saleCompleted = (amountMinorUnits = 2_500): BusinessEventV1 => ({
  eventId: 'sale-event-001', eventType: 'SaleCompleted', contractVersion: 1,
  aggregateId: 'sale-001', aggregateType: 'Sale', aggregateVersion: 5,
  originNodeId: 'node-001', correlationId: 'correlation-001', actorId: 'user-001',
  occurredAt: new Date('2026-08-16T09:00:00.000Z'),
  payload: {
    shiftId: 'shift-001', terminalId: 'terminal-001',
    total: { minorUnits: amountMinorUnits, currencyCode: 'USD' },
    paidTotal: { minorUnits: amountMinorUnits, currencyCode: 'USD' },
    payments: [{
      paymentId: 'payment-001', methodCode: 'CARD_USD',
      currencyCode: 'USD', amountMinorUnits
    }]
  }
});

describe('ApplySaleCompletedToShift', () => {
  it('registers each payment exactly once without reading sale tables', async () => {
    const shift = Shift.open({
      id: 'shift-001', cashRegister: CashRegister.create({
        id: 'register-001', name: 'Main', terminalId: 'terminal-001', originNodeId: 'node-001'
      }), openingFunds: [], openedBy: 'user-001',
      openedAt: new Date('2026-08-16T08:00:00.000Z'), eventId: 'shift-event-001'
    });
    let saves = 0;
    const shifts: ShiftRepository = {
      save: async () => { saves += 1; }, findById: async () => shift,
      findOpenByCashRegisterId: async () => shift
    };
    const methods: PaymentMethodRepository = { findByCode: async () => card, findAll: async () => [card] };
    const evidence = { ledger: [] as string[], outbox: [] as string[], audit: [] as AuditEntry[] };
    const service = new ApplySaleCompletedToShift(
      shifts, methods,
      { generate: () => 'cash-event-001' }, { generate: () => 'audit-001' },
      { execute: async (work) => work() } satisfies UnitOfWork,
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
      { append: async (entries) => { evidence.audit.push(...entries); } } satisfies AuditWriter
    );

    expect((await service.execute(saleCompleted())).ok).toBe(true);
    expect((await service.execute(saleCompleted())).ok).toBe(true);
    expect(shift.balanceFor('CARD_USD', 'USD').minorUnits).toBe(2_500);
    expect(shift.movements).toHaveLength(1);
    expect(saves).toBe(1);
    expect(evidence.ledger).toEqual(['CashMovementRegistered']);
    expect(evidence.outbox).toEqual(['CashMovementRegistered']);
    expect(evidence.audit).toMatchObject([{
      action: 'SALE_PAYMENT_REGISTERED_IN_SHIFT', entityId: 'shift-001'
    }]);

    const conflict = await service.execute(saleCompleted(2_501));
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe('CASH_SALE_PAYMENT_CONFLICT');
  });
});
