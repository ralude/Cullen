import { ApplicationError, DomainError, err, ok, Quantity, type AppError, type Result } from '@supermarket/shared';
import { StockCount, type StockCountDifference } from '../../domain/inventory/index.js';
import type { ExecutionContext } from '../execution-context.js';
import { persistBusinessChange } from '../events/index.js';
import { executeIdempotentCommand } from '../idempotency/index.js';
import type {
  AuditWriter,
  AuthorizationService,
  BusinessEventStore,
  CatalogReferenceProjection,
  Clock,
  IdGenerator,
  IdempotencyStore,
  OutboxStore,
  StockCountRepository,
  StockItemRepository,
  UnitOfWork
} from '../ports/index.js';
import { toStockAvailabilityPublications } from './stock-availability-publications.js';
import type { CoordinatedStockOperations } from '../sync/coordinated-stock-operations.js';
import type {
  ApproveStockCountInput,
  CloseStockCountInput,
  GetStockCountInput,
  OpenStockCountInput,
  RecordStockCountLineInput,
  RejectStockCountInput,
  StockCountDto
} from './dtos.js';
import { toStockCountDto } from './mappers.js';
import { INVENTORY_PERMISSIONS } from './permissions.js';
import { restoreStockCountDto, serializeStockCountDto } from './stock-count-idempotency.js';
import type { StockCountStatus } from '../../domain/inventory/index.js';

export class OpenStockCount {
  constructor(
    private readonly repository: StockCountRepository,
    private readonly authorization: AuthorizationService,
    private readonly countIdGenerator: IdGenerator,
    private readonly auditIdGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly auditWriter: AuditWriter,
    private readonly idempotencyStore?: IdempotencyStore
  ) {}

  async execute(input: OpenStockCountInput, context: ExecutionContext): Promise<Result<StockCountDto, AppError>> {
    if (!(await this.authorization.authorize(context, INVENTORY_PERMISSIONS.PERFORM_COUNT))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to open a stock count.'));
    }
    try {
      const occurredAt = this.clock.now();
      return await executeIdempotentCommand({
        operation: 'OpenStockCount', input, context, now: occurredAt,
        unitOfWork: this.unitOfWork,
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: async () => {
          if (await this.repository.findOpen()) {
            return err(new ApplicationError(
              'STOCK_COUNT_ALREADY_OPEN',
              'Another stock count is already open on this node.'
            ));
          }
          const count = StockCount.open({
            id: this.countIdGenerator.generate(), openedBy: context.actorId,
            originNodeId: context.originNodeId, openedAt: occurredAt
          });
          await this.repository.save(count);
          const dto = toStockCountDto(count);
          await this.auditWriter.append([{
            auditId: this.auditIdGenerator.generate(), actorId: context.actorId,
            actorRoleCodes: context.actorRoleCodes ?? [], action: 'STOCK_COUNT_OPENED',
            entityType: 'StockCount', entityId: count.id, before: null,
            after: { openedBy: context.actorId },
            reason: input.reason, terminalId: context.terminalId, originNodeId: context.originNodeId,
            occurredAt, correlationId: context.correlationId
          }]);
          return ok(dto);
        },
        serialize: serializeStockCountDto,
        restore: restoreStockCountDto
      });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }
}

/**
 * Registrar una línea es una acción rutinaria de alta frecuencia (escanear
 * producto tras producto), no una operación sensible: no exige motivo, igual
 * que `AddSaleItem`. El artículo, su unidad y si exige lote se derivan del
 * `StockItem` standalone o de la referencia autoritativa LAN; el operador
 * nunca los escribe.
 */
export class RecordStockCountLine {
  constructor(
    private readonly repository: StockCountRepository,
    private readonly stockItemRepository: StockItemRepository,
    private readonly authorization: AuthorizationService,
    private readonly lineIdGenerator: IdGenerator,
    private readonly auditIdGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly auditWriter: AuditWriter,
    private readonly idempotencyStore?: IdempotencyStore,
    /** Referencia autoritativa v2 usada solo por una terminal LAN. */
    private readonly stockReferences?: CatalogReferenceProjection
  ) {}

  async execute(
    input: RecordStockCountLineInput,
    context: ExecutionContext
  ): Promise<Result<StockCountDto, AppError>> {
    if (!(await this.authorization.authorize(context, INVENTORY_PERMISSIONS.PERFORM_COUNT))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to record a stock count line.'));
    }
    try {
      const occurredAt = this.clock.now();
      return await executeIdempotentCommand({
        operation: 'RecordStockCountLine', input, context, now: occurredAt,
        unitOfWork: this.unitOfWork,
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: async () => {
          const count = await this.repository.findById(input.stockCountId);
          if (!count) return err(new ApplicationError('STOCK_COUNT_NOT_FOUND', 'Stock count was not found.'));
          if (count.originNodeId !== context.originNodeId) {
            return err(new ApplicationError('AGGREGATE_OWNER_MISMATCH', 'Stock count belongs to another node.'));
          }
          const reference = await this.stockReferences?.findStockAvailability(input.productId);
          if (this.stockReferences && (reference === null || reference === undefined)) {
            return err(new ApplicationError(
              'STOCK_AVAILABILITY_REFERENCE_NOT_FOUND',
              'The stock availability reference was not found.'
            ));
          }
          if (reference && (reference.stockItemId === null || reference.unitCode === null ||
            reference.tracksBatches === null || reference.batches === null)) {
            return err(new ApplicationError(
              'STOCK_AVAILABILITY_REFERENCE_INCOMPLETE',
              'The stock availability reference does not contain authoritative identities.'
            ));
          }
          const localItem = reference ? null : await this.stockItemRepository.findByProductId(input.productId);
          const item = reference ? {
            id: reference.stockItemId as string,
            quantityScale: reference.quantityScale,
            tracksBatches: reference.tracksBatches as boolean,
            batches: (reference.batches ?? []).map(({ batchId }) => ({ id: batchId }))
          } : localItem;
          if (!item) return err(new ApplicationError('STOCK_ITEM_NOT_FOUND', 'Stock item was not found.'));
          if (item.tracksBatches && !input.batchId) {
            return err(new ApplicationError('STOCK_BATCH_REQUIRED', 'A batch is required for this stock item.'));
          }
          if (!item.tracksBatches && input.batchId) {
            return err(new ApplicationError('STOCK_BATCH_NOT_ACCEPTED', 'This stock item does not accept a batch.'));
          }
          if (input.batchId && !item.batches.some((batch) => batch.id === input.batchId)) {
            return err(new ApplicationError('STOCK_BATCH_NOT_FOUND', 'Stock batch was not found.'));
          }
          const countedQuantity = Quantity.fromDecimal(input.quantity, item.quantityScale);
          const line = count.recordLine({
            id: this.lineIdGenerator.generate(), productId: input.productId, stockItemId: item.id,
            countedQuantity, ...(input.batchId ? { batchId: input.batchId } : {})
          });
          await this.repository.save(count);
          const dto = toStockCountDto(count);
          await this.auditWriter.append([{
            auditId: this.auditIdGenerator.generate(), actorId: context.actorId,
            actorRoleCodes: context.actorRoleCodes ?? [], action: 'STOCK_COUNT_LINE_RECORDED',
            entityType: 'StockCount', entityId: count.id,
            before: null,
            after: {
              lineId: line.id, productId: line.productId, stockItemId: line.stockItemId,
              batchId: line.batchId, countedQuantityScaled: line.countedQuantity.scaledValue,
              quantityScale: line.countedQuantity.scale
            },
            reason: 'Conteo físico', terminalId: context.terminalId, originNodeId: context.originNodeId,
            occurredAt, correlationId: context.correlationId
          }]);
          return ok(dto);
        },
        serialize: serializeStockCountDto,
        restore: restoreStockCountDto
      });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }
}

export class CloseStockCount {
  constructor(
    private readonly repository: StockCountRepository,
    private readonly stockItemRepository: StockItemRepository,
    private readonly authorization: AuthorizationService,
    private readonly auditIdGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly auditWriter: AuditWriter,
    private readonly idempotencyStore?: IdempotencyStore,
    /** Referencia autoritativa v2 usada solo por una terminal LAN. */
    private readonly stockReferences?: CatalogReferenceProjection
  ) {}

  async execute(input: CloseStockCountInput, context: ExecutionContext): Promise<Result<StockCountDto, AppError>> {
    if (!(await this.authorization.authorize(context, INVENTORY_PERMISSIONS.PERFORM_COUNT))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to close a stock count.'));
    }
    try {
      const occurredAt = this.clock.now();
      return await executeIdempotentCommand({
        operation: 'CloseStockCount', input, context, now: occurredAt,
        unitOfWork: this.unitOfWork,
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: async () => {
          const count = await this.repository.findById(input.stockCountId);
          if (!count) return err(new ApplicationError('STOCK_COUNT_NOT_FOUND', 'Stock count was not found.'));
          if (count.originNodeId !== context.originNodeId) {
            return err(new ApplicationError('AGGREGATE_OWNER_MISMATCH', 'Stock count belongs to another node.'));
          }
          const differences: StockCountDifference[] = [];
          for (const line of count.lines) {
            const reference = await this.stockReferences?.findStockAvailability(line.productId);
            if (this.stockReferences && (reference === null || reference === undefined)) {
              return err(new ApplicationError(
                'STOCK_AVAILABILITY_REFERENCE_NOT_FOUND',
                'The stock availability reference was not found.'
              ));
            }
            if (reference && (reference.stockItemId === null || reference.unitCode === null ||
              reference.tracksBatches === null || reference.batches === null)) {
              return err(new ApplicationError(
                'STOCK_AVAILABILITY_REFERENCE_INCOMPLETE',
                'The stock availability reference does not contain authoritative identities.'
              ));
            }
            if (reference && reference.stockItemId !== line.stockItemId) {
              return err(new ApplicationError(
                'STOCK_AVAILABILITY_REFERENCE_CONFLICT',
                'The stock availability reference changed the authoritative item identity.'
              ));
            }
            const item = reference ? null : await this.stockItemRepository.findById(line.stockItemId);
            if (!reference && !item) {
              return err(new ApplicationError('STOCK_ITEM_NOT_FOUND', 'Stock item was not found.'));
            }
            const batch = line.batchId === null
              ? null
              : reference?.batches?.find(({ batchId }) => batchId === line.batchId);
            if (reference && line.batchId !== null && !batch) {
              return err(new ApplicationError('STOCK_BATCH_NOT_FOUND', 'Stock batch was not found.'));
            }
            const expectedScaled = reference
              ? (line.batchId === null ? reference.quantityScaled : batch?.quantityScaled as number)
              : (line.batchId !== null ? item!.balanceForBatch(line.batchId) : item!.balance).scaledValue;
            differences.push({
              lineId: line.id, stockItemId: line.stockItemId, batchId: line.batchId,
              quantityScale: line.countedQuantity.scale,
              expectedScaled, countedScaled: line.countedQuantity.scaledValue,
              differenceScaled: line.countedQuantity.scaledValue - expectedScaled,
              stockAvailabilityVersion: reference?.version ?? (item?.movements.length ?? 0) + 1
            });
          }
          count.close(differences, occurredAt);
          await this.repository.save(count);
          const dto = toStockCountDto(count);
          await this.auditWriter.append([{
            auditId: this.auditIdGenerator.generate(), actorId: context.actorId,
            actorRoleCodes: context.actorRoleCodes ?? [], action: 'STOCK_COUNT_CLOSED',
            entityType: 'StockCount', entityId: count.id,
            before: { status: 'OPEN' },
            after: {
              status: dto.status, lineCount: differences.length,
              differingLineCount: differences.filter((difference) => difference.differenceScaled !== 0).length
            },
            reason: input.reason, terminalId: context.terminalId, originNodeId: context.originNodeId,
            occurredAt, correlationId: context.correlationId
          }]);
          return ok(dto);
        },
        serialize: serializeStockCountDto,
        restore: restoreStockCountDto
      });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }
}

/**
 * Standalone aprueba el conteo y sus ajustes en la misma transacción. En LAN,
 * aprueba y publica un único `StockCountApproved`; el coordinador aplica el
 * delta. En ambos modos usa las diferencias congeladas al cerrar, no un
 * recálculo contra el saldo del momento de aprobar.
 */
export class ApproveStockCount {
  constructor(
    private readonly repository: StockCountRepository,
    private readonly stockItemRepository: StockItemRepository,
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
    private readonly outbox?: OutboxStore,
    /** Coordinación LAN: aprobar un conteo exige enlace (ADR-0026 D3). */
    private readonly coordination?: CoordinatedStockOperations
  ) {}

  async execute(input: ApproveStockCountInput, context: ExecutionContext): Promise<Result<StockCountDto, AppError>> {
    if (!(await this.authorization.authorize(context, INVENTORY_PERMISSIONS.APPROVE_COUNT))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to approve a stock count.'));
    }
    const started = await this.coordination?.begin({
      kind: 'STOCK_COUNT_APPROVAL',
      fingerprint: input.stockCountId,
      reason: input.reason
    }, context);
    if (started !== undefined && !started.ok) return err(started.error);
    try {
      const occurredAt = this.clock.now();
      return await executeIdempotentCommand({
        operation: 'ApproveStockCount', input, context, now: occurredAt,
        unitOfWork: this.unitOfWork,
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: async () => {
          const count = await this.repository.findById(input.stockCountId);
          if (!count) return err(new ApplicationError('STOCK_COUNT_NOT_FOUND', 'Stock count was not found.'));
          if (count.originNodeId !== context.originNodeId) {
            return err(new ApplicationError('AGGREGATE_OWNER_MISMATCH', 'Stock count belongs to another node.'));
          }
          const approvalEventId = this.eventIdGenerator.generate();
          const differences = count.approve({
            actorId: context.actorId, terminalId: context.terminalId, reason: input.reason,
            occurredAt, eventId: approvalEventId
          });
          const lanOperation = started !== undefined && started.ok &&
            started.value.coordinatorNodeId !== null;
          let adjustmentsCreated = 0;
          for (const difference of lanOperation ? [] : differences) {
            if (difference.differenceScaled === 0) continue;
            const item = await this.stockItemRepository.findById(difference.stockItemId);
            if (!item) return err(new ApplicationError('STOCK_ITEM_NOT_FOUND', 'Stock item was not found.'));
            const type = difference.differenceScaled > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
            const quantity = Quantity.fromScaled(Math.abs(difference.differenceScaled), difference.quantityScale);
            const before = item.balance.scaledValue;
            const previousEventCount = item.domainEvents.length;
            const movement = item.registerMovement({
              id: this.movementIdGenerator.generate(), type, quantity,
              ...(difference.batchId ? { batchId: difference.batchId } : {}),
              actorId: context.actorId, reason: input.reason, referenceId: count.id,
              occurredAt, eventId: this.eventIdGenerator.generate()
            });
            await persistBusinessChange(
              () => this.stockItemRepository.save(item), item.domainEvents.slice(previousEventCount), context,
              undefined, this.eventStore, this.outbox, [], this.auditWriter, [{
                auditId: this.auditIdGenerator.generate(), actorId: context.actorId,
                actorRoleCodes: context.actorRoleCodes ?? [], action: 'STOCK_COUNT_ADJUSTMENT_REGISTERED',
                entityType: 'StockItem', entityId: item.id,
                before: { balanceScaled: before },
                after: { balanceScaled: item.balance.scaledValue, movementId: movement.id, stockCountId: count.id },
                reason: movement.reason, terminalId: context.terminalId, originNodeId: context.originNodeId,
                occurredAt, correlationId: context.correlationId
              }],
              toStockAvailabilityPublications([item], this.eventIdGenerator, occurredAt)
            );
            adjustmentsCreated += 1;
          }
          const dto = toStockCountDto(count);
          await persistBusinessChange(
            () => this.repository.save(count), count.domainEvents, context, undefined,
            this.eventStore, this.outbox, lanOperation ? ['StockCountApproved'] : [],
            this.auditWriter, [{
            auditId: this.auditIdGenerator.generate(), actorId: context.actorId,
            actorRoleCodes: context.actorRoleCodes ?? [], action: 'STOCK_COUNT_APPROVED',
            entityType: 'StockCount', entityId: count.id,
            before: { status: 'COUNTED' },
            after: { status: dto.status, adjustmentsCreated },
            reason: input.reason, terminalId: context.terminalId, originNodeId: context.originNodeId,
            occurredAt, correlationId: context.correlationId
          }]);
          /**
           * La evidencia local se confirma con los efectos: si el proceso cae
           * aquí, la operación conserva su intención y la recuperación concilia
           * esa misma en lugar de aprobar el conteo dos veces.
           */
          if (started !== undefined && started.ok) {
            await this.coordination?.recordLocalEffect(
              started.value.operationId,
              [approvalEventId],
              context.originNodeId
            );
          }
          return ok(dto);
        },
        serialize: serializeStockCountDto,
        restore: restoreStockCountDto
      });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }
}

export class RejectStockCount {
  constructor(
    private readonly repository: StockCountRepository,
    private readonly authorization: AuthorizationService,
    private readonly auditIdGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly auditWriter: AuditWriter,
    private readonly idempotencyStore?: IdempotencyStore
  ) {}

  async execute(input: RejectStockCountInput, context: ExecutionContext): Promise<Result<StockCountDto, AppError>> {
    if (!(await this.authorization.authorize(context, INVENTORY_PERMISSIONS.APPROVE_COUNT))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to reject a stock count.'));
    }
    try {
      const occurredAt = this.clock.now();
      return await executeIdempotentCommand({
        operation: 'RejectStockCount', input, context, now: occurredAt,
        unitOfWork: this.unitOfWork,
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: async () => {
          const count = await this.repository.findById(input.stockCountId);
          if (!count) return err(new ApplicationError('STOCK_COUNT_NOT_FOUND', 'Stock count was not found.'));
          if (count.originNodeId !== context.originNodeId) {
            return err(new ApplicationError('AGGREGATE_OWNER_MISMATCH', 'Stock count belongs to another node.'));
          }
          count.reject(context.actorId, input.reason, occurredAt);
          await this.repository.save(count);
          const dto = toStockCountDto(count);
          await this.auditWriter.append([{
            auditId: this.auditIdGenerator.generate(), actorId: context.actorId,
            actorRoleCodes: context.actorRoleCodes ?? [], action: 'STOCK_COUNT_REJECTED',
            entityType: 'StockCount', entityId: count.id,
            before: { status: 'COUNTED' },
            after: { status: dto.status },
            reason: input.reason, terminalId: context.terminalId, originNodeId: context.originNodeId,
            occurredAt, correlationId: context.correlationId
          }]);
          return ok(dto);
        },
        serialize: serializeStockCountDto,
        restore: restoreStockCountDto
      });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }
}

export class GetStockCount {
  constructor(
    private readonly repository: StockCountRepository,
    private readonly authorization: AuthorizationService
  ) {}

  async execute(input: GetStockCountInput, context: ExecutionContext): Promise<Result<StockCountDto, AppError>> {
    if (!(await this.authorization.authorize(context, INVENTORY_PERMISSIONS.READ_COUNT))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to read stock counts.'));
    }
    const count = await this.repository.findById(input.stockCountId);
    return count
      ? ok(toStockCountDto(count))
      : err(new ApplicationError('STOCK_COUNT_NOT_FOUND', 'Stock count was not found.'));
  }
}

export class ListStockCounts {
  constructor(
    private readonly repository: StockCountRepository,
    private readonly authorization: AuthorizationService
  ) {}

  async execute(status: StockCountStatus | undefined, context: ExecutionContext): Promise<Result<readonly StockCountDto[], AppError>> {
    if (!(await this.authorization.authorize(context, INVENTORY_PERMISSIONS.READ_COUNT))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to list stock counts.'));
    }
    return ok((await this.repository.findAll(status)).map(toStockCountDto));
  }
}
