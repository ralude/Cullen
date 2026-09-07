import { ApplicationError, DomainError, Money, Quantity, err, ok, type AppError, type Result } from '@supermarket/shared';
import { CurrencyConverter, type ExchangeRate } from '../../domain/currency/index.js';
import { PurchaseReceipt, type PurchaseReceiptLine } from '../../domain/purchasing/index.js';
import { StockItem } from '../../domain/inventory/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type { JsonValue, DomainEventLike } from '../events/index.js';
import { persistBusinessChange } from '../events/index.js';
import { executeIdempotentCommand } from '../idempotency/index.js';
import type {
  AuditEntry, AuditWriter, AuthorizationService, BusinessEventStore, Clock, ExchangeRateRepository, IdGenerator,
  IdempotencyStore, OutboxStore, ProductRepository, PurchaseReceiptRepository, StockItemRepository,
  SupplierRepository, UnitOfWork
} from '../ports/index.js';
import { toStockAvailabilityPublications } from '../inventory/index.js';
import type { CoordinatedStockOperations } from '../sync/coordinated-stock-operations.js';
import type {
  CompletePurchaseReceiptInput, PurchaseReceiptDto, PurchaseReceiptLineDto, ReversePurchaseReceiptInput,
  StartPurchaseReceiptInput
} from './dtos.js';
import { PURCHASE_RECEIPT_PERMISSIONS } from './permissions.js';

const serialize = (output: PurchaseReceiptDto): JsonValue => JSON.parse(JSON.stringify(output)) as JsonValue;
const restore = (output: JsonValue): PurchaseReceiptDto => output as unknown as PurchaseReceiptDto;

const toPurchaseReceiptLineDto = (line: PurchaseReceiptLine): PurchaseReceiptLineDto => ({
  id: line.id,
  productId: line.productId,
  stockItemId: line.stockItemId,
  quantityScaled: line.quantity.scaledValue,
  quantityScale: line.quantity.scale,
  batchId: line.batchId,
  purchaseUnitCostMinorUnits: line.purchaseUnitCost.minorUnits,
  purchaseCurrency: line.purchaseUnitCost.currency,
  valuationUnitCostMinorUnits: line.valuationUnitCost.minorUnits,
  valuationCurrency: line.valuationUnitCost.currency,
  exchangeRateId: line.exchangeRate?.id ?? null
});

export const toPurchaseReceiptDto = (receipt: PurchaseReceipt): PurchaseReceiptDto => ({
  id: receipt.id,
  originNodeId: receipt.originNodeId,
  supplierId: receipt.supplierId,
  status: receipt.status,
  sourceDocument: {
    type: receipt.sourceDocument.type,
    number: receipt.sourceDocument.number,
    series: receipt.sourceDocument.series,
    controlNumber: receipt.sourceDocument.controlNumber,
    issuedAt: receipt.sourceDocument.issuedAt === null ? null : receipt.sourceDocument.issuedAt.toISOString()
  },
  effectiveAt: receipt.effectiveAt.toISOString(),
  createdBy: receipt.createdBy,
  createdAt: receipt.createdAt.toISOString(),
  completedAt: receipt.completedAt === null ? null : receipt.completedAt.toISOString(),
  reversedAt: receipt.reversedAt === null ? null : receipt.reversedAt.toISOString(),
  reversedBy: receipt.reversedBy,
  reversalReason: receipt.reversalReason,
  lines: receipt.lines.map(toPurchaseReceiptLineDto),
  version: receipt.version
});

/**
 * Crea o corrige (mientras siga DRAFT) una recepción de compra. Resuelve o
 * crea el `StockItem` y el lote de cada línea igual que la recepción rápida
 * existente: la aplicación deriva unidad y escala del catálogo, nunca el
 * cliente. La moneda de valoración de un artículo es la de su primer costo
 * recibido; una línea en otra moneda exige el snapshot de una tasa existente
 * (ADR-0016). No se consulta una tasa implícita.
 */
export class StartPurchaseReceipt {
  constructor(
    private readonly receiptRepository: PurchaseReceiptRepository,
    private readonly supplierRepository: SupplierRepository,
    private readonly productRepository: ProductRepository,
    private readonly stockItemRepository: StockItemRepository,
    private readonly exchangeRateRepository: ExchangeRateRepository,
    private readonly authorization: AuthorizationService,
    private readonly receiptIdGenerator: IdGenerator,
    private readonly lineIdGenerator: IdGenerator,
    private readonly stockItemIdGenerator: IdGenerator,
    private readonly batchIdGenerator: IdGenerator,
    private readonly auditIdGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly auditWriter: AuditWriter,
    private readonly idempotencyStore?: IdempotencyStore
  ) {}

  async execute(input: StartPurchaseReceiptInput, context: ExecutionContext): Promise<Result<PurchaseReceiptDto, AppError>> {
    if (!(await this.authorization.authorize(context, PURCHASE_RECEIPT_PERMISSIONS.START))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to start a purchase receipt.'));
    }
    if (input.lines.length === 0) {
      return err(new ApplicationError('PURCHASE_RECEIPT_LINES_REQUIRED', 'A purchase receipt needs at least one line.'));
    }
    const now = this.clock.now();
    try {
      return await executeIdempotentCommand({
        operation: 'StartPurchaseReceipt', input, context, now, unitOfWork: this.unitOfWork,
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: async () => {
          if (input.replacesReceiptId) {
            const replaced = await this.receiptRepository.findById(input.replacesReceiptId);
            if (!replaced) return err(new ApplicationError('PURCHASE_RECEIPT_NOT_FOUND', 'Purchase receipt was not found.'));
            if (replaced.status !== 'DRAFT') {
              return err(new ApplicationError('PURCHASE_RECEIPT_NOT_DRAFT', 'Only a draft receipt can be corrected.'));
            }
          }
          const supplier = await this.supplierRepository.findById(input.supplierId);
          if (!supplier) return err(new ApplicationError('SUPPLIER_NOT_FOUND', 'Supplier was not found.'));

          const lines: PurchaseReceiptLine[] = [];
          const resolvedItems = new Map<string, StockItem>();
          const plannedBatches = new Map<string, { id: string; lotNumber: string; expiresAt: Date | null }>();
          for (const lineInput of input.lines) {
            let item: StockItem | null = resolvedItems.get(lineInput.productId)
              ?? await this.stockItemRepository.findByProductId(lineInput.productId);
            if (item === null) {
              const product = await this.productRepository.findById(lineInput.productId);
              if (!product) return err(new ApplicationError('PRODUCT_NOT_FOUND', 'Product was not found in the catalog.'));
              item = StockItem.create({
                id: this.stockItemIdGenerator.generate(), productId: lineInput.productId,
                unitCode: product.unitOfMeasure.code, quantityScale: product.unitOfMeasure.quantityScale,
                tracksBatches: lineInput.lot !== undefined
              });
            }
            resolvedItems.set(lineInput.productId, item);
            let batchId: string | null = null;
            let batchLotNumber: string | null = null;
            let batchExpiresAt: Date | null = null;
            if (item.tracksBatches) {
              if (!lineInput.lot) return err(new ApplicationError('STOCK_BATCH_REQUIRED', 'A lot is required for this receipt line.'));
              const lotNumber = lineInput.lot.lotNumber.trim().toUpperCase();
              const plannedKey = `${item.id}:${lotNumber}`;
              const existing = item.batches.find((candidate) => candidate.lotNumber === lotNumber) ?? null;
              const planned = plannedBatches.get(plannedKey);
              const batch = existing ?? planned ?? {
                id: this.batchIdGenerator.generate(), lotNumber,
                expiresAt: lineInput.lot.expiresAt ? new Date(lineInput.lot.expiresAt) : null
              };
              plannedBatches.set(plannedKey, batch);
              batchId = batch.id;
              batchLotNumber = batch.lotNumber;
              batchExpiresAt = batch.expiresAt;
            } else if (lineInput.lot) {
              return err(new ApplicationError('STOCK_BATCH_NOT_ACCEPTED', 'This stock item does not accept a lot.'));
            }

            const purchaseUnitCost = Money.fromMinorUnits(lineInput.purchaseUnitCostMinorUnits, lineInput.purchaseCurrency);
            const valuationCurrency = item.valuationCurrency ?? lineInput.purchaseCurrency;
            let valuationUnitCost = purchaseUnitCost;
            let exchangeRate: ExchangeRate | null = null;
            if (valuationCurrency !== lineInput.purchaseCurrency) {
              if (!lineInput.exchangeRateId) {
                return err(new ApplicationError('PURCHASE_RECEIPT_EXCHANGE_RATE_REQUIRED', 'An exchange rate snapshot is required to convert this line.'));
              }
              const rate = await this.exchangeRateRepository.findById(lineInput.exchangeRateId);
              if (!rate) return err(new ApplicationError('PURCHASE_RECEIPT_EXCHANGE_RATE_NOT_FOUND', 'Exchange rate was not found.'));
              const pairMatches = (rate.baseCurrency === lineInput.purchaseCurrency && rate.quoteCurrency === valuationCurrency) ||
                (rate.baseCurrency === valuationCurrency && rate.quoteCurrency === lineInput.purchaseCurrency);
              if (!pairMatches) {
                return err(new ApplicationError('PURCHASE_RECEIPT_EXCHANGE_RATE_MISMATCH', 'Exchange rate does not apply to this currency pair.'));
              }
              if (!rate.isValidAt(input.effectiveAt)) {
                return err(new ApplicationError('PURCHASE_RECEIPT_EXCHANGE_RATE_EXPIRED', 'Exchange rate is not valid at the receipt effective date.'));
              }
              valuationUnitCost = new CurrencyConverter().convert(purchaseUnitCost, rate, input.effectiveAt);
              exchangeRate = rate;
            }

            lines.push({
              id: this.lineIdGenerator.generate(), productId: lineInput.productId, stockItemId: item.id,
              unitCode: item.unitCode, tracksBatches: item.tracksBatches,
              quantity: Quantity.fromDecimal(lineInput.quantity, item.quantityScale), batchId,
              batchLotNumber, batchExpiresAt,
              purchaseUnitCost, valuationUnitCost, exchangeRate
            });
          }

          const receipt = PurchaseReceipt.start({
            id: this.receiptIdGenerator.generate(),
            supplierId: supplier.id,
            supplierSnapshot: {
              legalName: supplier.legalName, tradeName: supplier.tradeName,
              taxIdentity: supplier.taxIdentity, fiscalAddress: supplier.fiscalAddress
            },
            sourceDocument: {
              type: input.sourceDocument.type, number: input.sourceDocument.number,
              series: input.sourceDocument.series ?? null, controlNumber: input.sourceDocument.controlNumber ?? null,
              issuedAt: input.sourceDocument.issuedAt ?? null
            },
            effectiveAt: input.effectiveAt, createdBy: context.actorId,
            originNodeId: context.originNodeId, createdAt: now,
            replacesReceiptId: input.replacesReceiptId ?? null, lines
          });
          await this.receiptRepository.save(receipt);
          const dto = toPurchaseReceiptDto(receipt);
          await this.auditWriter.append([{
            auditId: this.auditIdGenerator.generate(), actorId: context.actorId, actorRoleCodes: context.actorRoleCodes ?? [],
            action: input.replacesReceiptId ? 'PURCHASE_RECEIPT_DRAFT_CORRECTED' : 'PURCHASE_RECEIPT_DRAFT_STARTED',
            entityType: 'PurchaseReceipt', entityId: receipt.id, before: null, after: dto as unknown as JsonValue,
            reason: input.reason, terminalId: context.terminalId, originNodeId: context.originNodeId,
            occurredAt: now, correlationId: context.correlationId
          }]);
          return ok(dto);
        },
        serialize, restore
      });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }
}

/**
 * Completa una recepción en borrador: exige proveedor activo, unicidad del
 * documento entre recepciones completadas y registra en una sola transacción
 * el movimiento de inventario con el costo aplicado por línea (que recalcula
 * el promedio ponderado móvil del artículo), el ledger, el outbox y la
 * auditoría.
 */
export class CompletePurchaseReceipt {
  constructor(
    private readonly receiptRepository: PurchaseReceiptRepository,
    private readonly supplierRepository: SupplierRepository,
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
    /**
     * Salida del coordinador: la recepción cambia el saldo autoritativo, así
     * que publica la disponibilidad de los ítems tocados.
     */
    private readonly outbox?: OutboxStore,
    /**
     * Coordinación LAN. Presente en una terminal con coordinador, exige enlace
     * antes del primer efecto y deja la intención pendiente de conciliación
     * hasta tener evidencia de todos los pasos (ADR-0026 D3).
     */
    private readonly coordination?: CoordinatedStockOperations
  ) {}

  async execute(input: CompletePurchaseReceiptInput, context: ExecutionContext): Promise<Result<PurchaseReceiptDto, AppError>> {
    if (!(await this.authorization.authorize(context, PURCHASE_RECEIPT_PERMISSIONS.COMPLETE))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to complete a purchase receipt.'));
    }
    const now = this.clock.now();
    /**
     * La intención se registra antes del primer efecto y exige enlace: sin
     * coordinador alcanzable no se toca nada, en lugar de dejar una operación
     * a medias que después haya que compensar.
     */
    const started = await this.coordination?.begin({
      kind: 'PURCHASE_RECEIPT_COMPLETION',
      fingerprint: input.receiptId,
      reason: input.reason
    }, context);
    if (started !== undefined && !started.ok) return err(started.error);
    try {
      return await executeIdempotentCommand({
        operation: 'CompletePurchaseReceipt', input, context, now, unitOfWork: this.unitOfWork,
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: async () => {
          const receipt = await this.receiptRepository.findById(input.receiptId);
          if (!receipt) return err(new ApplicationError('PURCHASE_RECEIPT_NOT_FOUND', 'Purchase receipt was not found.'));
          if (receipt.originNodeId !== context.originNodeId) {
            return err(new ApplicationError('AGGREGATE_OWNER_MISMATCH', 'Purchase receipt belongs to another node.'));
          }
          const supplier = await this.supplierRepository.findById(receipt.supplierId);
          if (!supplier || supplier.status !== 'ACTIVE') {
            return err(new ApplicationError('SUPPLIER_NOT_ACTIVE', 'Supplier is not active for new receipts.'));
          }
          const duplicate = await this.receiptRepository.findCompletedBySource(
            receipt.supplierId, receipt.sourceDocument.type, receipt.sourceDocument.series, receipt.sourceDocument.number
          );
          if (duplicate && duplicate.id !== receipt.id) {
            return err(new ApplicationError('PURCHASE_RECEIPT_SOURCE_DUPLICATED', 'This source document was already received.'));
          }
          if (receipt.sourceDocument.controlNumber !== null) {
            const controlDuplicate = await this.receiptRepository.findCompletedByControlNumber(
              receipt.supplierId, receipt.sourceDocument.controlNumber
            );
            if (controlDuplicate && controlDuplicate.id !== receipt.id) {
              return err(new ApplicationError('PURCHASE_RECEIPT_SOURCE_DUPLICATED', 'This source document was already received.'));
            }
          }

          const before = toPurchaseReceiptDto(receipt);
          const items = new Map<string, StockItem>();
          const allEvents: DomainEventLike[] = [];
          for (const line of receipt.lines) {
            let item = items.get(line.stockItemId) ?? await this.stockItemRepository.findById(line.stockItemId);
            if (!item) {
              item = StockItem.create({
                id: line.stockItemId, productId: line.productId, unitCode: line.unitCode,
                quantityScale: line.quantity.scale, tracksBatches: line.tracksBatches
              });
            }
            items.set(line.stockItemId, item);
            if (line.batchId !== null && !item.batches.some(({ id }) => id === line.batchId)) {
              if (line.batchLotNumber === null) {
                return err(new ApplicationError('STOCK_BATCH_NOT_FOUND', 'Receipt batch evidence is incomplete.'));
              }
              item.registerBatch({
                id: line.batchId, lotNumber: line.batchLotNumber,
                ...(line.batchExpiresAt === null ? {} : { expiresAt: line.batchExpiresAt })
              });
            }
            const beforeEventCount = item.domainEvents.length;
            item.registerMovement({
              id: this.movementIdGenerator.generate(), type: 'PURCHASE_RECEIPT', quantity: line.quantity,
              ...(line.batchId ? { batchId: line.batchId } : {}), actorId: context.actorId, reason: input.reason,
              referenceId: `${receipt.id}:${line.id}`, occurredAt: now,
              eventId: this.eventIdGenerator.generate(), unitCost: line.valuationUnitCost
            });
            allEvents.push(...item.domainEvents.slice(beforeEventCount));
          }

          receipt.complete({ actorId: context.actorId, occurredAt: now, eventId: this.eventIdGenerator.generate() });
          allEvents.push(...receipt.domainEvents);

          const audits: AuditEntry[] = [{
            auditId: this.auditIdGenerator.generate(), actorId: context.actorId, actorRoleCodes: context.actorRoleCodes ?? [],
            action: 'PURCHASE_RECEIPT_COMPLETED', entityType: 'PurchaseReceipt', entityId: receipt.id,
            before: before as unknown as JsonValue, after: toPurchaseReceiptDto(receipt) as unknown as JsonValue,
            reason: input.reason, terminalId: context.terminalId, originNodeId: context.originNodeId,
            occurredAt: now, correlationId: context.correlationId
          }];
          await persistBusinessChange(
            async () => {
              await this.receiptRepository.save(receipt);
              for (const item of items.values()) await this.stockItemRepository.save(item);
            },
            allEvents, context, undefined, this.eventStore, this.outbox, [], this.auditWriter, audits,
            toStockAvailabilityPublications(items.values(), this.eventIdGenerator, now)
          );
          /**
           * La evidencia local se confirma en la misma transacción que los
           * efectos: si el proceso cae aquí, la operación conserva su
           * intención y la recuperación concilia esa misma, sin repetirla.
           */
          if (started !== undefined && started.ok) {
            await this.coordination?.recordLocalEffect(
              started.value.operationId,
              allEvents.map(({ eventId }) => eventId),
              context.originNodeId
            );
          }
          return ok(toPurchaseReceiptDto(receipt));
        },
        serialize, restore
      });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }
}

/**
 * Revierte una recepción completada. Conserva la recepción original, crea un
 * movimiento `ADJUSTMENT_OUT` compensatorio por línea con el costo congelado
 * del movimiento original (ADR-0016) y falla sin efectos parciales si alguna
 * línea ya no tiene stock suficiente para compensar.
 */
export class ReversePurchaseReceipt {
  constructor(
    private readonly receiptRepository: PurchaseReceiptRepository,
    private readonly stockItemRepository: StockItemRepository,
    private readonly authorization: AuthorizationService,
    private readonly movementIdGenerator: IdGenerator,
    private readonly eventIdGenerator: IdGenerator,
    private readonly auditIdGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly eventStore: BusinessEventStore,
    private readonly auditWriter: AuditWriter,
    private readonly idempotencyStore?: IdempotencyStore
  ) {}

  async execute(input: ReversePurchaseReceiptInput, context: ExecutionContext): Promise<Result<PurchaseReceiptDto, AppError>> {
    if (!(await this.authorization.authorize(context, PURCHASE_RECEIPT_PERMISSIONS.REVERSE))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to reverse a purchase receipt.'));
    }
    const now = this.clock.now();
    try {
      return await executeIdempotentCommand({
        operation: 'ReversePurchaseReceipt', input, context, now, unitOfWork: this.unitOfWork,
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: async () => {
          const receipt = await this.receiptRepository.findById(input.receiptId);
          if (!receipt) return err(new ApplicationError('PURCHASE_RECEIPT_NOT_FOUND', 'Purchase receipt was not found.'));
          if (receipt.originNodeId !== context.originNodeId) {
            return err(new ApplicationError('AGGREGATE_OWNER_MISMATCH', 'Purchase receipt belongs to another node.'));
          }
          receipt.assertCanReverse({ actorId: context.actorId, reason: input.reason, occurredAt: now });
          const before = toPurchaseReceiptDto(receipt);
          const items = new Map<string, StockItem>();
          const allEvents: DomainEventLike[] = [];
          for (const line of receipt.lines) {
            const item = items.get(line.stockItemId) ?? await this.stockItemRepository.findById(line.stockItemId);
            if (!item) return err(new ApplicationError('STOCK_ITEM_NOT_FOUND', 'Stock item was not found.'));
            items.set(line.stockItemId, item);
            const referenceId = `${receipt.id}:${line.id}`;
            const original = item.movements.find((movement) =>
              movement.referenceId === referenceId && movement.type === 'PURCHASE_RECEIPT');
            if (!original) {
              return err(new ApplicationError('PURCHASE_RECEIPT_MOVEMENT_NOT_FOUND', 'Original receipt movement was not found.'));
            }
            const beforeEventCount = item.domainEvents.length;
            item.registerMovement({
              id: this.movementIdGenerator.generate(), type: 'ADJUSTMENT_OUT', quantity: original.quantity,
              ...(original.batchId ? { batchId: original.batchId } : {}), actorId: context.actorId,
              reason: input.reason, referenceId: `${referenceId}:reversal`, occurredAt: now,
              eventId: this.eventIdGenerator.generate(), unitCost: original.unitCost
            });
            allEvents.push(...item.domainEvents.slice(beforeEventCount));
          }

          receipt.reverse({
            actorId: context.actorId, reason: input.reason, occurredAt: now,
            eventId: this.eventIdGenerator.generate()
          });
          allEvents.push(...receipt.domainEvents);

          const audits: AuditEntry[] = [{
            auditId: this.auditIdGenerator.generate(), actorId: context.actorId, actorRoleCodes: context.actorRoleCodes ?? [],
            action: 'PURCHASE_RECEIPT_REVERSED', entityType: 'PurchaseReceipt', entityId: receipt.id,
            before: before as unknown as JsonValue, after: toPurchaseReceiptDto(receipt) as unknown as JsonValue,
            reason: input.reason, terminalId: context.terminalId, originNodeId: context.originNodeId,
            occurredAt: now, correlationId: context.correlationId
          }];
          await persistBusinessChange(
            async () => {
              await this.receiptRepository.save(receipt);
              for (const item of items.values()) await this.stockItemRepository.save(item);
            },
            allEvents, context, undefined, this.eventStore, undefined, [], this.auditWriter, audits
          );
          return ok(toPurchaseReceiptDto(receipt));
        },
        serialize, restore
      });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }
}

export class GetPurchaseReceipt {
  constructor(
    private readonly repository: PurchaseReceiptRepository,
    private readonly authorization: AuthorizationService
  ) {}
  async execute(receiptId: string, context: ExecutionContext): Promise<Result<PurchaseReceiptDto, AppError>> {
    if (!(await this.authorization.authorize(context, PURCHASE_RECEIPT_PERMISSIONS.READ))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to read purchase receipts.'));
    }
    const receipt = await this.repository.findById(receiptId);
    return receipt ? ok(toPurchaseReceiptDto(receipt))
      : err(new ApplicationError('PURCHASE_RECEIPT_NOT_FOUND', 'Purchase receipt was not found.'));
  }
}
