import {
  ApplicationError,
  DomainError,
  err,
  Money,
  ok,
  type AppError,
  type Result
} from '@supermarket/shared';
import type { Clock, IdGenerator, ProductRepository } from '../ports/index.js';
import type { ExecutionContext } from '../execution-context.js';
import { persistBusinessChange, type JsonValue } from '../events/index.js';
import { executeIdempotentCommand } from '../idempotency/index.js';
import type {
  AuditWriter, AuthorizationService, BusinessEventStore, IdempotencyStore,
  OutboxStore, UnitOfWork
} from '../ports/index.js';
import type { ProductDto, UpdatePriceInput } from './dtos.js';
import { toProductDto } from './mappers.js';
import { toProductPublication } from './reference-publications.js';
import { CATALOG_PERMISSIONS } from './permissions.js';

export class UpdatePrice {
  constructor(
    private readonly repository: ProductRepository,
    private readonly priceHistoryIdGenerator: IdGenerator,
    private readonly eventIdGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly authorization: AuthorizationService,
    private readonly unitOfWork?: UnitOfWork,
    private readonly eventStore?: BusinessEventStore,
    private readonly outboxStore?: OutboxStore,
    private readonly idempotencyStore?: IdempotencyStore,
    private readonly auditWriter?: AuditWriter
  ) {}

  async execute(input: UpdatePriceInput, context: ExecutionContext): Promise<Result<ProductDto, AppError>> {
    if (!(await this.authorization.authorize(context, CATALOG_PERMISSIONS.UPDATE_PRICE))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to update prices.'));
    }
    const now = this.clock.now();
    try {
      return await executeIdempotentCommand({
        operation: 'UpdatePrice', input, context, now,
        ...(this.unitOfWork ? { unitOfWork: this.unitOfWork } : {}),
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: async () => {
      const product = await this.repository.findById(input.productId);
      if (product === null) {
        return err(new ApplicationError('PRODUCT_NOT_FOUND', 'Product was not found.'));
      }
      const before = toProductDto(product);

      product.changePrice({
        price: Money.fromMinorUnits(input.priceMinorUnits, input.currencyCode),
        priceHistoryId: this.priceHistoryIdGenerator.generate(),
        changedBy: context.actorId,
        reason: input.reason,
        occurredAt: now,
        eventId: this.eventIdGenerator.generate()
      });
      const dto = toProductDto(product);
      await persistBusinessChange(
        () => this.repository.save(product), product.domainEvents, context,
        undefined, this.eventStore, this.outboxStore, [],
        this.auditWriter, this.auditWriter ? [{
          auditId: this.eventIdGenerator.generate(), actorId: context.actorId,
          actorRoleCodes: context.actorRoleCodes ?? [], action: 'CATALOG_PRICE_UPDATED',
          entityType: 'Product', entityId: product.id,
          before: JSON.parse(JSON.stringify(before)) as JsonValue,
          after: JSON.parse(JSON.stringify(dto)) as JsonValue, reason: input.reason,
          terminalId: context.terminalId, originNodeId: context.originNodeId,
          occurredAt: now, correlationId: context.correlationId
        }] : [],
        [toProductPublication(product, {
          eventId: this.eventIdGenerator.generate(), occurredAt: now
        })]
      );
      return ok(dto);
        },
        serialize: (output) => JSON.parse(JSON.stringify(output)) as JsonValue,
        restore: (output) => output as unknown as ProductDto
      });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }
}
