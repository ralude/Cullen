import { describe, expect, it } from 'vitest';
import {
  Barcode,
  CashRegister,
  Category,
  ExchangeRate,
  PaymentMethod,
  Product,
  Shift,
  StockItem,
  UnitOfMeasure
} from '@supermarket/core';
import { Money, Quantity, TaxRate } from '@supermarket/shared';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';
import {
  DrizzleCashRegisterRepository,
  DrizzleCategoryRepository,
  DrizzleExchangeRateRepository,
  DrizzlePaymentMethodRepository,
  DrizzleProductRepository,
  DrizzleShiftRepository,
  DrizzleStockItemRepository,
  DrizzleUnitOfMeasureRepository
} from './repositories.js';
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

  it('persists append-only stock movements and rehydrates the derived balance', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const repository = new DrizzleStockItemRepository(handle);
    const item = StockItem.create({
      id: 'stock-001', productId: 'product-001', unitCode: 'UNIT',
      quantityScale: 0, tracksBatches: true
    });
    item.registerBatch({ id: 'batch-001', lotNumber: 'LOT-001' });
    item.registerMovement({
      id: 'movement-001', eventId: 'event-001', type: 'PURCHASE_RECEIPT',
      quantity: Quantity.fromScaled(5, 0), batchId: 'batch-001', actorId: 'user-001',
      reason: 'Purchase', referenceId: 'receipt-001', occurredAt: date('2026-08-29T10:00:00Z')
    });

    await unitOfWork.execute(() => repository.save(item));
    item.registerMovement({
      id: 'movement-002', eventId: 'event-002', type: 'WASTE',
      quantity: Quantity.fromScaled(2, 0), batchId: 'batch-001', actorId: 'user-002',
      reason: 'Damaged', referenceId: 'waste-001', occurredAt: date('2026-08-29T09:00:00Z')
    });
    await unitOfWork.execute(() => repository.save(item));

    const restored = await repository.findByProductId('product-001');
    expect(restored?.balance.scaledValue).toBe(3);
    expect(restored?.movements.map((movement) => movement.id))
      .toEqual(['movement-001', 'movement-002']);
    expect(restored?.domainEvents).toEqual([]);
    expect(() => handle.sqlite.prepare(
      "update stock_movements set reason = 'changed' where id = 'movement-001'"
    ).run()).toThrowError('stock movements are append-only');
    expect(() => handle.sqlite.prepare(
      "delete from stock_movements where id = 'movement-001'"
    ).run()).toThrowError('stock movements are append-only');
    handle.close();
  });

  it('persists the stock valuation currency after the balance returns to zero', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const repository = new DrizzleStockItemRepository(handle);
    const item = StockItem.create({
      id: 'stock-valued', productId: 'product-valued', unitCode: 'UNIT',
      quantityScale: 0, tracksBatches: false
    });
    item.registerMovement({
      id: 'valued-in', eventId: 'valued-in-event', type: 'PURCHASE_RECEIPT',
      quantity: Quantity.fromScaled(2, 0), actorId: 'user-001', reason: 'Purchase',
      referenceId: 'receipt-valued', occurredAt: date('2026-09-05T10:00:00Z'),
      unitCost: Money.fromMinorUnits(150, 'USD')
    });
    item.registerMovement({
      id: 'valued-out', eventId: 'valued-out-event', type: 'SALE_ISSUE',
      quantity: Quantity.fromScaled(2, 0), actorId: 'user-001', reason: 'Sale',
      referenceId: 'sale-valued', occurredAt: date('2026-09-05T11:00:00Z')
    });

    await unitOfWork.execute(() => repository.save(item));

    const restored = await repository.findById(item.id);
    expect(restored?.valuationCurrency).toBe('USD');
    expect(restored?.inventoryValue).toEqual(Money.zero('USD'));
    expect(restored?.movements[1]?.unitCost).toEqual(Money.fromMinorUnits(150, 'USD'));
    handle.close();
  });
});
