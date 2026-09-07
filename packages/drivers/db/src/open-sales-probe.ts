import type { OpenSalesProbe } from '@supermarket/core';
import type { DatabaseHandle } from './connection.js';
import { mapDatabaseError } from './unit-of-work.js';

/**
 * Cuenta las ventas que el turno todavía conserva sin cerrar. `DRAFT` es el
 * único estado abierto: una venta completada ya asentó su cobro y una anulada
 * no dejará ninguno.
 *
 * Es una consulta de precondición para el arqueo y no participa del cálculo de
 * saldos; caja sigue derivando su esperado únicamente de sus movimientos.
 */
export class SqliteOpenSalesProbe implements OpenSalesProbe {
  constructor(private readonly handle: DatabaseHandle) {}

  async countOpenByShiftId(shiftId: string): Promise<number> {
    try {
      return this.handle.sqlite.prepare(
        "select count(*) from sales where shift_id = ? and status = 'DRAFT'"
      ).pluck().get(shiftId) as number;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
