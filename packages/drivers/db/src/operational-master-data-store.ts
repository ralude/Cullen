import {
  Category, PaymentMethod, UnitOfMeasure,
  type OperationalMasterDataStore, type PaymentMethodKind
} from '@supermarket/core';
import type { DatabaseHandle } from './connection.js';
import { mapDatabaseError, requireTransaction } from './unit-of-work.js';

const read = async <T>(operation: () => T): Promise<T> => {
  try { return operation(); } catch (error) { throw mapDatabaseError(error); }
};

export class SqliteOperationalMasterDataStore implements OperationalMasterDataStore {
  constructor(private readonly handle: DatabaseHandle) {}

  findCategoryById(id: string): Promise<Category | null> {
    return read(() => {
      const row = this.handle.sqlite.prepare('select id, name, is_active as isActive from categories where id = ?').get(id) as
        { id: string; name: string; isActive: number } | undefined;
      return row ? Category.create({ ...row, isActive: row.isActive === 1 }) : null;
    });
  }
  listCategories(): Promise<readonly Category[]> {
    return read(() => (this.handle.sqlite.prepare('select id, name, is_active as isActive from categories order by name').all() as
      Array<{ id: string; name: string; isActive: number }>).map((row) => Category.create({ ...row, isActive: row.isActive === 1 })));
  }
  async saveCategory(value: Category): Promise<void> {
    requireTransaction(this.handle.sqlite);
    this.handle.sqlite.prepare(`insert into categories (id, name, is_active) values (?, ?, ?)
      on conflict(id) do update set name = excluded.name, is_active = excluded.is_active`)
      .run(value.id, value.name, value.isActive ? 1 : 0);
  }
  isCategoryInUse(id: string): Promise<boolean> {
    return read(() => Boolean(this.handle.sqlite.prepare(
      'select 1 from products where category_id = ? and is_active = 1 limit 1'
    ).get(id)));
  }

  findUnitByCode(code: string): Promise<UnitOfMeasure | null> {
    return read(() => {
      const row = this.handle.sqlite.prepare(`select id, code, name, quantity_scale as quantityScale,
        is_active as isActive from units_of_measure where code = ?`).get(code) as
        { id: string; code: string; name: string; quantityScale: number; isActive: number } | undefined;
      return row ? UnitOfMeasure.create({ ...row, isActive: row.isActive === 1 }) : null;
    });
  }
  listUnits(): Promise<readonly UnitOfMeasure[]> {
    return read(() => (this.handle.sqlite.prepare(`select id, code, name, quantity_scale as quantityScale,
      is_active as isActive from units_of_measure order by code`).all() as
      Array<{ id: string; code: string; name: string; quantityScale: number; isActive: number }>)
      .map((row) => UnitOfMeasure.create({ ...row, isActive: row.isActive === 1 })));
  }
  async saveUnit(value: UnitOfMeasure): Promise<void> {
    requireTransaction(this.handle.sqlite);
    this.handle.sqlite.prepare(`insert into units_of_measure (id, code, name, quantity_scale, is_active)
      values (?, ?, ?, ?, ?) on conflict(id) do update set code = excluded.code, name = excluded.name,
      quantity_scale = excluded.quantity_scale, is_active = excluded.is_active`)
      .run(value.id, value.code, value.name, value.quantityScale, value.isActive ? 1 : 0);
  }
  isUnitInUse(id: string): Promise<boolean> {
    return read(() => Boolean(this.handle.sqlite.prepare(
      'select 1 from products where unit_id = ? and is_active = 1 limit 1'
    ).get(id)));
  }
  hasUnitHistory(id: string): Promise<boolean> {
    return read(() => Boolean(this.handle.sqlite.prepare('select 1 from products where unit_id = ? limit 1').get(id)));
  }

  findPaymentMethodByCode(code: string): Promise<PaymentMethod | null> {
    return read(() => {
      const row = this.handle.sqlite.prepare(`select code, name, kind, currency_code as currencyCode,
        is_active as isActive from payment_methods where code = ?`).get(code) as
        { code: string; name: string; kind: PaymentMethodKind; currencyCode: string; isActive: number } | undefined;
      return row ? PaymentMethod.create({ ...row, isActive: row.isActive === 1 }) : null;
    });
  }
  listPaymentMethods(): Promise<readonly PaymentMethod[]> {
    return read(() => (this.handle.sqlite.prepare(`select code, name, kind, currency_code as currencyCode,
      is_active as isActive from payment_methods order by code`).all() as
      Array<{ code: string; name: string; kind: PaymentMethodKind; currencyCode: string; isActive: number }>)
      .map((row) => PaymentMethod.create({ ...row, isActive: row.isActive === 1 })));
  }
  async savePaymentMethod(value: PaymentMethod): Promise<void> {
    requireTransaction(this.handle.sqlite);
    this.handle.sqlite.prepare(`insert into payment_methods (code, name, kind, currency_code, is_active)
      values (?, ?, ?, ?, ?) on conflict(code) do update set name = excluded.name, kind = excluded.kind,
      currency_code = excluded.currency_code, is_active = excluded.is_active`)
      .run(value.code, value.name, value.kind, value.currencyCode, value.isActive ? 1 : 0);
  }
  isPaymentMethodInUse(code: string): Promise<boolean> {
    return read(() => Boolean(this.handle.sqlite.prepare(`
      select 1 from sale_payments p join sales s on s.id = p.sale_id
      where p.payment_method_code = ? and s.status = 'DRAFT'
      union all
      select 1 from cash_movements m join shifts sh on sh.id = m.shift_id
      where m.payment_method_code = ? and sh.status = 'OPEN'
      limit 1
    `).get(code, code)));
  }
}
