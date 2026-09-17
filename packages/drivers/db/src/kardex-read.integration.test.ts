/**
 * Corte 2 de 12.03: el kardex deja de rehidratar el agregado para devolver una
 * página.
 *
 * La [caracterización](../../../../docs/cronograma/fase-12-optimizacion/12.03-caracterizacion.md)
 * midió que `kardex-10k` cuesta 2,66 s y que sólo 20 ms son SQLite: el resto es
 * reconstruir 10.000 movimientos para devolver como mucho 500. Aquí se fija
 * primero el comportamiento que esa lectura debe conservar y después la
 * propiedad que la hace barata.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  application, Barcode, Category, Product, StockItem, UnitOfMeasure,
  type AuthorizationService
} from '@supermarket/core';
import { Money, Quantity, TaxRate } from '@supermarket/shared';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleKardexReadRepository } from './kardex-read-repository.js';
import {
  DrizzleCategoryRepository,
  DrizzleProductRepository,
  DrizzleUnitOfMeasureRepository
} from './catalog-repositories.js';
import { DrizzleStockItemRepository } from './stock-item-repository.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

const AT = new Date('2026-09-17T12:00:00.000Z');
const context = {
  actorId: 'user-001', actorRoleCodes: ['manager'], terminalId: 'terminal-001',
  originNodeId: 'node-001', correlationId: 'correlation-001'
};
const allow: AuthorizationService = { authorize: async () => true };

const directories: string[] = [];
const handles: DatabaseHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) if (handle.sqlite.open) handle.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const unit = (): UnitOfMeasure =>
  UnitOfMeasure.create({ id: 'unit-001', code: 'UNIT', name: 'Unidad', quantityScale: 0 });

/**
 * Un artículo con `depth` entradas y una salida al final, sembrado por el
 * dominio para que lo consultado sea lo que el nodo realmente escribe.
 */
const seed = async (depth: number, tracksBatches: boolean): Promise<DatabaseHandle> => {
  const directory = mkdtempSync(join(tmpdir(), 'kardex-read-'));
  directories.push(directory);
  const handle = openDatabase(join(directory, 'node.sqlite'));
  handles.push(handle);
  applyMigrations(handle.sqlite);
  await new SqliteUnitOfWork(handle.sqlite).execute(async () => {
    await new DrizzleUnitOfMeasureRepository(handle).save(unit());
    await new DrizzleCategoryRepository(handle).save(
      Category.create({ id: 'category-001', name: 'Víveres' })
    );
    await new DrizzleProductRepository(handle).save(Product.create({
      id: 'product-001', name: 'Producto', description: 'Artículo con historia',
      categoryId: 'category-001', unitOfMeasure: unit(),
      barcodes: [Barcode.create({ id: 'barcode-001', value: '7590000000001' })],
      price: Money.fromMinorUnits(1_500, 'USD'), taxRate: TaxRate.fromBasisPoints(1_600),
      priceHistoryId: 'price-001', recordedBy: 'test', occurredAt: AT, eventId: 'event-price-001'
    }));
    const item = StockItem.create({
      id: 'stock-001', productId: 'product-001', unitCode: 'UNIT',
      quantityScale: 0, tracksBatches
    });
    if (tracksBatches) {
      item.registerBatch({ id: 'batch-a', lotNumber: 'LOTE-A' });
      item.registerBatch({ id: 'batch-b', lotNumber: 'LOTE-B' });
    }
    for (let movement = 1; movement <= depth; movement += 1) {
      item.registerMovement({
        id: 'movement-' + movement, type: 'PURCHASE_RECEIPT',
        quantity: Quantity.fromScaled(2, 0),
        ...(tracksBatches ? { batchId: movement % 2 === 0 ? 'batch-b' : 'batch-a' } : {}),
        actorId: 'test', reason: movement % 2 === 0 ? 'Compra par' : 'Compra impar',
        referenceId: 'reference-' + movement,
        occurredAt: new Date(AT.getTime() + movement * 1_000),
        eventId: 'event-movement-' + movement,
        unitCost: Money.fromMinorUnits(800, 'USD')
      });
    }
    item.registerMovement({
      id: 'movement-issue', type: 'SALE_ISSUE', quantity: Quantity.fromScaled(1, 0),
      ...(tracksBatches ? { batchId: 'batch-a' } : {}),
      actorId: 'test', reason: 'Venta', referenceId: 'sale-001',
      occurredAt: new Date(AT.getTime() + (depth + 1) * 1_000),
      eventId: 'event-movement-issue'
    });
    await new DrizzleStockItemRepository(handle).save(item);
  });
  return handle;
};

const kardexFor = (handle: DatabaseHandle): application.GetKardex =>
  new application.GetKardex(new DrizzleKardexReadRepository(handle), allow);

describe('kardex sobre la lectura del repositorio', () => {
  it('conserva orden, página, saldo y lotes', async () => {
    const handle = await seed(10, false);

    const result = await kardexFor(handle).execute({ productId: 'product-001', limit: 3 }, context);

    expect(result.ok).toBe(true);
    const kardex = result.ok ? result.value : undefined;
    /** 10 entradas de 2 menos una salida de 1. */
    expect(kardex?.currentBalanceScaled).toBe(19);
    expect(kardex?.id).toBe('stock-001');
    expect(kardex?.unitCode).toBe('UNIT');
    expect(kardex?.quantityScale).toBe(0);
    expect(kardex?.batches).toEqual([]);
    /** La página son los últimos del período, en orden ascendente. */
    expect(kardex?.movements.map(({ id }) => id)).toEqual([
      'movement-9', 'movement-10', 'movement-issue'
    ]);
    expect(kardex?.movements.at(-1)).toMatchObject({
      type: 'SALE_ISSUE', direction: 'OUT', quantityScaled: 1, quantityScale: 0,
      actorId: 'test', reason: 'Venta', referenceId: 'sale-001', batchId: null
    });
  });

  it('filtra por lote, motivo y período, y el saldo sigue al lote pedido', async () => {
    const handle = await seed(10, true);
    const kardex = kardexFor(handle);

    const byBatch = await kardex.execute(
      { productId: 'product-001', limit: 100, batchId: 'batch-b' }, context
    );
    expect(byBatch.ok && byBatch.value.currentBalanceScaled).toBe(10);
    expect(byBatch.ok && byBatch.value.movements.every(({ batchId }) => batchId === 'batch-b'))
      .toBe(true);

    const byReason = await kardex.execute(
      { productId: 'product-001', limit: 100, reason: 'compra PAR' }, context
    );
    expect(byReason.ok && byReason.value.movements.map(({ id }) => id))
      .toEqual(['movement-2', 'movement-4', 'movement-6', 'movement-8', 'movement-10']);
    /** El saldo es el del artículo: el filtro pagina movimientos, no reescribe existencias. */
    expect(byReason.ok && byReason.value.currentBalanceScaled).toBe(19);

    const byPeriod = await kardex.execute({
      productId: 'product-001', limit: 100,
      from: new Date(AT.getTime() + 3_000), to: new Date(AT.getTime() + 5_000)
    }, context);
    expect(byPeriod.ok && byPeriod.value.movements.map(({ id }) => id))
      .toEqual(['movement-3', 'movement-4', 'movement-5']);
  });

  it('rechaza un lote inexistente y un artículo sin lotes con sus códigos', async () => {
    const withBatches = await seed(3, true);
    await expect(kardexFor(withBatches).execute(
      { productId: 'product-001', limit: 10, batchId: 'batch-z' }, context
    )).rejects.toMatchObject({ code: 'STOCK_BATCH_NOT_FOUND' });

    const withoutBatches = await seed(3, false);
    await expect(kardexFor(withoutBatches).execute(
      { productId: 'product-001', limit: 10, batchId: 'batch-a' }, context
    )).rejects.toMatchObject({ code: 'STOCK_BATCH_NOT_TRACKED' });
  });

  it('no materializa la historia que no devuelve', async () => {
    const handle = await seed(500, false);
    type Preparable = { prepare: (sql: string) => Record<string, unknown> };
    const database = handle.sqlite as unknown as Preparable;
    const original = database.prepare.bind(database);
    let rows = 0;
    /**
     * La propiedad que hace barato el kardex no es cuántas consultas hace sino
     * cuántas filas cruzan a JavaScript: rehidratar el agregado traía las 501
     * para devolver 5. Se cuenta sobre el mismo `Database` que usa el
     * repositorio, así que ve todo lo que la lectura ejecuta.
     */
    database.prepare = (sql: string): Record<string, unknown> => {
      const statement = original(sql);
      const all = (statement.all as (...values: unknown[]) => unknown[]).bind(statement);
      statement.all = (...parameters: unknown[]): unknown[] => {
        const result = all(...parameters);
        rows += result.length;
        return result;
      };
      return statement;
    };

    const result = await kardexFor(handle).execute(
      { productId: 'product-001', limit: 5 }, context
    );

    expect(result.ok && result.value.movements).toHaveLength(5);
    /** Cinco movimientos más las filas de artículo, lotes y saldo. */
    expect(rows).toBeLessThan(20);
  });
});
