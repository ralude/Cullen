import type {
  AuditReportEntryDto,
  AuditReportInput,
  AuditReportRepository,
  CashClosureBalanceDto,
  CashClosureReportEntryDto,
  CashClosureReportInput,
  CashClosureReportRepository,
  FiscalOperationReportEntryDto,
  FiscalOperationsReportInput,
  FiscalOperationsReportRepository,
  MarginReportEntryDto,
  MarginReportInput,
  MarginReportRepository,
  ResolvedReportQuery
} from '@supermarket/core';
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import type { DatabaseHandle } from './connection.js';
import {
  auditLogs,
  cashMovements,
  fiscalDocuments,
  fiscalReports,
  shiftClosingBalances,
  shifts
} from './schema.js';

const EVIDENCE_AXES = [
  'lastDispatchState', 'lastCommandEffect', 'lastFiscalCommit', 'lastPrintDelivery'
] as const;

const evidenceOf = (row: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> | null => {
  const entries: [string, string][] = [];
  for (const axis of EVIDENCE_AXES) {
    const value = row[axis];
    if (typeof value === 'string') entries.push([axis, value]);
  }
  return entries.length === 0 ? null : Object.fromEntries(entries);
};

const roleCodesOf = (value: string): readonly string[] => {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((code): code is string => typeof code === 'string') : [];
  } catch {
    return [];
  }
};

const every = (conditions: readonly (SQL | undefined)[]): SQL | undefined => {
  const present = conditions.filter((condition): condition is SQL => condition !== undefined);
  return present.length === 0 ? undefined : and(...present);
};

export class DrizzleCashClosureReportRepository implements CashClosureReportRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async findCashClosures(
    query: ResolvedReportQuery<CashClosureReportInput>
  ): Promise<readonly CashClosureReportEntryDto[]> {
    const occurredAt = sql<number>`coalesce(${shifts.closedAt}, ${shifts.openedAt})`;
    const rows = this.handle.db.select().from(shifts).where(every([
      query.from === undefined ? undefined : gte(occurredAt, query.from.getTime()),
      query.to === undefined ? undefined : lte(occurredAt, query.to.getTime()),
      query.cashRegisterId === undefined
        ? undefined
        : eq(shifts.cashRegisterId, query.cashRegisterId)
    ])).orderBy(desc(occurredAt)).limit(query.limit).all();

    return rows.map((row) => ({
      shiftId: row.id,
      cashRegisterId: row.cashRegisterId,
      terminalId: row.terminalId,
      originNodeId: row.originNodeId,
      openedBy: row.openedBy,
      openedAt: new Date(row.openedAt),
      closedBy: row.closedBy,
      closedAt: row.closedAt === null ? null : new Date(row.closedAt),
      movementCount: this.handle.db.select({ total: sql<number>`count(*)` })
        .from(cashMovements).where(eq(cashMovements.shiftId, row.id)).get()?.total ?? 0,
      balances: this.handle.db.select().from(shiftClosingBalances)
        .where(eq(shiftClosingBalances.shiftId, row.id)).all()
        .map((balance): CashClosureBalanceDto => ({
          paymentMethodCode: balance.paymentMethodCode,
          currencyCode: balance.currencyCode,
          expectedMinorUnits: balance.expectedMinorUnits,
          declaredMinorUnits: balance.declaredMinorUnits,
          differenceMinorUnits: balance.differenceMinorUnits
        }))
    }));
  }
}

export class DrizzleAuditReportRepository implements AuditReportRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async findAuditEntries(
    query: ResolvedReportQuery<AuditReportInput>
  ): Promise<readonly AuditReportEntryDto[]> {
    const rows = this.handle.db.select({
      auditId: auditLogs.auditId,
      actorId: auditLogs.actorId,
      actorRoleCodes: auditLogs.actorRoleCodes,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      reason: auditLogs.reason,
      terminalId: auditLogs.terminalId,
      originNodeId: auditLogs.originNodeId,
      occurredAt: auditLogs.occurredAt,
      correlationId: auditLogs.correlationId
    }).from(auditLogs).where(every([
      query.from === undefined ? undefined : gte(auditLogs.occurredAt, query.from.getTime()),
      query.to === undefined ? undefined : lte(auditLogs.occurredAt, query.to.getTime()),
      query.actorId === undefined ? undefined : eq(auditLogs.actorId, query.actorId),
      query.action === undefined ? undefined : eq(auditLogs.action, query.action),
      query.entityType === undefined ? undefined : eq(auditLogs.entityType, query.entityType)
    ])).orderBy(desc(auditLogs.occurredAt), desc(auditLogs.auditId)).limit(query.limit).all();

    return rows.map((row) => ({
      ...row,
      actorRoleCodes: roleCodesOf(row.actorRoleCodes),
      occurredAt: new Date(row.occurredAt)
    }));
  }
}

export class DrizzleFiscalOperationsReportRepository implements FiscalOperationsReportRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async findFiscalOperations(
    query: ResolvedReportQuery<FiscalOperationsReportInput>
  ): Promise<readonly FiscalOperationReportEntryDto[]> {
    const documents = this.handle.db.select().from(fiscalDocuments).where(every([
      query.from === undefined ? undefined : gte(fiscalDocuments.createdAt, query.from),
      query.to === undefined ? undefined : lte(fiscalDocuments.createdAt, query.to)
    ])).orderBy(desc(fiscalDocuments.createdAt)).limit(query.limit).all()
      .map((row): FiscalOperationReportEntryDto => ({
        kind: 'DOCUMENT',
        id: row.id,
        referenceId: row.referenceId,
        dayId: null,
        operationType: row.documentType,
        status: row.status,
        attempts: row.attempts,
        fiscalNumber: row.fiscalNumber,
        lastErrorCode: row.lastErrorCode,
        evidence: evidenceOf(row),
        requestedAt: row.createdAt
      }));

    const reports = this.handle.db.select().from(fiscalReports).where(every([
      query.from === undefined ? undefined : gte(fiscalReports.requestedAt, query.from),
      query.to === undefined ? undefined : lte(fiscalReports.requestedAt, query.to)
    ])).orderBy(desc(fiscalReports.requestedAt)).limit(query.limit).all()
      .map((row): FiscalOperationReportEntryDto => ({
        kind: 'REPORT',
        id: row.id,
        referenceId: null,
        dayId: row.dayId,
        operationType: row.reportType,
        status: row.status,
        attempts: row.attempts,
        fiscalNumber: row.reportNumber,
        lastErrorCode: row.lastErrorCode,
        evidence: evidenceOf(row),
        requestedAt: row.requestedAt
      }));

    return [...documents, ...reports]
      .sort((left, right) => right.requestedAt.getTime() - left.requestedAt.getTime()
        || left.id.localeCompare(right.id))
      .slice(0, query.limit);
  }
}

/**
 * Margen neto agregado y acotado en SQLite. Las escalas forman parte de la
 * clave para no sumar cantidades incompatibles; descuentos y devoluciones
 * conservan columnas separadas para que la respuesta explique el neto.
 */
export class DrizzleMarginReportRepository implements MarginReportRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async findMargins(query: ResolvedReportQuery<MarginReportInput>): Promise<readonly MarginReportEntryDto[]> {
    type Row = Omit<MarginReportEntryDto, 'marginMinorUnits'>;
    const rows = this.handle.sqlite.prepare(`
      with
      sale_base as (
        select item.product_id, item.currency_code, item.quantity_scale,
          item.quantity_scaled,
          cast(case item.quantity_scale
            when 0 then item.price_minor_units * item.quantity_scaled
            when 1 then (item.price_minor_units * item.quantity_scaled + 5) / 10
            when 2 then (item.price_minor_units * item.quantity_scaled + 50) / 100
            when 3 then (item.price_minor_units * item.quantity_scaled + 500) / 1000
            when 4 then (item.price_minor_units * item.quantity_scaled + 5000) / 10000
            when 5 then (item.price_minor_units * item.quantity_scaled + 50000) / 100000
            when 6 then (item.price_minor_units * item.quantity_scaled + 500000) / 1000000
          end as integer) as gross_minor_units,
          coalesce((select sum(discount.amount_minor_units) from sale_discounts discount
            where discount.item_id = item.id), 0) as discount_minor_units
        from sale_items item
        join sales sale on sale.id = item.sale_id
        where sale.status = 'COMPLETED' and sale.completed_at between @from and @to
      ),
      sale_group as (
        select product_id, currency_code, quantity_scale,
          sum(quantity_scaled) as quantity_sold_scaled,
          sum(discount_minor_units) as discount_minor_units,
          sum(gross_minor_units - discount_minor_units) as sale_revenue_minor_units
        from sale_base group by product_id, currency_code, quantity_scale
      ),
      cost_group as (
        select item.product_id,
          coalesce(movement.cost_currency_code, item.valuation_currency_code) as currency_code,
          movement.quantity_scale,
          case when sum(case when movement.unit_cost_minor_units is null then 1 else 0 end) = 0
            then sum(cast(case movement.quantity_scale
              when 0 then movement.unit_cost_minor_units * movement.quantity_scaled
              when 1 then (movement.unit_cost_minor_units * movement.quantity_scaled + 5) / 10
              when 2 then (movement.unit_cost_minor_units * movement.quantity_scaled + 50) / 100
              when 3 then (movement.unit_cost_minor_units * movement.quantity_scaled + 500) / 1000
              when 4 then (movement.unit_cost_minor_units * movement.quantity_scaled + 5000) / 10000
              when 5 then (movement.unit_cost_minor_units * movement.quantity_scaled + 50000) / 100000
              when 6 then (movement.unit_cost_minor_units * movement.quantity_scaled + 500000) / 1000000
            end as integer)) else null end as sale_cost_minor_units
        from stock_movements movement
        join stock_items item on item.id = movement.stock_item_id
        where movement.type = 'SALE_ISSUE' and movement.occurred_at between @from and @to
          and coalesce(movement.cost_currency_code, item.valuation_currency_code) is not null
        group by item.product_id, coalesce(movement.cost_currency_code, item.valuation_currency_code),
          movement.quantity_scale
      ),
      return_item as (
        select line.sale_item_id, line.product_id, line.quantity_scale,
          sum(line.quantity_scaled) as quantity_scaled
        from sale_return_lines line
        join sale_returns returned on returned.id = line.sale_return_id
        where returned.occurred_at between @from and @to
        group by line.sale_item_id, line.product_id, line.quantity_scale
      ),
      return_group as (
        select returned_item.product_id, original.currency_code, returned_item.quantity_scale,
          sum(returned_item.quantity_scaled) as quantity_returned_scaled,
          sum(cast(case returned_item.quantity_scale
            when 0 then original.price_minor_units * returned_item.quantity_scaled
            when 1 then (original.price_minor_units * returned_item.quantity_scaled + 5) / 10
            when 2 then (original.price_minor_units * returned_item.quantity_scaled + 50) / 100
            when 3 then (original.price_minor_units * returned_item.quantity_scaled + 500) / 1000
            when 4 then (original.price_minor_units * returned_item.quantity_scaled + 5000) / 10000
            when 5 then (original.price_minor_units * returned_item.quantity_scaled + 50000) / 100000
            when 6 then (original.price_minor_units * returned_item.quantity_scaled + 500000) / 1000000
          end as integer) - coalesce((select sum(discount.amount_minor_units)
            from sale_discounts discount where discount.item_id = original.id), 0))
            as return_revenue_minor_units
        from return_item returned_item
        join sale_items original on original.id = returned_item.sale_item_id
        group by returned_item.product_id, original.currency_code, returned_item.quantity_scale
      ),
      return_cost_group as (
        select line.product_id, line.cost_currency_code as currency_code, line.quantity_scale,
          case when sum(case when line.unit_cost_minor_units is null then 1 else 0 end) = 0
            then sum(cast(case line.quantity_scale
              when 0 then line.unit_cost_minor_units * line.quantity_scaled
              when 1 then (line.unit_cost_minor_units * line.quantity_scaled + 5) / 10
              when 2 then (line.unit_cost_minor_units * line.quantity_scaled + 50) / 100
              when 3 then (line.unit_cost_minor_units * line.quantity_scaled + 500) / 1000
              when 4 then (line.unit_cost_minor_units * line.quantity_scaled + 5000) / 10000
              when 5 then (line.unit_cost_minor_units * line.quantity_scaled + 50000) / 100000
              when 6 then (line.unit_cost_minor_units * line.quantity_scaled + 500000) / 1000000
            end as integer)) else null end as return_cost_minor_units
        from sale_return_lines line
        join sale_returns returned on returned.id = line.sale_return_id
        where returned.occurred_at between @from and @to and line.cost_currency_code is not null
        group by line.product_id, line.cost_currency_code, line.quantity_scale
      ),
      report_keys as (
        select product_id, currency_code, quantity_scale from sale_group union
        select product_id, currency_code, quantity_scale from cost_group union
        select product_id, currency_code, quantity_scale from return_group union
        select product_id, currency_code, quantity_scale from return_cost_group
      )
      select keys.product_id as productId, keys.currency_code as currencyCode,
        coalesce(sale.quantity_sold_scaled, 0) as quantitySoldScaled,
        coalesce(returned.quantity_returned_scaled, 0) as quantityReturnedScaled,
        keys.quantity_scale as quantityScale,
        coalesce(sale.discount_minor_units, 0) as discountMinorUnits,
        coalesce(returned.return_revenue_minor_units, 0) as returnRevenueMinorUnits,
        coalesce(return_cost.return_cost_minor_units, 0) as returnCostMinorUnits,
        case when sale.product_id is null and returned.product_id is null then null
          else coalesce(sale.sale_revenue_minor_units, 0) - coalesce(returned.return_revenue_minor_units, 0)
          end as revenueMinorUnits,
        case when cost.product_id is null and return_cost.product_id is null then null
          when cost.product_id is not null and cost.sale_cost_minor_units is null then null
          when return_cost.product_id is not null and return_cost.return_cost_minor_units is null then null
          else coalesce(cost.sale_cost_minor_units, 0) - coalesce(return_cost.return_cost_minor_units, 0)
          end as costMinorUnits
      from report_keys keys
      left join sale_group sale using (product_id, currency_code, quantity_scale)
      left join cost_group cost using (product_id, currency_code, quantity_scale)
      left join return_group returned using (product_id, currency_code, quantity_scale)
      left join return_cost_group return_cost using (product_id, currency_code, quantity_scale)
      where @currency is null or keys.currency_code = @currency
      order by keys.product_id, keys.currency_code, keys.quantity_scale
      limit @limit
    `).all({
      from: query.from.getTime(), to: query.to.getTime(),
      currency: query.currencyCode ?? null, limit: query.limit
    }) as Row[];

    return rows.map((row) => ({
      ...row,
      marginMinorUnits: row.revenueMinorUnits !== null && row.costMinorUnits !== null
        ? row.revenueMinorUnits - row.costMinorUnits
        : null
    }));
  }
}
