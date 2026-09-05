import { DomainError, type Quantity } from '@supermarket/shared';

/**
 * Ciclo de vida aprobado en el plan 9B.07:
 *   OPEN -> COUNTED -> APPROVED
 *                   \-> REJECTED
 * Un conteo `APPROVED` o `REJECTED` es inmutable.
 */
export const STOCK_COUNT_STATUSES = ['OPEN', 'COUNTED', 'APPROVED', 'REJECTED'] as const;
export type StockCountStatus = (typeof STOCK_COUNT_STATUSES)[number];

export type StockCountLineProps = {
  id: string;
  productId: string;
  stockItemId: string;
  countedQuantity: Quantity;
  batchId?: string;
};

/**
 * La diferencia se congela al cerrar el conteo (supuesto documentado en el
 * plan 9B.07, decisión 1: momento de la diferencia). El ajuste que aprueba el
 * conteo usa exactamente estos valores, no un recálculo contra el saldo del
 * momento de aprobar.
 */
export type StockCountDifference = {
  readonly lineId: string;
  readonly stockItemId: string;
  readonly batchId: string | null;
  readonly quantityScale: number;
  readonly expectedScaled: number;
  readonly countedScaled: number;
  readonly differenceScaled: number;
};

export type StockCountProps = {
  id: string;
  openedBy: string;
  originNodeId: string;
  openedAt: Date;
};

export type RestoredStockCountProps = {
  id: string;
  openedBy: string;
  originNodeId: string;
  openedAt: Date;
  status: StockCountStatus;
  lines: readonly StockCountLine[];
  differences: readonly StockCountDifference[] | null;
  closedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectedBy: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  version: number;
};

const requireText = (value: string, code: string, message: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) throw new DomainError(code, message);
  return normalized;
};

const lineKey = (stockItemId: string, batchId: string | null): string =>
  `${stockItemId}:${batchId ?? ''}`;

export class StockCountLine {
  private constructor(
    readonly id: string,
    readonly productId: string,
    readonly stockItemId: string,
    readonly batchId: string | null,
    readonly countedQuantity: Quantity
  ) {}

  static create(props: StockCountLineProps): StockCountLine {
    const id = requireText(props.id, 'STOCK_COUNT_LINE_ID_REQUIRED', 'Stock count line ID is required.');
    const productId = requireText(
      props.productId, 'STOCK_COUNT_LINE_PRODUCT_REQUIRED', 'Stock count line product is required.'
    );
    const stockItemId = requireText(
      props.stockItemId, 'STOCK_COUNT_LINE_STOCK_ITEM_REQUIRED', 'Stock count line stock item is required.'
    );
    const batchId = props.batchId === undefined
      ? null
      : requireText(props.batchId, 'STOCK_COUNT_LINE_BATCH_REQUIRED', 'Stock count line batch is required.');
    if (props.countedQuantity.scaledValue < 0) {
      throw new DomainError(
        'STOCK_COUNT_LINE_QUANTITY_INVALID',
        'A counted quantity cannot be negative.'
      );
    }
    return new StockCountLine(id, productId, stockItemId, batchId, props.countedQuantity);
  }
}

/**
 * `StockCount` es una raíz de agregado separada de `StockItem`: documenta el
 * conteo y sus líneas, pero no muta existencia por sí misma. El caso de uso de
 * aprobación coordina ambas raíces por puertos, dentro de una sola
 * `UnitOfWork`.
 */
export class StockCount {
  private readonly currentLines = new Map<string, StockCountLine>();
  private currentDifferences: StockCountDifference[] | null = null;
  private currentStatus: StockCountStatus;
  private currentClosedAt: Date | null = null;
  private currentApprovedBy: string | null = null;
  private currentApprovedAt: Date | null = null;
  private currentRejectedBy: string | null = null;
  private currentRejectedAt: Date | null = null;
  private currentRejectionReason: string | null = null;
  private currentVersion: number;

  private constructor(
    readonly id: string,
    readonly openedBy: string,
    readonly originNodeId: string,
    readonly openedAt: Date,
    status: StockCountStatus,
    version: number
  ) {
    this.currentStatus = status;
    this.currentVersion = version;
  }

  static open(props: StockCountProps): StockCount {
    const id = requireText(props.id, 'STOCK_COUNT_ID_REQUIRED', 'Stock count ID is required.');
    const openedBy = requireText(props.openedBy, 'STOCK_COUNT_ACTOR_REQUIRED', 'Stock count actor is required.');
    const originNodeId = requireText(
      props.originNodeId, 'STOCK_COUNT_ORIGIN_NODE_REQUIRED', 'Stock count origin node is required.'
    );
    return new StockCount(id, openedBy, originNodeId, new Date(props.openedAt), 'OPEN', 1);
  }

  static restore(props: RestoredStockCountProps): StockCount {
    const count = new StockCount(
      props.id, props.openedBy, props.originNodeId, props.openedAt, props.status, props.version
    );
    for (const line of props.lines) count.currentLines.set(lineKey(line.stockItemId, line.batchId), line);
    count.currentDifferences = props.differences === null ? null : [...props.differences];
    count.currentClosedAt = props.closedAt;
    count.currentApprovedBy = props.approvedBy;
    count.currentApprovedAt = props.approvedAt;
    count.currentRejectedBy = props.rejectedBy;
    count.currentRejectedAt = props.rejectedAt;
    count.currentRejectionReason = props.rejectionReason;
    return count;
  }

  get status(): StockCountStatus { return this.currentStatus; }
  get lines(): readonly StockCountLine[] { return [...this.currentLines.values()]; }
  get differences(): readonly StockCountDifference[] | null {
    return this.currentDifferences === null ? null : [...this.currentDifferences];
  }
  get closedAt(): Date | null { return this.currentClosedAt; }
  get approvedBy(): string | null { return this.currentApprovedBy; }
  get approvedAt(): Date | null { return this.currentApprovedAt; }
  get rejectedBy(): string | null { return this.currentRejectedBy; }
  get rejectedAt(): Date | null { return this.currentRejectedAt; }
  get rejectionReason(): string | null { return this.currentRejectionReason; }
  get version(): number { return this.currentVersion; }

  /**
   * Registra o reemplaza la cantidad contada de un artículo (o de un lote
   * suyo). Solo admite conteos abiertos: el alcance del conteo es la lista de
   * líneas registradas (decisión 3 del plan: un producto no incluido no se
   * toca, no se cuenta como cero).
   */
  recordLine(props: StockCountLineProps): StockCountLine {
    if (this.currentStatus !== 'OPEN') {
      throw new DomainError('STOCK_COUNT_NOT_OPEN', 'Stock count is not open for recording lines.');
    }
    const line = StockCountLine.create(props);
    this.currentLines.set(lineKey(line.stockItemId, line.batchId), line);
    this.touch();
    return line;
  }

  /**
   * Cierra el conteo y congela sus diferencias. La aplicación calcula
   * `differences` leyendo el saldo vigente de cada `StockItem`; el dominio
   * solo valida que corresponden exactamente a las líneas registradas.
   */
  close(differences: readonly StockCountDifference[], occurredAt: Date): void {
    if (this.currentStatus !== 'OPEN') {
      throw new DomainError('STOCK_COUNT_NOT_OPEN', 'Stock count is not open for closing.');
    }
    if (this.currentLines.size === 0) {
      throw new DomainError('STOCK_COUNT_EMPTY', 'Stock count has no lines to close.');
    }
    const lineIds = new Set(this.lines.map((line) => line.id));
    const differenceIds = new Set(differences.map((difference) => difference.lineId));
    if (
      lineIds.size !== differenceIds.size ||
      [...lineIds].some((id) => !differenceIds.has(id))
    ) {
      throw new DomainError(
        'STOCK_COUNT_DIFFERENCE_MISMATCH',
        'Closing differences must match the recorded lines exactly.'
      );
    }
    this.currentDifferences = [...differences];
    this.currentClosedAt = new Date(occurredAt);
    this.currentStatus = 'COUNTED';
    this.touch();
  }

  /** Aprueba el conteo y devuelve las diferencias congeladas para que la aplicación derive los ajustes. */
  approve(actorId: string, occurredAt: Date): readonly StockCountDifference[] {
    if (this.currentStatus !== 'COUNTED') {
      throw new DomainError('STOCK_COUNT_NOT_COUNTED', 'Only a closed stock count can be approved.');
    }
    this.currentApprovedBy = requireText(actorId, 'STOCK_COUNT_ACTOR_REQUIRED', 'Stock count actor is required.');
    this.currentApprovedAt = new Date(occurredAt);
    this.currentStatus = 'APPROVED';
    this.touch();
    return this.currentDifferences ?? [];
  }

  /** Rechaza el conteo cerrado sin producir ningún efecto de inventario. */
  reject(actorId: string, reason: string, occurredAt: Date): void {
    if (this.currentStatus !== 'COUNTED') {
      throw new DomainError('STOCK_COUNT_NOT_COUNTED', 'Only a closed stock count can be rejected.');
    }
    this.currentRejectionReason = requireText(
      reason, 'STOCK_COUNT_REJECTION_REASON_REQUIRED', 'A rejection reason is required.'
    );
    this.currentRejectedBy = requireText(actorId, 'STOCK_COUNT_ACTOR_REQUIRED', 'Stock count actor is required.');
    this.currentRejectedAt = new Date(occurredAt);
    this.currentStatus = 'REJECTED';
    this.touch();
  }

  private touch(): void {
    this.currentVersion += 1;
  }
}
