import {
  DomainError,
  Money,
  Percentage,
  Quantity
} from '@supermarket/shared';
import { ProductSnapshot } from '../catalog/index.js';
import { Discount } from './discount.js';
import { Payment } from './payment.js';
import type { SaleDomainEvent } from './sale-events.js';
import { SaleItem } from './sale-item.js';
import { cloneSaleRecipientSnapshot, type SaleRecipientSnapshot } from './sale-recipient.js';

export const SALE_STATUSES = ['DRAFT', 'COMPLETED', 'VOIDED'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export type StartSaleProps = {
  id: string;
  shiftId: string;
  currencyCode: string;
  terminalId: string;
  originNodeId: string;
  startedBy: string;
  startedAt: Date;
  eventId: string;
};

export type AddItemProps = {
  id: string;
  snapshot: ProductSnapshot;
  quantity: Quantity;
  occurredAt: Date;
  eventId: string;
};

export type ApplyDiscountProps = {
  id: string;
  lineItemId: string;
  percentage: Percentage;
  reason: string;
  appliedBy: string;
  occurredAt: Date;
  eventId: string;
  maximumBasisPoints: number;
};

export type RegisterPaymentsProps = {
  payments: Payment[];
  financialTransactionTax: Money;
  occurredAt: Date;
  eventIds: string[];
};

export type RestoredSaleProps = {
  id: string;
  shiftId: string;
  currencyCode: string;
  terminalId: string;
  originNodeId: string;
  startedBy: string;
  startedAt: Date;
  status: SaleStatus;
  version: number;
  items: SaleItem[];
  payments: Payment[];
  financialTransactionTax: Money;
  completedAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  voidedBy: string | null;
  recipient?: SaleRecipientSnapshot | null;
};

export type SetRecipientProps = {
  recipient: SaleRecipientSnapshot | null;
  occurredAt: Date;
  eventId: string;
};

export class Sale {
  private readonly currentItems: SaleItem[] = [];
  private readonly currentPayments: Payment[] = [];
  private readonly events: SaleDomainEvent[];
  private currentStatus: SaleStatus = 'DRAFT';
  private currentVersion = 1;
  private currentFinancialTransactionTax: Money;
  private currentCompletedAt: Date | null = null;
  private currentVoidedAt: Date | null = null;
  private currentVoidReason: string | null = null;
  private currentVoidedBy: string | null = null;
  private currentRecipient: SaleRecipientSnapshot | null = null;

  private constructor(
    readonly id: string,
    readonly shiftId: string,
    readonly currencyCode: string,
    readonly terminalId: string,
    readonly originNodeId: string,
    readonly startedBy: string,
    readonly startedAt: Date,
    event: SaleDomainEvent
  ) {
    this.currentFinancialTransactionTax = Money.zero(currencyCode);
    this.events = [event];
  }

  static start(props: StartSaleProps): Sale {
    const shiftId = props.shiftId.trim();
    if (shiftId.length === 0) {
      throw new DomainError('SALE_SHIFT_REQUIRED', 'Sale shift ID is required.');
    }
    const zero = Money.zero(props.currencyCode);
    const event: SaleDomainEvent = {
      type: 'SaleStarted',
      eventId: props.eventId,
      aggregateId: props.id,
      aggregateType: 'Sale',
      aggregateVersion: 1,
      occurredAt: new Date(props.startedAt),
      payload: {
        shiftId,
        currencyCode: zero.currency,
        terminalId: props.terminalId,
        originNodeId: props.originNodeId
      }
    };
    return new Sale(
      props.id,
      shiftId,
      zero.currency,
      props.terminalId,
      props.originNodeId,
      props.startedBy,
      new Date(props.startedAt),
      event
    );
  }

  /** Rehydrates persisted state without publishing historical domain events. */
  static restore(props: RestoredSaleProps): Sale {
    const sale = Sale.start({
      id: props.id,
      shiftId: props.shiftId,
      currencyCode: props.currencyCode,
      terminalId: props.terminalId,
      originNodeId: props.originNodeId,
      startedBy: props.startedBy,
      startedAt: props.startedAt,
      eventId: 'restored'
    });
    sale.currentItems.push(...props.items);
    sale.currentPayments.push(...props.payments);
    sale.currentStatus = props.status;
    sale.currentVersion = props.version;
    sale.currentFinancialTransactionTax = props.financialTransactionTax;
    sale.currentCompletedAt = props.completedAt === null ? null : new Date(props.completedAt);
    sale.currentVoidedAt = props.voidedAt === null ? null : new Date(props.voidedAt);
    sale.currentVoidReason = props.voidReason;
    sale.currentVoidedBy = props.voidedBy;
    sale.currentRecipient = props.recipient
      ? cloneSaleRecipientSnapshot(props.recipient)
      : null;
    sale.events.splice(0);
    return sale;
  }

  get status(): SaleStatus {
    return this.currentStatus;
  }

  get version(): number {
    return this.currentVersion;
  }

  get items(): readonly SaleItem[] {
    return this.currentItems;
  }

  get payments(): readonly Payment[] {
    return this.currentPayments;
  }

  get financialTransactionTax(): Money {
    return this.currentFinancialTransactionTax;
  }

  get completedAt(): Date | null {
    return this.currentCompletedAt;
  }

  get voidedAt(): Date | null {
    return this.currentVoidedAt;
  }

  get voidReason(): string | null {
    return this.currentVoidReason;
  }

  get voidedBy(): string | null {
    return this.currentVoidedBy;
  }

  get recipient(): SaleRecipientSnapshot | null {
    return this.currentRecipient === null
      ? null
      : cloneSaleRecipientSnapshot(this.currentRecipient);
  }

  get domainEvents(): readonly SaleDomainEvent[] {
    return this.events;
  }

  get subtotal(): Money {
    return this.sum((item) => item.grossAmount);
  }

  get discountTotal(): Money {
    return this.sum((item) => item.discountAmount);
  }

  get taxableBase(): Money {
    return this.sum((item) => item.taxableAmount);
  }

  get taxTotal(): Money {
    return this.sum((item) => item.taxAmount);
  }

  get commercialTotal(): Money {
    return this.taxableBase.add(this.taxTotal);
  }

  get total(): Money {
    return this.commercialTotal.add(this.currentFinancialTransactionTax);
  }

  get paidTotal(): Money {
    return this.currentPayments.reduce(
      (total, payment) => total.add(payment.amountInSaleCurrency),
      Money.zero(this.currencyCode)
    );
  }

  get balance(): Money {
    return this.total.subtract(this.paidTotal);
  }

  addItem(props: AddItemProps): void {
    this.assertEditable();
    if (this.currentItems.some((item) => item.id === props.id)) {
      throw new DomainError('SALE_ITEM_ALREADY_EXISTS', 'Sale item already exists.');
    }
    if (props.snapshot.price.currency !== this.currencyCode) {
      throw new DomainError('SALE_ITEM_CURRENCY_MISMATCH', 'Product price currency must match sale currency.');
    }

    const item = SaleItem.create(props);
    this.currentItems.push(item);
    this.recordEvent({
      type: 'SaleItemAdded',
      eventId: props.eventId,
      occurredAt: props.occurredAt,
      payload: {
        itemId: item.id,
        productId: item.snapshot.productId,
        quantity: item.quantity
      }
    });
  }

  removeItem(itemId: string, occurredAt: Date, eventId: string): void {
    this.assertEditable();
    const itemIndex = this.currentItems.findIndex((item) => item.id === itemId);
    if (itemIndex < 0) {
      throw new DomainError('SALE_ITEM_NOT_FOUND', 'Sale item was not found.');
    }
    this.currentItems.splice(itemIndex, 1);
    this.recordEvent({
      type: 'SaleItemRemoved',
      eventId,
      occurredAt,
      payload: { itemId }
    });
  }

  applyDiscount(props: ApplyDiscountProps): Discount {
    this.assertEditable();
    if (
      !Number.isSafeInteger(props.maximumBasisPoints) ||
      props.maximumBasisPoints < 0 ||
      props.maximumBasisPoints > 10_000
    ) {
      throw new DomainError('SALE_DISCOUNT_INVALID_POLICY', 'Discount policy maximum is invalid.');
    }
    if (props.percentage.basisPoints > props.maximumBasisPoints) {
      throw new DomainError('SALE_DISCOUNT_EXCEEDS_LIMIT', 'Discount exceeds the configured limit.');
    }

    const item = this.findItem(props.lineItemId);
    const discount = item.applyDiscount({
      id: props.id,
      lineItemId: props.lineItemId,
      percentage: props.percentage,
      reason: props.reason,
      appliedBy: props.appliedBy,
      appliedAt: props.occurredAt
    });
    this.recordEvent({
      type: 'DiscountApplied',
      eventId: props.eventId,
      occurredAt: props.occurredAt,
      payload: {
        discountId: discount.id,
        itemId: discount.lineItemId,
        amount: discount.amount,
        basisPoints: discount.percentage.basisPoints
      }
    });
    return discount;
  }

  registerPayments(props: RegisterPaymentsProps): void {
    this.assertEditable();
    if (this.currentItems.length === 0) {
      throw new DomainError('SALE_EMPTY', 'Sale must contain at least one item.');
    }
    if (this.currentPayments.length > 0) {
      throw new DomainError('SALE_PAYMENTS_ALREADY_REGISTERED', 'Sale payments are already registered.');
    }
    if (props.payments.length === 0 || props.eventIds.length !== props.payments.length) {
      throw new DomainError('SALE_PAYMENT_BATCH_INVALID', 'Payment batch is invalid.');
    }
    this.assertMoneyInSaleCurrency(props.financialTransactionTax);
    if (props.financialTransactionTax.minorUnits < 0) {
      throw new DomainError('SALE_INVALID_IGTF', 'Financial transaction tax cannot be negative.');
    }

    const paymentTotal = props.payments.reduce(
      (total, payment) => {
        this.assertMoneyInSaleCurrency(payment.amountInSaleCurrency);
        return total.add(payment.amountInSaleCurrency);
      },
      Money.zero(this.currencyCode)
    );
    const expectedTotal = this.commercialTotal.add(props.financialTransactionTax);
    if (paymentTotal.minorUnits !== expectedTotal.minorUnits) {
      throw new DomainError(
        'SALE_PAYMENT_TOTAL_MISMATCH',
        'Payment batch must match the sale total exactly.'
      );
    }

    this.currentPayments.push(...props.payments);
    this.currentFinancialTransactionTax = props.financialTransactionTax;
    props.payments.forEach((payment, index) => {
      this.recordEvent({
        type: 'PaymentRegistered',
        eventId: props.eventIds[index] as string,
        occurredAt: props.occurredAt,
        payload: {
          paymentId: payment.id,
          amountInSaleCurrency: payment.amountInSaleCurrency,
          methodCode: payment.method.code
        }
      });
    });
  }

  /**
   * Adjunta, corrige o retira el receptor mientras la venta sigue en borrador.
   * No usa `assertEditable` a propósito: ese cierre protege la consistencia
   * monetaria después de registrar pagos, y el receptor no altera importes.
   * Completar sí congela el valor, porque el documento fiscal ya lo copió.
   */
  setRecipient(props: SetRecipientProps): void {
    if (this.currentStatus !== 'DRAFT') {
      throw new DomainError('SALE_INVALID_STATE', 'Only draft sales can change their recipient.');
    }
    this.currentRecipient = props.recipient === null
      ? null
      : cloneSaleRecipientSnapshot(props.recipient);
    this.recordEvent({
      type: 'SaleRecipientChanged',
      eventId: props.eventId,
      occurredAt: props.occurredAt,
      /**
       * El ledger explica la acción sin acumular datos personales: la
       * identificación, el nombre y la dirección viven solo en la venta, que
       * es la fuente de verdad operativa (ADR-0018).
       */
      payload: {
        attached: this.currentRecipient !== null,
        country: this.currentRecipient?.country ?? null,
        type: this.currentRecipient?.type ?? null
      }
    });
  }

  complete(props: { completedAt: Date; eventId: string }): void {
    if (this.currentStatus !== 'DRAFT') {
      throw new DomainError('SALE_INVALID_STATE', 'Only draft sales can be completed.');
    }
    if (this.currentItems.length === 0) {
      throw new DomainError('SALE_EMPTY', 'Sale must contain at least one item.');
    }
    if (this.currentPayments.length === 0 || this.balance.minorUnits !== 0) {
      throw new DomainError('SALE_PAYMENT_INSUFFICIENT', 'Sale payment is insufficient.');
    }

    this.currentStatus = 'COMPLETED';
    this.currentCompletedAt = new Date(props.completedAt);
    this.recordEvent({
      type: 'SaleCompleted',
      eventId: props.eventId,
      occurredAt: props.completedAt,
      payload: {
        shiftId: this.shiftId,
        terminalId: this.terminalId,
        total: this.total,
        paidTotal: this.paidTotal,
        payments: this.currentPayments.map((payment) => ({
          paymentId: payment.id,
          methodCode: payment.method.code,
          currencyCode: payment.amount.currency,
          amountMinorUnits: payment.amount.minorUnits
        })),
        items: this.currentItems.map((item) => ({
          itemId: item.id,
          productId: item.snapshot.productId,
          quantityScaled: item.quantity.scaledValue,
          quantityScale: item.quantity.scale,
          /**
           * Costo congelado al vender, con su procedencia. `null` es costo
           * desconocido y así viaja: el receptor no lo completa con su
           * promedio del momento de aplicar (ADR-0026 D4).
           */
          costSnapshot: item.snapshot.costSnapshot === null ? null : {
            unitCost: item.snapshot.costSnapshot.unitCost,
            version: item.snapshot.costSnapshot.version,
            source: item.snapshot.costSnapshot.source,
            observedAt: item.snapshot.costSnapshot.observedAt.toISOString()
          }
        }))
      }
    });
  }

  void(props: { reason: string; voidedBy: string; voidedAt: Date; eventId: string }): void {
    if (this.currentStatus !== 'DRAFT') {
      throw new DomainError('SALE_INVALID_STATE', 'Only draft sales can be voided.');
    }
    const reason = props.reason.trim();
    if (reason.length === 0) {
      throw new DomainError('SALE_VOID_REASON_REQUIRED', 'Void reason is required.');
    }

    this.currentStatus = 'VOIDED';
    this.currentVoidedAt = new Date(props.voidedAt);
    this.currentVoidReason = reason;
    this.currentVoidedBy = props.voidedBy.trim();
    this.recordEvent({
      type: 'SaleVoided',
      eventId: props.eventId,
      occurredAt: props.voidedAt,
      payload: { reason, voidedBy: props.voidedBy }
    });
  }

  private findItem(itemId: string): SaleItem {
    const item = this.currentItems.find((candidate) => candidate.id === itemId);
    if (!item) throw new DomainError('SALE_ITEM_NOT_FOUND', 'Sale item was not found.');
    return item;
  }

  private assertEditable(): void {
    if (this.currentStatus !== 'DRAFT') {
      throw new DomainError('SALE_INVALID_STATE', 'Only draft sales can be modified.');
    }
    if (this.currentPayments.length > 0) {
      throw new DomainError('SALE_LOCKED_AFTER_PAYMENT', 'Sale cannot change after payments are registered.');
    }
  }

  private assertMoneyInSaleCurrency(money: Money): void {
    if (money.currency !== this.currencyCode) {
      throw new DomainError('SALE_CURRENCY_MISMATCH', 'Amount currency must match sale currency.');
    }
  }

  private sum(selector: (item: SaleItem) => Money): Money {
    return this.currentItems.reduce(
      (total, item) => total.add(selector(item)),
      Money.zero(this.currencyCode)
    );
  }

  private recordEvent(event: Omit<SaleDomainEvent, 'aggregateId' | 'aggregateType' | 'aggregateVersion'>): void {
    this.currentVersion += 1;
    this.events.push({
      ...event,
      aggregateId: this.id,
      aggregateType: 'Sale',
      aggregateVersion: this.currentVersion
    } as SaleDomainEvent);
  }
}
