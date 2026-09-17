/**
 * Persistencia del catálogo: producto con sus barcodes e historial de precios,
 * categoría y unidad de medida.
 *
 * Separado de los otros contextos por 12.05.03. El mapeo de un producto no
 * necesita las clases de caja, ventas, inventario ni moneda para leerse.
 */
import {
  Barcode,
  Category,
  PriceHistory,
  Product,
  UnitOfMeasure,
  type CategoryRepository,
  type ProductRepository,
  type UnitOfMeasureRepository
} from '@supermarket/core';
import { Money, TaxRate } from '@supermarket/shared';
import { and, eq } from 'drizzle-orm';
import type { DatabaseHandle } from './connection.js';
import {
  categories,
  productBarcodes,
  productPriceHistory,
  products,
  unitsOfMeasure
} from './schema.js';
import { read, requireTransaction } from './unit-of-work.js';

/** Agrupa filas ya traídas, para ensamblar sin volver a consultar por cada padre. */
const groupBy = <T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> => {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(key(row));
    if (bucket) bucket.push(row);
    else grouped.set(key(row), [row]);
  }
  return grouped;
};

export class DrizzleCategoryRepository implements CategoryRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  /**
   * Devuelve la versión persistida del maestro. La incrementa el propio
   * `insert`, así que dos escrituras concurrentes no pueden leer la misma
   * versión y publicar dos referencias indistinguibles.
   */
  async save(category: Category): Promise<number> {
    requireTransaction(this.handle.sqlite);
    return this.handle.sqlite.prepare(`
      insert into categories (id, name, is_active, version) values (?, ?, ?, 1)
      on conflict(id) do update
        set name = excluded.name, is_active = excluded.is_active, version = version + 1
      returning version
    `).pluck().get(category.id, category.name, category.isActive ? 1 : 0) as number;
  }

  findById(id: string): Promise<Category | null> {
    return read(() => {
      const row = this.handle.db.select().from(categories).where(eq(categories.id, id)).get();
      return row ? Category.create(row) : null;
    });
  }

  findAll(): Promise<readonly Category[]> {
    return read(() => this.handle.db.select().from(categories).all().map((row) => Category.create(row)));
  }
}

export class DrizzleUnitOfMeasureRepository implements UnitOfMeasureRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(unit: UnitOfMeasure): Promise<number> {
    requireTransaction(this.handle.sqlite);
    return this.handle.sqlite.prepare(`
      insert into units_of_measure (id, code, name, quantity_scale, is_active, version)
      values (?, ?, ?, ?, ?, 1)
      on conflict(id) do update
        set code = excluded.code, name = excluded.name,
          quantity_scale = excluded.quantity_scale, is_active = excluded.is_active,
          version = version + 1
      returning version
    `).pluck().get(
      unit.id, unit.code, unit.name, unit.quantityScale, unit.isActive ? 1 : 0
    ) as number;
  }

  findByCode(code: string): Promise<UnitOfMeasure | null> {
    return read(() => {
      const row = this.handle.db.select().from(unitsOfMeasure)
        .where(eq(unitsOfMeasure.code, code)).get();
      return row ? UnitOfMeasure.create(row) : null;
    });
  }

  findAll(): Promise<readonly UnitOfMeasure[]> {
    return read(() => this.handle.db.select().from(unitsOfMeasure).all().map((row) => UnitOfMeasure.create(row)));
  }
}

export class DrizzleProductRepository implements ProductRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(product: Product): Promise<void> {
    requireTransaction(this.handle.sqlite);
    this.handle.db.insert(products).values({
      id: product.id,
      name: product.name,
      description: product.description,
      categoryId: product.categoryId,
      unitId: product.unitOfMeasure.id,
      priceMinorUnits: product.price.minorUnits,
      currencyCode: product.price.currency,
      taxRateBasisPoints: product.taxRate.basisPoints,
      isActive: product.isActive,
      version: product.version
    }).onConflictDoUpdate({
      target: products.id,
      set: {
        name: product.name,
        description: product.description,
        categoryId: product.categoryId,
        unitId: product.unitOfMeasure.id,
        priceMinorUnits: product.price.minorUnits,
        currencyCode: product.price.currency,
        taxRateBasisPoints: product.taxRate.basisPoints,
        isActive: product.isActive,
        version: product.version
      }
    }).run();
    this.handle.db.delete(productBarcodes).where(eq(productBarcodes.productId, product.id)).run();
    if (product.barcodes.length > 0) {
      this.handle.db.insert(productBarcodes).values(product.barcodes.map((barcode) => ({
        id: barcode.id,
        productId: product.id,
        value: barcode.value,
        isActive: barcode.isActive
      }))).run();
    }
    this.handle.db.delete(productPriceHistory)
      .where(eq(productPriceHistory.productId, product.id)).run();
    this.handle.db.insert(productPriceHistory).values(product.priceHistory.map((history) => ({
      id: history.id,
      productId: product.id,
      priceMinorUnits: history.price.minorUnits,
      currencyCode: history.price.currency,
      recordedAt: history.recordedAt.getTime(),
      recordedBy: history.recordedBy,
      reason: history.reason ?? ''
    }))).run();
  }

  findById(id: string): Promise<Product | null> {
    return read(() => this.restore(this.handle.db.select().from(products)
      .where(eq(products.id, id)).get()));
  }

  findByActiveBarcode(value: string): Promise<Product | null> {
    return read(() => {
      const barcode = this.handle.db.select().from(productBarcodes).where(and(
        eq(productBarcodes.value, value),
        eq(productBarcodes.isActive, true)
      )).get();
      return barcode ? this.restore(this.handle.db.select().from(products)
        .where(eq(products.id, barcode.productId)).get()) : null;
    });
  }

  /**
   * Catálogo completo en un número fijo de consultas.
   *
   * Resolver producto por producto costaba cuatro sentencias cada uno, y las
   * de `product_id = ?` escanean la tabla entera porque no existe ese índice:
   * doscientos artículos disparaban más de ochocientas sentencias y el costo
   * crecía de forma cuadrática. Aquí se traen los cuatro conjuntos completos y
   * se ensamblan en memoria, con el mismo mapeo que usa la lectura individual.
   *
   * Vive en el repositorio, no en la lectura de catálogo, para que el mapeo del
   * agregado tenga un solo dueño; devuelve `Product`, así que no expone Drizzle.
   */
  findAllProducts(): Promise<readonly Product[]> {
    return read(() => {
      const rows = this.handle.db.select().from(products).all();
      if (rows.length === 0) return [];
      const units = new Map(this.handle.db.select().from(unitsOfMeasure).all()
        .map((unitRow) => [unitRow.id, unitRow]));
      const barcodesByProduct = groupBy(
        this.handle.db.select().from(productBarcodes).all(),
        (barcode) => barcode.productId
      );
      /**
       * El orden por producto se conserva ordenando también por `product_id`:
       * la lectura individual lo pedía por fecha dentro de un solo producto.
       */
      const historyByProduct = groupBy(
        this.handle.db.select().from(productPriceHistory)
          .orderBy(productPriceHistory.productId, productPriceHistory.recordedAt).all(),
        (history) => history.productId
      );
      return rows.map((row) => this.build(
        row,
        units.get(row.unitId),
        barcodesByProduct.get(row.id) ?? [],
        historyByProduct.get(row.id) ?? []
      ));
    });
  }

  private restore(row: typeof products.$inferSelect | undefined): Product | null {
    if (!row) return null;
    const unitRow = this.handle.db.select().from(unitsOfMeasure)
      .where(eq(unitsOfMeasure.id, row.unitId)).get();
    const barcodeRows = this.handle.db.select().from(productBarcodes)
      .where(eq(productBarcodes.productId, row.id)).all();
    const histories = this.handle.db.select().from(productPriceHistory)
      .where(eq(productPriceHistory.productId, row.id))
      .orderBy(productPriceHistory.recordedAt).all();
    return this.build(row, unitRow, barcodeRows, histories);
  }

  /** Mapeo puro: no consulta, así que sirve a la lectura individual y a la masiva. */
  private build(
    row: typeof products.$inferSelect,
    unitRow: typeof unitsOfMeasure.$inferSelect | undefined,
    barcodeRows: readonly (typeof productBarcodes.$inferSelect)[],
    histories: readonly (typeof productPriceHistory.$inferSelect)[]
  ): Product {
    if (!unitRow) throw new Error('Persisted product unit is missing.');
    return Product.restore({
      id: row.id,
      name: row.name,
      description: row.description,
      categoryId: row.categoryId,
      unitOfMeasure: UnitOfMeasure.create(unitRow),
      barcodes: barcodeRows.map((barcode) => Barcode.create(barcode)),
      price: Money.fromMinorUnits(row.priceMinorUnits, row.currencyCode),
      taxRate: TaxRate.fromBasisPoints(row.taxRateBasisPoints),
      priceHistory: histories.map((history) => PriceHistory.create({
        id: history.id,
        price: Money.fromMinorUnits(history.priceMinorUnits, history.currencyCode),
        recordedAt: new Date(history.recordedAt),
        recordedBy: history.recordedBy,
        reason: history.reason
      })),
      isActive: row.isActive,
      version: row.version
    });
  }
}
