import { CostSnapshot, type SaleCostSnapshotProvider } from '@supermarket/core';
import { Money } from '@supermarket/shared';
import type { DatabaseHandle } from './connection.js';
import { mapDatabaseError } from './unit-of-work.js';

/**
 * Costo conocido por este nodo al vender.
 *
 * Prefiere la disponibilidad que publicó el coordinador, que es la autoridad
 * del stock en LAN; si no hay ninguna proyectada —el caso standalone— usa el
 * promedio ponderado del propio inventario, con este nodo como procedencia.
 *
 * Sin ninguno de los dos devuelve `null`: costo **desconocido**, que es lo que
 * el nodo realmente sabe. Nunca devuelve cero como sustituto.
 */
export class SqliteSaleCostSnapshotProvider implements SaleCostSnapshotProvider {
  constructor(
    private readonly handle: DatabaseHandle,
    private readonly localNodeId: string
  ) {}

  async findByProductId(productId: string): Promise<CostSnapshot | null> {
    try {
      const projected = this.handle.sqlite.prepare(`
        select cost_unit_minor_units as minorUnits, cost_currency_code as currencyCode,
          version, published_by as publishedBy, published_at as publishedAt
        from stock_availability_reference where product_id = ?
      `).get(productId) as {
        minorUnits: number | null; currencyCode: string | null;
        version: number; publishedBy: string; publishedAt: number;
      } | undefined;
      if (projected !== undefined) {
        if (projected.minorUnits === null || projected.currencyCode === null) return null;
        return CostSnapshot.create({
          unitCost: Money.fromMinorUnits(projected.minorUnits, projected.currencyCode),
          version: projected.version,
          source: projected.publishedBy,
          observedAt: new Date(projected.publishedAt)
        });
      }

      const local = this.handle.sqlite.prepare(`
        select i.valuation_currency_code as currencyCode,
          coalesce(sum(case when m.direction = 'IN' then m.quantity_scaled
            else -m.quantity_scaled end), 0) as balanceScaled,
          sum(case when m.unit_cost_minor_units is null then null
            when m.direction = 'IN' then m.unit_cost_minor_units * m.quantity_scaled
            else -m.unit_cost_minor_units * m.quantity_scaled end) as valueScaled,
          count(m.id) + 1 as version,
          max(m.occurred_at) as observedAt
        from stock_items i
        left join stock_movements m on m.stock_item_id = i.id
        where i.product_id = ?
        group by i.id
      `).get(productId) as {
        currencyCode: string | null; balanceScaled: number;
        valueScaled: number | null; version: number; observedAt: number | null;
      } | undefined;
      if (local === undefined || local.currencyCode === null || local.valueScaled === null ||
        local.balanceScaled <= 0 || local.observedAt === null) {
        return null;
      }
      return CostSnapshot.create({
        unitCost: Money.fromMinorUnits(
          Math.round(local.valueScaled / local.balanceScaled),
          local.currencyCode
        ),
        version: local.version,
        source: this.localNodeId,
        observedAt: new Date(local.observedAt)
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
