import { describe, expect, it } from 'vitest';
import {
  application,
  CashRegister,
  PaymentMethod,
  type AuditWriter
} from '@supermarket/core';
import { InfrastructureError } from '@supermarket/shared';
import { DrizzleAuditWriter } from './audit-writer.js';
import { DrizzleBusinessEventStore } from './business-event-store.js';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleOutboxStore } from './outbox-store.js';
import { DrizzleCashRegisterRepository, DrizzleShiftRepository } from './cash-repositories.js';
import { DrizzlePaymentMethodRepository } from './currency-repositories.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

const context = {
  actorId: 'user-001', actorRoleCodes: ['cashier'], terminalId: 'terminal-001',
  originNodeId: 'node-001', correlationId: 'correlation-001'
};

describe('cash shift opening transaction', () => {
  it('commits the open shift, ledger, outbox and audit together', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const registers = new DrizzleCashRegisterRepository(handle);
    const methods = new DrizzlePaymentMethodRepository(handle);
    const shifts = new DrizzleShiftRepository(handle);
    await unitOfWork.execute(async () => {
      await registers.save(CashRegister.create({
        id: 'register-001', name: 'Main', terminalId: 'terminal-001', originNodeId: 'node-001'
      }));
      await methods.save(PaymentMethod.create({
        code: 'CASH_USD', name: 'Cash USD', kind: 'CASH', currencyCode: 'USD'
      }));
    });

    const useCase = new application.OpenShift(
      registers, shifts, methods, { authorize: async () => true },
      { generate: () => 'shift-001' }, { generate: () => 'movement-001' },
      { generate: () => 'event-001' }, { now: () => new Date('2026-08-29T08:00:00Z') },
      unitOfWork, new DrizzleBusinessEventStore(handle), new DrizzleOutboxStore(handle),
      new DrizzleAuditWriter(handle), { generate: () => 'audit-001' }
    );

    expect((await useCase.execute({
      cashRegisterId: 'register-001',
      openingFunds: [{ paymentMethodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: 10_000 }]
    }, context)).ok).toBe(true);
    expect((await shifts.findById('shift-001'))?.balanceFor('CASH_USD', 'USD').minorUnits).toBe(10_000);
    expect(handle.sqlite.prepare('select event_type from business_event').pluck().all()).toEqual(['ShiftOpened']);
    expect(handle.sqlite.prepare('select event_type from outbox_event').pluck().all()).toEqual(['ShiftOpened']);
    expect(handle.sqlite.prepare('select action from audit_log').pluck().all()).toEqual(['SHIFT_OPENED']);

    const movement = new application.RegisterCashMovement(
      shifts, methods, { authorize: async () => true },
      { generate: () => 'movement-002' }, { generate: () => 'event-002' },
      { now: () => new Date('2026-08-29T09:00:00Z') }, unitOfWork,
      new DrizzleBusinessEventStore(handle), new DrizzleOutboxStore(handle),
      new DrizzleAuditWriter(handle), { generate: () => 'audit-002' }
    );
    expect((await movement.execute({
      shiftId: 'shift-001', type: 'INCOME', paymentMethodCode: 'CASH_USD',
      currencyCode: 'USD', amountMinorUnits: 2_500, reason: 'Additional change'
    }, context)).ok).toBe(true);
    expect((await shifts.findById('shift-001'))?.balanceFor('CASH_USD', 'USD').minorUnits).toBe(12_500);
    expect(handle.sqlite.prepare('select event_type from business_event order by aggregate_version')
      .pluck().all()).toEqual(['ShiftOpened', 'CashMovementRegistered']);
    expect(handle.sqlite.prepare('select action from audit_log order by occurred_at')
      .pluck().all()).toEqual(['SHIFT_OPENED', 'CASH_INCOME_REGISTERED']);
    expect(() => handle.sqlite.prepare('delete from cash_movements where id = ?').run('movement-002'))
      .toThrow('cash_movements is append-only');
    handle.close();
  });

  it('rolls the whole opening back when audit persistence fails', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const registers = new DrizzleCashRegisterRepository(handle);
    const methods = new DrizzlePaymentMethodRepository(handle);
    const shifts = new DrizzleShiftRepository(handle);
    await unitOfWork.execute(async () => {
      await registers.save(CashRegister.create({
        id: 'register-001', name: 'Main', terminalId: 'terminal-001', originNodeId: 'node-001'
      }));
    });
    const failingAudit: AuditWriter = { append: async () => {
      throw new InfrastructureError('DATABASE_OPERATION_FAILED', 'Injected failure.');
    } };
    const useCase = new application.OpenShift(
      registers, shifts, methods, { authorize: async () => true },
      { generate: () => 'shift-001' }, { generate: () => 'movement-001' },
      { generate: () => 'event-001' }, { now: () => new Date('2026-08-29T08:00:00Z') },
      unitOfWork, new DrizzleBusinessEventStore(handle), new DrizzleOutboxStore(handle),
      failingAudit, { generate: () => 'audit-001' }
    );

    await expect(useCase.execute({ cashRegisterId: 'register-001', openingFunds: [] }, context))
      .rejects.toMatchObject({ code: 'DATABASE_OPERATION_FAILED' });
    expect(await shifts.findById('shift-001')).toBeNull();
    expect(handle.sqlite.prepare('select count(*) from business_event').pluck().get()).toBe(0);
    expect(handle.sqlite.prepare('select count(*) from outbox_event').pluck().get()).toBe(0);
    handle.close();
  });
});
