import { describe, expect, it } from 'vitest';
import { CashRegister, Shift } from '../../domain/cash/index.js';
import { Sale } from '../../domain/sales/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type { SaleRepository, ShiftRepository } from '../ports/index.js';
import { StartSale } from './start-sale.js';

class FakeSaleRepository implements SaleRepository {
  sale: Sale | null = null;

  async save(sale: Sale): Promise<void> {
    this.sale = sale;
  }

  async findById(): Promise<Sale | null> {
    return this.sale;
  }
}

const context: ExecutionContext = {
  actorId: 'user-001',
  terminalId: 'terminal-001',
  originNodeId: 'node-001',
  correlationId: 'correlation-001'
};

describe('StartSale', () => {
  it('starts a draft sale owned by the execution terminal', async () => {
    const repository = new FakeSaleRepository();
    const shift = Shift.open({
      id: 'shift-001', cashRegister: CashRegister.create({
        id: 'register-001', name: 'Main', terminalId: 'terminal-001', originNodeId: 'node-001'
      }), openingFunds: [], openedBy: 'user-001',
      openedAt: new Date('2026-08-15T09:00:00.000Z'), eventId: 'shift-event-001'
    });
    const shifts: ShiftRepository = {
      save: async () => undefined,
      findById: async (id) => id === shift.id ? shift : null,
      findOpenByCashRegisterId: async () => shift
    };
    const useCase = new StartSale(
      { generate: () => 'sale-001' },
      { generate: () => 'event-001' },
      repository,
      { now: () => new Date('2026-08-15T10:00:00.000Z') },
      shifts,
      { execute: async (work) => work() }
    );

    const result = await useCase.execute({ currencyCode: 'USD', shiftId: 'shift-001' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe('sale-001');
    expect(result.value.status).toBe('DRAFT');
    expect(repository.sale?.terminalId).toBe('terminal-001');
    expect(repository.sale?.shiftId).toBe('shift-001');
  });

  /** ADR-0033: sin exponente conocido no hay forma de leer ni convertir sus importes. */
  it('refuses a sale in a currency outside the registry', async () => {
    const repository = new FakeSaleRepository();
    const shift = Shift.open({
      id: 'shift-001', cashRegister: CashRegister.create({
        id: 'register-001', name: 'Main', terminalId: 'terminal-001', originNodeId: 'node-001'
      }), openingFunds: [], openedBy: 'user-001',
      openedAt: new Date('2026-08-15T09:00:00.000Z'), eventId: 'shift-event-001'
    });
    const useCase = new StartSale(
      { generate: () => 'sale-001' }, { generate: () => 'event-001' }, repository,
      { now: () => new Date('2026-08-15T10:00:00.000Z') },
      { save: async () => undefined, findById: async () => shift, findOpenByCashRegisterId: async () => shift },
      { execute: async (work) => work() }
    );

    const result = await useCase.execute({ currencyCode: 'BRL', shiftId: 'shift-001' }, context);

    expect(result).toMatchObject({ ok: false, error: { code: 'CURRENCY_UNSUPPORTED' } });
    expect(repository.sale).toBeNull();
  });
});
