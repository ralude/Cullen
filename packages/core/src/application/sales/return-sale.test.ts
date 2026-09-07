import { describe, expect, it } from 'vitest';
import { Money, Quantity, TaxRate } from '@supermarket/shared';
import { ProductSnapshot } from '../../domain/catalog/index.js';
import { CashRegister, Shift } from '../../domain/cash/index.js';
import { PaymentMethod } from '../../domain/currency/index.js';
import { FiscalDocument, type FiscalDocumentContent } from '../../domain/fiscal/index.js';
import { StockItem } from '../../domain/inventory/index.js';
import { Payment, Sale } from '../../domain/sales/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuditEntry, AuditWriter, AuthorizationService, BusinessEventStore, FiscalDocumentRepository,
  FiscalPrinterPort, IdempotencyRecord, IdempotencyStore, OutboxStore, RemoteSaleIssueProbe,
  SaleRepository, SaleReturnRepository, ShiftRepository, StockItemRepository, UnitOfWork
} from '../ports/index.js';
import type { CoordinatedStockOperations } from '../sync/index.js';
import { ReturnSale } from './return-sale.js';

const context: ExecutionContext = {
  actorId: 'actor-001', actorRoleCodes: ['supervisor'], terminalId: 'terminal-001',
  originNodeId: 'node-001', correlationId: 'correlation-001', idempotencyKey: 'return-001'
};
const now = new Date('2026-09-04T12:00:00.000Z');
const method = PaymentMethod.create({ code: 'CASH_USD', name: 'Cash USD', kind: 'CASH', currencyCode: 'USD' });

const completedSale = (mixed = false): Sale => {
  const sale = Sale.start({
    id: 'sale-001', shiftId: 'shift-001', currencyCode: 'USD', terminalId: 'terminal-001',
    originNodeId: 'node-001', startedBy: 'actor-001', startedAt: now, eventId: 'sale-started'
  });
  sale.addItem({
    id: 'item-001', snapshot: ProductSnapshot.create({
      productId: 'product-001', description: 'Coffee', price: Money.fromMinorUnits(1_000, 'USD'),
      taxRate: TaxRate.fromBasisPoints(0), unitCode: 'UNIT', unitScale: 0
    }), quantity: Quantity.fromScaled(1, 0), occurredAt: now, eventId: 'item-added'
  });
  sale.registerPayments({
    payments: [Payment.create({
      id: 'payment-001', method, amount: Money.fromMinorUnits(mixed ? 600 : 1_000, 'USD'),
      amountInSaleCurrency: Money.fromMinorUnits(mixed ? 600 : 1_000, 'USD'), exchangeRate: null,
      registeredBy: 'actor-001', registeredAt: now
    }), ...(mixed ? [Payment.create({
      id: 'payment-002', method, amount: Money.fromMinorUnits(400, 'USD'),
      amountInSaleCurrency: Money.fromMinorUnits(400, 'USD'), exchangeRate: null,
      registeredBy: 'actor-001', registeredAt: now
    })] : [])],
    financialTransactionTax: Money.zero('USD'), occurredAt: now,
    eventIds: mixed ? ['payment-registered-1', 'payment-registered-2'] : ['payment-registered']
  });
  sale.complete({ completedAt: now, eventId: 'sale-completed' });
  return sale;
};

const originalDocument = (): FiscalDocument => {
  const content: FiscalDocumentContent = {
    referenceId: 'sale-001', type: 'INVOICE', currencyCode: 'USD',
    lines: [{ id: 'item-001', description: 'Coffee', quantityScaled: 1, quantityScale: 0,
      unitPriceMinorUnits: 1_000, taxRateBasisPoints: 0, totalMinorUnits: 1_000 }],
    payments: [{ methodCode: 'CASH_USD', amountMinorUnits: 1_000 }], totalMinorUnits: 1_000
  };
  const document = FiscalDocument.create({
    id: 'invoice-001', content, idempotencyKey: 'invoice-key', requestFingerprint: 'invoice-fingerprint',
    terminalId: 'terminal-001', originNodeId: 'node-001', createdBy: 'actor-001', createdAt: now,
    eventId: 'invoice-pending'
  });
  document.startPrinting({ actorId: 'actor-001', occurredAt: now, eventId: 'invoice-printing' });
  document.markIssued({
    fiscalNumber: 'F-001', actorId: 'actor-001', occurredAt: now, eventId: 'invoice-issued',
    evidence: { dispatchState: 'RESULT_RECEIVED', commandEffect: 'APPLIED', fiscalCommit: 'COMMITTED', printDelivery: 'COMPLETE' }
  });
  return document;
};

const stock = (): StockItem => {
  const item = StockItem.create({ id: 'stock-001', productId: 'product-001', unitCode: 'UNIT', quantityScale: 0, tracksBatches: false });
  item.registerMovement({ id: 'purchase-1', type: 'PURCHASE_RECEIPT', quantity: Quantity.fromScaled(2, 0), actorId: 'actor-001', reason: 'Purchase', referenceId: 'receipt-1', occurredAt: now, eventId: 'purchase-event', unitCost: Money.fromMinorUnits(500, 'USD') });
  item.registerMovement({ id: 'sale-issue-1', type: 'SALE_ISSUE', quantity: Quantity.fromScaled(1, 0), actorId: 'actor-001', reason: 'Completed sale issue', referenceId: 'sale-completed:item-001', occurredAt: now, eventId: 'issue-event', unitCost: Money.fromMinorUnits(500, 'USD') });
  return item;
};

const openShift = (): Shift => Shift.open({
  id: 'shift-001', cashRegister: CashRegister.create({ id: 'register-001', name: 'Caja 1', terminalId: 'terminal-001', originNodeId: 'node-001' }),
  openingFunds: [{ id: 'opening-1', method, amount: Money.fromMinorUnits(5_000, 'USD') }],
  openedBy: 'actor-001', openedAt: now, eventId: 'shift-opened'
});

/**
 * Coordinación LAN mínima: registra la intención con coordinador y recoge la
 * evidencia local que la reconciliación usará después.
 */
const lanCoordination = (localEvidence: string[][]): CoordinatedStockOperations => ({
  begin: async () => ({ ok: true, value: {
    operationId: 'operation-001', kind: 'SALE_RETURN', fingerprint: 'sale-001',
    coordinatorNodeId: 'node-coordinator', actorId: context.actorId,
    terminalId: context.terminalId, originNodeId: context.originNodeId,
    correlationId: context.correlationId, reason: 'Producto devuelto',
    status: 'PENDING_RECONCILIATION', startedAt: now, updatedAt: now, steps: []
  } }),
  recordLocalEffect: async (_operationId: string, eventIds: readonly string[]) => {
    localEvidence.push([...eventIds]);
    return {};
  }
} as unknown as CoordinatedStockOperations);

class Harness {
  constructor(
    readonly failPrinting = false,
    /** Coordinación LAN y evidencia remota; ausentes en un nodo standalone. */
    readonly coordination?: CoordinatedStockOperations,
    readonly saleIssues?: RemoteSaleIssueProbe
  ) {
    this.useCase = this.build();
  }
  sale: Sale = completedSale();
  document: FiscalDocument = originalDocument();
  shift: Shift = openShift();
  stockItem: StockItem = stock();
  returned: Awaited<ReturnType<SaleReturnRepository['findById']>> = null;
  idempotency: IdempotencyRecord | null = null;
  printerCalls = 0;
  /** Salida de integración observada, cuando la prueba la necesita. */
  enqueued?: { eventType: string; contractVersion: number; payload: unknown }[];
  readonly saleRepository: SaleRepository = { save: async (sale) => { this.sale = sale; }, findById: async () => this.sale };
  readonly saleReturnRepository: SaleReturnRepository = {
    save: async (value) => { this.returned = value; }, findById: async (id) => this.returned?.id === id ? this.returned : null,
    findBySaleId: async (id) => this.returned?.saleId === id ? this.returned : null
  };
  readonly fiscalRepository: FiscalDocumentRepository = {
    save: async (value) => { this.document = value; }, findById: async (id) => id === this.document.id ? this.document : null,
    findByReference: async (_node, type, reference) => type === this.document.content.type && reference === this.document.content.referenceId ? this.document : null,
    findByIdempotencyKey: async () => null, findActive: async () => null, findRecoverable: async () => []
  };
  readonly shiftRepository: ShiftRepository = { save: async (value) => { this.shift = value; }, findById: async () => this.shift, findOpenByCashRegisterId: async () => this.shift };
  readonly stockRepository: StockItemRepository = { save: async (value) => { this.stockItem = value; }, findById: async () => this.stockItem, findByProductId: async () => this.stockItem };
  readonly printer: FiscalPrinterPort = {
    getStatus: async () => ({ ok: true, value: { connection: 'OPEN', state: 'IDLE', paperAvailable: true, memoryAvailable: true, lastDocumentReferenceId: null, lastDocumentNumber: null } }),
    printInvoice: async () => { throw new Error('unused'); },
    printCreditNote: async () => {
      this.printerCalls += 1;
      if (this.failPrinting) return { ok: false, error: {
        code: 'FISCAL_PRINTER_TIMEOUT', retryable: true, message: 'Printer timeout.',
        evidence: { dispatchState: 'STARTED', commandEffect: 'UNKNOWN', fiscalCommit: 'UNKNOWN', printDelivery: 'INCOMPLETE' }
      } };
      return { ok: true, value: { fiscalNumber: 'NC-001', confirmedAt: now, evidence: { dispatchState: 'RESULT_RECEIVED', commandEffect: 'APPLIED', fiscalCommit: 'COMMITTED', printDelivery: 'COMPLETE' } } };
    },
    printXReport: async () => { throw new Error('unused'); }, printZReport: async () => { throw new Error('unused'); }
  };
  /**
   * Se compone en el constructor, no como inicializador de campo: las
   * propiedades de parámetro se asignan después de los campos, así que
   * `coordination` y `saleIssues` no existirían todavía.
   */
  readonly useCase: ReturnSale;

  private build(): ReturnSale {
    return new ReturnSale(
    this.saleRepository, this.saleReturnRepository, this.fiscalRepository, this.shiftRepository,
    this.stockRepository, this.printer, { authorize: async () => true } satisfies AuthorizationService,
    { generate: () => `return-id-${this.printerCalls}` }, { generate: () => `movement-id-${this.printerCalls}` },
    { generate: () => 'credit-note-001' }, { generate: () => `event-id-${this.printerCalls}` },
    { generate: () => `audit-id-${this.printerCalls}` }, { now: () => now },
    { execute: async <T>(work: () => Promise<T>) => work() } satisfies UnitOfWork,
    /**
     * El ledger conserva la `SaleCompleted` que causó la salida: es la
     * identidad con la que el coordinador reconoce qué restituir.
     */
    { append: async (events) => { void events; },
      findByAggregate: async () => [{
        eventId: 'sale-completed', eventType: 'SaleCompleted', contractVersion: 2,
        aggregateId: 'sale-001', aggregateType: 'Sale', aggregateVersion: 4,
        originNodeId: 'node-001', correlationId: 'correlation-001', actorId: 'actor-001',
        occurredAt: now, payload: {}
      }] } satisfies BusinessEventStore,
    { enqueue: async (events) => { this.enqueued?.push(...events); }, claimAvailable: async () => [],
      isClaimActive: async () => false, markPublished: async () => false,
      markFailed: async () => false, markBlocked: async () => false,
      markPaused: async () => false, resumeDelivery: async () => false,
      summarize: async (destinationNodeId: string) => ({
        destinationNodeId, pending: 0, paused: 0, blocked: 0,
        lastPublishedAt: null, lastError: null
      }), listPaused: async () => [] } satisfies OutboxStore,
    { append: async (entries: readonly AuditEntry[]) => { void entries; } } satisfies AuditWriter,
    { find: async (scope, key) => this.idempotency?.scope === scope && this.idempotency.key === key ? this.idempotency : null,
      save: async (record) => { this.idempotency = record; } } satisfies IdempotencyStore,
      this.coordination,
      this.saleIssues
    );
  }
}

describe('ReturnSale', () => {
  it('revierte inventario y turno, emite una nota simulada y repite sin efectos', async () => {
    const harness = new Harness();
    const first = await harness.useCase.execute({ saleId: 'sale-001', reason: 'Producto devuelto' }, context);
    const second = await harness.useCase.execute({ saleId: 'sale-001', reason: 'Producto devuelto' }, context);
    const differentIntent = await harness.useCase.execute(
      { saleId: 'sale-001', reason: 'Otro motivo' }, { ...context, idempotencyKey: 'return-002' }
    );

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(harness.stockItem.balance.scaledValue).toBe(2);
    expect(harness.shift.expectedBalances.find((entry) => entry.paymentMethodCode === 'CASH_USD')?.amount.minorUnits).toBe(4_000);
    expect(harness.printerCalls).toBe(1);
    expect(first.ok && first.value.creditNoteStatus).toBe('ISSUED');
    expect(differentIntent).toMatchObject({ ok: false, error: { code: 'SALE_ALREADY_RETURNED' } });
  });

  it('rechaza pagos mixtos antes de mutar inventario o caja', async () => {
    const harness = new Harness();
    harness.sale = completedSale(true);
    const result = await harness.useCase.execute({ saleId: 'sale-001', reason: 'Cambio' }, context);

    expect(result).toMatchObject({ ok: false, error: { code: 'SALE_RETURN_MIXED_PAYMENT_UNSUPPORTED' } });
    expect(harness.returned).toBeNull();
    expect(harness.stockItem.balance.scaledValue).toBe(1);
    expect(harness.printerCalls).toBe(0);
  });

  it('conserva la devolución y bloquea la reimpresión ciega si el fake falla', async () => {
    const harness = new Harness(true);
    const first = await harness.useCase.execute({ saleId: 'sale-001', reason: 'Falla de impresión' }, context);
    const retry = await harness.useCase.execute({ saleId: 'sale-001', reason: 'Falla de impresión' }, context);

    expect(first).toMatchObject({ ok: false, error: { code: 'FISCAL_PRINTER_TIMEOUT' } });
    expect(retry).toMatchObject({ ok: false, error: { code: 'FISCAL_RECONCILIATION_REQUIRED' } });
    expect(harness.stockItem.balance.scaledValue).toBe(2);
    expect(harness.printerCalls).toBe(1);
  });

  it('en LAN restituye con la salida del coordinador y no escribe stock local', async () => {
    const localEvidence: string[][] = [];
    const enqueued: { eventType: string; contractVersion: number; payload: unknown }[] = [];
    const harness = new Harness(false, lanCoordination(localEvidence), {
      saleIssuesOf: async (saleEventId) => saleEventId === 'sale-completed'
        ? {
          state: 'APPLIED',
          lines: [{
            saleItemId: 'item-001', productId: 'product-001', stockItemId: 'stock-authority-001',
            batchId: 'batch-authority-001', quantityScaled: 1, quantityScale: 0,
            unitCost: { minorUnits: 800, currencyCode: 'USD' }
          }]
        }
        : { state: 'NONE', lines: [] }
    });
    harness.enqueued = enqueued;

    const result = await harness.useCase.execute(
      { saleId: 'sale-001', reason: 'Producto devuelto' }, context
    );

    expect(result.ok).toBe(true);
    /** El POS no toca su proyección: el movimiento autoritativo es del coordinador. */
    expect(harness.stockItem.balance.scaledValue).toBe(1);
    /** La caja local sí se mueve: el reintegro es un hecho del turno del origen. */
    expect(harness.shift.expectedBalances
      .find((entry) => entry.paymentMethodCode === 'CASH_USD')?.amount.minorUnits).toBe(4_000);
    expect(enqueued.find(({ eventType }) => eventType === 'SaleReturned')).toMatchObject({
      contractVersion: 2,
      payload: {
        saleEventId: 'sale-completed',
        terminalId: 'terminal-001',
        lines: [{
          saleItemId: 'item-001', stockItemId: 'stock-authority-001',
          batchId: 'batch-authority-001', quantityScaled: 1,
          unitCost: { minorUnits: 800, currencyCode: 'USD' }
        }]
      }
    });
    expect(localEvidence).toHaveLength(1);
  });

  it('en LAN no devuelve nada si el coordinador aún no aplicó la salida', async () => {
    for (const state of ['PENDING', 'DISCREPANCY', 'UNKNOWN'] as const) {
      const harness = new Harness(false, lanCoordination([]), {
        saleIssuesOf: async () => ({ state, lines: [] })
      });

      await expect(harness.useCase.execute(
        { saleId: 'sale-001', reason: 'Producto devuelto' }, context
      )).resolves.toMatchObject({
        ok: false, error: { code: 'SALE_RETURN_SALE_ISSUE_NOT_APPLIED' }
      });
      /** Ni nota, ni reintegro, ni stock: la operación no empezó. */
      expect(harness.returned).toBeNull();
      expect(harness.printerCalls).toBe(0);
      expect(harness.stockItem.balance.scaledValue).toBe(1);
    }
  });

  it('en LAN rechaza una restitución que no explica lo vendido', async () => {
    const harness = new Harness(false, lanCoordination([]), {
      saleIssuesOf: async () => ({
        state: 'APPLIED',
        lines: [{
          saleItemId: 'item-001', productId: 'product-001', stockItemId: 'stock-authority-001',
          batchId: null, quantityScaled: 5, quantityScale: 0, unitCost: null
        }]
      })
    });

    await expect(harness.useCase.execute(
      { saleId: 'sale-001', reason: 'Producto devuelto' }, context
    )).resolves.toMatchObject({
      ok: false, error: { code: 'SALE_RETURN_STOCK_NOT_RESTORABLE' }
    });
    expect(harness.returned).toBeNull();
    expect(harness.printerCalls).toBe(0);
  });
});
