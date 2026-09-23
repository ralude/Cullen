import { afterEach, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  DrizzleProductRepository,
  openDatabase,
  type DatabaseHandle
} from '@supermarket/driver-db';
import { seedExampleProducts } from './seed-products.ts';

describe('example product seed', () => {
  let handle: DatabaseHandle | undefined;

  afterEach(() => {
    handle?.close();
    handle = undefined;
  });

  it('creates the basic catalog once when executed repeatedly', async () => {
    handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);

    const options = { currencyCode: 'USD', taxRateBasisPoints: 0 };
    const first = await seedExampleProducts(handle, options);
    const second = await seedExampleProducts(handle, options);

    expect(first).toEqual({ categories: 3, unitsOfMeasure: 1, products: 5 });
    expect(second).toEqual(first);
    expect(countRows(handle, 'categories')).toBe(3);
    expect(countRows(handle, 'units_of_measure')).toBe(1);
    expect(countRows(handle, 'products')).toBe(5);
    expect(countRows(handle, 'product_barcodes')).toBe(5);
    expect(countRows(handle, 'product_price_history')).toBe(5);

    const product = await new DrizzleProductRepository(handle)
      .findByActiveBarcode('DEMOARROZ001');
    expect(product?.name).toBe('Arroz blanco 1 kg');
    expect(product?.price.currency).toBe('USD');
    expect(product?.taxRate.basisPoints).toBe(0);
  });

  /**
   * Catálogo de supermercado: canasta básica exenta, el resto al impuesto que
   * se declare, y productos por peso con cantidad en kilogramos. La
   * clasificación de exentos es ilustrativa, no asesoría tributaria.
   */
  it('creates the extended catalog with exempt goods and products sold by weight', async () => {
    handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);

    const options = { currencyCode: 'USD', taxRateBasisPoints: 1600, catalog: 'extended' as const };
    const first = await seedExampleProducts(handle, options);
    const second = await seedExampleProducts(handle, options);

    expect(first).toEqual({ categories: 7, unitsOfMeasure: 2, products: 31 });
    expect(second).toEqual(first);
    expect(countRows(handle, 'products')).toBe(31);
    expect(countRows(handle, 'product_barcodes')).toBe(31);

    const products = new DrizzleProductRepository(handle);
    /** Los cinco productos del catálogo básico conservan identidad, código y precio. */
    const rice = await products.findByActiveBarcode('DEMOARROZ001');
    expect(rice).toMatchObject({ name: 'Arroz blanco 1 kg' });
    expect(rice?.price.minorUnits).toBe(180);
    expect(rice?.taxRate.basisPoints).toBe(0);

    const detergent = await products.findByActiveBarcode('DEMODETERGENTE001');
    expect(detergent?.taxRate.basisPoints).toBe(1600);

    const cheese = await products.findByActiveBarcode('DEMOQUESO001');
    expect(cheese?.name).toBe('Queso blanco duro');
    expect(cheese?.unitOfMeasure).toMatchObject({ code: 'KG', quantityScale: 3 });
    expect(cheese?.taxRate.basisPoints).toBe(0);
  });

  it('keeps every barcode in the extended catalog unique', async () => {
    handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);

    await seedExampleProducts(handle, { currencyCode: 'USD', taxRateBasisPoints: 1600, catalog: 'extended' });

    expect(handle.sqlite.prepare('select count(distinct value) from product_barcodes').pluck().get())
      .toBe(31);
  });
});

const countRows = (handle: DatabaseHandle, table: string): number => {
  const row = handle.sqlite.prepare(`select count(*) as count from ${table}`).get() as {
    count: number;
  };
  return row.count;
};
