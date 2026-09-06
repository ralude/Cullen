import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuditReportRepository,
  AuthorizationService,
  CashClosureReportRepository,
  FiscalOperationsReportRepository,
  InventoryReportRepository,
  MarginReportRepository,
  SalesReportRepository
} from '../ports/index.js';
import { GetAuditReport } from './get-audit-report.js';
import { GetCashClosureReport } from './get-cash-closure-report.js';
import { GetFiscalOperationsReport } from './get-fiscal-operations-report.js';
import { GetInventoryReport } from './get-inventory-report.js';
import { GetMarginReport } from './get-margin-report.js';
import { GetSalesReport } from './get-sales-report.js';
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
implements CashClosureReportRepository, AuditReportRepository, FiscalOperationsReportRepository,
  MarginReportRepository, SalesReportRepository, InventoryReportRepository {
  readonly queries: { readonly kind: string; readonly limit: number; readonly currencyCode?: string }[] = [];
  async findSalesSummary(query: { readonly limit: number; readonly currencyCode?: string }): Promise<[]> {
    this.queries.push({
      kind: 'sales', limit: query.limit,
      ...(query.currencyCode === undefined ? {} : { currencyCode: query.currencyCode })
    });
    return [];
  }
  async findInventorySnapshot(query: { readonly limit: number }): Promise<[]> {
    this.queries.push({ kind: 'inventory', limit: query.limit });
    return [];
  }
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
  async findMargins(query: { readonly limit: number; readonly currencyCode?: string }): Promise<[]> {
    this.queries.push({
      kind: 'margin', limit: query.limit,
      ...(query.currencyCode === undefined ? {} : { currencyCode: query.currencyCode })
    });
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

  it('rejects a margin report with an invalid or unordered UTC period', async () => {
    const authorization = new RecordingAuthorization(Object.values(REPORT_PERMISSIONS));
    const repositories = new RecordingRepositories();
    const report = new GetMarginReport(repositories, authorization);

    const unordered = await report.execute({
      from: new Date('2026-09-05T00:00:00Z'), to: new Date('2026-09-01T00:00:00Z')
    }, context);
    const invalid = await report.execute({
      from: new Date('not-a-date'), to: new Date('2026-09-05T00:00:00Z')
    }, context);

    expect(unordered).toMatchObject({ ok: false, error: { code: 'REPORT_PERIOD_INVALID' } });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'REPORT_PERIOD_INVALID' } });
    expect(repositories.queries).toEqual([]);
  });

  it('normalizes the margin currency filter to upper case at the boundary', async () => {
    const authorization = new RecordingAuthorization(Object.values(REPORT_PERMISSIONS));
    const repositories = new RecordingRepositories();

    await new GetMarginReport(repositories, authorization).execute({
      from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-02T00:00:00Z'),
      currencyCode: ' usd '
    }, context);

    expect(repositories.queries).toEqual([{ kind: 'margin', limit: REPORT_ROW_LIMIT.default, currencyCode: 'USD' }]);
  });

  it('gates the sales and inventory KPI reads with their own permission and a bounded query', async () => {
    const repositories = new RecordingRepositories();
    const denied = new RecordingAuthorization([]);

    const noSales = await new GetSalesReport(repositories, denied).execute({
      from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-02T00:00:00Z')
    }, context);
    const noInventory = await new GetInventoryReport(repositories, denied).execute({
      asOf: new Date('2026-09-02T00:00:00Z')
    }, context);
    expect(noSales).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(noInventory).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(repositories.queries).toEqual([]);

    const granted = new RecordingAuthorization(Object.values(REPORT_PERMISSIONS));
    const badPeriod = await new GetSalesReport(repositories, granted).execute({
      from: new Date('2026-09-05T00:00:00Z'), to: new Date('2026-09-01T00:00:00Z')
    }, context);
    expect(badPeriod).toMatchObject({ ok: false, error: { code: 'REPORT_PERIOD_INVALID' } });

    await new GetSalesReport(repositories, granted).execute({
      from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-02T00:00:00Z'), currencyCode: 'ves'
    }, context);
    await new GetInventoryReport(repositories, granted).execute({
      asOf: new Date('2026-09-02T00:00:00Z'), limit: 9_000
    }, context);
    expect(repositories.queries).toEqual([
      { kind: 'sales', limit: REPORT_ROW_LIMIT.default, currencyCode: 'VES' },
      { kind: 'inventory', limit: REPORT_ROW_LIMIT.maximum }
    ]);
  });
});
