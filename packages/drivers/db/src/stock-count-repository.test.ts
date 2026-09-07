import { describe, expect, it } from 'vitest';
import { StockCount } from '@supermarket/core';
import { Quantity } from '@supermarket/shared';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleStockCountRepository } from './stock-count-repository.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

const opened = (id = 'count-1'): StockCount => StockCount.open({
  id, openedBy: 'user-001', originNodeId: 'node-1', openedAt: new Date('2026-09-05T10:00:00.000Z')
});

describe('DrizzleStockCountRepository', () => {
  it('round-trips the full lifecycle with lines and frozen differences', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const repository = new DrizzleStockCountRepository(handle);
    const uow = new SqliteUnitOfWork(handle.sqlite);

    const count = opened();
    await uow.execute(() => repository.save(count));
    count.recordLine({
      id: 'line-1', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(8, 0)
    });
    await uow.execute(() => repository.save(count));

    const reloaded = await repository.findById('count-1');
    expect(reloaded).toMatchObject({ status: 'OPEN', version: 2 });
    expect(reloaded?.lines).toHaveLength(1);
    expect(reloaded?.differences).toBeNull();

    reloaded!.close([{
      lineId: 'line-1', stockItemId: 'stock-001', batchId: null, quantityScale: 0,
      expectedScaled: 5, countedScaled: 8, differenceScaled: 3, stockAvailabilityVersion: 7
    }], new Date('2026-09-05T11:00:00.000Z'));
    await uow.execute(() => repository.save(reloaded!));

    const closed = await repository.findById('count-1');
    expect(closed?.status).toBe('COUNTED');
    expect(closed?.differences).toEqual([{
      lineId: 'line-1', stockItemId: 'stock-001', batchId: null, quantityScale: 0,
      expectedScaled: 5, countedScaled: 8, differenceScaled: 3, stockAvailabilityVersion: 7
    }]);

    closed!.approve({
      actorId: 'supervisor-001', terminalId: 'terminal-001', reason: 'Aprobado',
      occurredAt: new Date('2026-09-05T12:00:00.000Z'), eventId: 'event-approved'
    });
    await uow.execute(() => repository.save(closed!));

    const approved = await repository.findById('count-1');
    expect(approved).toMatchObject({ status: 'APPROVED', approvedBy: 'supervisor-001', version: 4 });
    expect(approved?.differences).toHaveLength(1);
    handle.close();
  });

  it('replaces a corrected line without leaving an orphan row', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const repository = new DrizzleStockCountRepository(handle);
    const uow = new SqliteUnitOfWork(handle.sqlite);

    const count = opened();
    count.recordLine({
      id: 'line-1', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(5, 0)
    });
    await uow.execute(() => repository.save(count));
    count.recordLine({
      id: 'line-2', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(9, 0)
    });
    await uow.execute(() => repository.save(count));

    const reloaded = await repository.findById('count-1');
    expect(reloaded?.lines).toHaveLength(1);
    expect(reloaded?.lines[0]).toMatchObject({ id: 'line-2', countedQuantity: { scaledValue: 9 } });
    expect(
      handle.sqlite.prepare('select count(*) from stock_count_lines').pluck().get()
    ).toBe(1);
    handle.close();
  });

  it('lists by status and rejects a stale version', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const repository = new DrizzleStockCountRepository(handle);
    const uow = new SqliteUnitOfWork(handle.sqlite);

    await uow.execute(() => repository.save(opened('count-open')));
    const rejected = opened('count-rejected');
    rejected.recordLine({
      id: 'line-1', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(1, 0)
    });
    rejected.close([{
      lineId: 'line-1', stockItemId: 'stock-001', batchId: null, quantityScale: 0,
      expectedScaled: 0, countedScaled: 1, differenceScaled: 1, stockAvailabilityVersion: 1
    }], new Date('2026-09-05T11:00:00.000Z'));
    rejected.reject('supervisor-001', 'Error de digitación', new Date('2026-09-05T12:00:00.000Z'));
    await uow.execute(() => repository.save(rejected));

    expect((await repository.findAll('OPEN')).map(({ id }) => id)).toEqual(['count-open']);
    expect((await repository.findAll('REJECTED')).map(({ id }) => id)).toEqual(['count-rejected']);
    expect(await repository.findAll()).toHaveLength(2);

    const first = await repository.findById('count-open');
    const second = await repository.findById('count-open');
    first!.recordLine({
      id: 'line-a', productId: 'product-002', stockItemId: 'stock-002',
      countedQuantity: Quantity.fromScaled(1, 0)
    });
    await uow.execute(() => repository.save(first!));
    second!.recordLine({
      id: 'line-b', productId: 'product-003', stockItemId: 'stock-003',
      countedQuantity: Quantity.fromScaled(2, 0)
    });
    await expect(uow.execute(() => repository.save(second!)))
      .rejects.toMatchObject({ code: 'DATABASE_CONCURRENCY_CONFLICT' });
    handle.close();
  });

  it('rejects physical deletion of a stock count', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const repository = new DrizzleStockCountRepository(handle);
    const uow = new SqliteUnitOfWork(handle.sqlite);
    await uow.execute(() => repository.save(opened()));

    expect(() => handle.sqlite.prepare("delete from stock_counts where id = 'count-1'").run())
      .toThrowError('stock counts cannot be deleted');
    handle.close();
  });
});
