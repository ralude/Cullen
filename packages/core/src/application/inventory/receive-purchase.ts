import { ApplicationError, DomainError, err, Quantity, ok, type AppError, type Result } from '@supermarket/shared';
import { StockItem } from '../../domain/inventory/index.js';
import type { ExecutionContext } from '../execution-context.js';
import { persistBusinessChange } from '../events/index.js';
import { executeIdempotentCommand } from '../idempotency/index.js';
import type { AuditWriter, AuthorizationService, BusinessEventStore, Clock, IdGenerator, IdempotencyStore, OutboxStore, ProductRepository, StockItemRepository, SupplierRepository, UnitOfWork } from '../ports/index.js';
import { toStockAvailabilityPublications } from './stock-availability-publications.js';
import type { ReceivePurchaseInput, StockItemDto } from './dtos.js';
import { toStockItemDto } from './mappers.js';
import { INVENTORY_PERMISSIONS } from './permissions.js';
import { restoreStockItemDto, serializeStockItemDto } from './stock-idempotency.js';

export class ReceivePurchase {
  constructor(
    private readonly repository: StockItemRepository,
    private readonly supplierRepository: SupplierRepository,
    private readonly productRepository: ProductRepository,
    private readonly authorization: AuthorizationService,
    private readonly stockItemIdGenerator: IdGenerator,
    private readonly movementIdGenerator: IdGenerator,
    private readonly batchIdGenerator: IdGenerator,
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

  async execute(input: ReceivePurchaseInput, context: ExecutionContext): Promise<Result<StockItemDto, AppError>> {
    if (!(await this.authorization.authorize(context, INVENTORY_PERMISSIONS.RECEIVE_PURCHASE))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to receive purchases.'));
    }
    try {
      const occurredAt = this.clock.now();
      return await executeIdempotentCommand({
        operation: 'ReceivePurchase', input, context, now: occurredAt,
        unitOfWork: this.unitOfWork,
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: async () => {
        const supplier = await this.supplierRepository.findById(input.supplierId);
        if (!supplier) {
          return err(new ApplicationError('SUPPLIER_NOT_FOUND', 'Supplier was not found.'));
        }
        if (supplier.status !== 'ACTIVE') {
          return err(new ApplicationError('SUPPLIER_NOT_ACTIVE', 'Supplier is not active for new receipts.'));
        }
        /**
         * La primera recepción crea el artículo: su ID lo genera la aplicación
         * y su unidad y escala salen del catálogo. Un artículo ya existente
         * conserva su configuración aunque el catálogo cambie después, porque
         * su historia de movimientos está escrita en esa escala.
         */
        let item = await this.repository.findByProductId(input.productId);
        if (item === null) {
          const product = await this.productRepository.findById(input.productId);
          if (!product) {
            return err(new ApplicationError('PRODUCT_NOT_FOUND', 'Product was not found in the catalog.'));
          }
          item = StockItem.create({
            id: this.stockItemIdGenerator.generate(),
            productId: input.productId,
            unitCode: product.unitOfMeasure.code,
            quantityScale: product.unitOfMeasure.quantityScale,
            tracksBatches: input.lot !== undefined
          });
        }
        let batchId: string | undefined;
        if (item.tracksBatches) {
          if (!input.lot) return err(new ApplicationError('STOCK_BATCH_REQUIRED', 'A lot is required for this receipt.'));
          const lotNumber = input.lot.lotNumber.trim().toUpperCase();
          const batch = item.batches.find((candidate) => candidate.lotNumber === lotNumber) ?? item.registerBatch({
            id: this.batchIdGenerator.generate(), lotNumber,
            ...(input.lot.expiresAt ? { expiresAt: input.lot.expiresAt } : {})
          });
          batchId = batch.id;
        } else if (input.lot) {
          return err(new ApplicationError('STOCK_BATCH_NOT_ACCEPTED', 'This stock item does not accept a lot.'));
        }
        const previousEventCount = item.domainEvents.length;
        const movement = item.registerMovement({
          id: this.movementIdGenerator.generate(), type: 'PURCHASE_RECEIPT',
          quantity: Quantity.fromDecimal(input.quantity, item.quantityScale),
          ...(batchId ? { batchId } : {}), actorId: context.actorId, reason: input.reason,
          referenceId: input.receiptId, occurredAt, eventId: this.eventIdGenerator.generate()
        });
        await persistBusinessChange(
          () => this.repository.save(item), item.domainEvents.slice(previousEventCount), context,
          undefined, this.eventStore, this.outbox, [], this.auditWriter, [{
            auditId: this.auditIdGenerator.generate(), actorId: context.actorId,
            actorRoleCodes: context.actorRoleCodes ?? [], action: 'PURCHASE_RECEIPT_REGISTERED',
            entityType: 'StockItem', entityId: item.id, before: null,
            after: { supplierId: input.supplierId, receiptId: input.receiptId, movementId: movement.id,
              quantityScaled: movement.quantity.scaledValue, quantityScale: movement.quantity.scale,
              batchId: movement.batchId },
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
