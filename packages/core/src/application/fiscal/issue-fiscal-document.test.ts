import { describe, expect, it } from 'vitest';
import { FiscalDocument, type FiscalDocumentContent } from '../../domain/fiscal/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuditEntry,
  BusinessEventStore,
  FiscalDocumentRepository,
  FiscalPrinterPort,
  OutboxStore,
  UnitOfWork
} from '../ports/index.js';
import { IssueFiscalDocument } from './issue-fiscal-document.js';
import { ReconcileFiscalState } from './reconcile-fiscal-state.js';

const content: FiscalDocumentContent = {
  referenceId: 'sale-001', type: 'INVOICE', currencyCode: 'USD',
  lines: [{
    id: 'line-001', description: 'Coffee', quantityScaled: 1, quantityScale: 0,
    unitPriceMinorUnits: 1_000, taxRateBasisPoints: 0, totalMinorUnits: 1_000
  }],
  payments: [{ methodCode: 'CASH_USD', amountMinorUnits: 1_000 }],
  totalMinorUnits: 1_000
};
const context: ExecutionContext = {
  actorId: 'user-001', actorRoleCodes: ['cashier'], terminalId: 'terminal-001',
  originNodeId: 'node-001', correlationId: 'correlation-001', idempotencyKey: 'request-001'
};
const committedEvidence = {
  dispatchState: 'RESULT_RECEIVED', commandEffect: 'APPLIED',
  fiscalCommit: 'COMMITTED', printDelivery: 'COMPLETE'
} as const;
const unknownEvidence = {
  dispatchState: 'STARTED', commandEffect: 'UNKNOWN',
  fiscalCommit: 'UNKNOWN', printDelivery: 'UNKNOWN'
} as const;
const resultReceivedUnknownEvidence = {
  dispatchState: 'RESULT_RECEIVED', commandEffect: 'UNKNOWN',
  fiscalCommit: 'UNKNOWN', printDelivery: 'UNKNOWN'
} as const;
const rejectedEvidence = {
  dispatchState: 'RESULT_RECEIVED', commandEffect: 'REJECTED',
  fiscalCommit: 'NOT_COMMITTED', printDelivery: 'INCOMPLETE'
} as const;
const notStartedEvidence = {
  dispatchState: 'NOT_STARTED', commandEffect: 'NOT_APPLIED',
  fiscalCommit: 'NOT_COMMITTED', printDelivery: 'INCOMPLETE'
} as const;

class Repository implements FiscalDocumentRepository {
  stored: FiscalDocument | null = null;
  statuses: string[] = [];
  async save(document: FiscalDocument): Promise<void> {
    this.stored = document;
    this.statuses.push(document.status);
  }
  async findById(id: string): Promise<FiscalDocument | null> {
    return this.stored?.id === id ? this.stored : null;
  }
  async findByReference(
    originNodeId: string,
    type: FiscalDocument['content']['type'],
    referenceId: string
  ): Promise<FiscalDocument | null> {
    return this.stored?.originNodeId === originNodeId &&
      this.stored.content.type === type && this.stored.content.referenceId === referenceId
      ? this.stored : null;
  }
  async findByIdempotencyKey(originNodeId: string, key: string): Promise<FiscalDocument | null> {
    return this.stored?.originNodeId === originNodeId && this.stored.idempotencyKey === key
      ? this.stored : null;
  }
  async findActive(): Promise<FiscalDocument | null> {
    return this.stored && !['ISSUED', 'FAILED'].includes(this.stored.status) ? this.stored : null;
  }
  async findRecoverable(): Promise<FiscalDocument[]> {
    return this.stored && ['PENDING', 'PRINTING', 'ERROR', 'RETRYING'].includes(this.stored.status)
      ? [this.stored] : [];
  }
}

const evidence = () => ({
  transactionActive: false,
  transactions: 0,
  ledger: [] as string[],
  outbox: [] as string[],
  audit: [] as AuditEntry[]
});

const dependencies = (recorded: ReturnType<typeof evidence>) => ({
  unitOfWork: {
    execute: async <T>(work: () => Promise<T>): Promise<T> => {
      recorded.transactions += 1;
      recorded.transactionActive = true;
      try { return await work(); } finally { recorded.transactionActive = false; }
    }
  } satisfies UnitOfWork,
  eventStore: {
    append: async (events) => { recorded.ledger.push(...events.map(({ eventType }) => eventType)); },
    findByAggregate: async () => []
  } satisfies BusinessEventStore,
  outboxStore: {
    enqueue: async (events) => { recorded.outbox.push(...events.map(({ eventType }) => eventType)); },
    claimAvailable: async () => [], isClaimActive: async () => false,
    markPublished: async () => false, markFailed: async () => false,
    markBlocked: async () => false,
    markPaused: async () => false,
    resumeDelivery: async () => false,
    summarize: async (destinationNodeId: string) => ({
      destinationNodeId, pending: 0, paused: 0, blocked: 0,
      lastPublishedAt: null, lastError: null
    }),
    listPaused: async () => []
  } satisfies OutboxStore,
  auditWriter: { append: async (entries: readonly AuditEntry[]) => { recorded.audit.push(...entries); } }
});

const ids = (prefix: string) => {
  let value = 0;
  return { generate: () => `${prefix}-${++value}` };
};

describe('IssueFiscalDocument', () => {
  it('persists state before hardware and issues outside the transaction', async () => {
    const repository = new Repository();
    const recorded = evidence();
    const printer: FiscalPrinterPort = {
      getStatus: async () => ({ ok: true, value: {
        connection: 'OPEN', state: 'IDLE', paperAvailable: true, memoryAvailable: true,
        lastDocumentReferenceId: null, lastDocumentNumber: null
      } }),
      printInvoice: async () => {
        expect(recorded.transactionActive).toBe(false);
        expect(repository.stored?.status).toBe('PRINTING');
        return { ok: true, value: {
          fiscalNumber: 'INV-000001', confirmedAt: new Date('2026-08-30T10:00:00.000Z'),
          evidence: committedEvidence
        } };
      },
      printCreditNote: async () => { throw new Error('not expected'); },
      printXReport: async () => { throw new Error('not expected'); },
      printZReport: async () => { throw new Error('not expected'); }
    };
    const deps = dependencies(recorded);
    const service = new IssueFiscalDocument(
      repository, printer, { authorize: async () => true }, ids('document'), ids('event'),
      ids('audit'), { now: () => new Date('2026-08-30T10:00:00.000Z') },
      deps.unitOfWork, deps.eventStore, deps.outboxStore, deps.auditWriter
    );

    const result = await service.execute({ content, reason: 'Completed sale' }, context);

    expect(result.ok).toBe(true);
    expect(repository.statuses).toEqual(['PENDING', 'PRINTING', 'ISSUED']);
    expect(recorded.ledger).toEqual([
      'FiscalDocumentPending', 'FiscalDocumentPrintingStarted', 'FiscalDocumentIssued'
    ]);
    expect(recorded.outbox).toEqual(['FiscalDocumentIssued']);
    expect(recorded.audit).toMatchObject([{ action: 'FISCAL_DOCUMENT_ISSUED' }]);
    expect(result).toMatchObject({ ok: true, value: { lastEvidence: committedEvidence } });
  });

  it('persists an uncertain error and requires reconciliation on redelivery', async () => {
    const repository = new Repository();
    const recorded = evidence();
    let prints = 0;
    const printer: FiscalPrinterPort = {
      getStatus: async () => ({ ok: true, value: {
        connection: 'OPEN', state: 'IDLE', paperAvailable: true, memoryAvailable: true,
        lastDocumentReferenceId: 'sale-001', lastDocumentNumber: 'INV-000001'
      } }),
      printInvoice: async () => {
        prints += 1;
        return { ok: false, error: {
          code: 'FISCAL_PRINTER_TIMEOUT', evidence: unknownEvidence, retryable: true,
          message: 'Timed out.'
        } };
      },
      printCreditNote: async () => { throw new Error('not expected'); },
      printXReport: async () => { throw new Error('not expected'); },
      printZReport: async () => { throw new Error('not expected'); }
    };
    const deps = dependencies(recorded);
    const service = new IssueFiscalDocument(
      repository, printer, { authorize: async () => true }, ids('document'), ids('event'),
      ids('audit'), { now: () => new Date('2026-08-30T10:00:00.000Z') },
      deps.unitOfWork, deps.eventStore, deps.outboxStore, deps.auditWriter
    );

    const failed = await service.execute({ content, reason: 'Completed sale' }, context);
    expect(failed.ok).toBe(false);
    expect(repository.stored?.status).toBe('ERROR');
    const redelivery = await service.execute({ content, reason: 'Completed sale' }, context);
    expect(redelivery.ok).toBe(false);
    if (!redelivery.ok) expect(redelivery.error.code).toBe('FISCAL_RECONCILIATION_REQUIRED');
    expect(prints).toBe(1);

    const reconciled = await new ReconcileFiscalState(
      repository, printer, { authorize: async () => true }, ids('event'), ids('audit'),
      { now: () => new Date('2026-08-30T11:00:00.000Z') }, deps.unitOfWork,
      deps.eventStore, deps.outboxStore, deps.auditWriter
    ).execute({ documentId: 'document-1', reason: 'Startup recovery' }, context);
    expect(reconciled.ok).toBe(true);
    expect(repository.stored?.status).toBe('ISSUED');
    expect(prints).toBe(1);
  });

  it('keeps an uncertain document blocked when the last device reference is different', async () => {
    const repository = new Repository();
    const recorded = evidence();
    let prints = 0;
    const printer: FiscalPrinterPort = {
      getStatus: async () => ({ ok: true, value: {
        connection: 'OPEN', state: 'IDLE', paperAvailable: true, memoryAvailable: true,
        lastDocumentReferenceId: 'another-sale', lastDocumentNumber: 'INV-000999'
      } }),
      printInvoice: async () => {
        prints += 1;
        return prints === 1
          ? { ok: false, error: {
            code: 'FISCAL_PRINTER_TIMEOUT' as const,
            evidence: unknownEvidence,
            retryable: true,
            message: 'Timed out.'
          } }
          : { ok: true, value: {
            fiscalNumber: 'INV-000002',
            confirmedAt: new Date('2026-08-30T11:00:00.000Z'),
            evidence: committedEvidence
          } };
      },
      printCreditNote: async () => { throw new Error('not expected'); },
      printXReport: async () => { throw new Error('not expected'); },
      printZReport: async () => { throw new Error('not expected'); }
    };
    const deps = dependencies(recorded);
    const issue = new IssueFiscalDocument(
      repository, printer, { authorize: async () => true }, ids('document'), ids('event'),
      ids('audit'), { now: () => new Date('2026-08-30T10:00:00.000Z') },
      deps.unitOfWork, deps.eventStore, deps.outboxStore, deps.auditWriter
    );
    const reconcile = new ReconcileFiscalState(
      repository, printer, { authorize: async () => true }, ids('event'), ids('audit'),
      { now: () => new Date('2026-08-30T11:00:00.000Z') }, deps.unitOfWork,
      deps.eventStore, deps.outboxStore, deps.auditWriter
    );

    expect((await issue.execute({ content, reason: 'Completed sale' }, context)).ok).toBe(false);
    const result = await reconcile.execute({
      documentId: 'document-1', reason: 'Startup recovery'
    }, context);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FISCAL_RECONCILIATION_INCONCLUSIVE');
    expect(repository.stored?.status).toBe('ERROR');
    expect(repository.stored?.lastEvidence).toEqual(unknownEvidence);
    expect(prints).toBe(1);
  });

  it('persists and audits an inconclusive PRINTING recovery without printing again', async () => {
    const repository = new Repository();
    const recorded = evidence();
    const document = FiscalDocument.create({
      id: 'document-1', content, idempotencyKey: 'request-001',
      requestFingerprint: JSON.stringify({ content, reason: 'Completed sale' }),
      terminalId: context.terminalId, originNodeId: context.originNodeId,
      createdBy: context.actorId, createdAt: new Date('2026-08-30T10:00:00.000Z'),
      eventId: 'event-created'
    });
    document.startPrinting({
      actorId: context.actorId, occurredAt: new Date('2026-08-30T10:00:00.000Z'),
      eventId: 'event-printing'
    });
    repository.stored = document;
    let prints = 0;
    const printer: FiscalPrinterPort = {
      getStatus: async () => ({ ok: true, value: {
        connection: 'OPEN', state: 'IDLE', paperAvailable: true, memoryAvailable: true,
        lastDocumentReferenceId: 'another-sale', lastDocumentNumber: 'INV-000999'
      } }),
      printInvoice: async () => { prints += 1; throw new Error('not expected'); },
      printCreditNote: async () => { throw new Error('not expected'); },
      printXReport: async () => { throw new Error('not expected'); },
      printZReport: async () => { throw new Error('not expected'); }
    };
    const deps = dependencies(recorded);

    const result = await new ReconcileFiscalState(
      repository, printer, { authorize: async () => true }, ids('event'), ids('audit'),
      { now: () => new Date('2026-08-30T11:00:00.000Z') }, deps.unitOfWork,
      deps.eventStore, deps.outboxStore, deps.auditWriter
    ).execute({ documentId: 'document-1', reason: 'Startup recovery' }, context);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FISCAL_RECONCILIATION_INCONCLUSIVE');
    expect(repository.stored).toMatchObject({
      status: 'ERROR',
      lastErrorCode: 'FISCAL_RECONCILIATION_INCONCLUSIVE',
      lastEvidence: {
        dispatchState: 'STARTED', commandEffect: 'UNKNOWN',
        fiscalCommit: 'UNKNOWN', printDelivery: 'UNKNOWN'
      }
    });
    expect(recorded.ledger).toEqual(['FiscalDocumentErrorRecorded']);
    expect(recorded.outbox).toEqual([]);
    expect(recorded.audit).toMatchObject([{
      action: 'FISCAL_DOCUMENT_RECONCILIATION_INCONCLUSIVE',
      reason: 'Startup recovery',
      after: { status: 'ERROR', errorCode: 'FISCAL_RECONCILIATION_INCONCLUSIVE' }
    }]);
    expect(prints).toBe(0);
  });

  it('does not treat a status response as the original command response when reconciling', async () => {
    const repository = new Repository();
    const recorded = evidence();
    const document = FiscalDocument.create({
      id: 'document-1', content, idempotencyKey: 'request-001',
      requestFingerprint: JSON.stringify({ content, reason: 'Completed sale' }),
      terminalId: context.terminalId, originNodeId: context.originNodeId,
      createdBy: context.actorId, createdAt: new Date('2026-08-30T10:00:00.000Z'),
      eventId: 'event-created'
    });
    document.startPrinting({
      actorId: context.actorId, occurredAt: new Date('2026-08-30T10:00:00.000Z'),
      eventId: 'event-printing'
    });
    document.recordError({
      code: 'FISCAL_PRINTER_PORT_CLOSED', evidence: notStartedEvidence, retryable: true,
      actorId: context.actorId, occurredAt: new Date('2026-08-30T10:01:00.000Z'),
      eventId: 'event-error'
    });
    document.beginRetry({
      actorId: context.actorId, occurredAt: new Date('2026-08-30T10:02:00.000Z'),
      eventId: 'event-retrying'
    });
    repository.stored = document;
    let prints = 0;
    const printer: FiscalPrinterPort = {
      getStatus: async () => ({ ok: true, value: {
        connection: 'OPEN', state: 'IDLE', paperAvailable: true, memoryAvailable: true,
        lastDocumentReferenceId: content.referenceId, lastDocumentNumber: 'INV-000001'
      } }),
      printInvoice: async () => { prints += 1; throw new Error('not expected'); },
      printCreditNote: async () => { throw new Error('not expected'); },
      printXReport: async () => { throw new Error('not expected'); },
      printZReport: async () => { throw new Error('not expected'); }
    };
    const deps = dependencies(recorded);

    const result = await new ReconcileFiscalState(
      repository, printer, { authorize: async () => true }, ids('event'), ids('audit'),
      { now: () => new Date('2026-08-30T11:00:00.000Z') }, deps.unitOfWork,
      deps.eventStore, deps.outboxStore, deps.auditWriter
    ).execute({ documentId: 'document-1', reason: 'Startup recovery' }, context);

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'ISSUED', fiscalNumber: 'INV-000001',
        lastEvidence: {
          dispatchState: 'STARTED', commandEffect: 'APPLIED',
          fiscalCommit: 'COMMITTED', printDelivery: 'UNKNOWN'
        }
      }
    });
    expect(repository.stored?.transitions.at(-1)).toMatchObject({
      from: 'RETRYING', to: 'ISSUED'
    });
    expect(recorded.audit).toMatchObject([{
      action: 'FISCAL_DOCUMENT_RECONCILED', reason: 'Startup recovery'
    }]);
    expect(prints).toBe(0);
  });

  it('preserves RESULT_RECEIVED when the original command already had response evidence', async () => {
    const repository = new Repository();
    const recorded = evidence();
    const document = FiscalDocument.create({
      id: 'document-1', content, idempotencyKey: 'request-001',
      requestFingerprint: JSON.stringify({ content, reason: 'Completed sale' }),
      terminalId: context.terminalId, originNodeId: context.originNodeId,
      createdBy: context.actorId, createdAt: new Date('2026-08-30T10:00:00.000Z'),
      eventId: 'event-created'
    });
    document.startPrinting({
      actorId: context.actorId, occurredAt: new Date('2026-08-30T10:00:00.000Z'),
      eventId: 'event-printing'
    });
    document.recordError({
      code: 'FISCAL_PRINTER_CRC_ERROR', evidence: resultReceivedUnknownEvidence,
      retryable: true, actorId: context.actorId,
      occurredAt: new Date('2026-08-30T10:01:00.000Z'), eventId: 'event-error'
    });
    repository.stored = document;
    const printer: FiscalPrinterPort = {
      getStatus: async () => ({ ok: true, value: {
        connection: 'OPEN', state: 'IDLE', paperAvailable: true, memoryAvailable: true,
        lastDocumentReferenceId: content.referenceId, lastDocumentNumber: 'INV-000001'
      } }),
      printInvoice: async () => { throw new Error('not expected'); },
      printCreditNote: async () => { throw new Error('not expected'); },
      printXReport: async () => { throw new Error('not expected'); },
      printZReport: async () => { throw new Error('not expected'); }
    };
    const deps = dependencies(recorded);

    const result = await new ReconcileFiscalState(
      repository, printer, { authorize: async () => true }, ids('event'), ids('audit'),
      { now: () => new Date('2026-08-30T11:00:00.000Z') }, deps.unitOfWork,
      deps.eventStore, deps.outboxStore, deps.auditWriter
    ).execute({ documentId: 'document-1', reason: 'Startup recovery' }, context);

    expect(result).toMatchObject({
      ok: true,
      value: { lastEvidence: {
        dispatchState: 'RESULT_RECEIVED', commandEffect: 'APPLIED',
        fiscalCommit: 'COMMITTED', printDelivery: 'UNKNOWN'
      } }
    });
  });

  it('rejects reuse of an idempotency key with another request', async () => {
    const repository = new Repository();
    const recorded = evidence();
    const printer: FiscalPrinterPort = {
      getStatus: async () => { throw new Error('not expected'); },
      printInvoice: async () => ({ ok: false, error: {
        code: 'FISCAL_PRINTER_MEMORY_FULL', evidence: rejectedEvidence, retryable: false,
        message: 'Memory full.'
      } }),
      printCreditNote: async () => { throw new Error('not expected'); },
      printXReport: async () => { throw new Error('not expected'); },
      printZReport: async () => { throw new Error('not expected'); }
    };
    const deps = dependencies(recorded);
    const service = new IssueFiscalDocument(
      repository, printer, { authorize: async () => true }, ids('document'), ids('event'),
      ids('audit'), { now: () => new Date('2026-08-30T10:00:00.000Z') },
      deps.unitOfWork, deps.eventStore, deps.outboxStore, deps.auditWriter
    );
    await service.execute({ content, reason: 'Completed sale' }, context);

    const conflict = await service.execute({
      content: { ...content, referenceId: 'sale-002' }, reason: 'Another sale'
    }, context);
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    expect(repository.stored).toMatchObject({
      status: 'ERROR',
      lastFailureRetryable: false,
      lastEvidence: rejectedEvidence
    });
    expect(await repository.findRecoverable()).toEqual([repository.stored]);
    expect(recorded.audit).toMatchObject([{ action: 'FISCAL_DOCUMENT_ERROR_RECORDED' }]);
    expect(recorded.outbox).not.toContain('FiscalDocumentFailed');
  });
});
