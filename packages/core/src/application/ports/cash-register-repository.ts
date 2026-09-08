import type { CashRegister } from '../../domain/cash/index.js';

export interface CashRegisterRepository {
  findById(cashRegisterId: string): Promise<CashRegister | null>;
  findAll(): Promise<readonly CashRegister[]>;
  /**
   * Alta de la caja de esta terminal. Una caja no se borra ni cambia de dueño:
   * su terminal y su nodo quedan fijados al crearla.
   */
  save(cashRegister: CashRegister): Promise<void>;
}
