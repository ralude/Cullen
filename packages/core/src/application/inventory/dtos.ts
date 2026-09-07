/**
 * Entrada de negocio de una recepción. El artículo de inventario, su unidad y
 * su escala no viajan aquí: los deriva la aplicación del artículo existente o,
 * la primera vez, del producto del catálogo.
 */
export type ReceivePurchaseInput = {
  productId: string;
  quantity: string;
  supplierId: string;
  receiptId: string;
  reason: string;
  lot?: { lotNumber: string; expiresAt?: Date };
};

export type RegisterStockAdjustmentInput = {
  stockItemId: string;
  type: 'WASTE' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';
  quantityScaled: number;
  quantityScale: number;
  batchId?: string;
  reason: string;
  referenceId: string;
};

export type StockMovementDto = {
  id: string;
  type: string;
  direction: 'IN' | 'OUT';
  quantityScaled: number;
  quantityScale: number;
  batchId: string | null;
  actorId: string;
  reason: string;
  referenceId: string;
  occurredAt: Date;
};

export type StockItemDto = {
  id: string;
  productId: string;
  unitCode: string;
  quantityScale: number;
  tracksBatches: boolean;
  balanceScaled: number;
  movements: StockMovementDto[];
};

export type GetKardexInput = {
  productId: string;
  batchId?: string;
  from?: Date;
  to?: Date;
  reason?: string;
  limit?: number;
};

export type KardexDto = {
  id: string;
  productId: string;
  unitCode: string;
  quantityScale: number;
  currentBalanceScaled: number;
  batches: { id: string; lotNumber: string; expiresAt: Date | null }[];
  movements: StockMovementDto[];
};

/**
 * Conteo físico (9B.07). El artículo, su unidad y su escala no viajan en la
 * entrada: se derivan del producto y del `StockItem` existente, igual que en
 * la recepción de compra.
 */
export type OpenStockCountInput = { reason: string };

export type RecordStockCountLineInput = {
  stockCountId: string;
  productId: string;
  quantity: string;
  batchId?: string;
};

export type CloseStockCountInput = { stockCountId: string; reason: string };
export type ApproveStockCountInput = { stockCountId: string; reason: string };
export type RejectStockCountInput = { stockCountId: string; reason: string };
export type GetStockCountInput = { stockCountId: string };

export type StockCountLineDto = {
  id: string;
  productId: string;
  stockItemId: string;
  batchId: string | null;
  countedQuantityScaled: number;
  quantityScale: number;
};

export type StockCountDifferenceDto = {
  lineId: string;
  stockItemId: string;
  batchId: string | null;
  quantityScale: number;
  expectedScaled: number;
  countedScaled: number;
  differenceScaled: number;
  stockAvailabilityVersion: number;
};

export type StockCountDto = {
  id: string;
  originNodeId: string;
  status: string;
  openedBy: string;
  openedAt: Date;
  lines: StockCountLineDto[];
  differences: StockCountDifferenceDto[] | null;
  closedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectedBy: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  version: number;
};
