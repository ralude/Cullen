import { ApplicationError, err, ok, type AppError, type Result } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type { AuthorizationService, StockItemRepository } from '../ports/index.js';
import type { GetKardexInput, KardexDto } from './dtos.js';
import { toStockMovementDto } from './mappers.js';
import { INVENTORY_PERMISSIONS } from './permissions.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export class GetKardex {
  constructor(
    private readonly repository: StockItemRepository,
    private readonly authorization: AuthorizationService
  ) {}

  async execute(input: GetKardexInput, context: ExecutionContext): Promise<Result<KardexDto, AppError>> {
    if (!(await this.authorization.authorize(context, INVENTORY_PERMISSIONS.READ_KARDEX))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to read the kardex.'));
    }
    const limit = input.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return err(new ApplicationError('KARDEX_LIMIT_INVALID', `Kardex limit must be between 1 and ${MAX_LIMIT}.`));
    }
    const item = await this.repository.findByProductId(input.productId);
    if (!item) return err(new ApplicationError('STOCK_ITEM_NOT_FOUND', 'Stock item was not found.'));
    const reason = input.reason?.trim().toLowerCase();
    const movements = item.movements.filter((movement) =>
      (input.batchId === undefined || movement.batchId === input.batchId) &&
      (input.from === undefined || movement.occurredAt.getTime() >= input.from.getTime()) &&
      (input.to === undefined || movement.occurredAt.getTime() <= input.to.getTime()) &&
      (!reason || movement.reason.toLowerCase().includes(reason))
    ).sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime()).slice(-limit);
    const currentBalance = input.batchId === undefined ? item.balance : item.balanceForBatch(input.batchId);
    return ok({ id: item.id, productId: item.productId, unitCode: item.unitCode, quantityScale: item.quantityScale,
      currentBalanceScaled: currentBalance.scaledValue,
      batches: item.batches.map((batch) => ({
        id: batch.id, lotNumber: batch.lotNumber, expiresAt: batch.expiresAt
      })),
      movements: movements.map(toStockMovementDto) });
  }
}
