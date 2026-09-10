import { describe, expect, it } from 'vitest';
import { Money, TaxRate } from '@supermarket/shared';
import { Barcode } from './barcode.js';
import { Product } from './product.js';
import { ProductSnapshot } from './product-snapshot.js';
import { UnitOfMeasure } from './unit-of-measure.js';

const unit = UnitOfMeasure.create({
  id: 'unit-001',
  code: 'UNIT',
  name: 'Unit',
  quantityScale: 0
});

function createProduct(): Product {
  return Product.create({
    id: 'product-001',
    name: 'Coffee',
    description: 'Ground coffee',
    categoryId: 'category-001',
    unitOfMeasure: unit,
    barcodes: [Barcode.create({ id: 'barcode-001', value: '0123456789' })],
    price: Money.fromMinorUnits(1250, 'USD'),
    taxRate: TaxRate.fromBasisPoints(1600),
    priceHistoryId: 'price-001',
    recordedBy: 'user-001',
    occurredAt: new Date('2026-08-15T10:00:00.000Z'),
    eventId: 'event-001'
  });
}

describe('Product', () => {
  it('rejects duplicate active barcodes in the aggregate', () => {
    expect(() =>
      Product.create({
        id: 'product-001',
        name: 'Coffee',
        description: 'Ground coffee',
        categoryId: 'category-001',
        unitOfMeasure: unit,
        barcodes: [
          Barcode.create({ id: 'barcode-001', value: '0123456789' }),
          Barcode.create({ id: 'barcode-002', value: ' 0123456789 ' })
        ],
        price: Money.fromMinorUnits(1250, 'USD'),
        taxRate: TaxRate.fromBasisPoints(1600),
        priceHistoryId: 'price-001',
        recordedBy: 'user-001',
        occurredAt: new Date('2026-08-15T10:00:00.000Z'),
        eventId: 'event-001'
      })
    ).toThrowError('Active barcode must be unique within a product.');
  });

  it('labels the snapshot with the name, not the longer description', () => {
    expect(createProduct().createSnapshot().description).toBe('Coffee');
  });

  it('creates an immutable snapshot and records price changes', () => {
    const product = createProduct();
    const snapshot = product.createSnapshot();

    product.changePrice({
      price: Money.fromMinorUnits(1500, 'USD'),
      priceHistoryId: 'price-002',
      changedBy: 'user-002',
      reason: 'Supplier update',
      occurredAt: new Date('2026-08-16T10:00:00.000Z'),
      eventId: 'event-002'
    });

    expect(snapshot).toEqual(
      ProductSnapshot.create({
        productId: 'product-001',
        description: 'Coffee',
        price: Money.fromMinorUnits(1250, 'USD'),
        taxRate: TaxRate.fromBasisPoints(1600),
        unitCode: 'UNIT',
        unitScale: 0
      })
    );
    expect(product.price.minorUnits).toBe(1500);
    expect(product.priceHistory).toHaveLength(2);
    expect(product.domainEvents.map((event) => event.type)).toEqual([
      'ProductCreated',
      'PriceChanged'
    ]);
  });
});
