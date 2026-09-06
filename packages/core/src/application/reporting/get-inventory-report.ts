import { ApplicationError, err, ok, type AppError, type Result } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type { AuthorizationService, InventoryReportRepository } from '../ports/index.js';
import type { InventoryReportEntryDto, InventoryReportInput } from './dtos.js';
import { REPORT_PERMISSIONS } from './permissions.js';
import { resolveRowLimit } from './row-limit.js';

export class GetInventoryReport {
  constructor(
    private readonly repository: InventoryReportRepository,
    private readonly authorization: AuthorizationService
  ) {}

  async execute(
    input: InventoryReportInput,
    context: ExecutionContext
  ): Promise<Result<readonly InventoryReportEntryDto[], AppError>> {
    if (!await this.authorization.authorize(context, REPORT_PERMISSIONS.READ_INVENTORY)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to read inventory reports.'));
    }
    if (Number.isNaN(input.asOf.getTime())) {
      return err(new ApplicationError('REPORT_PERIOD_INVALID', 'Report cutoff date must be a valid UTC instant.'));
    }
    if (input.expiringWithinDays !== undefined
      && (!Number.isInteger(input.expiringWithinDays) || input.expiringWithinDays < 0)) {
      return err(new ApplicationError('REPORT_PERIOD_INVALID', 'The expiry window must be a non-negative integer of days.'));
    }
    return ok(await this.repository.findInventorySnapshot({ ...input, limit: resolveRowLimit(input.limit) }));
  }
}
