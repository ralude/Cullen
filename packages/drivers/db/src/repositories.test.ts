/**
 * Lo que sigue siendo de los repositorios en conjunto tras 12.05.03: una sola
 * transacción que persiste varios agregados, el listado de datos de referencia
 * y el rechazo de una escritura fuera de la unidad de trabajo. Lo que pertenece
 * a un contexto vive con su clase.
 */
import { describe, expect, it } from 'vitest';
import {
  Barcode,
  CashRegister,
  Category,
  ExchangeRate,
  PaymentMethod,
  Product,
  Shift,
  UnitOfMeasure
} from '@supermarket/core';
import { Money, TaxRate } from '@supermarket/shared';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleCashRegisterRepository, DrizzleShiftRepository } from './cash-repositories.js';
import {
  DrizzleCategoryRepository,
  DrizzleProductRepository,
  DrizzleUnitOfMeasureRepository
} from './catalog-repositories.js';
import {
  DrizzleExchangeRateRepository,
  DrizzlePaymentMethodRepository
} from './currency-repositories.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

const date = (iso: string): Date => new Date(iso);

describe('Drizzle repositories', () => {
  it('persists reference data, exchange rates and products inside one transaction', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const categories = new DrizzleCategoryRepository(handle);
    const units = new DrizzleUnitOfMeasureRepository(handle);
    const paymentMethods = new DrizzlePaymentMethodRepository(handle);
    const registers = new DrizzleCashRegisterRepository(handle);
    const rates = new DrizzleExchangeRateRepository(handle);
    const products = new DrizzleProductRepository(handle);
    const category = Category.create({ id: 'category-001', name: 'Food' });
    const unit = UnitOfMeasure.create({
      id: 'unit-001', code: 'UNIT', name: 'Unit', quantityScale: 0
    });
    const method = PaymentMethod.create({
      code: 'USD_CASH', name: 'USD cash', kind: 'CASH', currencyCode: 'USD'
    });
    const register = CashRegister.create({
      id: 'register-001', name: 'Register 1', terminalId: 'terminal-001', originNodeId: 'node-001'
    });
    const rate = ExchangeRate.create({
      id: 'rate-001', baseCurrency: 'USD', quoteCurrency: 'VES', rateValue: 4000,
      rateScale: 2, source: 'BCV', validFrom: date('2026-08-29T00:00:00Z'),
      registeredBy: 'user-001'
    });
    const product = Product.create({
      id: 'product-001', name: 'Rice', description: 'Rice 1kg', categoryId: category.id,
      unitOfMeasure: unit, barcodes: [Barcode.create({ id: 'barcode-001', value: '1234' })],
      price: Money.fromMinorUnits(250, 'USD'), taxRate: TaxRate.fromBasisPoints(1600),
      priceHistoryId: 'history-001', recordedBy: 'user-001',
      occurredAt: date('2026-08-29T10:00:00Z'), eventId: 'event-001'
    });

    await unitOfWork.execute(async () => {
      await categories.save(category);
      await units.save(unit);
      await paymentMethods.save(method);
      await registers.save(register);
      await rates.save(rate);
      await products.save(product);
    });

    expect(await categories.findById(category.id)).toEqual(category);
    expect(await units.findByCode(unit.code)).toEqual(unit);
    expect(await paymentMethods.findByCode(method.code)).toEqual(method);
    expect(await registers.findById(register.id)).toEqual(register);
    expect(await categories.findAll()).toEqual([category]);
    expect(await units.findAll()).toEqual([unit]);
    expect(await paymentMethods.findAll()).toEqual([method]);
    expect(await registers.findAll()).toEqual([register]);
    expect((await rates.findCurrentByPair('USD', 'VES', date('2026-08-29T12:00:00Z')))?.id)
      .toBe(rate.id);
    const restored = await products.findByActiveBarcode('1234');
    expect(restored).toMatchObject({ id: product.id, name: 'Rice', version: 1 });
    expect(restored?.domainEvents).toEqual([]);
    expect(restored?.priceHistory).toHaveLength(1);
    handle.close();
  });

  it('persists and rehydrates an open shift with its movements', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const registers = new DrizzleCashRegisterRepository(handle);
    const shifts = new DrizzleShiftRepository(handle);
    const register = CashRegister.create({
      id: 'register-001', name: 'Register 1', terminalId: 'terminal-001', originNodeId: 'node-001'
    });
    const method = PaymentMethod.create({
      code: 'USD_CASH', name: 'USD cash', kind: 'CASH', currencyCode: 'USD'
    });
    const shift = Shift.open({
      id: 'shift-001', cashRegister: register, openedBy: 'user-001',
      openedAt: date('2026-08-29T10:00:00Z'), eventId: 'event-001',
      openingFunds: [{ id: 'movement-001', method, amount: Money.fromMinorUnits(1000, 'USD') }]
    });

    await unitOfWork.execute(async () => {
      await registers.save(register);
      await shifts.save(shift);
    });

    const restored = await shifts.findOpenByCashRegisterId(register.id);
    expect(restored).toMatchObject({ id: shift.id, status: 'OPEN', version: 1 });
    expect(restored?.balanceFor('USD_CASH', 'USD').minorUnits).toBe(1000);
    expect(restored?.domainEvents).toEqual([]);
    handle.close();
  });

  it('lists reference data including inactive rows; filtering active-only is an application decision', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const categories = new DrizzleCategoryRepository(handle);
    const active = Category.create({ id: 'category-001', name: 'Food' });
    const inactive = Category.create({ id: 'category-002', name: 'Discontinued', isActive: false });

    await unitOfWork.execute(async () => {
      await categories.save(active);
      await categories.save(inactive);
    });

    const listed = await categories.findAll();
    expect(listed).toHaveLength(2);
    expect(listed.map((category) => category.id).sort()).toEqual(['category-001', 'category-002']);
    handle.close();
  });

  it('rejects aggregate writes outside UnitOfWork', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const repository = new DrizzleCategoryRepository(handle);
    await expect(repository.save(Category.create({ id: 'category-001', name: 'Food' })))
      .rejects.toMatchObject({ code: 'DATABASE_TRANSACTION_REQUIRED' });
    handle.close();
  });
});
