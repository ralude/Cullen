import { ApplicationError, DomainError, err, Quantity, ok, type AppError, type Result } from '@supermarket/shared';
import type { StockItem } from '../../domain/inventory/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type { BusinessEventV1, JsonValue } from '../events/index.js';
import { persistBusinessChange } from '../events/index.js';
import type { AuditEntry, AuditWriter, BusinessEventStore, IdGenerator, OutboxStore, StockItemRepository, UnitOfWork } from '../ports/index.js';
import { toStockAvailabilityPublications } from './stock-availability-publications.js';
import type { StockItemDto } from './dtos.js';
import { toStockItemDto } from './mappers.js';

type SaleItemPayload = { itemId: string; productId: string; quantityScaled: number; quantityScale: number };
type SalePayload = { terminalId: string; items: SaleItemPayload[] };
const record = (value: JsonValue): Record<string, JsonValue> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, JsonValue> : null;
const payloadOf = (event: BusinessEventV1): SalePayload | null => {
  const payload = record(event.payload);
  if (!payload || typeof payload.terminalId !== 'string' || !Array.isArray(payload.items)) return null;
  const items: SaleItemPayload[] = [];
  for (const value of payload.items) {
    const item = record(value);
    if (!item || typeof item.itemId !== 'string' || typeof item.productId !== 'string' ||
      typeof item.quantityScaled !== 'number' || !Number.isSafeInteger(item.quantityScaled) ||
      item.quantityScaled <= 0 || typeof item.quantityScale !== 'number' || !Number.isInteger(item.quantityScale)) return null;
    items.push({ itemId: item.itemId, productId: item.productId,
      quantityScaled: item.quantityScaled, quantityScale: item.quantityScale });
  }
  return payload.terminalId.length > 0 && items.length > 0 ? { terminalId: payload.terminalId, items } : null;
};

/**
 * Fuente del costo que se congela en la salida.
 *
 * `LOCAL_AVERAGE` conserva ADR-0016 para la venta que ocurre en este nodo: el
 * promedio ponderado vigente al momento de vender.
 *
 * `SYNCED_SNAPSHOT` es la excepción explícita de ADR-0026 D4 para un hecho
 * recibido de otra terminal: el costo debe ser el snapshot que esa terminal
 * conoció al vender. Los once contratos v1 no lo transportan, así que la salida
 * queda con costo desconocido y visible como tal; no se completa con el
 * promedio del coordinador en el momento de recibir el evento.
 */
export type SaleIssueCostSource = 'LOCAL_AVERAGE' | 'SYNCED_SNAPSHOT';

export class ApplySaleCompletedToInventory {
  constructor(
    private readonly repository: StockItemRepository,
    private readonly eventIdGenerator: IdGenerator,
    private readonly auditIdGenerator: IdGenerator,
    private readonly unitOfWork: UnitOfWork,
    private readonly eventStore: BusinessEventStore,
    private readonly auditWriter: AuditWriter,
    private readonly costSource: SaleIssueCostSource = 'LOCAL_AVERAGE',
    /**
     * Salida del coordinador. Aplicar una venta remota cambia el saldo
     * autoritativo, así que publica la disponibilidad de los ítems tocados en
     * la misma transacción del efecto.
     */
    private readonly outbox?: OutboxStore
  ) {}

  async execute(event: BusinessEventV1): Promise<Result<StockItemDto[], AppError>> {
    if (event.eventType !== 'SaleCompleted' || event.aggregateType !== 'Sale') {
      return err(new ApplicationError('INVENTORY_SALE_EVENT_UNSUPPORTED', 'Inventory only consumes SaleCompleted.v1.'));
    }
    const payload = payloadOf(event);
    if (!payload) return err(new ApplicationError('INVENTORY_SALE_EVENT_INVALID', 'SaleCompleted.v1 payload is invalid.'));
    const context: ExecutionContext = { actorId: event.actorId, actorRoleCodes: [], terminalId: payload.terminalId,
      originNodeId: event.originNodeId, correlationId: event.correlationId };
    try {
      return await this.unitOfWork.execute(async () => {
        const changed = new Map<string, StockItem>();
        const allEvents = [];
        const audits: AuditEntry[] = [];
        for (const line of payload.items) {
          const item = changed.get(line.productId) ?? await this.repository.findByProductId(line.productId);
          if (!item) return err(new ApplicationError('STOCK_ITEM_NOT_FOUND', 'Stock item was not found.'));
          changed.set(line.productId, item);
          const referenceId = `${event.eventId}:${line.itemId}`;
          const previous = item.movements.filter((movement) =>
            movement.type === 'SALE_ISSUE' && movement.referenceId === referenceId);
          if (previous.length > 0) {
            const previousTotal = previous.reduce((total, movement) => total + movement.quantity.scaledValue, 0);
            if (previous.some((movement) => movement.quantity.scale !== line.quantityScale) ||
              previousTotal !== line.quantityScaled) {
              return err(new ApplicationError('STOCK_SALE_ISSUE_CONFLICT', 'Sale stock issue conflicts with persisted movements.'));
            }
            continue;
          }
          const beforeEventCount = item.domainEvents.length;
          const beforeBalance = item.balance.scaledValue;
          const quantity = Quantity.fromScaled(line.quantityScaled, line.quantityScale);
          const allocations = item.allocateForIssue(quantity);
          /**
           * El costo de la salida se congela en el promedio ponderado vigente
           * al momento de la venta (ADR-0016); una recepción posterior no
           * revaloriza esta salida. Un hecho sincronizado conserva en cambio el
           * snapshot de su origen: sin esa evidencia el costo queda desconocido.
           */
          const unitCostAtIssue = this.costSource === 'LOCAL_AVERAGE'
            ? item.averageUnitCost
            : undefined;
          allocations.forEach((allocation, index) => item.registerMovement({
            id: `${event.eventId}:${line.itemId}:${index}`, type: 'SALE_ISSUE', quantity: allocation.quantity,
            ...(allocation.batchId ? { batchId: allocation.batchId } : {}), actorId: event.actorId,
            reason: 'Completed sale issue', referenceId, occurredAt: event.occurredAt,
            eventId: this.eventIdGenerator.generate(),
            ...(unitCostAtIssue ? { unitCost: unitCostAtIssue } : {})
          }, { inferOperationalCost: this.costSource === 'LOCAL_AVERAGE' }));
          const events = item.domainEvents.slice(beforeEventCount);
          allEvents.push(...events);
          audits.push({
            auditId: this.auditIdGenerator.generate(), actorId: event.actorId, actorRoleCodes: [],
            action: 'SALE_STOCK_ISSUED', entityType: 'StockItem', entityId: item.id,
            before: { balanceScaled: beforeBalance }, after: { balanceScaled: item.balance.scaledValue,
              saleId: event.aggregateId, saleItemId: line.itemId }, reason: 'Completed sale applied to inventory.',
            terminalId: payload.terminalId, originNodeId: event.originNodeId,
            occurredAt: event.occurredAt, correlationId: event.correlationId
          });
        }
        if (allEvents.length === 0) return ok([...changed.values()].map(toStockItemDto));
        await persistBusinessChange(
          async () => { for (const item of changed.values()) await this.repository.save(item); },
          allEvents, context, undefined, this.eventStore, this.outbox, [], this.auditWriter, audits,
          toStockAvailabilityPublications(changed.values(), this.eventIdGenerator, event.occurredAt)
        );
        return ok([...changed.values()].map(toStockItemDto));
      });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }
}
