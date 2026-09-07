import { describe, expect, it } from 'vitest';
import {
  application,
  Barcode,
  Category,
  Product,
  StockItem,
  UnitOfMeasure,
  type BusinessEventV1
} from '@supermarket/core';
import { Money, Quantity, TaxRate } from '@supermarket/shared';
import { DrizzleAuditWriter } from './audit-writer.js';
import { DrizzleBusinessEventStore } from './business-event-store.js';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { applyMigrations } from './migrations.js';
import {
  DrizzleCategoryRepository,
  DrizzleProductRepository,
  DrizzleStockItemRepository,
  DrizzleUnitOfMeasureRepository
} from './repositories.js';
import { SqliteSaleCostSnapshotProvider } from './sale-cost-snapshot-provider.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

/**
 * Costo congelado al vender (ADR-0026 D4).
 *
 * La terminal toma el costo de la disponibilidad publicada por su coordinador;
 * el coordinador lo aplica tal cual, y una compra posterior no lo revaloriza.
 * Sin evidencia, el costo queda **desconocido** y visible como tal.
 */

const SOLD_AT = new Date('2026-09-06T12:00:00.000Z');
const OBSERVED_AT = new Date('2026-09-06T09:00:00.000Z');

let issued = 0;
const ids = { generate: (): string => `generated-${(issued += 1)}` };

const migrated = (): DatabaseHandle => {
  const handle = openDatabase(':memory:');
  applyMigrations(handle.sqlite);
  return handle;
};

const projectAvailability = (
  handle: DatabaseHandle,
  minorUnits: number | null
): void => {
  handle.sqlite.prepare(`
    insert into stock_availability_reference (
      product_id, quantity_scaled, quantity_scale, version,
      cost_unit_minor_units, cost_currency_code,
      published_by, published_at, applied_at
    ) values ('product-001', 30, 0, 7, ?, ?, 'node-coordinator', ?, ?)
  `).run(
    minorUnits,
    minorUnits === null ? null : 'USD',
    OBSERVED_AT.getTime(),
    OBSERVED_AT.getTime()
  );
};

const seedCoordinatorStock = async (
  handle: DatabaseHandle,
  unitCostMinorUnits: number
): Promise<void> => {
  const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
  const unit = UnitOfMeasure.create({
    id: 'unit-001', code: 'UNIT', name: 'Unidad', quantityScale: 0
  });
  await unitOfWork.execute(() => new DrizzleCategoryRepository(handle).save(
    Category.create({ id: 'category-001', name: 'Granos' })
  ));
  await unitOfWork.execute(() => new DrizzleUnitOfMeasureRepository(handle).save(unit));
  await unitOfWork.execute(() => new DrizzleProductRepository(handle).save(Product.create({
    id: 'product-001',
    name: 'Arroz',
    description: 'Arroz 1kg',
    categoryId: 'category-001',
    unitOfMeasure: unit,
    barcodes: [Barcode.create({ id: 'barcode-001', value: '1234' })],
    price: Money.fromMinorUnits(1200, 'USD'),
    taxRate: TaxRate.fromBasisPoints(1600),
    priceHistoryId: 'history-001',
    recordedBy: 'operator-001',
    occurredAt: OBSERVED_AT,
    eventId: 'event-product-created'
  })));
  const item = StockItem.create({
    id: 'stock-item-001', productId: 'product-001',
    unitCode: 'UNIT', quantityScale: 0, tracksBatches: false
  });
  item.registerMovement({
    id: 'movement-1', type: 'PURCHASE_RECEIPT', quantity: Quantity.fromScaled(10, 0),
    actorId: 'operator-001', reason: 'Recepción inicial', referenceId: 'receipt-1',
    occurredAt: OBSERVED_AT, eventId: 'event-movement-1',
    unitCost: Money.fromMinorUnits(unitCostMinorUnits, 'USD')
  });
  await unitOfWork.execute(() => new DrizzleStockItemRepository(handle).save(item));
};

const saleCompleted = (costSnapshot: unknown): BusinessEventV1 => ({
  eventId: 'event-sale-completed',
  eventType: 'SaleCompleted',
  contractVersion: 2,
  aggregateId: 'sale-001',
  aggregateType: 'Sale',
  aggregateVersion: 4,
  originNodeId: 'node-terminal-1',
  correlationId: 'correlation-sale',
  actorId: 'operator-001',
  occurredAt: SOLD_AT,
  payload: {
    shiftId: 'shift-001',
    terminalId: 'terminal-001',
    total: { minorUnits: 1200, currencyCode: 'USD' },
    paidTotal: { minorUnits: 1200, currencyCode: 'USD' },
    payments: [],
    items: [{
      itemId: 'item-001',
      productId: 'product-001',
      quantityScaled: 1,
      quantityScale: 0,
      costSnapshot
    }]
  } as never
});

const issuedCost = (handle: DatabaseHandle): unknown => handle.sqlite.prepare(`
  select unit_cost_minor_units as minorUnits, cost_currency_code as currencyCode
  from stock_movements where type = 'SALE_ISSUE'
`).get();

describe('costo conocido al vender', () => {
  it('toma el costo publicado por el coordinador y su procedencia', async () => {
    const handle = migrated();
    projectAvailability(handle, 800);

    const snapshot = await new SqliteSaleCostSnapshotProvider(handle, 'node-terminal-1')
      .findByProductId('product-001');

    expect(snapshot).toMatchObject({
      version: 7,
      source: 'node-coordinator',
      observedAt: OBSERVED_AT
    });
    expect(snapshot?.unitCost.minorUnits).toBe(800);
    expect(snapshot?.unitCost.currency).toBe('USD');
    handle.close();
  });

  it('conserva costo desconocido cuando la disponibilidad no lo trae', async () => {
    const handle = migrated();
    projectAvailability(handle, null);

    await expect(new SqliteSaleCostSnapshotProvider(handle, 'node-terminal-1')
      .findByProductId('product-001')).resolves.toBeNull();
    handle.close();
  });

  it('usa el promedio local del propio nodo cuando no hay disponibilidad publicada', async () => {
    const handle = migrated();
    await seedCoordinatorStock(handle, 500);

    const snapshot = await new SqliteSaleCostSnapshotProvider(handle, 'node-standalone')
      .findByProductId('product-001');

    expect(snapshot?.unitCost.minorUnits).toBe(500);
    expect(snapshot).toMatchObject({ source: 'node-standalone' });
    handle.close();
  });

  it('aplica el snapshot recibido y no el promedio del coordinador al recibir', async () => {
    const handle = migrated();
    /** El coordinador ya compró más caro después de la venta. */
    await seedCoordinatorStock(handle, 900);

    const applied = await new application.ApplySaleCompletedToInventory(
      new DrizzleStockItemRepository(handle), ids, ids,
      new SqliteUnitOfWork(handle.sqlite),
      new DrizzleBusinessEventStore(handle), new DrizzleAuditWriter(handle),
      'SYNCED_SNAPSHOT', undefined, 'node-coordinator'
    ).execute(saleCompleted({
      unitCost: { minorUnits: 500, currencyCode: 'USD' },
      version: 7,
      source: 'node-coordinator',
      observedAt: OBSERVED_AT.toISOString()
    }));

    expect(applied.ok).toBe(true);
    expect(issuedCost(handle)).toEqual({ minorUnits: 500, currencyCode: 'USD' });
    handle.close();
  });

  it('no acepta un costo cuya procedencia no es la autoridad del receptor', async () => {
    const handle = migrated();
    await seedCoordinatorStock(handle, 900);

    const applied = await new application.ApplySaleCompletedToInventory(
      new DrizzleStockItemRepository(handle), ids, ids,
      new SqliteUnitOfWork(handle.sqlite),
      new DrizzleBusinessEventStore(handle), new DrizzleAuditWriter(handle),
      'SYNCED_SNAPSHOT', undefined, 'node-coordinator'
    ).execute(saleCompleted({
      unitCost: { minorUnits: 1, currencyCode: 'USD' },
      version: 7,
      source: 'node-impostor',
      observedAt: OBSERVED_AT.toISOString()
    }));

    expect(applied.ok).toBe(true);
    /** Costo desconocido, no el promedio de 900 ni el valor inventado. */
    expect(issuedCost(handle)).toEqual({ minorUnits: null, currencyCode: null });
    handle.close();
  });

  it('un hecho v1 sin snapshot conserva costo desconocido', async () => {
    const handle = migrated();
    await seedCoordinatorStock(handle, 900);

    const applied = await new application.ApplySaleCompletedToInventory(
      new DrizzleStockItemRepository(handle), ids, ids,
      new SqliteUnitOfWork(handle.sqlite),
      new DrizzleBusinessEventStore(handle), new DrizzleAuditWriter(handle),
      'SYNCED_SNAPSHOT', undefined, 'node-coordinator'
    ).execute(saleCompleted(null));

    expect(applied.ok).toBe(true);
    expect(issuedCost(handle)).toEqual({ minorUnits: null, currencyCode: null });
    handle.close();
  });
});
