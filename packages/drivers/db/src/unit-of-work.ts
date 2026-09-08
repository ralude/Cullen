import type Database from 'better-sqlite3';
import type { TransactionState, UnitOfWork } from '@supermarket/core';
import { AppError, InfrastructureError } from '@supermarket/shared';

const sqliteCode = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : '';

export const mapDatabaseError = (error: unknown): AppError => {
  if (error instanceof AppError) return error;
  const code = sqliteCode(error);
  if (code.startsWith('SQLITE_CONSTRAINT')) {
    return new InfrastructureError(
      'DATABASE_CONSTRAINT_VIOLATION',
      'A database constraint was violated.',
      { cause: error }
    );
  }
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') {
    return new InfrastructureError(
      'DATABASE_BUSY',
      'The database is temporarily busy.',
      { cause: error }
    );
  }
  return new InfrastructureError(
    'DATABASE_OPERATION_FAILED',
    'The database operation failed.',
    { cause: error }
  );
};

export const requireTransaction = (sqlite: Database.Database): void => {
  if (!sqlite.inTransaction) {
    throw new InfrastructureError(
      'DATABASE_TRANSACTION_REQUIRED',
      'Database writes require an active UnitOfWork transaction.'
    );
  }
};

export class SqliteUnitOfWork implements UnitOfWork {
  constructor(private readonly sqlite: Database.Database) {}

  async execute<T>(work: () => Promise<T>): Promise<T> {
    if (this.sqlite.inTransaction) {
      throw new InfrastructureError(
        'DATABASE_TRANSACTION_NESTED',
        'Nested database transactions are not supported.'
      );
    }

    try {
      this.sqlite.exec('begin immediate');
      const result = await work();
      this.sqlite.exec('commit');
      return result;
    } catch (error) {
      if (this.sqlite.inTransaction) this.sqlite.exec('rollback');
      throw mapDatabaseError(error);
    }
  }
}

/**
 * Estado de la transacción de este nodo. Lo consulta el punto de decisión de
 * autorización para no anidar la escritura de su evidencia.
 */
export class SqliteTransactionState implements TransactionState {
  constructor(private readonly sqlite: Database.Database) {}

  get isActive(): boolean {
    return this.sqlite.inTransaction;
  }
}
