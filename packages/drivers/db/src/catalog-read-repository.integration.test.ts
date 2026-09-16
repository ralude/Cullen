import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Barcode, Category, Product, UnitOfMeasure } from '@supermarket/core';
import { Money, TaxRate } from '@supermarket/shared';
import { DrizzleCatalogReadRepository } from './catalog-read-repository.js';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { applyMigrations } from './migrations.js';
import {
  DrizzleCategoryRepository, DrizzleProductRepository, DrizzleUnitOfMeasureRepository
} from './repositories.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

const at = new Date('2026-09-16T12:00:00.000Z');
const unit = UnitOfMeasure.create({ id: 'unit-001', code: 'UNIT', name: 'Unidad', quantityScale: 0 });

const directories: string[] = [];
const handles: DatabaseHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) if (handle.sqlite.open) handle.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const openSeeded = async (count: number): Promise<DatabaseHandle> => {
  const directory = mkdtempSync(join(tmpdir(), 'catalog-read-'));
  directories.push(directory);
  const handle = openDatabase(join(directory, 'catalog.sqlite'));
  handles.push(handle);
  applyMigrations(handle.sqlite);
  await new SqliteUnitOfWork(handle.sqlite).execute(async () => {
    await new DrizzleUnitOfMeasureRepository(handle).save(unit);
    await new DrizzleCategoryRepository(handle).save(
      Category.create({ id: 'category-001', name: 'Víveres' })
    );
    const products = new DrizzleProductRepository(handle);
    for (let index = 1; index <= count; index += 1) {
      const suffix = String(index).padStart(4, '0');
      await products.save(Product.create({
        id: 'product-' + suffix,
        name: 'Producto ' + suffix,
        description: 'Artículo ' + suffix,
        categoryId: 'category-001',
        unitOfMeasure: unit,
        barcodes: [Barcode.create({ id: 'barcode-' + suffix, value: '75900000' + suffix })],
        price: Money.fromMinorUnits(1_000 + index, 'USD'),
        taxRate: TaxRate.fromBasisPoints(1_600),
        priceHistoryId: 'history-' + suffix,
        recordedBy: 'tester',
        occurredAt: at,
        eventId: 'event-product-' + suffix
      }));
    }
  });
  return handle;
};

/** Cuenta ejecuciones sobre el mismo `Database` que usan Drizzle y las consultas directas. */
const countStatements = (handle: DatabaseHandle): { readonly total: () => number } => {
  const database = handle.sqlite as unknown as { prepare: (sql: string) => Record<string, unknown> };
  const original = database.prepare.bind(database);
  let executed = 0;
  database.prepare = (sql: string): Record<string, unknown> => {
    const statement = original(sql);
    for (const method of ['run', 'get', 'all', 'iterate'] as const) {
      const existing = statement[method];
      if (typeof existing !== 'function') continue;
      const runner = (existing as (...args: readonly unknown[]) => unknown).bind(statement);
      statement[method] = (...parameters: readonly unknown[]): unknown => {
        executed += 1;
        return runner(...parameters);
      };
    }
    return statement;
  };
  return { total: (): number => executed };
};

describe('lectura del catálogo completo', () => {
  it('devuelve cada producto con su unidad, sus barcodes y su historial de precios', async () => {
    const handle = await openSeeded(3);
    const catalog = await new DrizzleCatalogReadRepository(handle).findAll();

    expect(catalog).toHaveLength(3);
    const [first] = [...catalog].sort((left, right) => left.id.localeCompare(right.id));
    expect(first).toMatchObject({
      id: 'product-0001', name: 'Producto 0001', categoryId: 'category-001', isActive: true
    });
    expect(first!.unitOfMeasure.code).toBe('UNIT');
    expect(first!.barcodes.map((barcode) => barcode.value)).toEqual(['759000000001']);
    expect(first!.price.minorUnits).toBe(1_001);
    expect(first!.price.currency).toBe('USD');
    expect(first!.taxRate.basisPoints).toBe(1_600);
    /** El historial es parte del agregado: una lectura del catálogo no lo pierde. */
    expect(first!.priceHistory).toHaveLength(1);
    expect(first!.priceHistory[0]!.price.minorUnits).toBe(1_001);
  });

  it('no consulta una vez por producto: el costo no crece con el tamaño del catálogo', async () => {
    /**
     * La lectura resolvía un producto por vez —unidad, barcodes e historial en
     * consultas propias—, así que un catálogo de doscientos artículos disparaba
     * más de ochocientas sentencias, y las de `product_id = ?` escanean la
     * tabla entera porque no hay índice: el costo crecía de forma cuadrática.
     *
     * Esta prueba no fija un número exacto, que dependería de detalles del
     * mapeo, sino la propiedad que importa: multiplicar por diez los productos
     * no multiplica por diez las consultas.
     */
    const small = await openSeeded(5);
    const smallCounter = countStatements(small);
    await new DrizzleCatalogReadRepository(small).findAll();
    const smallCount = smallCounter.total();

    const large = await openSeeded(50);
    const largeCounter = countStatements(large);
    const catalog = await new DrizzleCatalogReadRepository(large).findAll();
    const largeCount = largeCounter.total();

    expect(catalog).toHaveLength(50);
    expect(largeCount).toBe(smallCount);
  });

  it('devuelve una lista vacía sin consultar el detalle de nada', async () => {
    const handle = await openSeeded(0);
    const counter = countStatements(handle);
    expect(await new DrizzleCatalogReadRepository(handle).findAll()).toEqual([]);
    expect(counter.total()).toBeLessThanOrEqual(2);
  });
});
