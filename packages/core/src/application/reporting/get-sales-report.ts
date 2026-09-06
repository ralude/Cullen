import { ApplicationError, err, ok, type AppError, type Result } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type { AuthorizationService, SalesReportRepository } from '../ports/index.js';
import type { SalesReportEntryDto, SalesReportInput } from './dtos.js';
import { REPORT_PERMISSIONS } from './permissions.js';
import { resolveRowLimit } from './row-limit.js';

export class GetSalesReport {
  constructor(
    private readonly repository: SalesReportRepository,
    private readonly authorization: AuthorizationService
  ) {}

  async execute(
    input: SalesReportInput,
    context: ExecutionContext
  ): Promise<Result<readonly SalesReportEntryDto[], AppError>> {
    if (!await this.authorization.authorize(context, REPORT_PERMISSIONS.READ_SALES)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to read sales reports.'));
    }
    if (Number.isNaN(input.from.getTime()) || Number.isNaN(input.to.getTime()) || input.from > input.to) {
      return err(new ApplicationError('REPORT_PERIOD_INVALID', 'Report period must be a valid ordered UTC range.'));
    }
    const currencyCode = input.currencyCode?.trim().toUpperCase();
    return ok(await this.repository.findSalesSummary({
      ...input,
      ...(currencyCode ? { currencyCode } : {}),
      limit: resolveRowLimit(input.limit)
    }));
  }
}
