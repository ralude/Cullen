import { describe, expect, it } from 'vitest';
import { ExchangeRate, PurchaseReceipt, StockItem, Supplier } from '@supermarket/core';
import { Money, Quantity } from '@supermarket/shared';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzlePurchaseReceiptRepository } from './purchase-receipt-repository.js';
import { DrizzleSupplierRepository } from './supplier-repository.js';
import { DrizzleStockItemRepository } from './repositories.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

const supplier = (): Supplier => Supplier.create({
  id: 'supplier-1', code: 'SUP-000001', legalName: 'Proveedor Uno',
  fiscalAddress: { countryCode: 'VE', addressLine: 'Caracas' },
  taxIdentity: { country: 'VE', type: 'RIF', value: 'J-12345678-9' },
  createdAt: new Date('2026-09-04T10:00:00Z')
});

const stockItem = (): StockItem => StockItem.create({
  id: 'stock-1', productId: 'product-1', unitCode: 'UND', quantityScale: 0, tracksBatches: false
});

const draftReceipt = (id: string, exchangeRate: ExchangeRate | null = null): PurchaseReceipt => PurchaseReceipt.start({
  id, supplierId: 'supplier-1',
  supplierSnapshot: {
    legalName: 'Proveedor Uno', tradeName: null,
    taxIdentity: { country: 'VE', type: 'RIF', value: 'J-12345678-9', normalizedValue: 'J123456789' },
    fiscalAddress: { countryCode: 'VE', addressLine: 'Caracas' }
  },
  sourceDocument: { type: 'INVOICE', number: 'FAC-001', series: 'A', controlNumber: '00-000001', issuedAt: null },
  effectiveAt: new Date('2026-09-04T10:00:00Z'), createdBy: 'user-1', originNodeId: 'node-1',
  createdAt: new Date('2026-09-04T10:00:00Z'),
  replacesReceiptId: null,
  lines: [{
    id: 'line-1', productId: 'product-1', stockItemId: 'stock-1',
    unitCode: 'UND', tracksBatches: false,
    quantity: Quantity.fromScaled(10, 0), batchId: null, batchLotNumber: null, batchExpiresAt: null,
    purchaseUnitCost: Money.fromMinorUnits(100, exchangeRate ? 'EUR' : 'USD'),
    valuationUnitCost: Money.fromMinorUnits(exchangeRate ? 110 : 100, 'USD'),
    exchangeRate
  }]
});

describe('DrizzlePurchaseReceiptRepository', () => {
  it('round-trips a completed receipt with its exchange rate snapshot and finds it by source document', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const uow = new SqliteUnitOfWork(handle.sqlite);
    await uow.execute(() => new DrizzleSupplierRepository(handle).save(supplier()));
    await uow.execute(() => new DrizzleStockItemRepository(handle).save(stockItem()));

    const repository = new DrizzlePurchaseReceiptRepository(handle);
    const rate = ExchangeRate.create({
      id: 'rate-1', baseCurrency: 'USD', quoteCurrency: 'EUR', rateValue: 110, rateScale: 2,
      source: 'BCV', validFrom: new Date('2026-09-01T00:00:00Z'), registeredBy: 'user-1'
    });
    const receipt = draftReceipt('receipt-1', rate);
    await uow.execute(() => repository.save(receipt));

    const loadedDraft = await repository.findById('receipt-1');
    expect(loadedDraft).toMatchObject({ status: 'DRAFT', version: 1 });
    expect(loadedDraft?.lines[0]?.exchangeRate).toMatchObject({ id: 'rate-1', baseCurrency: 'USD' });

    receipt.complete({ actorId: 'user-1', occurredAt: new Date('2026-09-04T11:00:00Z'), eventId: 'event-completed' });
    await uow.execute(() => repository.save(receipt));

    const completed = await repository.findById('receipt-1');
    expect(completed).toMatchObject({ status: 'COMPLETED', version: 2 });
    expect(await repository.findCompletedBySource('supplier-1', 'INVOICE', 'a', 'fac-001'))
      .toMatchObject({ id: 'receipt-1' });
    expect(await repository.findCompletedBySource('supplier-1', 'INVOICE', 'B', 'FAC-001')).toBeNull();
    expect(await repository.findCompletedByControlNumber('supplier-1', '00-000001'))
      .toMatchObject({ id: 'receipt-1' });
    handle.close();
  });

  it('rejects editing or deleting an already written line', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const uow = new SqliteUnitOfWork(handle.sqlite);
    await uow.execute(() => new DrizzleSupplierRepository(handle).save(supplier()));
    await uow.execute(() => new DrizzleStockItemRepository(handle).save(stockItem()));
    const repository = new DrizzlePurchaseReceiptRepository(handle);
    await uow.execute(() => repository.save(draftReceipt('receipt-2')));

    expect(() => handle.sqlite.prepare("delete from purchase_receipt_lines where receipt_id = 'receipt-2'").run())
      .toThrowError('purchase receipt lines are immutable');
    expect(() => handle.sqlite.prepare("delete from purchase_receipts where id = 'receipt-2'").run())
      .toThrowError('purchase receipts cannot be deleted');
    handle.close();
  });
});
