import { describe, expect, it } from 'vitest';
import { InfrastructureError } from '@supermarket/shared';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';
import { SqliteUnitOfWork, requireTransaction } from './unit-of-work.js';

describe('SqliteUnitOfWork', () => {
  it('commits all writes after successful work', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);

    await unitOfWork.execute(async () => {
      requireTransaction(handle.sqlite);
      handle.sqlite.prepare('insert into categories (id, name, is_active, version) values (?, ?, ?, 1)')
        .run('category-001', 'Food', 1);
    });

    expect(handle.sqlite.prepare('select count(*) from categories').pluck().get()).toBe(1);
    handle.close();
  });

  it('rolls back all writes when work fails', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);

    await expect(unitOfWork.execute(async () => {
      handle.sqlite.prepare('insert into categories (id, name, is_active, version) values (?, ?, ?, 1)')
        .run('category-001', 'Food', 1);
      throw new Error('Injected failure.');
    })).rejects.toMatchObject({ code: 'DATABASE_OPERATION_FAILED' });

    expect(handle.sqlite.prepare('select count(*) from categories').pluck().get()).toBe(0);
    handle.close();
  });

  it('rejects repository writes outside an explicit transaction', () => {
    const handle = openDatabase(':memory:');
    expect(() => requireTransaction(handle.sqlite)).toThrowError(
      expect.objectContaining({ code: 'DATABASE_TRANSACTION_REQUIRED' })
    );
    handle.close();
  });

  it('maps SQLite constraint failures to a stable infrastructure error', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    await unitOfWork.execute(async () => {
      handle.sqlite.prepare('insert into categories (id, name, is_active, version) values (?, ?, ?, 1)')
        .run('category-001', 'Food', 1);
    });

    let caught: unknown;
    try {
      await unitOfWork.execute(async () => {
        handle.sqlite.prepare('insert into categories (id, name, is_active, version) values (?, ?, ?, 1)')
          .run('category-001', 'Other', 1);
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InfrastructureError);
    expect((caught as InfrastructureError).code).toBe('DATABASE_CONSTRAINT_VIOLATION');
    handle.close();
  });
});
