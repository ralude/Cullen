import { ApplicationError, err, ok, type AppError, type Result } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type { JsonValue } from '../events/index.js';
import type { AuthorizationService, BusinessEventStore, SaleReturnRepository } from '../ports/index.js';
import { resolveRowLimit } from '../reporting/row-limit.js';
import { SALE_PERMISSIONS } from './permissions.js';

export type SaleHistoryVersion = {
  readonly version: number;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly actorId: string;
  readonly status: 'DRAFT' | 'COMPLETED' | 'VOIDED' | 'RETURNED';
  readonly itemIds: readonly string[];
  readonly discountTotalMinorUnits: number;
  readonly paymentTotalMinorUnits: number;
  readonly totalMinorUnits: number | null;
  readonly recipientAttached: boolean;
  readonly refundMinorUnits: number | null;
};

export type GetSaleHistoryInput = {
  readonly saleId: string;
  readonly limit?: number;
};

const record = (value: JsonValue): Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};

const text = (value: JsonValue | undefined): string | null =>
  typeof value === 'string' ? value : null;

const minorUnits = (value: JsonValue | undefined): number => {
  const amount = value === undefined ? {} : record(value);
  return typeof amount.minorUnits === 'number' ? amount.minorUnits : 0;
};

/**
 * Historia consultable de una venta. Reúne los eventos de la propia venta
 * (incluido el cambio de receptor, ADR-0018) y, si existe, la devolución que
 * vive en el agregado `SaleReturn`, sin reescribir la venta original. La
 * lectura autoriza en aplicación y acota el número de versiones devueltas.
 */
export class GetSaleHistory {
  constructor(
    private readonly events: BusinessEventStore,
    private readonly saleReturns: SaleReturnRepository,
    private readonly authorization: AuthorizationService
  ) {}

  async execute(
    input: GetSaleHistoryInput,
    context: ExecutionContext
  ): Promise<Result<readonly SaleHistoryVersion[], AppError>> {
    if (!(await this.authorization.authorize(context, SALE_PERMISSIONS.READ_HISTORY))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to read sale history.'));
    }

    const events = await this.events.findByAggregate('Sale', input.saleId);
    if (events.length === 0) {
      return err(new ApplicationError('SALE_HISTORY_NOT_FOUND', 'Sale history was not found.'));
    }

    let status: SaleHistoryVersion['status'] = 'DRAFT';
    const itemIds = new Set<string>();
    let discountTotalMinorUnits = 0;
    let paymentTotalMinorUnits = 0;
    let totalMinorUnits: number | null = null;
    let recipientAttached = false;
    const history: SaleHistoryVersion[] = [];

    for (const event of events) {
      const payload = record(event.payload);
      if (event.eventType === 'SaleItemAdded') {
        const itemId = text(payload.itemId);
        if (itemId) itemIds.add(itemId);
      } else if (event.eventType === 'SaleItemRemoved') {
        const itemId = text(payload.itemId);
        if (itemId) itemIds.delete(itemId);
      } else if (event.eventType === 'DiscountApplied') {
        discountTotalMinorUnits += minorUnits(payload.amount);
      } else if (event.eventType === 'PaymentRegistered') {
        paymentTotalMinorUnits += minorUnits(payload.amountInSaleCurrency);
      } else if (event.eventType === 'SaleCompleted') {
        status = 'COMPLETED';
        totalMinorUnits = minorUnits(payload.total);
      } else if (event.eventType === 'SaleVoided') {
        status = 'VOIDED';
      } else if (event.eventType === 'SaleRecipientChanged') {
        recipientAttached = payload.attached === true;
      }
      history.push({
        version: event.aggregateVersion,
        eventType: event.eventType,
        occurredAt: new Date(event.occurredAt),
        actorId: event.actorId,
        status,
        itemIds: [...itemIds],
        discountTotalMinorUnits,
        paymentTotalMinorUnits,
        totalMinorUnits,
        recipientAttached,
        refundMinorUnits: null
      });
    }

    const saleReturn = await this.saleReturns.findBySaleId(input.saleId);
    if (saleReturn !== null) {
      status = 'RETURNED';
      history.push({
        version: (history.at(-1)?.version ?? 0) + 1,
        eventType: 'SaleReturned',
        occurredAt: new Date(saleReturn.occurredAt),
        actorId: saleReturn.actorId,
        status,
        itemIds: [...itemIds],
        discountTotalMinorUnits,
        paymentTotalMinorUnits,
        totalMinorUnits,
        recipientAttached,
        refundMinorUnits: saleReturn.refund.minorUnits
      });
    }

    return ok(history.slice(-resolveRowLimit(input.limit)));
  }
}
