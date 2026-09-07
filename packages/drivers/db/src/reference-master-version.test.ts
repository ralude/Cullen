import { describe, expect, it } from 'vitest';
import { Category, ExchangeRate, PaymentMethod, UnitOfMeasure } from '@supermarket/core';
import { openDatabase } from './connection.js';
import { applyMigrations, migrations } from './migrations.js';
import { SqliteOperationalMasterDataStore } from './operational-master-data-store.js';
import {
  DrizzleCategoryRepository,
  DrizzleExchangeRateRepository,
  DrizzlePaymentMethodRepository,
  DrizzleUnitOfMeasureRepository
} from './repositories.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

const category = (name: string): Category =>
  Category.create({ id: 'category-001', name });

const unit = (name: string): UnitOfMeasure =>
  UnitOfMeasure.create({ id: 'unit-001', code: 'KG', name, quantityScale: 3 });

const paymentMethod = (name: string): PaymentMethod => PaymentMethod.create({
  code: 'CASH_USD', name, kind: 'CASH', currencyCode: 'USD'
});

describe('versión monotónica de los maestros distribuidos', () => {
  it('arranca en uno y avanza en cada guardado del maestro', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const store = new SqliteOperationalMasterDataStore(handle);

    const first = await unitOfWork.execute(() => store.saveCategory(category('Granos')));
    const second = await unitOfWork.execute(() => store.saveCategory(category('Granos y cereales')));
    const unitFirst = await unitOfWork.execute(() => store.saveUnit(unit('Kilogramo')));
    const unitSecond = await unitOfWork.execute(() => store.saveUnit(unit('Kilo')));
    const paymentFirst = await unitOfWork.execute(() =>
      store.savePaymentMethod(paymentMethod('Efectivo USD')));
    const paymentSecond = await unitOfWork.execute(() =>
      store.savePaymentMethod(paymentMethod('Dólares en efectivo')));

    expect([first, second, unitFirst, unitSecond, paymentFirst, paymentSecond])
      .toEqual([1, 2, 1, 2, 1, 2]);
    expect(handle.sqlite.prepare('select name, version from categories').get())
      .toEqual({ name: 'Granos y cereales', version: 2 });
    expect(handle.sqlite.prepare('select name, version from units_of_measure').get())
      .toEqual({ name: 'Kilo', version: 2 });
    expect(handle.sqlite.prepare('select name, version from payment_methods').get())
      .toEqual({ name: 'Dólares en efectivo', version: 2 });
    handle.close();
  });

  it('comparte la versión entre las dos rutas de escritura del maestro', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const store = new SqliteOperationalMasterDataStore(handle);
    const repository = new DrizzleCategoryRepository(handle);
    const units = new DrizzleUnitOfMeasureRepository(handle);
    const payments = new DrizzlePaymentMethodRepository(handle);

    await unitOfWork.execute(() => repository.save(category('Granos')));
    const afterStore = await unitOfWork.execute(() => store.saveCategory(category('Cereales')));
    await unitOfWork.execute(() => units.save(unit('Kilogramo')));
    const afterUnitStore = await unitOfWork.execute(() => store.saveUnit(unit('Kilo')));
    await unitOfWork.execute(() => payments.save(paymentMethod('Efectivo USD')));
    const afterPaymentStore = await unitOfWork.execute(() =>
      store.savePaymentMethod(paymentMethod('Dólares en efectivo')));

    expect([afterStore, afterUnitStore, afterPaymentStore]).toEqual([2, 2, 2]);
    handle.close();
  });

  it('asigna secuencias independientes a cada par de tasas confirmadas', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const rates = new DrizzleExchangeRateRepository(handle);
    const rate = (id: string, baseCurrency: string, quoteCurrency: string): ExchangeRate =>
      ExchangeRate.create({
        id, baseCurrency, quoteCurrency, rateValue: 36_500, rateScale: 3,
        source: 'BCV', validFrom: new Date('2026-09-06T00:00:00.000Z'),
        registeredBy: 'operator-001'
      });

    const first = await unitOfWork.execute(() => rates.save(rate('rate-1', 'USD', 'VES')));
    const second = await unitOfWork.execute(() => rates.save(rate('rate-2', 'USD', 'VES')));
    const otherPair = await unitOfWork.execute(() => rates.save(rate('rate-3', 'EUR', 'VES')));

    expect([first, second, otherPair]).toEqual([1, 2, 1]);
    expect(() => handle.sqlite.prepare(
      "update exchange_rates set version = 1 where id = 'rate-2'"
    ).run()).toThrow(/version is immutable/);
    handle.close();
  });

  it('impide que la versión de un maestro retroceda', () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    handle.sqlite.prepare(
      'insert into categories (id, name, is_active, version) values (?, ?, 1, 4)'
    ).run('category-001', 'Granos');
    handle.sqlite.prepare(
      'insert into units_of_measure (id, code, name, quantity_scale, is_active, version) ' +
      'values (?, ?, ?, 3, 1, 4)'
    ).run('unit-001', 'KG', 'Kilogramo');
    handle.sqlite.prepare(`
      insert into payment_methods (code, name, kind, currency_code, is_active, version)
      values (?, ?, 'CASH', 'USD', 1, 4)
    `).run('CASH_USD', 'Efectivo USD');

    expect(() => handle.sqlite.prepare('update categories set version = 3').run())
      .toThrow(/must not decrease/);
    expect(() => handle.sqlite.prepare('update units_of_measure set version = 3').run())
      .toThrow(/must not decrease/);
    expect(() => handle.sqlite.prepare('update payment_methods set version = 3').run())
      .toThrow(/must not decrease/);
    expect(() => handle.sqlite.prepare('update categories set version = 5').run()).not.toThrow();
    handle.close();
  });

  it('conserva los maestros existentes al migrar y les asigna la versión inicial', () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite, migrations.filter(({ version }) => version < 32));
    handle.sqlite.prepare('insert into categories (id, name, is_active) values (?, ?, 1)')
      .run('category-existente', 'Granos');
    handle.sqlite.prepare(
      'insert into units_of_measure (id, code, name, quantity_scale, is_active) values (?, ?, ?, 0, 1)'
    ).run('unit-existente', 'UND', 'Unidad');
    handle.sqlite.prepare(`
      insert into payment_methods (code, name, kind, currency_code, is_active)
      values (?, ?, 'CASH', 'USD', 1)
    `).run('CASH_USD', 'Efectivo USD');
    handle.sqlite.prepare(`
      insert into exchange_rates (
        id, base_currency, quote_currency, rate_value, rate_scale, source,
        valid_from, valid_until, registered_by
      ) values (?, 'USD', 'VES', 35000, 3, 'BCV', ?, null, 'operator-001')
    `).run('rate-old', new Date('2026-09-05T00:00:00.000Z').getTime());
    handle.sqlite.prepare(`
      insert into exchange_rates (
        id, base_currency, quote_currency, rate_value, rate_scale, source,
        valid_from, valid_until, registered_by
      ) values (?, 'USD', 'VES', 36500, 3, 'BCV', ?, null, 'operator-001')
    `).run('rate-new', new Date('2026-09-06T00:00:00.000Z').getTime());

    expect(applyMigrations(handle.sqlite)).toEqual([32, 33, 34, 35, 36, 37, 38]);

    expect(handle.sqlite.prepare('select id, version from categories').all())
      .toEqual([{ id: 'category-existente', version: 1 }]);
    expect(handle.sqlite.prepare('select id, version from units_of_measure').all())
      .toEqual([{ id: 'unit-existente', version: 1 }]);
    expect(handle.sqlite.prepare('select code, version from payment_methods').all())
      .toEqual([{ code: 'CASH_USD', version: 1 }]);
    expect(handle.sqlite.prepare('select id, version from exchange_rates order by version').all())
      .toEqual([{ id: 'rate-old', version: 1 }, { id: 'rate-new', version: 2 }]);
    handle.close();
  });
});
