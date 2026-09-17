import { describe, expect, it } from 'vitest';
import {
  createSaleRecipientSnapshot,
  Payment,
  PaymentMethod,
  ProductSnapshot,
  Sale
} from '@supermarket/core';
import { Money, Percentage, Quantity, TaxRate } from '@supermarket/shared';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleSaleRepository } from './sale-repository.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

const instant = (minute: number): Date => new Date(`2026-08-29T10:${String(minute).padStart(2, '0')}:00Z`);

const paidDraftSale = (): Sale => {
  const sale = Sale.start({
    id: 'sale-001', shiftId: 'shift-001', currencyCode: 'USD', terminalId: 'terminal-001',
    originNodeId: 'node-001', startedBy: 'user-001', startedAt: instant(0), eventId: 'event-001'
  });
  sale.addItem({
    id: 'item-001',
    snapshot: ProductSnapshot.create({
      productId: 'product-001', description: 'Rice 1kg',
      price: Money.fromMinorUnits(1000, 'USD'), taxRate: TaxRate.fromBasisPoints(1600),
      unitCode: 'UNIT', unitScale: 0
    }),
    quantity: Quantity.fromScaled(1, 0), occurredAt: instant(1), eventId: 'event-002'
  });
  sale.applyDiscount({
    id: 'discount-001', lineItemId: 'item-001',
    percentage: Percentage.fromBasisPoints(1000), maximumBasisPoints: 1000,
    reason: 'Promotion', appliedBy: 'manager-001', occurredAt: instant(2), eventId: 'event-003'
  });
  const method = PaymentMethod.create({
    code: 'USD_CASH', name: 'USD cash', kind: 'CASH', currencyCode: 'USD'
  });
  sale.registerPayments({
    payments: [Payment.create({
      id: 'payment-001', method, amount: Money.fromMinorUnits(1044, 'USD'),
      amountInSaleCurrency: Money.fromMinorUnits(1044, 'USD'), exchangeRate: null,
      registeredBy: 'user-001', registeredAt: instant(3)
    })],
    financialTransactionTax: Money.zero('USD'), occurredAt: instant(3), eventIds: ['event-004']
  });
  return sale;
};

describe('DrizzleSaleRepository integration', () => {
  it('persists and rehydrates item, discount, payment and immutable snapshots', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const repository = new DrizzleSaleRepository(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const sale = paidDraftSale();
    await unitOfWork.execute(() => repository.save(sale));

    const restored = await repository.findById(sale.id);
    expect(restored).toMatchObject({
      id: sale.id, shiftId: 'shift-001', status: 'DRAFT', version: 4
    });
    expect(restored?.items[0]?.snapshot).toMatchObject({
      productId: 'product-001', description: 'Rice 1kg', unitCode: 'UNIT'
    });
    expect(restored?.items[0]?.discount).toMatchObject({
      id: 'discount-001', reason: 'Promotion', appliedBy: 'manager-001'
    });
    expect(restored?.payments[0]).toMatchObject({
      id: 'payment-001', registeredBy: 'user-001'
    });
    expect(restored?.total.minorUnits).toBe(1044);
    expect(restored?.domainEvents).toEqual([]);
    handle.close();
  });

  it('allows draft completion and rejects overwriting a final sale', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const repository = new DrizzleSaleRepository(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    await unitOfWork.execute(() => repository.save(paidDraftSale()));
    const completed = await repository.findById('sale-001');
    const staleDraft = await repository.findById('sale-001');
    if (!completed || !staleDraft) throw new Error('Sale fixture was not restored.');
    completed.complete({ completedAt: instant(4), eventId: 'event-005' });
    await unitOfWork.execute(() => repository.save(completed));

    expect((await repository.findById('sale-001'))?.status).toBe('COMPLETED');
    await expect(unitOfWork.execute(() => repository.save(staleDraft)))
      .rejects.toMatchObject({ code: 'SALE_FINAL_STATE_IMMUTABLE' });
    handle.close();
  });

  it('persists and rehydrates the recipient snapshot, including its removal', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const repository = new DrizzleSaleRepository(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const sale = paidDraftSale();
    sale.setRecipient({
      recipient: createSaleRecipientSnapshot({
        country: 'VE', type: 'RIF', value: 'J-12.345.678-9', name: 'Bodega Central',
        address: 'Av. Urdaneta'
      }),
      occurredAt: instant(4), eventId: 'event-005'
    });
    await unitOfWork.execute(() => repository.save(sale));

    expect((await repository.findById('sale-001'))?.recipient).toEqual({
      country: 'VE', type: 'RIF', value: 'J-12.345.678-9', normalizedValue: 'J123456789',
      name: 'Bodega Central', address: 'Av. Urdaneta'
    });

    const withoutRecipient = await repository.findById('sale-001');
    if (!withoutRecipient) throw new Error('Sale fixture was not restored.');
    withoutRecipient.setRecipient({
      recipient: null, occurredAt: instant(5), eventId: 'event-006'
    });
    await unitOfWork.execute(() => repository.save(withoutRecipient));

    expect((await repository.findById('sale-001'))?.recipient).toBeNull();
    handle.close();
  });

  it('keeps an anonymous sale valid without a recipient', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const repository = new DrizzleSaleRepository(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    await unitOfWork.execute(() => repository.save(paidDraftSale()));

    expect((await repository.findById('sale-001'))?.recipient).toBeNull();
    handle.close();
  });

  it('rolls back a saved sale when later work fails', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const repository = new DrizzleSaleRepository(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);

    await expect(unitOfWork.execute(async () => {
      await repository.save(paidDraftSale());
      throw new Error('Injected intermediate failure.');
    })).rejects.toMatchObject({ code: 'DATABASE_OPERATION_FAILED' });

    expect(await repository.findById('sale-001')).toBeNull();
    handle.close();
  });
});
