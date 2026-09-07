import { describe, expect, it } from 'vitest';
import { Money, Quantity } from '@supermarket/shared';
import { SaleReturn } from '@supermarket/core';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleSaleReturnRepository } from './sale-return-repository.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

describe('DrizzleSaleReturnRepository', () => {
  it('persists and rehydrates immutable return evidence and its cost snapshot', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    // El agregado se prueba aislado; las relaciones se validan por SQLite en
    // producción y no son necesarias para esta prueba de rehidratación.
    handle.sqlite.exec('pragma foreign_keys = off');
    const repository = new DrizzleSaleReturnRepository(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const value = SaleReturn.register({
      id: 'return-001', saleId: 'sale-001', saleEventId: 'event-sale-completed',
      originalDocumentId: 'invoice-001',
      creditNoteId: 'credit-note-001', shiftId: 'shift-001',
      refund: Money.fromMinorUnits(1_000, 'USD'), paymentMethodCode: 'CASH_USD',
      reason: 'Producto defectuoso', actorId: 'actor-001', terminalId: 'terminal-001',
      originNodeId: 'node-001', occurredAt: new Date('2026-09-04T12:00:00.000Z'),
      eventId: 'return-event-001', lines: [{
        id: 'return-line-001', saleItemId: 'item-001', productId: 'product-001',
        stockItemId: 'stock-001', batchId: 'batch-001', quantity: Quantity.fromScaled(2, 0),
        unitCost: Money.fromMinorUnits(500, 'USD')
      }]
    });

    await unitOfWork.execute(() => repository.save(value));
    const restored = await repository.findBySaleId('sale-001');

    expect(restored).toMatchObject({
      id: 'return-001', saleId: 'sale-001', saleEventId: 'event-sale-completed',
      creditNoteId: 'credit-note-001',
      refund: { minorUnits: 1_000, currency: 'USD' }, reason: 'Producto defectuoso'
    });
    expect(restored?.lines[0]).toMatchObject({
      saleItemId: 'item-001', batchId: 'batch-001', quantity: { scaledValue: 2, scale: 0 },
      unitCost: { minorUnits: 500, currency: 'USD' }
    });
    expect(restored?.domainEvents).toEqual([]);
    handle.close();
  });
});
