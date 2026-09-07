import { describe, expect, it } from 'vitest';
import {
  application,
  CashRegister,
  PaymentMethod,
  type AuditWriter,
  type BusinessEventV1
} from '@supermarket/core';
import { InfrastructureError } from '@supermarket/shared';
import { DrizzleAuditWriter } from './audit-writer.js';
import { DrizzleBusinessEventStore } from './business-event-store.js';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleOutboxStore } from './outbox-store.js';
import {
  DrizzleCashRegisterRepository,
  DrizzlePaymentMethodRepository,
  DrizzleShiftRepository
} from './repositories.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

const context = {
  actorId: 'user-001', actorRoleCodes: ['cashier'], terminalId: 'terminal-001',
  originNodeId: 'node-001', correlationId: 'correlation-001'
};

const saleCompleted: BusinessEventV1 = {
  eventId: 'sale-event-001', eventType: 'SaleCompleted', contractVersion: 1,
  aggregateId: 'sale-001', aggregateType: 'Sale', aggregateVersion: 5,
  originNodeId: 'node-001', correlationId: 'correlation-sale-001', actorId: 'user-001',
  occurredAt: new Date('2026-08-29T10:00:00Z'),
  payload: {
    shiftId: 'shift-001', terminalId: 'terminal-001',
    total: { minorUnits: 2_500, currencyCode: 'USD' },
    paidTotal: { minorUnits: 2_500, currencyCode: 'USD' },
    payments: [{
      paymentId: 'payment-001', methodCode: 'CARD_USD',
      currencyCode: 'USD', amountMinorUnits: 2_500
    }]
  }
};

describe('complete persisted cash flow', () => {
  it('opens, moves cash, consumes a sale once, rolls back failure and closes with audit', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const registers = new DrizzleCashRegisterRepository(handle);
    const methods = new DrizzlePaymentMethodRepository(handle);
    const shifts = new DrizzleShiftRepository(handle);
    const ledger = new DrizzleBusinessEventStore(handle);
    const outbox = new DrizzleOutboxStore(handle);
    const audit = new DrizzleAuditWriter(handle);
    await unitOfWork.execute(async () => {
      await registers.save(CashRegister.create({
        id: 'register-001', name: 'Main', terminalId: 'terminal-001', originNodeId: 'node-001'
      }));
      await methods.save(PaymentMethod.create({
        code: 'CASH_USD', name: 'Cash USD', kind: 'CASH', currencyCode: 'USD'
      }));
      await methods.save(PaymentMethod.create({
        code: 'CARD_USD', name: 'Card USD', kind: 'CARD', currencyCode: 'USD'
      }));
    });

    const open = new application.OpenShift(
      registers, shifts, methods, { authorize: async () => true },
      { generate: () => 'shift-001' }, { generate: () => 'opening-001' },
      { generate: () => 'shift-event-001' }, { now: () => new Date('2026-08-29T08:00:00Z') },
      unitOfWork, ledger, outbox, audit, { generate: () => 'audit-open' }
    );
    expect((await open.execute({
      cashRegisterId: 'register-001',
      openingFunds: [{ paymentMethodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: 10_000 }]
    }, context)).ok).toBe(true);

    const income = new application.RegisterCashMovement(
      shifts, methods, { authorize: async () => true },
      { generate: () => 'income-001' }, { generate: () => 'shift-event-002' },
      { now: () => new Date('2026-08-29T09:00:00Z') },
      unitOfWork, ledger, outbox, audit, { generate: () => 'audit-income' }
    );
    expect((await income.execute({
      shiftId: 'shift-001', type: 'INCOME', paymentMethodCode: 'CASH_USD',
      currencyCode: 'USD', amountMinorUnits: 2_500, reason: 'Additional change'
    }, context)).ok).toBe(true);

    const failingAudit: AuditWriter = { append: async () => {
      throw new InfrastructureError('DATABASE_OPERATION_FAILED', 'Injected audit failure.');
    } };
    const failedMovement = new application.RegisterCashMovement(
      shifts, methods, { authorize: async () => true },
      { generate: () => 'failed-001' }, { generate: () => 'failed-event-001' },
      { now: () => new Date('2026-08-29T09:30:00Z') },
      unitOfWork, ledger, outbox, failingAudit, { generate: () => 'failed-audit-001' }
    );
    await expect(failedMovement.execute({
      shiftId: 'shift-001', type: 'INCOME', paymentMethodCode: 'CASH_USD',
      currencyCode: 'USD', amountMinorUnits: 100, reason: 'Must roll back'
    }, context)).rejects.toMatchObject({ code: 'DATABASE_OPERATION_FAILED' });
    expect((await shifts.findById('shift-001'))?.balanceFor('CASH_USD', 'USD').minorUnits)
      .toBe(12_500);

    const sale = new application.ApplySaleCompletedToShift(
      shifts, methods, { generate: () => 'shift-event-003' }, { generate: () => 'audit-sale' },
      unitOfWork, ledger, outbox, audit
    );
    expect((await sale.execute(saleCompleted)).ok).toBe(true);
    expect((await sale.execute(saleCompleted)).ok).toBe(true);

    const withdrawal = new application.RegisterCashMovement(
      shifts, methods, { authorize: async () => true },
      { generate: () => 'withdrawal-001' }, { generate: () => 'shift-event-004' },
      { now: () => new Date('2026-08-29T11:00:00Z') },
      unitOfWork, ledger, outbox, audit, { generate: () => 'audit-withdrawal' }
    );
    expect((await withdrawal.execute({
      shiftId: 'shift-001', type: 'WITHDRAWAL', paymentMethodCode: 'CASH_USD',
      currencyCode: 'USD', amountMinorUnits: 1_000, reason: 'Cash pickup'
    }, context)).ok).toBe(true);

    const close = new application.CloseShift(
      shifts, methods, { authorize: async () => true },
      { generate: () => 'shift-event-005' }, { now: () => new Date('2026-08-29T12:00:00Z') },
      unitOfWork, ledger, outbox, audit, { generate: () => 'audit-close' },
      { countOpenByShiftId: async () => 0 }
    );
    expect((await close.execute({
      shiftId: 'shift-001',
      declaredBalances: [
        { paymentMethodCode: 'CARD_USD', currencyCode: 'USD', amountMinorUnits: 2_500 },
        { paymentMethodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: 11_500 }
      ]
    }, context)).ok).toBe(true);

    const closed = await shifts.findById('shift-001');
    expect(closed?.status).toBe('CLOSED');
    expect(closed?.closingBalances?.map((balance) => balance.difference.minorUnits)).toEqual([0, 0]);
    expect(handle.sqlite.prepare('select event_type from business_event order by occurred_at')
      .pluck().all()).toEqual([
        'ShiftOpened', 'CashMovementRegistered', 'CashMovementRegistered',
        'CashMovementRegistered', 'ShiftClosed'
      ]);
    expect(handle.sqlite.prepare('select event_type from outbox_event order by occurred_at')
      .pluck().all()).toEqual([
        'ShiftOpened', 'CashMovementRegistered', 'CashMovementRegistered',
        'CashMovementRegistered', 'ShiftClosed'
      ]);
    expect(handle.sqlite.prepare('select action from audit_log order by occurred_at')
      .pluck().all()).toEqual([
        'SHIFT_OPENED', 'CASH_INCOME_REGISTERED', 'SALE_PAYMENT_REGISTERED_IN_SHIFT',
        'CASH_WITHDRAWAL_REGISTERED', 'SHIFT_CLOSED'
      ]);
    expect(handle.sqlite.prepare('select source_event_id from cash_movements where id = ?')
      .pluck().get('payment-001')).toBe('sale-event-001');
    handle.close();
  });
});
