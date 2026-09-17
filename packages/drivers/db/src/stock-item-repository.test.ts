/**
 * Persistencia del artículo de inventario: historia append-only, rehidratación
 * del saldo derivado y moneda de valoración.
 *
 * Separadas de las demás por 12.05.03, con la clase que ejercitan: cambiar el
 * mapeo de inventario ya no obliga a leer las pruebas de caja ni de catálogo.
 */
import { describe, expect, it } from 'vitest';
import { StockItem } from '@supermarket/core';
import { Money, Quantity } from '@supermarket/shared';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleStockItemRepository } from './stock-item-repository.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

const date = (iso: string): Date => new Date(iso);

describe('DrizzleStockItemRepository', () => {
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
