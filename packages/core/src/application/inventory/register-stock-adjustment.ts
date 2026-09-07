import { ApplicationError, DomainError, err, Quantity, ok, type AppError, type Result } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import { persistBusinessChange } from '../events/index.js';
import { executeIdempotentCommand } from '../idempotency/index.js';
import type { AuditWriter, AuthorizationService, BusinessEventStore, Clock, IdGenerator, IdempotencyStore, OutboxStore, StockItemRepository, UnitOfWork } from '../ports/index.js';
import { toStockAvailabilityPublications } from './stock-availability-publications.js';
import type { RegisterStockAdjustmentInput, StockItemDto } from './dtos.js';
import { toStockItemDto } from './mappers.js';
import { INVENTORY_PERMISSIONS } from './permissions.js';
import { restoreStockItemDto, serializeStockItemDto } from './stock-idempotency.js';

export class RegisterStockAdjustment {
  constructor(
    private readonly repository: StockItemRepository,
    private readonly authorization: AuthorizationService,
    private readonly movementIdGenerator: IdGenerator,
    private readonly eventIdGenerator: IdGenerator,
    private readonly auditIdGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly eventStore: BusinessEventStore,
    private readonly auditWriter: AuditWriter,
    private readonly idempotencyStore?: IdempotencyStore,
    /** Salida del coordinador: publica la disponibilidad informativa del ítem. */
    private readonly outbox?: OutboxStore
  ) {}

  async execute(input: RegisterStockAdjustmentInput, context: ExecutionContext): Promise<Result<StockItemDto, AppError>> {
    const permission = input.type === 'WASTE' ? INVENTORY_PERMISSIONS.REGISTER_WASTE : INVENTORY_PERMISSIONS.REGISTER_ADJUSTMENT;
    if (!(await this.authorization.authorize(context, permission))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized for this stock movement.'));
    }
    try {
      const occurredAt = this.clock.now();
      return await executeIdempotentCommand({
        operation: 'RegisterStockAdjustment', input, context, now: occurredAt,
        unitOfWork: this.unitOfWork,
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: async () => {
        const item = await this.repository.findById(input.stockItemId);
        if (item === null) return err(new ApplicationError('STOCK_ITEM_NOT_FOUND', 'Stock item was not found.'));
        const before = item.balance.scaledValue;
        const previousEventCount = item.domainEvents.length;
        const movement = item.registerMovement({
          id: this.movementIdGenerator.generate(), type: input.type,
          quantity: Quantity.fromScaled(input.quantityScaled, input.quantityScale),
          ...(input.batchId ? { batchId: input.batchId } : {}), actorId: context.actorId,
          reason: input.reason, referenceId: input.referenceId, occurredAt,
          eventId: this.eventIdGenerator.generate()
        });
        await persistBusinessChange(
          () => this.repository.save(item), item.domainEvents.slice(previousEventCount), context,
          undefined, this.eventStore, this.outbox, [], this.auditWriter, [{
            auditId: this.auditIdGenerator.generate(), actorId: context.actorId,
            actorRoleCodes: context.actorRoleCodes ?? [],
            action: input.type === 'WASTE' ? 'STOCK_WASTE_REGISTERED' : 'STOCK_ADJUSTMENT_REGISTERED',
            entityType: 'StockItem', entityId: item.id,
            before: { balanceScaled: before }, after: { balanceScaled: item.balance.scaledValue, movementId: movement.id },
            reason: movement.reason, terminalId: context.terminalId, originNodeId: context.originNodeId,
            occurredAt, correlationId: context.correlationId
          }],
          toStockAvailabilityPublications([item], this.eventIdGenerator, occurredAt)
        );
          return ok(toStockItemDto(item));
        },
        serialize: serializeStockItemDto,
        restore: restoreStockItemDto
      });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }
}
