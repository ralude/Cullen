import type { StockCount, StockCountLine, StockItem, StockMovement } from '../../domain/inventory/index.js';
import type { StockCountDto, StockCountLineDto, StockItemDto, StockMovementDto } from './dtos.js';

export const toStockMovementDto = (movement: StockMovement): StockMovementDto => ({
  id: movement.id,
  type: movement.type,
  direction: movement.direction,
  quantityScaled: movement.quantity.scaledValue,
  quantityScale: movement.quantity.scale,
  batchId: movement.batchId,
  actorId: movement.actorId,
  reason: movement.reason,
  referenceId: movement.referenceId,
  occurredAt: movement.occurredAt
});

export const toStockItemDto = (item: StockItem): StockItemDto => ({
  id: item.id,
  productId: item.productId,
  unitCode: item.unitCode,
  quantityScale: item.quantityScale,
  tracksBatches: item.tracksBatches,
  balanceScaled: item.balance.scaledValue,
  movements: item.movements.map(toStockMovementDto)
});

export const toStockCountLineDto = (line: StockCountLine): StockCountLineDto => ({
  id: line.id,
  productId: line.productId,
  stockItemId: line.stockItemId,
  batchId: line.batchId,
  countedQuantityScaled: line.countedQuantity.scaledValue,
  quantityScale: line.countedQuantity.scale
});

export const toStockCountDto = (count: StockCount): StockCountDto => ({
  id: count.id,
  originNodeId: count.originNodeId,
  status: count.status,
  openedBy: count.openedBy,
  openedAt: count.openedAt,
  lines: count.lines.map(toStockCountLineDto),
  differences: count.differences === null ? null : count.differences.map((difference) => ({ ...difference })),
  closedAt: count.closedAt,
  approvedBy: count.approvedBy,
  approvedAt: count.approvedAt,
  rejectedBy: count.rejectedBy,
  rejectedAt: count.rejectedAt,
  rejectionReason: count.rejectionReason,
  version: count.version
});
