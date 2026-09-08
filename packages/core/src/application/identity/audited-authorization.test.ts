import { describe, expect, it } from 'vitest';
import { InfrastructureError } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type { AuditEntry, AuthorizationService, TransactionState } from '../ports/index.js';
import { AuditedAuthorizationService, DeferredDenialUnitOfWork } from './audited-authorization.js';

const context: ExecutionContext = {
  actorId: 'user-001',
  actorRoleCodes: ['CASHIER'],
  terminalId: 'terminal-001',
  originNodeId: 'node-001',
  correlationId: 'correlation-001'
};

const setup = (options: {
  readonly granted?: boolean;
  readonly failsToAppend?: boolean;
} = {}) => {
  const appended: AuditEntry[] = [];
  const transaction: { isActive: boolean } = { isActive: false };
  const inner: AuthorizationService = {
    authorize: async () => options.granted ?? false
  };
  const transactions = {
    depth: 0,
    async execute<T>(work: () => Promise<T>): Promise<T> {
      if (transaction.isActive) throw new InfrastructureError(
        'DATABASE_TRANSACTION_NESTED', 'Nested database transactions are not supported.'
      );
      transaction.isActive = true;
      try {
        return await work();
      } finally {
        transaction.isActive = false;
      }
    }
  };
  const auditWriter = {
    append: async (entries: readonly AuditEntry[]): Promise<void> => {
      if (options.failsToAppend) {
        throw new InfrastructureError('DATABASE_OPERATION_FAILED', 'The database operation failed.');
      }
      appended.push(...entries);
    }
  };
  let sequence = 0;
  const authorization = new AuditedAuthorizationService(
    inner, auditWriter, transactions, transaction as TransactionState,
    { generate: () => `audit-${++sequence}` },
    { now: () => new Date('2026-09-08T10:00:00.000Z') }
  );
  return {
    appended, transaction, authorization,
    unitOfWork: new DeferredDenialUnitOfWork(transactions, authorization)
  };
};

describe('audited authorization decisions', () => {
  it('grants without leaving evidence', async () => {
    const { authorization, appended } = setup({ granted: true });

    await expect(authorization.authorize(context, 'sale.void')).resolves.toBe(true);
    expect(appended).toEqual([]);
  });

  it('records a denial decided outside a transaction, in its own unit of work', async () => {
    const { authorization, appended } = setup();

    await expect(authorization.authorize(context, 'sale.void')).resolves.toBe(false);
    expect(appended).toEqual([{
      auditId: 'audit-1',
      actorId: 'user-001',
      actorRoleCodes: ['CASHIER'],
      action: 'AUTHORIZATION_DENIED',
      entityType: 'Permission',
      entityId: 'sale.void',
      before: null,
      after: { granted: false },
      reason: 'Actor lacks the required permission: sale.void.',
      terminalId: 'terminal-001',
      originNodeId: 'node-001',
      occurredAt: new Date('2026-09-08T10:00:00.000Z'),
      correlationId: 'correlation-001'
    }]);
  });

  it('defers a denial decided inside the command transaction and never nests one', async () => {
    const { authorization, unitOfWork, appended } = setup();

    const decided = await unitOfWork.execute(async () => {
      const granted = await authorization.authorize(context, 'cash.shift.close.difference');
      expect(appended).toEqual([]);
      return granted;
    });

    expect(decided).toBe(false);
    expect(appended.map((entry) => entry.entityId)).toEqual(['cash.shift.close.difference']);
  });

  it('does not present an unrecorded denial as an audited decision', async () => {
    const { authorization, unitOfWork } = setup({ failsToAppend: true });

    await expect(authorization.authorize(context, 'sale.void'))
      .rejects.toBeInstanceOf(InfrastructureError);
    await expect(unitOfWork.execute(
      () => authorization.authorize(context, 'cash.shift.close.difference')
    )).rejects.toBeInstanceOf(InfrastructureError);
  });

  it('keeps the failure of the command when the evidence cannot be written either', async () => {
    const { authorization, unitOfWork } = setup({ failsToAppend: true });

    await expect(unitOfWork.execute(async () => {
      await authorization.authorize(context, 'cash.shift.close.difference');
      throw new InfrastructureError('DATABASE_BUSY', 'The database is temporarily busy.');
    })).rejects.toMatchObject({ code: 'DATABASE_BUSY' });
  });
});
