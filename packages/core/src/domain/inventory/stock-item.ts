import { DomainError, Money, Quantity } from '@supermarket/shared';
import { Batch, type BatchProps } from './batch.js';
import { StockMovement, type StockMovementProps } from './stock-movement.js';
import type { StockMovementRegisteredEvent } from './stock-events.js';

export type StockItemProps = {
  id: string;
  productId: string;
  unitCode: string;
  quantityScale: number;
  tracksBatches: boolean;
};

export type RestoredStockItemProps = StockItemProps & {
  valuationCurrency: string | null;
  batches: Batch[];
  movements: StockMovement[];
};

const UNIT_CODE_PATTERN = /^[A-Z][A-Z0-9_-]*$/;

export class StockItem {
  private readonly currentBatches: Batch[] = [];
  private readonly currentMovements: StockMovement[] = [];
  private readonly events: StockMovementRegisteredEvent[] = [];
  private currentValuationCurrency: string | null;
  /**
   * Lo que cada movimiento necesita saber de todos los anteriores, mantenido
   * al agregarlo en vez de recalculado recorriéndolos ([ADR-0032]).
   * Reconstruir una historia deja de costar el cuadrado de su tamaño; las
   * comprobaciones y sus códigos de error son los mismos.
   */
  private readonly movementsById = new Map<string, StockMovement>();
  private readonly movementEventIds = new Set<string>();
  private readonly costCurrencies = new Set<string>();
  private balanceScaled = 0;
  private readonly batchBalancesScaled = new Map<string, number>();

  private constructor(
    readonly id: string,
    readonly productId: string,
    readonly unitCode: string,
    readonly quantityScale: number,
    readonly tracksBatches: boolean,
    valuationCurrency: string | null
  ) {
    if (valuationCurrency !== null) Money.zero(valuationCurrency);
    this.currentValuationCurrency = valuationCurrency;
  }

  static create(props: StockItemProps): StockItem {
    const id = StockItem.requireText(props.id, 'STOCK_ITEM_ID_REQUIRED', 'Stock item ID is required.');
    const productId = StockItem.requireText(
      props.productId,
      'STOCK_PRODUCT_ID_REQUIRED',
      'Stock product ID is required.'
    );
    const unitCode = props.unitCode.trim().toUpperCase();
    if (!UNIT_CODE_PATTERN.test(unitCode)) {
      throw new DomainError('STOCK_UNIT_CODE_INVALID', 'Stock unit code is invalid.');
    }
    if (!Number.isInteger(props.quantityScale) || props.quantityScale < 0 || props.quantityScale > 6) {
      throw new DomainError(
        'STOCK_QUANTITY_SCALE_INVALID',
        'Stock quantity scale must be an integer between 0 and 6.'
      );
    }
    return new StockItem(id, productId, unitCode, props.quantityScale, props.tracksBatches, null);
  }

  static restore(props: RestoredStockItemProps): StockItem {
    const created = StockItem.create(props);
    const item = new StockItem(
      created.id,
      created.productId,
      created.unitCode,
      created.quantityScale,
      created.tracksBatches,
      props.valuationCurrency
    );
    for (const batch of props.batches) item.registerBatch({
      id: batch.id,
      lotNumber: batch.lotNumber,
      ...(batch.expiresAt === null ? {} : { expiresAt: batch.expiresAt })
    });
    for (const movement of props.movements) item.appendMovement({
      id: movement.id,
      type: movement.type,
      quantity: movement.quantity,
      ...(movement.batchId === null ? {} : { batchId: movement.batchId }),
      actorId: movement.actorId,
      reason: movement.reason,
      referenceId: movement.referenceId,
      occurredAt: movement.occurredAt,
      eventId: movement.eventId,
      unitCost: movement.unitCost
    }, false);
    item.events.length = 0;
    return item;
  }

  get batches(): readonly Batch[] {
    return [...this.currentBatches];
  }

  get movements(): readonly StockMovement[] {
    return [...this.currentMovements];
  }

  get valuationCurrency(): string | null {
    return this.currentValuationCurrency;
  }

  get inventoryValue(): Money | null {
    const currency = this.currentValuationCurrency;
    if (currency === null) return null;
    let value = Money.zero(currency);
    let balanceScaled = 0;
    let known = true;
    for (const movement of this.currentMovements) {
      if (movement.unitCost !== null && movement.unitCost.currency !== currency) {
        throw new DomainError('STOCK_COST_CURRENCY_MISMATCH', 'Valued stock movements must use one currency.');
      }
      if (movement.unitCost === null) {
        known = false;
      } else if (known) {
        const movementValue = movement.unitCost.multiplyByQuantity(movement.quantity);
        value = movement.direction === 'IN' ? value.add(movementValue) : value.subtract(movementValue);
      }
      balanceScaled += movement.direction === 'IN'
        ? movement.quantity.scaledValue
        : -movement.quantity.scaledValue;
      if (balanceScaled === 0) {
        value = Money.zero(currency);
        known = true;
      }
    }
    return known ? value : null;
  }

  get averageUnitCost(): Money | null {
    const value = this.inventoryValue;
    return value === null || this.balance.isZero() ? null : value.divideByQuantity(this.balance);
  }

  get domainEvents(): readonly StockMovementRegisteredEvent[] {
    return [...this.events];
  }

  get balance(): Quantity {
    return this.calculateBalance();
  }

  registerBatch(props: BatchProps): Batch {
    if (!this.tracksBatches) {
      throw new DomainError('STOCK_BATCH_NOT_TRACKED', 'This stock item does not track batches.');
    }
    const batch = Batch.create(props);
    if (this.currentBatches.some((existing) => existing.id === batch.id)) {
      throw new DomainError('STOCK_BATCH_DUPLICATE', 'Stock batch already exists.');
    }
    if (this.currentBatches.some((existing) => existing.lotNumber === batch.lotNumber)) {
      throw new DomainError(
        'STOCK_BATCH_LOT_DUPLICATE',
        'Stock batch lot number must be unique.'
      );
    }
    this.currentBatches.push(batch);
    return batch;
  }

  /**
   * `inferOperationalCost: false` conserva un costo desconocido en la salida en
   * lugar de heredar el promedio vigente. Es la excepción explícita de
   * ADR-0026 D4 para un hecho recibido de otra terminal: su costo es el
   * snapshot que el origen conoció al vender, no el promedio de este nodo en el
   * momento de recibirlo.
   */
  registerMovement(
    props: StockMovementProps,
    options: { readonly inferOperationalCost?: boolean } = {}
  ): StockMovement {
    return this.appendMovement(props, options.inferOperationalCost ?? true);
  }

  private appendMovement(props: StockMovementProps, inferOperationalCost: boolean): StockMovement {
    const existing = this.movementsById.get(props.id.trim());
    if (existing?.type === 'SALE_ISSUE' && props.type === 'SALE_ISSUE') {
      if (existing.matches(props)) return existing;
      throw new DomainError('STOCK_SALE_ISSUE_CONFLICT', 'Sale stock issue conflicts with another movement.');
    }
    if (existing) {
      throw new DomainError('STOCK_MOVEMENT_DUPLICATE', 'Stock movement already exists.');
    }
    if (this.movementEventIds.has(props.eventId.trim())) {
      throw new DomainError(
        'STOCK_MOVEMENT_EVENT_DUPLICATE',
        'Stock movement event already exists.'
      );
    }
    let valuationCurrency = this.currentValuationCurrency;
    const providedCost = props.unitCost ?? null;
    if (providedCost !== null) {
      const historicCurrencies = this.costCurrencies;
      if (valuationCurrency === null && historicCurrencies.size > 1) {
        throw new DomainError(
          'STOCK_COST_CURRENCY_UNDETERMINED',
          'Stock valuation currency cannot be derived from mixed historical costs.'
        );
      }
      valuationCurrency ??= historicCurrencies.values().next().value ?? providedCost.currency;
      if (providedCost.currency !== valuationCurrency) {
        throw new DomainError('STOCK_COST_CURRENCY_MISMATCH', 'Valued stock movements must use one currency.');
      }
    }
    const canInheritCost = props.type !== 'PURCHASE_RECEIPT';
    const inferredCost = inferOperationalCost && providedCost === null && canInheritCost
      ? this.averageUnitCost
      : null;
    const movement = StockMovement.create({ ...props, unitCost: providedCost ?? inferredCost });
    if (movement.quantity.scale !== this.quantityScale) {
      throw new DomainError(
        'STOCK_QUANTITY_SCALE_MISMATCH',
        'Stock movement quantity scale must match the stock item scale.'
      );
    }
    this.assertBatchPolicy(movement);
    if (movement.direction === 'OUT') {
      const available = movement.batchId === null
        ? this.balance
        : this.balanceForBatch(movement.batchId);
      if (movement.quantity.scaledValue > available.scaledValue) {
        throw new DomainError(
          'STOCK_INSUFFICIENT',
          'Stock movement exceeds the available balance.'
        );
      }
    }
    this.currentValuationCurrency = valuationCurrency;
    this.currentMovements.push(movement);
    this.index(movement);
    this.events.push({
      type: 'StockMovementRegistered',
      eventId: movement.eventId,
      aggregateId: this.id,
      aggregateType: 'StockItem',
      aggregateVersion: this.currentMovements.length,
      occurredAt: movement.occurredAt,
      payload: {
        productId: this.productId,
        movementId: movement.id,
        movementType: movement.type,
        quantity: movement.quantity,
        batchId: movement.batchId,
        actorId: movement.actorId,
        reason: movement.reason,
        referenceId: movement.referenceId
      }
    });
    return movement;
  }

  allocateForIssue(quantity: Quantity): Array<{ batchId: string | null; quantity: Quantity }> {
    if (quantity.scale !== this.quantityScale) {
      throw new DomainError('STOCK_QUANTITY_SCALE_MISMATCH', 'Stock issue scale must match the item scale.');
    }
    if (!this.tracksBatches) return [{ batchId: null, quantity }];
    let remaining = quantity.scaledValue;
    const allocations: Array<{ batchId: string | null; quantity: Quantity }> = [];
    const batches = [...this.currentBatches].sort((left, right) =>
      (left.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (right.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
      left.lotNumber.localeCompare(right.lotNumber)
    );
    for (const batch of batches) {
      const available = this.balanceForBatch(batch.id).scaledValue;
      if (available <= 0) continue;
      const used = Math.min(available, remaining);
      allocations.push({ batchId: batch.id, quantity: Quantity.fromScaled(used, this.quantityScale) });
      remaining -= used;
      if (remaining === 0) return allocations;
    }
    throw new DomainError('STOCK_INSUFFICIENT', 'Stock movement exceeds the available balance.');
  }

  balanceForBatch(batchId: string): Quantity {
    if (!this.tracksBatches) {
      throw new DomainError('STOCK_BATCH_NOT_TRACKED', 'This stock item does not track batches.');
    }
    const normalized = batchId.trim();
    if (!this.currentBatches.some((batch) => batch.id === normalized)) {
      throw new DomainError('STOCK_BATCH_NOT_FOUND', 'Stock batch was not found.');
    }
    return this.calculateBalance(normalized);
  }

  private assertBatchPolicy(movement: StockMovement): void {
    if (!this.tracksBatches && movement.batchId !== null) {
      throw new DomainError('STOCK_BATCH_NOT_ACCEPTED', 'This stock item does not accept a batch.');
    }
    if (this.tracksBatches && movement.batchId === null) {
      throw new DomainError('STOCK_BATCH_REQUIRED', 'A batch is required for this stock item.');
    }
    if (
      movement.batchId !== null &&
      !this.currentBatches.some((batch) => batch.id === movement.batchId)
    ) {
      throw new DomainError('STOCK_BATCH_NOT_FOUND', 'Stock batch was not found.');
    }
  }

  /**
   * Registra el movimiento en lo que las comprobaciones consultan. El saldo
   * acumula la misma suma que recorrer la historia: una entrada suma su
   * cantidad y una salida la resta, sobre la escala del artículo, que ya se
   * verificó igual a la del movimiento.
   */
  private index(movement: StockMovement): void {
    this.movementsById.set(movement.id, movement);
    this.movementEventIds.add(movement.eventId);
    if (movement.unitCost !== null) this.costCurrencies.add(movement.unitCost.currency);
    const signed = movement.direction === 'IN'
      ? movement.quantity.scaledValue
      : -movement.quantity.scaledValue;
    this.balanceScaled += signed;
    if (movement.batchId !== null) {
      this.batchBalancesScaled.set(
        movement.batchId, (this.batchBalancesScaled.get(movement.batchId) ?? 0) + signed
      );
    }
  }

  private calculateBalance(batchId?: string): Quantity {
    return Quantity.fromScaled(
      batchId === undefined ? this.balanceScaled : this.batchBalancesScaled.get(batchId) ?? 0,
      this.quantityScale
    );
  }

  private static requireText(value: string, code: string, message: string): string {
    const normalized = value.trim();
    if (normalized.length === 0) throw new DomainError(code, message);
    return normalized;
  }
}
