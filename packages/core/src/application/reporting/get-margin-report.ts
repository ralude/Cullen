import { ApplicationError, err, ok, type AppError, type Result } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type { AuthorizationService, MarginReportRepository } from '../ports/index.js';
import type { MarginReportEntryDto, MarginReportInput } from './dtos.js';
import { REPORT_PERMISSIONS } from './permissions.js';
import { resolveRowLimit } from './row-limit.js';

export class GetMarginReport {
  constructor(
    private readonly repository: MarginReportRepository,
    private readonly authorization: AuthorizationService
  ) {}

  async execute(
    input: MarginReportInput,
    context: ExecutionContext
  ): Promise<Result<readonly MarginReportEntryDto[], AppError>> {
    if (!await this.authorization.authorize(context, REPORT_PERMISSIONS.READ_MARGIN)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to read margin reports.'));
    }
    if (Number.isNaN(input.from.getTime()) || Number.isNaN(input.to.getTime()) || input.from > input.to) {
      return err(new ApplicationError('REPORT_PERIOD_INVALID', 'Report period must be a valid ordered UTC range.'));
    }
    return ok(await this.repository.findMargins({ ...input, limit: resolveRowLimit(input.limit) }));
  }
}
