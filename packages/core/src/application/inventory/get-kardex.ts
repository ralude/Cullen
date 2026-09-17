import { ApplicationError, DomainError, err, ok, type AppError, type Result } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type { AuthorizationService, KardexQuery, KardexReadRepository } from '../ports/index.js';
import type { GetKardexInput, KardexDto } from './dtos.js';
import { INVENTORY_PERMISSIONS } from './permissions.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export class GetKardex {
  constructor(
    private readonly repository: KardexReadRepository,
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
    const batchId = input.batchId?.trim();
    const query: KardexQuery = {
      productId: input.productId,
      limit,
      ...(batchId === undefined ? {} : { batchId }),
      ...(input.from === undefined ? {} : { from: input.from }),
      ...(input.to === undefined ? {} : { to: input.to }),
      ...(input.reason === undefined ? {} : { reason: input.reason.trim().toLowerCase() })
    };
    const kardex = await this.repository.findKardex(query);
    if (!kardex) return err(new ApplicationError('STOCK_ITEM_NOT_FOUND', 'Stock item was not found.'));
    /**
     * Las dos negativas de lote las levantaba el agregado al pedirle el saldo.
     * La lectura no reconstruye el agregado, así que el caso de uso conserva
     * aquí los mismos códigos y el mismo momento: antes de responder.
     */
    if (batchId !== undefined) {
      if (!kardex.tracksBatches) {
        throw new DomainError('STOCK_BATCH_NOT_TRACKED', 'This stock item does not track batches.');
      }
      if (!kardex.batches.some((batch) => batch.id === batchId)) {
        throw new DomainError('STOCK_BATCH_NOT_FOUND', 'Stock batch was not found.');
      }
    }
    return ok({
      id: kardex.id,
      productId: kardex.productId,
      unitCode: kardex.unitCode,
      quantityScale: kardex.quantityScale,
      currentBalanceScaled: kardex.balanceScaled,
      batches: kardex.batches.map((batch) => ({
        id: batch.id, lotNumber: batch.lotNumber, expiresAt: batch.expiresAt
      })),
      movements: [...kardex.movements]
    });
  }
}
