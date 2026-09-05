import { describe, expect, it } from 'vitest';
import { Branch } from '@supermarket/core';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleBranchRepository } from './branch-repository.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

describe('DrizzleBranchRepository', () => {
  it('round-trips state, rejects a duplicate code and a stale version', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const repository = new DrizzleBranchRepository(handle);
    const uow = new SqliteUnitOfWork(handle.sqlite);
    const branch = Branch.create({ id: 'branch-1', code: 'CCS', name: 'Sucursal Centro', originNodeId: 'node-1', createdAt: new Date('2026-09-05T12:00:00Z') });
    await uow.execute(() => repository.save(branch));
    branch.changeStatus('INACTIVE', new Date('2026-09-05T13:00:00Z'));
    await uow.execute(() => repository.save(branch));

    expect(await repository.findById('branch-1')).toMatchObject({ status: 'INACTIVE', version: 2 });
    expect(await repository.findByCode('CCS')).toMatchObject({ id: 'branch-1' });
    expect(await repository.findAll('ACTIVE')).toHaveLength(0);

    await expect(uow.execute(() => repository.save(
      Branch.create({
        id: 'branch-2', code: 'CCS', name: 'Otra', originNodeId: 'node-1',
        createdAt: new Date('2026-09-05T12:00:00Z')
      })
    ))).rejects.toMatchObject({ code: 'DATABASE_CONSTRAINT_VIOLATION' });

    expect(() => handle.sqlite.prepare("delete from branches where id = 'branch-1'").run())
      .toThrowError('branches cannot be deleted');
    handle.close();
  });
});
