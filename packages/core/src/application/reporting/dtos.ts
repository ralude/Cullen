export type CashClosureReportInput = {
  readonly from?: Date;
  readonly to?: Date;
  readonly cashRegisterId?: string;
  readonly limit?: number;
};

export type CashClosureBalanceDto = {
  readonly paymentMethodCode: string;
  readonly currencyCode: string;
  readonly expectedMinorUnits: number;
  readonly declaredMinorUnits: number;
  readonly differenceMinorUnits: number;
};

export type CashClosureReportEntryDto = {
  readonly shiftId: string;
  readonly cashRegisterId: string;
  readonly terminalId: string;
  readonly originNodeId: string;
  readonly openedBy: string;
  readonly openedAt: Date;
  readonly closedBy: string | null;
  readonly closedAt: Date | null;
  readonly movementCount: number;
  readonly balances: readonly CashClosureBalanceDto[];
};

export type AuditReportInput = {
  readonly from?: Date;
  readonly to?: Date;
  readonly actorId?: string;
  readonly action?: string;
  readonly entityType?: string;
  readonly limit?: number;
};

export type AuditReportEntryDto = {
  readonly auditId: string;
  readonly actorId: string;
  readonly actorRoleCodes: readonly string[];
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly reason: string;
  readonly terminalId: string;
  readonly originNodeId: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
};

export type FiscalOperationsReportInput = {
  readonly from?: Date;
  readonly to?: Date;
  readonly limit?: number;
};

export type FiscalOperationReportEntryDto = {
  readonly kind: 'DOCUMENT' | 'REPORT';
  readonly id: string;
  readonly referenceId: string | null;
  readonly dayId: string | null;
  readonly operationType: string;
  readonly status: string;
  readonly attempts: number;
  readonly fiscalNumber: string | null;
  readonly lastErrorCode: string | null;
  readonly evidence: Readonly<Record<string, string>> | null;
  readonly requestedAt: Date;
};

export type MarginReportInput = {
  readonly from: Date;
  readonly to: Date;
  readonly currencyCode?: string;
  readonly limit?: number;
};

/**
 * Margen agregado por producto, moneda y período. El ingreso proviene de las
 * líneas de venta completadas después de descuentos y devoluciones, y el costo neto de las salidas de inventario
 * congeladas en ese período (ADR-0016); no se mezclan monedas ni se aplica
 * una tasa actual a hechos históricos. Cuando el período no tiene ingreso o
 * costo valorado en esa moneda para el producto, ese lado queda en `null` y
 * `marginMinorUnits` también es `null`: no se afirma un margen que no puede
 * calcularse sin inventar un dato.
 */
export type MarginReportEntryDto = {
  readonly productId: string;
  readonly currencyCode: string;
  readonly quantitySoldScaled: number;
  readonly quantityReturnedScaled: number;
  readonly quantityScale: number;
  readonly discountMinorUnits: number;
  readonly returnRevenueMinorUnits: number;
  readonly returnCostMinorUnits: number;
  readonly revenueMinorUnits: number | null;
  readonly costMinorUnits: number | null;
  readonly marginMinorUnits: number | null;
};

export type SalesReportInput = {
  readonly from: Date;
  readonly to: Date;
  readonly currencyCode?: string;
  readonly limit?: number;
};

/**
 * Resumen de ventas `COMPLETED` por moneda y escala de cantidad en un período
 * UTC (9B.13). No suma cantidades de escalas distintas ni convierte monedas;
 * las ventas `DRAFT` y `VOIDED` no cuentan.
 */
export type SalesReportEntryDto = {
  readonly currencyCode: string;
  readonly quantityScale: number;
  readonly salesCount: number;
  readonly lineCount: number;
  readonly quantitySoldScaled: number;
  readonly grossMinorUnits: number;
  readonly discountMinorUnits: number;
  readonly netMinorUnits: number;
};

export type InventoryReportInput = {
  readonly asOf: Date;
  readonly expiringWithinDays?: number;
  readonly limit?: number;
};

/**
 * Existencia del nodo por artículo y lote a una fecha de corte, con el estado
 * de vencimiento del lote (9B.13). El saldo se deriva de los movimientos;
 * no se materializa un saldo mutable.
 */
export type InventoryReportEntryDto = {
  readonly stockItemId: string;
  readonly productId: string;
  readonly batchId: string | null;
  readonly lotNumber: string | null;
  readonly unitCode: string;
  readonly quantityScale: number;
  readonly onHandScaled: number;
  readonly expiresAt: Date | null;
  readonly expiryStatus: 'NONE' | 'OK' | 'EXPIRING' | 'EXPIRED';
};
