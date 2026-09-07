import {
  ApplicationError, DomainError, Money, Quantity, err, ok,
  type AppError, type Result
} from '@supermarket/shared';
import type { StockItem, StockMovement } from '../../domain/inventory/index.js';
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

type ReturnLine = {
  readonly lineId: string;
  readonly saleItemId: string;
  readonly productId: string;
  readonly stockItemId: string;
  readonly batchId: string | null;
  readonly quantity: Quantity;
  readonly unitCost: Money | null;
};

type ReturnPayload = {
  readonly saleEventId: string;
  readonly terminalId: string;
  readonly reason: string;
  readonly lines: readonly ReturnLine[];
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

const costOf = (value: JsonValue | undefined): Money | null | undefined => {
  if (value === null) return null;
  const cost = record(value);
  const minorUnits = integer(cost?.minorUnits);
  const currencyCode = text(cost?.currencyCode);
  if (!cost || minorUnits === null || currencyCode === null ||
    !/^[A-Z]{3}$/.test(currencyCode)) return undefined;
  return Money.fromMinorUnits(minorUnits, currencyCode);
};

const payloadOf = (event: BusinessEventV1): ReturnPayload | null => {
  const payload = record(event.payload);
  const saleEventId = text(payload?.saleEventId);
  const terminalId = text(payload?.terminalId);
  const reason = text(payload?.reason);
  if (!payload || saleEventId === null || terminalId === null || reason === null ||
    !Array.isArray(payload.lines) ||
    integer(payload.lineCount, 1) !== payload.lines.length) return null;
  const lines: ReturnLine[] = [];
  const lineIds = new Set<string>();
  for (const value of payload.lines) {
    const line = record(value);
    const lineId = text(line?.lineId);
    const saleItemId = text(line?.saleItemId);
    const productId = text(line?.productId);
    const stockItemId = text(line?.stockItemId);
    const batchId = line?.batchId === null ? null : text(line?.batchId);
    const quantityScaled = integer(line?.quantityScaled, 1);
    const quantityScale = integer(line?.quantityScale, 0);
    const unitCost = costOf(line?.unitCost);
    if (!line || lineId === null || lineIds.has(lineId) || saleItemId === null ||
      productId === null || stockItemId === null ||
      !Object.prototype.hasOwnProperty.call(line, 'batchId') ||
      (line.batchId !== null && batchId === null) || quantityScaled === null ||
      quantityScale === null || unitCost === undefined) return null;
    lineIds.add(lineId);
    lines.push({
      lineId, saleItemId, productId, stockItemId, batchId,
      quantity: Quantity.fromScaled(quantityScaled, quantityScale),
      unitCost
    });
  }
  return lines.length === 0 ? null : { saleEventId, terminalId, reason, lines };
};

const sameCost = (movement: StockMovement, unitCost: Money | null): boolean =>
  unitCost === null
    ? movement.unitCost === null
    : movement.unitCost !== null &&
      movement.unitCost.minorUnits === unitCost.minorUnits &&
      movement.unitCost.currency === unitCost.currency;

/**
 * Restitución autoritativa de una devolución recibida (ADR-0026 D3).
 *
 * El coordinador **vuelve a validar** la evidencia que la terminal transporta
 * contra sus propios movimientos `SALE_ISSUE`: la línea debe corresponder a una
 * salida existente de esa venta, con su mismo lote y su mismo costo, y no puede
 * reponer más de lo que salió. Sin esa correspondencia no se inventa una
 * entrada de stock.
 *
 * Es idempotente por `eventId + lineId`: una reentrega conserva el movimiento
 * ya registrado y no duplica ni el stock ni su auditoría.
 */
export class ApplySaleReturnedToInventory {
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
    if (event.eventType !== 'SaleReturned' || event.aggregateType !== 'SaleReturn') {
      return err(new ApplicationError(
        'INVENTORY_SALE_RETURN_EVENT_UNSUPPORTED',
        'Inventory only consumes SaleReturned.'
      ));
    }
    let payload: ReturnPayload | null;
    try {
      payload = payloadOf(event);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      payload = null;
    }
    if (!payload) {
      return err(new ApplicationError(
        'INVENTORY_SALE_RETURN_EVENT_INVALID',
        'SaleReturned payload is invalid.'
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
        /** Lo ya restituido por esta misma línea de venta y lote, para no exceder la salida. */
        const restored = new Map<string, number>();
        for (const line of payload.lines) {
          const item = changed.get(line.productId) ??
            await this.repository.findByProductId(line.productId);
          if (!item || item.id !== line.stockItemId ||
            item.quantityScale !== line.quantity.scale) {
            return err(new ApplicationError(
              'STOCK_SALE_RETURN_ITEM_CONFLICT',
              'Sale return evidence conflicts with the authoritative item.'
            ));
          }
          changed.set(line.productId, item);
          const issueReference = `${payload.saleEventId}:${line.saleItemId}`;
          const issues = item.movements.filter((movement) =>
            movement.type === 'SALE_ISSUE' && movement.referenceId === issueReference &&
            movement.batchId === line.batchId && sameCost(movement, line.unitCost));
          const issued = issues.reduce(
            (total, movement) => total + movement.quantity.scaledValue, 0
          );
          const key = `${line.saleItemId}:${line.batchId ?? ''}:${line.unitCost?.currency ?? ''}:${line.unitCost?.minorUnits ?? ''}`;
          const alreadyRestored = restored.get(key) ?? 0;
          if (issues.length === 0 ||
            issues.some((movement) => movement.quantity.scale !== line.quantity.scale) ||
            alreadyRestored + line.quantity.scaledValue > issued) {
            return err(new ApplicationError(
              'STOCK_SALE_RETURN_ISSUE_NOT_FOUND',
              'The sale issue this return restores is not applied here.'
            ));
          }
          restored.set(key, alreadyRestored + line.quantity.scaledValue);
          const referenceId = `${event.eventId}:${line.lineId}`;
          const previous = item.movements.filter(
            (movement) => movement.referenceId === referenceId
          );
          if (previous.length > 0) {
            if (previous.length !== 1 || previous[0]?.type !== 'ADJUSTMENT_IN' ||
              previous[0].quantity.scaledValue !== line.quantity.scaledValue ||
              previous[0].quantity.scale !== line.quantity.scale ||
              previous[0].batchId !== line.batchId ||
              !sameCost(previous[0], line.unitCost)) {
              return err(new ApplicationError(
                'STOCK_SALE_RETURN_MOVEMENT_CONFLICT',
                'Sale return evidence conflicts with the persisted movement.'
              ));
            }
            continue;
          }
          const beforeEventCount = item.domainEvents.length;
          const beforeBalance = item.balance.scaledValue;
          /**
           * `stock_movements.type` solo admite los cinco tipos originales, así
           * que la reposición usa `ADJUSTMENT_IN` con la referencia de la
           * devolución, igual que la ruta local de 9B.04.
           */
          item.registerMovement({
            id: this.movementIds.generate(),
            eventId: this.eventIds.generate(),
            type: 'ADJUSTMENT_IN',
            quantity: line.quantity,
            ...(line.batchId === null ? {} : { batchId: line.batchId }),
            actorId: event.actorId,
            reason: payload.reason,
            referenceId,
            occurredAt: event.occurredAt,
            ...(line.unitCost === null ? {} : { unitCost: line.unitCost })
          });
          events.push(...item.domainEvents.slice(beforeEventCount));
          audits.push({
            auditId: this.auditIds.generate(), actorId: event.actorId, actorRoleCodes: [],
            action: 'SALE_RETURN_STOCK_RESTORED', entityType: 'StockItem', entityId: item.id,
            before: { balanceScaled: beforeBalance },
            after: {
              balanceScaled: item.balance.scaledValue,
              saleReturnId: event.aggregateId,
              saleReturnLineId: line.lineId,
              saleEventId: payload.saleEventId,
              saleItemId: line.saleItemId
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
