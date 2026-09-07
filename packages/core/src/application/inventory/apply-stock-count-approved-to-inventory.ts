import { ApplicationError, DomainError, Quantity, err, ok, type AppError, type Result } from '@supermarket/shared';
import type { StockItem } from '../../domain/inventory/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type { BusinessEventV1, DomainEventLike, JsonValue } from '../events/index.js';
import { persistBusinessChange } from '../events/index.js';
import type {
  AuditEntry, AuditWriter, BusinessEventStore, IdGenerator, OutboxStore,
  StockItemRepository, UnitOfWork
} from '../ports/index.js';
import type { StockItemDto } from './dtos.js';
import { toStockItemDto } from './mappers.js';
import { toStockAvailabilityPublications } from './stock-availability-publications.js';

type CountLine = {
  readonly lineId: string;
  readonly productId: string;
  readonly stockItemId: string;
  readonly batchId: string | null;
  readonly quantityScale: number;
  readonly expectedScaled: number;
  readonly countedScaled: number;
  readonly differenceScaled: number;
  readonly stockAvailabilityVersion: number;
};

type CountPayload = {
  readonly terminalId: string;
  readonly reason: string;
  readonly lines: readonly CountLine[];
};

const record = (value: JsonValue | undefined): Record<string, JsonValue> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : null;
const text = (value: JsonValue | undefined): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;
const integer = (value: JsonValue | undefined, minimum?: number): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) &&
    (minimum === undefined || value >= minimum) ? value : null;

const payloadOf = (event: BusinessEventV1): CountPayload | null => {
  const payload = record(event.payload);
  const terminalId = text(payload?.terminalId);
  const reason = text(payload?.reason);
  if (!payload || terminalId === null || reason === null || !Array.isArray(payload.lines) ||
    integer(payload.lineCount, 1) !== payload.lines.length) return null;
  const lines: CountLine[] = [];
  const lineIds = new Set<string>();
  for (const value of payload.lines) {
    const line = record(value);
    const lineId = text(line?.lineId);
    const productId = text(line?.productId);
    const stockItemId = text(line?.stockItemId);
    const batchId = line?.batchId === null ? null : text(line?.batchId);
    const quantityScale = integer(line?.quantityScale, 0);
    const expectedScaled = integer(line?.expectedScaled, 0);
    const countedScaled = integer(line?.countedScaled, 0);
    const differenceScaled = integer(line?.differenceScaled);
    const stockAvailabilityVersion = integer(line?.stockAvailabilityVersion, 1);
    if (!line || lineId === null || lineIds.has(lineId) || productId === null ||
      stockItemId === null || !Object.prototype.hasOwnProperty.call(line, 'batchId') ||
      (line.batchId !== null && batchId === null) || quantityScale === null ||
      expectedScaled === null || countedScaled === null || differenceScaled === null ||
      differenceScaled !== countedScaled - expectedScaled || stockAvailabilityVersion === null) return null;
    lineIds.add(lineId);
    lines.push({
      lineId, productId, stockItemId, batchId, quantityScale, expectedScaled,
      countedScaled, differenceScaled, stockAvailabilityVersion
    });
  }
  return lines.length === 0 ? null : { terminalId, reason, lines };
};

export class ApplyStockCountApprovedToInventory {
  constructor(
    private readonly repository: StockItemRepository,
    private readonly movementIds: IdGenerator,
    private readonly eventIds: IdGenerator,
    private readonly auditIds: IdGenerator,
    private readonly unitOfWork: UnitOfWork,
    private readonly eventStore: BusinessEventStore,
    private readonly auditWriter: AuditWriter,
    private readonly outbox?: OutboxStore,
    private readonly authoritativeOriginNodeId?: string
  ) {}

  async execute(event: BusinessEventV1): Promise<Result<StockItemDto[], AppError>> {
    if (event.eventType !== 'StockCountApproved' || event.aggregateType !== 'StockCount') {
      return err(new ApplicationError(
        'INVENTORY_STOCK_COUNT_EVENT_UNSUPPORTED',
        'Inventory only consumes StockCountApproved.'
      ));
    }
    const payload = payloadOf(event);
    if (!payload) {
      return err(new ApplicationError(
        'INVENTORY_STOCK_COUNT_EVENT_INVALID',
        'StockCountApproved payload is invalid.'
      ));
    }
    const context: ExecutionContext = {
      actorId: event.actorId,
      actorRoleCodes: [],
      terminalId: payload.terminalId,
      originNodeId: this.authoritativeOriginNodeId ?? event.originNodeId,
      correlationId: event.correlationId
    };
    try {
      return await this.unitOfWork.execute(async () => {
        const changed = new Map<string, StockItem>();
        const events: DomainEventLike[] = [];
        const audits: AuditEntry[] = [];
        for (const line of payload.lines) {
          const item = changed.get(line.productId) ??
            await this.repository.findByProductId(line.productId);
          if (!item || item.id !== line.stockItemId || item.quantityScale !== line.quantityScale) {
            return err(new ApplicationError(
              'STOCK_COUNT_ITEM_CONFLICT',
              'Stock count evidence conflicts with the authoritative item.'
            ));
          }
          if ((item.tracksBatches && line.batchId === null) ||
            (!item.tracksBatches && line.batchId !== null) ||
            (line.batchId !== null && !item.batches.some(({ id }) => id === line.batchId))) {
            return err(new ApplicationError(
              'STOCK_COUNT_BATCH_CONFLICT',
              'Stock count batch evidence conflicts with the authoritative item.'
            ));
          }
          changed.set(line.productId, item);
          const referenceId = `${event.eventId}:${line.lineId}`;
          const previous = item.movements.filter((movement) => movement.referenceId === referenceId);
          if (line.differenceScaled === 0) {
            if (previous.length > 0) {
              return err(new ApplicationError(
                'STOCK_COUNT_MOVEMENT_CONFLICT',
                'Stock count evidence conflicts with the persisted movement.'
              ));
            }
            continue;
          }
          const movementType = line.differenceScaled > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
          if (previous.length > 0) {
            if (previous.length !== 1 || previous[0]?.type !== movementType ||
              previous[0].quantity.scaledValue !== Math.abs(line.differenceScaled) ||
              previous[0].quantity.scale !== line.quantityScale ||
              previous[0].batchId !== line.batchId) {
              return err(new ApplicationError(
                'STOCK_COUNT_MOVEMENT_CONFLICT',
                'Stock count evidence conflicts with the persisted movement.'
              ));
            }
            continue;
          }
          const beforeEventCount = item.domainEvents.length;
          const beforeBalance = item.balance.scaledValue;
          item.registerMovement({
            id: this.movementIds.generate(), eventId: this.eventIds.generate(),
            type: movementType,
            quantity: Quantity.fromScaled(Math.abs(line.differenceScaled), line.quantityScale),
            ...(line.batchId === null ? {} : { batchId: line.batchId }),
            actorId: event.actorId,
            reason: payload.reason,
            referenceId,
            occurredAt: event.occurredAt
          });
          events.push(...item.domainEvents.slice(beforeEventCount));
          audits.push({
            auditId: this.auditIds.generate(), actorId: event.actorId, actorRoleCodes: [],
            action: 'STOCK_COUNT_ADJUSTMENT_APPLIED', entityType: 'StockItem', entityId: item.id,
            before: { balanceScaled: beforeBalance },
            after: {
              balanceScaled: item.balance.scaledValue,
              stockCountId: event.aggregateId,
              stockCountLineId: line.lineId,
              expectedScaled: line.expectedScaled,
              countedScaled: line.countedScaled,
              differenceScaled: line.differenceScaled,
              stockAvailabilityVersion: line.stockAvailabilityVersion
            },
            reason: payload.reason, terminalId: payload.terminalId,
            originNodeId: context.originNodeId, occurredAt: event.occurredAt,
            correlationId: event.correlationId
          });
        }
        if (events.length === 0) return ok([...changed.values()].map(toStockItemDto));
        await persistBusinessChange(
          async () => { for (const item of changed.values()) await this.repository.save(item); },
          events, context, undefined, this.eventStore, this.outbox, [], this.auditWriter, audits,
          toStockAvailabilityPublications(changed.values(), this.eventIds, event.occurredAt)
        );
        return ok([...changed.values()].map(toStockItemDto));
      });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }
}
