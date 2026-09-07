import { describe, expect, it } from 'vitest';
import { Money, Quantity } from '@supermarket/shared';
import { SaleReturn } from '../../domain/sales/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type { BusinessEventV1 } from '../events/index.js';
import type { AuthorizationService, BusinessEventStore, SaleReturnRepository } from '../ports/index.js';
import { GetSaleHistory } from './get-sale-history.js';
import { SALE_PERMISSIONS } from './permissions.js';

const context: ExecutionContext = {
  actorId: 'user-001', terminalId: 'terminal-001', originNodeId: 'node-001', correlationId: 'correlation-001'
};

const event = (overrides: Partial<BusinessEventV1>): BusinessEventV1 => ({
  eventId: 'event-1', eventType: 'SaleStarted', contractVersion: 1,
  aggregateId: 'sale-1', aggregateType: 'Sale', aggregateVersion: 1,
  originNodeId: 'node-001', correlationId: 'correlation-001', actorId: 'user-001',
  occurredAt: new Date('2026-09-05T10:00:00.000Z'), payload: {}, ...overrides
});

const eventStore = (events: readonly BusinessEventV1[]): BusinessEventStore => ({
  append: async () => {},
  findByAggregate: async (type, id) =>
    type === 'Sale' && id === 'sale-1' ? events : []
});

const noReturn: SaleReturnRepository = {
  save: async () => {}, findById: async () => null, findBySaleId: async () => null
};

const allow = (...permissions: string[]): AuthorizationService => ({
  authorize: async (_context, permission) => permissions.includes(permission)
});

describe('GetSaleHistory', () => {
  it('denies the read without the history permission and reports a missing history', async () => {
    const denied = await new GetSaleHistory(eventStore([event({})]), noReturn, allow())
      .execute({ saleId: 'sale-1' }, context);
    expect(denied).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    const missing = await new GetSaleHistory(eventStore([]), noReturn, allow(SALE_PERMISSIONS.READ_HISTORY))
      .execute({ saleId: 'sale-1' }, context);
    expect(missing).toMatchObject({ ok: false, error: { code: 'SALE_HISTORY_NOT_FOUND' } });
  });

  it('folds the recipient change and the return into the sale history', async () => {
    const events = [
      event({ eventId: 'e1', eventType: 'SaleStarted', aggregateVersion: 1 }),
      event({
        eventId: 'e2', eventType: 'SaleItemAdded', aggregateVersion: 2,
        payload: { itemId: 'item-1' }
      }),
      event({
        eventId: 'e3', eventType: 'SaleRecipientChanged', aggregateVersion: 3,
        payload: { attached: true, country: 'VE', type: 'RIF' }
      }),
      event({
        eventId: 'e4', eventType: 'SaleCompleted', aggregateVersion: 4,
        payload: { total: { minorUnits: 5_000, currencyCode: 'USD' } }
      })
    ];
    const saleReturn = SaleReturn.register({
      id: 'return-1', saleId: 'sale-1', saleEventId: 'e4', originalDocumentId: 'doc-1', creditNoteId: 'note-1',
      shiftId: 'shift-1', refund: Money.fromMinorUnits(5_000, 'USD'), paymentMethodCode: 'CASH_USD',
      reason: 'Producto defectuoso', actorId: 'user-002', terminalId: 'terminal-001',
      originNodeId: 'node-001', occurredAt: new Date('2026-09-06T09:00:00.000Z'),
      eventId: 'return-event-1',
      lines: [{
        id: 'return-line-1', saleItemId: 'item-1', productId: 'product-1', stockItemId: 'stock-1',
        batchId: null, quantity: Quantity.fromScaled(1, 0), unitCost: Money.fromMinorUnits(3_000, 'USD')
      }]
    });
    const saleReturns: SaleReturnRepository = {
      save: async () => {}, findById: async () => null,
      findBySaleId: async (saleId) => saleId === 'sale-1' ? saleReturn : null
    };

    const result = await new GetSaleHistory(
      eventStore(events), saleReturns, allow(SALE_PERMISSIONS.READ_HISTORY)
    ).execute({ saleId: 'sale-1' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.at(2)).toMatchObject({ eventType: 'SaleRecipientChanged', recipientAttached: true });
    const last = result.value.at(-1)!;
    expect(last).toMatchObject({
      eventType: 'SaleReturned', status: 'RETURNED', refundMinorUnits: 5_000,
      recipientAttached: true, actorId: 'user-002', version: 5
    });
  });

  it('bounds the number of returned versions', async () => {
    const events = Array.from({ length: 20 }, (_unused, index) =>
      event({ eventId: `e${index}`, eventType: 'SaleItemAdded', aggregateVersion: index + 1,
        payload: { itemId: `item-${index}` } }));

    const result = await new GetSaleHistory(eventStore(events), noReturn, allow(SALE_PERMISSIONS.READ_HISTORY))
      .execute({ saleId: 'sale-1', limit: 5 }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(5);
    expect(result.value.at(-1)?.version).toBe(20);
  });
});
