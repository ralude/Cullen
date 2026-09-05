import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuditReportRepository,
  AuthorizationService,
  CashClosureReportRepository,
  FiscalOperationsReportRepository,
  MarginReportRepository
} from '../ports/index.js';
import { GetAuditReport } from './get-audit-report.js';
import { GetCashClosureReport } from './get-cash-closure-report.js';
import { GetFiscalOperationsReport } from './get-fiscal-operations-report.js';
import { GetMarginReport } from './get-margin-report.js';
import { REPORT_PERMISSIONS } from './permissions.js';
import { REPORT_ROW_LIMIT } from './row-limit.js';

const context: ExecutionContext = {
  actorId: 'user-001', terminalId: 'terminal-001', originNodeId: 'node-001',
  correlationId: 'correlation-001', actorRoleCodes: ['supervisor']
};

class RecordingAuthorization implements AuthorizationService {
  readonly asked: string[] = [];
  constructor(private readonly granted: readonly string[]) {}
  async authorize(_context: ExecutionContext, permission: string): Promise<boolean> {
    this.asked.push(permission);
    return this.granted.includes(permission);
  }
}

class RecordingRepositories
implements CashClosureReportRepository, AuditReportRepository, FiscalOperationsReportRepository, MarginReportRepository {
  readonly queries: { readonly kind: string; readonly limit: number }[] = [];
  async findCashClosures(query: { readonly limit: number }): Promise<[]> {
    this.queries.push({ kind: 'cash', limit: query.limit });
    return [];
  }
  async findAuditEntries(query: { readonly limit: number }): Promise<[]> {
    this.queries.push({ kind: 'audit', limit: query.limit });
    return [];
  }
  async findFiscalOperations(query: { readonly limit: number }): Promise<[]> {
    this.queries.push({ kind: 'fiscal', limit: query.limit });
    return [];
  }
  async findMargins(query: { readonly limit: number }): Promise<[]> {
    this.queries.push({ kind: 'margin', limit: query.limit });
    return [];
  }
}

describe('reporting read models', () => {
  it('denies every report before reading the projection', async () => {
    const authorization = new RecordingAuthorization([]);
    const repositories = new RecordingRepositories();
    const results = await Promise.all([
      new GetCashClosureReport(repositories, authorization).execute({}, context),
      new GetAuditReport(repositories, authorization).execute({}, context),
      new GetFiscalOperationsReport(repositories, authorization).execute({}, context),
      new GetMarginReport(repositories, authorization).execute({
        from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-02T00:00:00Z')
      }, context)
    ]);

    expect(results.every((result) => !result.ok)).toBe(true);
    expect(results.map((result) => result.ok ? null : result.error.code))
      .toEqual(['FORBIDDEN', 'FORBIDDEN', 'FORBIDDEN', 'FORBIDDEN']);
    expect(authorization.asked).toEqual([
      REPORT_PERMISSIONS.READ_CASH, REPORT_PERMISSIONS.READ_AUDIT, REPORT_PERMISSIONS.READ_FISCAL,
      REPORT_PERMISSIONS.READ_MARGIN
    ]);
    expect(repositories.queries).toEqual([]);
  });

  it('authorizes each report with its own permission', async () => {
    const authorization = new RecordingAuthorization([REPORT_PERMISSIONS.READ_CASH]);
    const repositories = new RecordingRepositories();

    const allowed = await new GetCashClosureReport(repositories, authorization).execute({}, context);
    const denied = await new GetAuditReport(repositories, authorization).execute({}, context);

    expect(allowed.ok).toBe(true);
    expect(denied.ok).toBe(false);
    expect(repositories.queries.map((query) => query.kind)).toEqual(['cash']);
  });

  it('never queries without a row limit inside the approved range', async () => {
    const granted = Object.values(REPORT_PERMISSIONS);
    const authorization = new RecordingAuthorization(granted);
    const repositories = new RecordingRepositories();
    const audit = new GetAuditReport(repositories, authorization);

    await audit.execute({}, context);
    await audit.execute({ limit: 50 }, context);
    await audit.execute({ limit: 5_000 }, context);
    await audit.execute({ limit: 0 }, context);
    await audit.execute({ limit: 1.5 }, context);
    await new GetCashClosureReport(repositories, authorization).execute({}, context);
    await new GetFiscalOperationsReport(repositories, authorization).execute({}, context);
    await new GetMarginReport(repositories, authorization).execute({
      from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-02T00:00:00Z')
    }, context);

    expect(repositories.queries.map((query) => query.limit)).toEqual([
      REPORT_ROW_LIMIT.default, 50, REPORT_ROW_LIMIT.maximum,
      REPORT_ROW_LIMIT.default, REPORT_ROW_LIMIT.default,
      REPORT_ROW_LIMIT.default, REPORT_ROW_LIMIT.default, REPORT_ROW_LIMIT.default
    ]);
  });
});
