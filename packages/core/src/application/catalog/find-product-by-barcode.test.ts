import { describe, expect, it } from 'vitest';
import { Product, UnitOfMeasure } from '../../domain/catalog/index.js';
import { Barcode } from '../../domain/catalog/barcode.js';
import { Money, TaxRate } from '@supermarket/shared';
import type { ProductRepository } from '../ports/index.js';
import { FindProductByBarcode } from './find-product-by-barcode.js';

class FakeProductRepository implements ProductRepository {
  product = Product.create({
    id: 'product-001',
    name: 'Coffee',
    description: 'Ground coffee',
    categoryId: 'category-001',
    unitOfMeasure: UnitOfMeasure.create({ id: 'unit-001', code: 'UNIT', name: 'Unit', quantityScale: 0 }),
    barcodes: [Barcode.create({ id: 'barcode-001', value: '0123456789' })],
    price: Money.fromMinorUnits(1250, 'USD'),
    taxRate: TaxRate.fromBasisPoints(1600),
    priceHistoryId: 'price-001',
    recordedBy: 'user-001',
    occurredAt: new Date('2026-08-15T10:00:00.000Z'),
    eventId: 'event-001'
  });

  async save(): Promise<void> {}

  async findById(): Promise<Product | null> {
    return null;
  }

  async findByActiveBarcode(): Promise<Product | null> {
    return this.product;
  }
}

describe('FindProductByBarcode', () => {
  it('returns a stable sales snapshot from the catalog lookup', async () => {
    const useCase = new FindProductByBarcode(new FakeProductRepository());

    const result = await useCase.execute({ barcode: ' 0123456789 ' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.snapshot).toEqual({
      productId: 'product-001',
      description: 'Coffee',
      priceMinorUnits: 1250,
      currencyCode: 'USD',
      taxRateBasisPoints: 1600,
      unitCode: 'UNIT',
      unitScale: 0
    });
  });
});
