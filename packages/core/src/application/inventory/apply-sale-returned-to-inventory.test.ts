import { describe, expect, it } from 'vitest';
import { Money, Quantity } from '@supermarket/shared';
import type { BusinessEventV1 } from '../events/index.js';
import type {
  AuditEntry, AuditWriter, BusinessEventStore, IdGenerator, OutboxStore,
  StockItemRepository, UnitOfWork
} from '../ports/index.js';
import { StockItem } from '../../domain/inventory/index.js';
import { ApplySaleReturnedToInventory } from './apply-sale-returned-to-inventory.js';

class StockItems implements StockItemRepository {
  readonly values = new Map<string, StockItem>();
  async save(item: StockItem): Promise<void> { this.values.set(item.id, item); }
  async findById(id: string): Promise<StockItem | null> { return this.values.get(id) ?? null; }
  async findByProductId(productId: string): Promise<StockItem | null> {
    return [...this.values.values()].find((item) => item.productId === productId) ?? null;
  }
}

const sequence = (prefix: string): IdGenerator => {
  let next = 0;
  return { generate: () => `${prefix}-${++next}` };
};
const unitOfWork: UnitOfWork = { execute: (work) => work() };

/**
 * Artículo del coordinador con la salida de la venta ya aplicada: dos unidades
 * del lote uno, a 500, con la referencia que `ApplySaleCompletedToInventory`
 * registra.
 */
const issuedItem = (): StockItem => {
  const item = StockItem.create({
    id: 'stock-001', productId: 'product-001', unitCode: 'UNIT',
    quantityScale: 0, tracksBatches: true
  });
  item.registerBatch({ id: 'batch-001', lotNumber: 'LOT-001' });
  item.registerMovement({
    id: 'receipt-1', eventId: 'receipt-event-1', type: 'PURCHASE_RECEIPT',
    quantity: Quantity.fromScaled(10, 0), batchId: 'batch-001', actorId: 'user-001',
    reason: 'Purchase', referenceId: 'receipt-1',
    occurredAt: new Date('2026-09-01T10:00:00.000Z'),
    unitCost: Money.fromMinorUnits(500, 'USD')
  });
  item.registerMovement({
    id: 'issue-1', eventId: 'issue-event-1', type: 'SALE_ISSUE',
    quantity: Quantity.fromScaled(2, 0), batchId: 'batch-001', actorId: 'user-001',
    reason: 'Completed sale issue', referenceId: 'event-sale-001:item-001',
    occurredAt: new Date('2026-09-07T10:00:00.000Z'),
    unitCost: Money.fromMinorUnits(500, 'USD')
  });
  return item;
};

const event = (overrides: Partial<BusinessEventV1> = {}): BusinessEventV1 => ({
  eventId: 'return-completed-001', eventType: 'SaleReturned', contractVersion: 2,
  aggregateId: 'return-001', aggregateType: 'SaleReturn', aggregateVersion: 1,
  originNodeId: 'node-terminal-001', correlationId: 'correlation-001', actorId: 'user-001',
  occurredAt: new Date('2026-09-07T11:00:00.000Z'),
  payload: {
    saleId: 'sale-001',
    saleEventId: 'event-sale-001',
    originalDocumentId: 'document-001',
    creditNoteId: 'credit-001',
    shiftId: 'shift-001',
    terminalId: 'terminal-001',
    refundMinorUnits: 2320,
    currencyCode: 'USD',
    paymentMethodCode: 'CASH_USD',
    reason: 'Producto defectuoso',
    lineCount: 1,
    lines: [{
      lineId: 'return-line-001', saleItemId: 'item-001', productId: 'product-001',
      stockItemId: 'stock-001', batchId: 'batch-001', quantityScaled: 2, quantityScale: 0,
      unitCost: { minorUnits: 500, currencyCode: 'USD' }
    }]
  },
  ...overrides
});

const withLines = (lines: readonly unknown[]): BusinessEventV1 => {
  const payload = event().payload as Record<string, unknown>;
  return event({ payload: { ...payload, lineCount: lines.length, lines } as never });
};

const outbox = (events: Parameters<OutboxStore['enqueue']>[0][number][]): OutboxStore => ({
  enqueue: async (enqueued) => { events.push(...enqueued); }, claimAvailable: async () => [],
  isClaimActive: async () => false, markPublished: async () => false,
  markFailed: async () => false, markBlocked: async () => false,
  markPaused: async () => false, resumeDelivery: async () => false,
  summarize: async (destinationNodeId) => ({ destinationNodeId, pending: 0, paused: 0,
    blocked: 0, lastPublishedAt: null, lastError: null }),
  listPaused: async () => []
});

const service = (
  repository: StockItems,
  collected: {
    readonly ledger?: string[];
    readonly audits?: AuditEntry[];
    readonly publications?: Parameters<OutboxStore['enqueue']>[0][number][];
  } = {}
): ApplySaleReturnedToInventory => new ApplySaleReturnedToInventory(
  repository, sequence('movement'), sequence('event'), sequence('audit'), unitOfWork,
  {
    append: async (events) => {
      collected.ledger?.push(...events.map(({ eventType }) => eventType));
    },
    findByAggregate: async () => []
  } satisfies BusinessEventStore,
  { append: async (entries) => { collected.audits?.push(...entries); } } satisfies AuditWriter,
  collected.publications ? outbox(collected.publications) : undefined,
  'node-coordinator'
);

describe('ApplySaleReturnedToInventory', () => {
  it('restituye el lote y el costo de la salida original una sola vez', async () => {
    const repository = new StockItems();
    await repository.save(issuedItem());
    const ledger: string[] = [];
    const audits: AuditEntry[] = [];
    const publications: Parameters<OutboxStore['enqueue']>[0][number][] = [];

    const consumer = service(repository, { ledger, audits, publications });
    await expect(consumer.execute(event())).resolves.toMatchObject({ ok: true });
    /** La reentrega conserva el mismo movimiento: ni stock ni auditoría duplicados. */
    await expect(consumer.execute(event())).resolves.toMatchObject({ ok: true });

    const item = repository.values.get('stock-001');
    expect(item?.balance.scaledValue).toBe(10);
    expect(item?.movements.filter(({ type }) => type === 'ADJUSTMENT_IN')).toMatchObject([{
      referenceId: 'return-completed-001:return-line-001',
      batchId: 'batch-001',
      quantity: { scaledValue: 2, scale: 0 },
      unitCost: { minorUnits: 500, currency: 'USD' }
    }]);
    expect(ledger).toEqual(['StockMovementRegistered']);
    expect(audits).toMatchObject([{
      action: 'SALE_RETURN_STOCK_RESTORED',
      originNodeId: 'node-coordinator',
      after: { saleEventId: 'event-sale-001', saleItemId: 'item-001' }
    }]);
    expect(publications).toMatchObject([{ eventType: 'StockAvailabilityPublished' }]);
  });

  it('conserva el costo desconocido de una salida sin costo', async () => {
    const repository = new StockItems();
    const item = StockItem.create({
      id: 'stock-001', productId: 'product-001', unitCode: 'UNIT',
      quantityScale: 0, tracksBatches: false
    });
    item.registerMovement({
      id: 'receipt-1', eventId: 'receipt-event-1', type: 'PURCHASE_RECEIPT',
      quantity: Quantity.fromScaled(4, 0), actorId: 'user-001', reason: 'Purchase',
      referenceId: 'receipt-1', occurredAt: new Date('2026-09-01T10:00:00.000Z')
    });
    item.registerMovement({
      id: 'issue-1', eventId: 'issue-event-1', type: 'SALE_ISSUE',
      quantity: Quantity.fromScaled(2, 0), actorId: 'user-001',
      reason: 'Completed sale issue', referenceId: 'event-sale-001:item-001',
      occurredAt: new Date('2026-09-07T10:00:00.000Z')
    }, { inferOperationalCost: false });
    await repository.save(item);

    await expect(service(repository).execute(withLines([{
      lineId: 'return-line-001', saleItemId: 'item-001', productId: 'product-001',
      stockItemId: 'stock-001', batchId: null, quantityScaled: 2, quantityScale: 0,
      unitCost: null
    }]))).resolves.toMatchObject({ ok: true });

    expect(repository.values.get('stock-001')?.movements
      .find(({ type }) => type === 'ADJUSTMENT_IN')?.unitCost).toBeNull();
  });

  it('no restituye una salida que este nodo no aplicó', async () => {
    const repository = new StockItems();
    await repository.save(issuedItem());

    await expect(service(repository).execute(event({
      payload: { ...event().payload as Record<string, unknown>, saleEventId: 'event-otra-venta' }
    }))).resolves.toMatchObject({
      ok: false, error: { code: 'STOCK_SALE_RETURN_ISSUE_NOT_FOUND' }
    });
    expect(repository.values.get('stock-001')?.balance.scaledValue).toBe(8);
  });

  it('no restituye con un lote o un costo que no salieron', async () => {
    const repository = new StockItems();
    await repository.save(issuedItem());

    await expect(service(repository).execute(withLines([{
      lineId: 'return-line-001', saleItemId: 'item-001', productId: 'product-001',
      stockItemId: 'stock-001', batchId: 'batch-001', quantityScaled: 2, quantityScale: 0,
      unitCost: { minorUnits: 900, currencyCode: 'USD' }
    }]))).resolves.toMatchObject({
      ok: false, error: { code: 'STOCK_SALE_RETURN_ISSUE_NOT_FOUND' }
    });
  });

  it('no repone más de lo que salió', async () => {
    const repository = new StockItems();
    await repository.save(issuedItem());

    await expect(service(repository).execute(withLines([{
      lineId: 'return-line-001', saleItemId: 'item-001', productId: 'product-001',
      stockItemId: 'stock-001', batchId: 'batch-001', quantityScaled: 3, quantityScale: 0,
      unitCost: { minorUnits: 500, currencyCode: 'USD' }
    }]))).resolves.toMatchObject({
      ok: false, error: { code: 'STOCK_SALE_RETURN_ISSUE_NOT_FOUND' }
    });
    expect(repository.values.get('stock-001')?.balance.scaledValue).toBe(8);
  });

  it('rechaza un hecho sin la evidencia de restitución del contrato v2', async () => {
    const repository = new StockItems();
    await repository.save(issuedItem());

    await expect(service(repository).execute(event({
      payload: {
        saleId: 'sale-001', originalDocumentId: 'document-001', creditNoteId: 'credit-001',
        shiftId: 'shift-001', refundMinorUnits: 2320, currencyCode: 'USD',
        paymentMethodCode: 'CASH_USD', lineCount: 1
      }
    }))).resolves.toMatchObject({
      ok: false, error: { code: 'INVENTORY_SALE_RETURN_EVENT_INVALID' }
    });
  });
});
