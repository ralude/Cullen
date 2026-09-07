import {
  ApplicationError, DomainError, Money, Quantity, err, ok,
  type AppError, type Result
} from '@supermarket/shared';
import { StockItem } from '../../domain/inventory/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type { BusinessEventV1, JsonValue } from '../events/index.js';
import { persistBusinessChange } from '../events/index.js';
import type {
  AuditEntry, AuditWriter, BusinessEventStore, IdGenerator, OutboxStore,
  StockItemRepository, UnitOfWork
} from '../ports/index.js';
import type { StockItemDto } from './dtos.js';
import { toStockItemDto } from './mappers.js';
import { toStockAvailabilityPublications } from './stock-availability-publications.js';

type PurchaseLine = {
  readonly lineId: string;
  readonly productId: string;
  readonly stockItemId: string;
  readonly unitCode: string;
  readonly quantity: Quantity;
  readonly tracksBatches: boolean;
  readonly batch: { readonly batchId: string; readonly lotNumber: string;
    readonly expiresAt: Date | null } | null;
  readonly valuationUnitCost: Money;
};
type PurchasePayload = {
  readonly terminalId: string;
  readonly reason: string;
  readonly lines: readonly PurchaseLine[];
};

const record = (value: JsonValue | undefined): Record<string, JsonValue> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : null;
const text = (value: JsonValue | undefined): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;
const integer = (value: JsonValue | undefined, minimum = 0): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : null;

const payloadOf = (event: BusinessEventV1): PurchasePayload | null => {
  const payload = record(event.payload);
  const terminalId = text(payload?.terminalId);
  const reason = text(payload?.reason);
  if (!payload || terminalId === null || reason === null || !Array.isArray(payload.lines) ||
    integer(payload.lineCount, 1) !== payload.lines.length) return null;
  const lines: PurchaseLine[] = [];
  const lineIds = new Set<string>();
  for (const value of payload.lines) {
    const line = record(value);
    const lineId = text(line?.lineId);
    const productId = text(line?.productId);
    const stockItemId = text(line?.stockItemId);
    const unitCode = text(line?.unitCode);
    const quantityScaled = integer(line?.quantityScaled, 1);
    const quantityScale = integer(line?.quantityScale);
    const batchTracking = text(line?.batchTracking);
    const cost = record(line?.valuationUnitCost);
    const costMinorUnits = integer(cost?.minorUnits);
    const currencyCode = text(cost?.currencyCode);
    if (!line || lineId === null || lineIds.has(lineId) || productId === null ||
      stockItemId === null || unitCode === null || quantityScaled === null ||
      quantityScale === null || !['TRACKED', 'NOT_TRACKED'].includes(batchTracking ?? '') ||
      costMinorUnits === null || currencyCode === null || !/^[A-Z]{3}$/.test(currencyCode)) return null;
    const tracksBatches = batchTracking === 'TRACKED';
    const batchValue = line.batch;
    let batch: PurchaseLine['batch'] = null;
    if (batchValue !== null) {
      const parsed = record(batchValue);
      const batchId = text(parsed?.batchId);
      const lotNumber = text(parsed?.lotNumber)?.toUpperCase() ?? null;
      const expiresAtText = parsed?.expiresAt === null ? null : text(parsed?.expiresAt);
      const expiresAt = expiresAtText === null ? null : new Date(expiresAtText);
      if (!parsed || batchId === null || lotNumber === null ||
        (expiresAt !== null && Number.isNaN(expiresAt.getTime()))) return null;
      batch = { batchId, lotNumber, expiresAt };
    }
    if (tracksBatches !== (batch !== null)) return null;
    lineIds.add(lineId);
    lines.push({
      lineId, productId, stockItemId, unitCode,
      quantity: Quantity.fromScaled(quantityScaled, quantityScale),
      tracksBatches, batch,
      valuationUnitCost: Money.fromMinorUnits(costMinorUnits, currencyCode)
    });
  }
  return lines.length === 0 ? null : { terminalId, reason, lines };
};

export class ApplyPurchaseReceiptCompletedToInventory {
  constructor(
    private readonly repository: StockItemRepository,
    private readonly movementIds: IdGenerator,
    private readonly eventIds: IdGenerator,
    private readonly auditIds: IdGenerator,
    private readonly unitOfWork: UnitOfWork,
    private readonly eventStore: BusinessEventStore,
    private readonly auditWriter: AuditWriter,
    private readonly outbox?: OutboxStore
  ) {}

  async execute(event: BusinessEventV1): Promise<Result<StockItemDto[], AppError>> {
    if (event.eventType !== 'PurchaseReceiptCompleted' || event.aggregateType !== 'PurchaseReceipt') {
      return err(new ApplicationError(
        'INVENTORY_PURCHASE_EVENT_UNSUPPORTED',
        'Inventory only consumes PurchaseReceiptCompleted.'
      ));
    }
    let payload: PurchasePayload | null;
    try {
      payload = payloadOf(event);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      payload = null;
    }
    if (!payload) {
      return err(new ApplicationError(
        'INVENTORY_PURCHASE_EVENT_INVALID',
        'PurchaseReceiptCompleted payload is invalid.'
      ));
    }
    const context: ExecutionContext = {
      actorId: event.actorId, actorRoleCodes: [], terminalId: payload.terminalId,
      originNodeId: event.originNodeId, correlationId: event.correlationId
    };
    try {
      return await this.unitOfWork.execute(async () => {
        const changed = new Map<string, StockItem>();
        const events = [];
        const audits: AuditEntry[] = [];
        for (const line of payload.lines) {
          let item = changed.get(line.productId) ??
            await this.repository.findByProductId(line.productId);
          if (item && (item.id !== line.stockItemId || item.unitCode !== line.unitCode ||
            item.quantityScale !== line.quantity.scale || item.tracksBatches !== line.tracksBatches)) {
            return err(new ApplicationError(
              'STOCK_PURCHASE_ITEM_CONFLICT',
              'Purchase stock evidence conflicts with the authoritative item.'
            ));
          }
          item ??= StockItem.create({
            id: line.stockItemId, productId: line.productId, unitCode: line.unitCode,
            quantityScale: line.quantity.scale, tracksBatches: line.tracksBatches
          });
          changed.set(line.productId, item);
          if (line.batch !== null) {
            const byId = item.batches.find(({ id }) => id === line.batch?.batchId);
            const byLot = item.batches.find(({ lotNumber }) => lotNumber === line.batch?.lotNumber);
            if ((byId && (byId.lotNumber !== line.batch.lotNumber ||
              byId.expiresAt?.getTime() !== line.batch.expiresAt?.getTime())) ||
              (byLot && byLot.id !== line.batch.batchId)) {
              return err(new ApplicationError(
                'STOCK_PURCHASE_BATCH_CONFLICT',
                'Purchase batch evidence conflicts with the authoritative item.'
              ));
            }
            if (!byId) item.registerBatch({
              id: line.batch.batchId, lotNumber: line.batch.lotNumber,
              ...(line.batch.expiresAt === null ? {} : { expiresAt: line.batch.expiresAt })
            });
          }
          const referenceId = `${event.eventId}:${line.lineId}`;
          const previous = item.movements.filter((movement) =>
            movement.type === 'PURCHASE_RECEIPT' && movement.referenceId === referenceId);
          if (previous.length > 0) {
            if (previous.length !== 1 || previous[0]?.quantity.scaledValue !== line.quantity.scaledValue ||
              previous[0]?.quantity.scale !== line.quantity.scale ||
              previous[0]?.batchId !== (line.batch?.batchId ?? null) ||
              previous[0]?.unitCost?.minorUnits !== line.valuationUnitCost.minorUnits ||
              previous[0]?.unitCost?.currency !== line.valuationUnitCost.currency) {
              return err(new ApplicationError(
                'STOCK_PURCHASE_MOVEMENT_CONFLICT',
                'Purchase stock evidence conflicts with the persisted movement.'
              ));
            }
            continue;
          }
          const beforeEventCount = item.domainEvents.length;
          const beforeBalance = item.balance.scaledValue;
          item.registerMovement({
            id: this.movementIds.generate(), eventId: this.eventIds.generate(),
            type: 'PURCHASE_RECEIPT', quantity: line.quantity,
            ...(line.batch ? { batchId: line.batch.batchId } : {}),
            actorId: event.actorId, reason: payload.reason, referenceId,
            occurredAt: event.occurredAt, unitCost: line.valuationUnitCost
          });
          events.push(...item.domainEvents.slice(beforeEventCount));
          audits.push({
            auditId: this.auditIds.generate(), actorId: event.actorId, actorRoleCodes: [],
            action: 'PURCHASE_STOCK_RECEIVED', entityType: 'StockItem', entityId: item.id,
            before: { balanceScaled: beforeBalance },
            after: { balanceScaled: item.balance.scaledValue, purchaseReceiptId: event.aggregateId,
              purchaseReceiptLineId: line.lineId },
            reason: payload.reason, terminalId: payload.terminalId,
            originNodeId: event.originNodeId, occurredAt: event.occurredAt,
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
