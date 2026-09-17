/**
 * Persistencia de caja: la caja registradora y el turno con sus movimientos y
 * saldos de cierre.
 */
import {
  CashMovement,
  CashRegister,
  PaymentMethod,
  Shift,
  type CashRegisterRepository,
  type PaymentMethodKind,
  type ShiftRepository
} from '@supermarket/core';
import { InfrastructureError, Money } from '@supermarket/shared';
import { and, eq } from 'drizzle-orm';
import type { DatabaseHandle } from './connection.js';
import { cashMovements, cashRegisters, shiftClosingBalances, shifts } from './schema.js';
import { read, requireTransaction } from './unit-of-work.js';

export class DrizzleCashRegisterRepository implements CashRegisterRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(register: CashRegister): Promise<void> {
    requireTransaction(this.handle.sqlite);
    this.handle.db.insert(cashRegisters).values(register).onConflictDoUpdate({
      target: cashRegisters.id,
      set: {
        name: register.name,
        terminalId: register.terminalId,
        originNodeId: register.originNodeId,
        isActive: register.isActive
      }
    }).run();
  }

  findById(id: string): Promise<CashRegister | null> {
    return read(() => {
      const row = this.handle.db.select().from(cashRegisters)
        .where(eq(cashRegisters.id, id)).get();
      return row ? CashRegister.create(row) : null;
    });
  }

  findAll(): Promise<readonly CashRegister[]> {
    return read(() => this.handle.db.select().from(cashRegisters).all().map((row) => CashRegister.create(row)));
  }
}

export class DrizzleShiftRepository implements ShiftRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(shift: Shift): Promise<void> {
    requireTransaction(this.handle.sqlite);
    const existing = this.handle.db.select({ status: shifts.status, version: shifts.version })
      .from(shifts).where(eq(shifts.id, shift.id)).get();
    if (existing?.status === 'CLOSED') {
      throw new InfrastructureError(
        'SHIFT_FINAL_STATE_IMMUTABLE',
        'A closed shift cannot be overwritten.'
      );
    }
    /**
     * El guardado exige avanzar, no avanzar exactamente uno: un cobro mixto
     * asienta un movimiento por método y sube el turno tantas versiones como
     * pagos tenga el lote. Exigir un solo incremento rechazaba esa venta con
     * el cobro ya registrado, que es lo peor que puede pasarle a una caja.
     */
    if (existing && shift.version <= existing.version) {
      throw new InfrastructureError('DATABASE_CONCURRENCY_CONFLICT', 'Shift version is stale.');
    }
    if (!existing && shift.version !== 1) {
      throw new InfrastructureError('DATABASE_CONCURRENCY_CONFLICT', 'New shift version must be one.');
    }
    this.handle.db.insert(shifts).values({
      id: shift.id,
      cashRegisterId: shift.cashRegisterId,
      terminalId: shift.terminalId,
      originNodeId: shift.originNodeId,
      openedBy: shift.openedBy,
      openedAt: shift.openedAt.getTime(),
      status: shift.status,
      version: shift.version,
      closedAt: shift.closedAt?.getTime() ?? null,
      closedBy: shift.closedBy
    }).onConflictDoUpdate({
      target: shifts.id,
      set: {
        status: shift.status,
        version: shift.version,
        closedAt: shift.closedAt?.getTime() ?? null,
        closedBy: shift.closedBy
      }
    }).run();
    const persistedMovementIds = new Set(this.handle.db.select({ id: cashMovements.id })
      .from(cashMovements).where(eq(cashMovements.shiftId, shift.id)).all().map(({ id }) => id));
    const newMovements = shift.movements.filter((movement) => !persistedMovementIds.has(movement.id));
    if (newMovements.length > 0) {
      this.handle.db.insert(cashMovements).values(newMovements.map((movement) => ({
        id: movement.id,
        shiftId: shift.id,
        type: movement.type,
        paymentMethodCode: movement.method.code,
        paymentMethodName: movement.method.name,
        paymentMethodKind: movement.method.kind,
        amountMinorUnits: movement.amount.minorUnits,
        currencyCode: movement.amount.currency,
        reason: movement.reason,
        registeredBy: movement.registeredBy,
        registeredAt: movement.registeredAt.getTime(),
        sourceId: movement.reference?.sourceId ?? null,
        sourceEventId: movement.reference?.sourceEventId ?? null
      }))).run();
    }
    if (shift.closingBalances && shift.closingBalances.length > 0) {
      this.handle.db.insert(shiftClosingBalances).values(shift.closingBalances.map((balance) => ({
        shiftId: shift.id,
        paymentMethodCode: balance.paymentMethodCode,
        currencyCode: balance.expected.currency,
        expectedMinorUnits: balance.expected.minorUnits,
        declaredMinorUnits: balance.declared.minorUnits,
        differenceMinorUnits: balance.difference.minorUnits
      }))).run();
    }
  }

  findById(id: string): Promise<Shift | null> {
    return read(() => this.restore(this.handle.db.select().from(shifts)
      .where(eq(shifts.id, id)).get()));
  }

  findOpenByCashRegisterId(id: string): Promise<Shift | null> {
    return read(() => this.restore(this.handle.db.select().from(shifts).where(and(
      eq(shifts.cashRegisterId, id), eq(shifts.status, 'OPEN')
    )).get()));
  }

  private restore(row: typeof shifts.$inferSelect | undefined): Shift | null {
    if (!row) return null;
    const movementRows = this.handle.db.select().from(cashMovements)
      .where(eq(cashMovements.shiftId, row.id)).orderBy(cashMovements.registeredAt).all();
    const balanceRows = this.handle.db.select().from(shiftClosingBalances)
      .where(eq(shiftClosingBalances.shiftId, row.id)).all();
    return Shift.restore({
      id: row.id,
      cashRegisterId: row.cashRegisterId,
      terminalId: row.terminalId,
      originNodeId: row.originNodeId,
      openedBy: row.openedBy,
      openedAt: new Date(row.openedAt),
      movements: movementRows.map((movement) => CashMovement.create({
        id: movement.id,
        type: movement.type as Parameters<typeof CashMovement.create>[0]['type'],
        method: PaymentMethod.create({
          code: movement.paymentMethodCode,
          name: movement.paymentMethodName,
          kind: movement.paymentMethodKind as PaymentMethodKind,
          currencyCode: movement.currencyCode
        }),
        amount: Money.fromMinorUnits(movement.amountMinorUnits, movement.currencyCode),
        reason: movement.reason,
        registeredBy: movement.registeredBy,
        registeredAt: new Date(movement.registeredAt),
        ...(movement.sourceId === null || movement.sourceEventId === null
          ? {}
          : { reference: { sourceId: movement.sourceId, sourceEventId: movement.sourceEventId } })
      })),
      status: row.status as Parameters<typeof Shift.restore>[0]['status'],
      version: row.version,
      closingBalances: balanceRows.length === 0 ? null : balanceRows.map((balance) => ({
        paymentMethodCode: balance.paymentMethodCode,
        expected: Money.fromMinorUnits(balance.expectedMinorUnits, balance.currencyCode),
        declared: Money.fromMinorUnits(balance.declaredMinorUnits, balance.currencyCode),
        difference: Money.fromMinorUnits(balance.differenceMinorUnits, balance.currencyCode)
      })),
      closedAt: row.closedAt === null ? null : new Date(row.closedAt),
      closedBy: row.closedBy
    });
  }
}
