import { DomainError, type Money, type Quantity } from '@supermarket/shared';
import type { ExchangeRate } from '../currency/index.js';
import type { FiscalAddress, TaxIdentity } from './supplier.js';

export type PurchaseReceiptStatus = 'DRAFT' | 'COMPLETED' | 'REVERSED';
export type PurchaseSourceDocument = {
  readonly type: 'INVOICE' | 'DELIVERY_NOTE';
  readonly number: string;
  readonly series: string | null;
  readonly controlNumber: string | null;
  readonly issuedAt: Date | null;
};
export type PurchaseSupplierSnapshot = {
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly taxIdentity: TaxIdentity;
  readonly fiscalAddress: FiscalAddress | null;
};
export type PurchaseReceiptLine = {
  readonly id: string;
  readonly productId: string;
  readonly stockItemId: string;
  readonly unitCode: string;
  readonly tracksBatches: boolean;
  readonly quantity: Quantity;
  readonly batchId: string | null;
  readonly batchLotNumber: string | null;
  readonly batchExpiresAt: Date | null;
  readonly purchaseUnitCost: Money;
  readonly valuationUnitCost: Money;
  readonly exchangeRate: ExchangeRate | null;
};
export type PurchaseReceiptEvent = {
  readonly type: 'PurchaseReceiptCompleted' | 'PurchaseReceiptReversed';
  readonly eventId: string;
  readonly aggregateId: string;
  readonly aggregateType: 'PurchaseReceipt';
  readonly aggregateVersion: number;
  readonly occurredAt: Date;
  readonly payload: Record<string, unknown>;
};
export type StartPurchaseReceiptProps = {
  readonly id: string;
  readonly supplierId: string;
  readonly supplierSnapshot: PurchaseSupplierSnapshot;
  readonly sourceDocument: PurchaseSourceDocument;
  readonly effectiveAt: Date;
  readonly createdBy: string;
  readonly originNodeId: string;
  readonly createdAt: Date;
  readonly replacesReceiptId: string | null;
  readonly lines: readonly PurchaseReceiptLine[];
};
export type RestorePurchaseReceiptProps = StartPurchaseReceiptProps & {
  readonly status: PurchaseReceiptStatus;
  readonly version: number;
  readonly completedAt: Date | null;
  readonly reversedAt: Date | null;
  readonly reversedBy: string | null;
  readonly reversalReason: string | null;
};

const required = (value: string, code: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new DomainError(code, 'A required purchase receipt value is missing.');
  return normalized;
};
const optional = (value: string | null): string | null => value === null ? null : value.trim() || null;
const validDate = (value: Date, code: string): Date => {
  if (Number.isNaN(value.getTime())) throw new DomainError(code, 'Purchase receipt date is invalid.');
  return new Date(value);
};

export class PurchaseReceipt {
  private currentStatus: PurchaseReceiptStatus = 'DRAFT';
  private currentVersion = 1;
  private currentCompletedAt: Date | null = null;
  private currentReversedAt: Date | null = null;
  private currentReversedBy: string | null = null;
  private currentReversalReason: string | null = null;
  private readonly events: PurchaseReceiptEvent[] = [];

  private constructor(
    readonly id: string,
    readonly supplierId: string,
    readonly supplierSnapshot: PurchaseSupplierSnapshot,
    readonly sourceDocument: PurchaseSourceDocument,
    readonly effectiveAt: Date,
    readonly createdBy: string,
    readonly originNodeId: string,
    readonly createdAt: Date,
    readonly replacesReceiptId: string | null,
    readonly lines: readonly PurchaseReceiptLine[]
  ) {}

  static start(props: StartPurchaseReceiptProps): PurchaseReceipt {
    const snapshot = {
      legalName: required(props.supplierSnapshot.legalName, 'PURCHASE_RECEIPT_SUPPLIER_NAME_REQUIRED'),
      tradeName: optional(props.supplierSnapshot.tradeName),
      taxIdentity: { ...props.supplierSnapshot.taxIdentity },
      fiscalAddress: props.supplierSnapshot.fiscalAddress ? { ...props.supplierSnapshot.fiscalAddress } : null
    };
    if (snapshot.taxIdentity.country === 'VE' && snapshot.fiscalAddress === null) {
      throw new DomainError('PURCHASE_RECEIPT_FISCAL_ADDRESS_REQUIRED', 'A fiscal address is required for a Venezuelan receipt.');
    }
    if (props.lines.length === 0) {
      throw new DomainError('PURCHASE_RECEIPT_LINES_REQUIRED', 'A purchase receipt needs at least one line.');
    }
    const lineIds = new Set<string>();
    const lines = props.lines.map((line) => {
      const id = required(line.id, 'PURCHASE_RECEIPT_LINE_ID_REQUIRED');
      if (lineIds.has(id)) throw new DomainError('PURCHASE_RECEIPT_LINE_DUPLICATED', 'Purchase receipt line is duplicated.');
      lineIds.add(id);
      if (line.quantity.scaledValue <= 0 || line.purchaseUnitCost.minorUnits < 0 || line.valuationUnitCost.minorUnits < 0) {
        throw new DomainError('PURCHASE_RECEIPT_LINE_INVALID', 'Purchase receipt quantity and costs are invalid.');
      }
      return { ...line, id, productId: required(line.productId, 'PURCHASE_RECEIPT_PRODUCT_REQUIRED'),
        stockItemId: required(line.stockItemId, 'PURCHASE_RECEIPT_STOCK_ITEM_REQUIRED'),
        unitCode: required(line.unitCode, 'PURCHASE_RECEIPT_UNIT_REQUIRED'),
        batchId: optional(line.batchId), batchLotNumber: optional(line.batchLotNumber),
        batchExpiresAt: line.batchExpiresAt === null ? null
          : validDate(line.batchExpiresAt, 'PURCHASE_RECEIPT_BATCH_EXPIRY_INVALID') };
    });
    const sourceDocument = {
      type: props.sourceDocument.type,
      number: required(props.sourceDocument.number, 'PURCHASE_RECEIPT_SOURCE_NUMBER_REQUIRED'),
      series: optional(props.sourceDocument.series), controlNumber: optional(props.sourceDocument.controlNumber),
      issuedAt: props.sourceDocument.issuedAt === null ? null : validDate(props.sourceDocument.issuedAt, 'PURCHASE_RECEIPT_SOURCE_DATE_INVALID')
    };
    return new PurchaseReceipt(required(props.id, 'PURCHASE_RECEIPT_ID_REQUIRED'),
      required(props.supplierId, 'PURCHASE_RECEIPT_SUPPLIER_REQUIRED'), snapshot, sourceDocument,
      validDate(props.effectiveAt, 'PURCHASE_RECEIPT_EFFECTIVE_DATE_INVALID'),
      required(props.createdBy, 'PURCHASE_RECEIPT_ACTOR_REQUIRED'),
      required(props.originNodeId, 'PURCHASE_RECEIPT_ORIGIN_NODE_REQUIRED'),
      validDate(props.createdAt, 'PURCHASE_RECEIPT_CREATED_AT_INVALID'), optional(props.replacesReceiptId), lines);
  }

  static restore(props: RestorePurchaseReceiptProps): PurchaseReceipt {
    const receipt = PurchaseReceipt.start(props);
    receipt.currentStatus = props.status;
    receipt.currentVersion = props.version;
    receipt.currentCompletedAt = props.completedAt && new Date(props.completedAt);
    receipt.currentReversedAt = props.reversedAt && new Date(props.reversedAt);
    receipt.currentReversedBy = props.reversedBy;
    receipt.currentReversalReason = props.reversalReason;
    return receipt;
  }

  get status(): PurchaseReceiptStatus { return this.currentStatus; }
  get version(): number { return this.currentVersion; }
  get completedAt(): Date | null { return this.currentCompletedAt && new Date(this.currentCompletedAt); }
  get reversedAt(): Date | null { return this.currentReversedAt && new Date(this.currentReversedAt); }
  get reversedBy(): string | null { return this.currentReversedBy; }
  get reversalReason(): string | null { return this.currentReversalReason; }
  get domainEvents(): readonly PurchaseReceiptEvent[] { return [...this.events]; }

  complete(props: { actorId: string; occurredAt: Date; eventId: string }): void {
    if (this.currentStatus !== 'DRAFT') throw new DomainError('PURCHASE_RECEIPT_INVALID_STATE', 'Only a draft receipt can be completed.');
    this.currentStatus = 'COMPLETED'; this.currentVersion += 1;
    this.currentCompletedAt = validDate(props.occurredAt, 'PURCHASE_RECEIPT_TIMESTAMP_INVALID');
    this.events.push({ type: 'PurchaseReceiptCompleted', eventId: required(props.eventId, 'PURCHASE_RECEIPT_EVENT_ID_REQUIRED'),
      aggregateId: this.id, aggregateType: 'PurchaseReceipt', aggregateVersion: this.currentVersion,
      occurredAt: this.currentCompletedAt, payload: { supplierId: this.supplierId, sourceType: this.sourceDocument.type,
        sourceNumber: this.sourceDocument.number, lineCount: this.lines.length } });
  }

  reverse(props: { actorId: string; reason: string; occurredAt: Date; eventId: string }): void {
    this.assertCanReverse(props);
    this.currentStatus = 'REVERSED'; this.currentVersion += 1;
    this.currentReversalReason = required(props.reason, 'PURCHASE_RECEIPT_REVERSAL_REASON_REQUIRED');
    this.currentReversedBy = required(props.actorId, 'PURCHASE_RECEIPT_ACTOR_REQUIRED');
    this.currentReversedAt = validDate(props.occurredAt, 'PURCHASE_RECEIPT_TIMESTAMP_INVALID');
    this.events.push({ type: 'PurchaseReceiptReversed', eventId: required(props.eventId, 'PURCHASE_RECEIPT_EVENT_ID_REQUIRED'),
      aggregateId: this.id, aggregateType: 'PurchaseReceipt', aggregateVersion: this.currentVersion,
      occurredAt: this.currentReversedAt, payload: { originalReceiptId: this.id, reason: this.currentReversalReason } });
  }

  assertCanReverse(props: { actorId: string; reason: string; occurredAt: Date }): void {
    if (this.currentStatus !== 'COMPLETED') {
      throw new DomainError('PURCHASE_RECEIPT_INVALID_STATE', 'Only a completed receipt can be reversed.');
    }
    required(props.reason, 'PURCHASE_RECEIPT_REVERSAL_REASON_REQUIRED');
    required(props.actorId, 'PURCHASE_RECEIPT_ACTOR_REQUIRED');
    validDate(props.occurredAt, 'PURCHASE_RECEIPT_TIMESTAMP_INVALID');
  }
}
