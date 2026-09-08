import { describe, expect, it } from 'vitest';
import { CashRegister } from '../../domain/cash/index.js';
import type { CashRegisterRepository } from '../ports/index.js';
import { ListCashRegisters } from './list-cash-registers.js';

class FakeCashRegisterRepository implements CashRegisterRepository {
  constructor(private readonly registers: readonly CashRegister[]) {}

  async findById(cashRegisterId: string): Promise<CashRegister | null> {
    return this.registers.find((register) => register.id === cashRegisterId) ?? null;
  }

  async save(): Promise<void> { /* la lectura no persiste */ }

  async findAll(): Promise<readonly CashRegister[]> {
    return this.registers;
  }
}

describe('ListCashRegisters', () => {
  it('lists only active registers', async () => {
    const active = CashRegister.create({
      id: 'register-001', name: 'Caja 1', terminalId: 'terminal-001', originNodeId: 'node-001'
    });
    const inactive = CashRegister.create({
      id: 'register-002', name: 'Caja 2', terminalId: 'terminal-001', originNodeId: 'node-001',
      isActive: false
    });
    const useCase = new ListCashRegisters(new FakeCashRegisterRepository([active, inactive]));

    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([{ id: 'register-001', name: 'Caja 1' }]);
  });
});
