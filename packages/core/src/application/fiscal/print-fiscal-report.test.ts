import { describe, expect, it } from 'vitest';
import { FiscalDay } from '../../domain/fiscal/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuditEntry, BusinessEventStore, FiscalDayRepository, FiscalPrinterPort,
  OutboxStore, UnitOfWork
} from '../ports/index.js';
import { PrintXReport } from './print-x-report.js';
import { PrintZReport } from './print-z-report.js';

const context: ExecutionContext = {
  actorId: 'user-001', terminalId: 'terminal-001', originNodeId: 'node-001',
  correlationId: 'correlation-001', idempotencyKey: 'report-request-001'
};
const committedEvidence = {
  dispatchState: 'RESULT_RECEIVED', commandEffect: 'APPLIED',
  fiscalCommit: 'COMMITTED', printDelivery: 'COMPLETE'
} as const;
const notStartedEvidence = {
  dispatchState: 'NOT_STARTED', commandEffect: 'NOT_APPLIED',
  fiscalCommit: 'NOT_COMMITTED', printDelivery: 'INCOMPLETE'
} as const;
const rejectedEvidence = {
  dispatchState: 'RESULT_RECEIVED', commandEffect: 'REJECTED',
  fiscalCommit: 'NOT_COMMITTED', printDelivery: 'INCOMPLETE'
} as const;

class Repository implements FiscalDayRepository {
  stored: FiscalDay | null = null;
  states: string[] = [];
  async save(day: FiscalDay): Promise<void> { this.stored = day; this.states.push(day.state); }
  async findById(id: string): Promise<FiscalDay | null> { return this.stored?.id === id ? this.stored : null; }
  async findOpenByTerminal(): Promise<FiscalDay | null> {
    return this.stored && this.stored.state !== 'DAY_CLOSED' ? this.stored : null;
  }
  async findByReportIdempotencyKey(originNodeId: string, key: string): Promise<FiscalDay | null> {
    return this.stored?.originNodeId === originNodeId &&
      this.stored.reports.some((report) => report.idempotencyKey === key) ? this.stored : null;
  }
  async findRecoverable(): Promise<FiscalDay[]> {
    return this.stored?.reports.some(({ status }) =>
      ['PENDING', 'PRINTING', 'ERROR', 'RETRYING'].includes(status)) ? [this.stored] : [];
  }
}

const setup = (response: 'ACK' | 'PAPER_END' | 'MEMORY_FULL' = 'ACK') => {
  const repository = new Repository();
  const evidence = { active: false, ledger: [] as string[], outbox: [] as string[], audit: [] as AuditEntry[] };
  const confirmation = {
    reportNumber: 'R-000001', confirmedAt: new Date('2026-08-30T20:00:00.000Z'),
    evidence: committedEvidence
  };
  const result = response === 'ACK' ? { ok: true as const, value: confirmation } : {
    ok: false as const,
    error: response === 'PAPER_END' ? {
      code: 'FISCAL_PRINTER_PAPER_END' as const, evidence: notStartedEvidence,
      retryable: true, message: 'No paper.'
    } : {
      code: 'FISCAL_PRINTER_MEMORY_FULL' as const, evidence: rejectedEvidence,
      retryable: false, message: 'Memory full.'
    }
  };
  const printer: FiscalPrinterPort = {
    getStatus: async () => { throw new Error('not expected'); },
    printInvoice: async () => { throw new Error('not expected'); },
    printCreditNote: async () => { throw new Error('not expected'); },
    printXReport: async () => { expect(evidence.active).toBe(false); return result; },
    printZReport: async () => { expect(evidence.active).toBe(false); return result; }
  };
  const unitOfWork: UnitOfWork = { execute: async (work) => {
    evidence.active = true;
    try { return await work(); } finally { evidence.active = false; }
  } };
  const eventStore: BusinessEventStore = {
    append: async (events) => { evidence.ledger.push(...events.map(({ eventType }) => eventType)); },
    findByAggregate: async () => []
  };
  const outboxStore: OutboxStore = {
    enqueue: async (events) => { evidence.outbox.push(...events.map(({ eventType }) => eventType)); },
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
  };
  let id = 0;
  const generator = { generate: () => `id-${++id}` };
  const common = [
    repository, printer, { authorize: async () => true }, generator, generator, generator,
    { now: () => new Date('2026-08-30T20:00:00.000Z') }, unitOfWork, eventStore,
    outboxStore, {
      append: async (entries: readonly AuditEntry[]) => { evidence.audit.push(...entries); }
    }
  ] as const;
  return { repository, evidence, common };
};

describe('fiscal reports', () => {
  it('keeps a PENDING report visible to startup recovery', async () => {
    const repository = new Repository();
    const day = FiscalDay.open({
      id: 'day-001', businessDate: '2026-08-30', terminalId: 'terminal-001',
      originNodeId: 'node-001', openedBy: 'user-001',
      openedAt: new Date('2026-08-30T08:00:00.000Z'), eventId: 'event-001'
    });
    day.requestReport({
      id: 'report-001', type: 'X', idempotencyKey: 'report-key',
      requestFingerprint: 'fingerprint', actorId: 'user-001',
      occurredAt: new Date('2026-08-30T09:00:00.000Z'), eventId: 'event-002'
    });
    repository.stored = day;

    expect(await repository.findRecoverable()).toEqual([day]);
  });

  it('issues X without closing the fiscal day', async () => {
    const { repository, evidence, common } = setup();
    const result = await new PrintXReport(...common).execute({
      dayId: 'day-001', businessDate: '2026-08-30', reason: 'Control report'
    }, context);
    expect(result.ok).toBe(true);
    expect(repository.stored?.state).toBe('DAY_OPEN');
    expect(repository.stored?.reports[0]).toMatchObject({
      type: 'X', status: 'ISSUED', lastEvidence: committedEvidence
    });
    expect(evidence.outbox).toEqual(['FiscalXReportIssued']);
  });

  it('closes the fiscal day only after Z is confirmed', async () => {
    const { repository, evidence, common } = setup();
    const result = await new PrintZReport(...common).execute({
      dayId: 'day-001', businessDate: '2026-08-30', reason: 'Daily close'
    }, context);
    expect(result.ok).toBe(true);
    expect(repository.stored?.state).toBe('DAY_CLOSED');
    expect(evidence.audit).toMatchObject([{ action: 'FISCAL_Z_REPORT_ISSUED' }]);
  });

  it.each([
    ['PAPER_END', 'ERROR'],
    ['MEMORY_FULL', 'ERROR']
  ] as const)('persists %s as %s', async (response, expectedStatus) => {
    const { repository, evidence, common } = setup(response);
    const result = await new PrintXReport(...common).execute({
      dayId: 'day-001', businessDate: '2026-08-30', reason: 'Control report'
    }, context);
    expect(result.ok).toBe(false);
    expect(repository.stored?.reports[0]?.status).toBe(expectedStatus);
    expect(await repository.findRecoverable()).toEqual([repository.stored]);
    expect(evidence.audit).toMatchObject([{ action: 'FISCAL_REPORT_ERROR_RECORDED' }]);
    expect(evidence.ledger).toContain('FiscalReportErrorRecorded');
    expect(evidence.ledger).not.toContain('FiscalReportFailed');
  });
});
