import { describe, expect, it } from 'vitest';
import { Money, Quantity, TaxRate } from '@supermarket/shared';
import { Barcode, Category, Product, ProductSnapshot, UnitOfMeasure } from '../../domain/catalog/index.js';
import { CashRegister, Shift } from '../../domain/cash/index.js';
import { ExchangeRate, PaymentMethod } from '../../domain/currency/index.js';
import { FiscalDay, FiscalDocument } from '../../domain/fiscal/index.js';
import { Payment, Sale, SaleReturn } from '../../domain/sales/index.js';
import {
  toCategoryPublication,
  toExchangeRatePublication,
  toOperationalPolicyPublication,
  toPaymentMethodPublication,
  toProductPublication,
  toUnitOfMeasurePublication
} from '../catalog/reference-publications.js';
import type { ExecutionContext } from '../execution-context.js';
import { toBusinessEvents, type DomainEventLike } from './business-event.js';
import { SYNC_EVENT_CONTRACTS_V1, SYNC_INTEGRATION_EVENT_TYPES } from './sync-contracts.js';
import { toSyncEnvelope, validateSyncEnvelope } from './sync-envelope.js';

const at = (minutes: number): Date =>
  new Date(new Date('2026-09-05T10:00:00.000Z').getTime() + minutes * 60_000);

const context: ExecutionContext = {
  actorId: 'user-001',
  terminalId: 'terminal-001',
  originNodeId: 'node-001',
  correlationId: 'correlation-001'
};

const unit = UnitOfMeasure.create({ id: 'unit-001', code: 'UNIT', name: 'Unit', quantityScale: 0 });

const cashMethod = PaymentMethod.create({
  code: 'CASH_USD', name: 'Cash USD', kind: 'CASH', currencyCode: 'USD'
});

const committedEvidence = {
  dispatchState: 'RESULT_RECEIVED',
  commandEffect: 'APPLIED',
  fiscalCommit: 'COMMITTED',
  printDelivery: 'COMPLETE'
} as const;

const noCommitEvidence = {
  dispatchState: 'RESULT_RECEIVED',
  commandEffect: 'NOT_APPLIED',
  fiscalCommit: 'NOT_COMMITTED',
  printDelivery: 'INCOMPLETE'
} as const;

const catalogProduct = (): Product => {
  const product = Product.create({
    id: 'product-001',
    name: 'Rice',
    description: 'Rice 1kg',
    categoryId: 'category-001',
    unitOfMeasure: unit,
    barcodes: [Barcode.create({ id: 'barcode-001', value: '1234' })],
    price: Money.fromMinorUnits(1000, 'USD'),
    taxRate: TaxRate.fromBasisPoints(1600),
    priceHistoryId: 'history-001',
    recordedBy: 'user-001',
    occurredAt: at(0),
    eventId: 'event-product-created'
  });
  product.changePrice({
    price: Money.fromMinorUnits(1200, 'USD'),
    priceHistoryId: 'history-002',
    changedBy: 'user-001',
    reason: 'Ajuste de proveedor',
    occurredAt: at(1),
    eventId: 'event-price-changed'
  });
  return product;
};

const catalogEvents = (): readonly DomainEventLike[] => catalogProduct().domainEvents;

/**
 * Publicaciones de referencia construidas desde los mismos agregados que
 * usarán los productores: el contrato se valida contra el payload real, no
 * contra un literal escrito a mano en la prueba.
 */
const catalogReferenceEvents = (): readonly DomainEventLike[] => {
  const product = catalogProduct();
  product.updateDetails({
    barcodes: [
      Barcode.create({ id: 'barcode-001', value: '1234' }),
      Barcode.create({ id: 'barcode-002', value: '5678', isActive: false })
    ],
    isActive: false
  });
  return [
    toCategoryPublication(Category.create({ id: 'category-001', name: 'Granos' }), {
      eventId: 'event-category-published', occurredAt: at(2), version: 3
    }),
    toUnitOfMeasurePublication(unit, {
      eventId: 'event-unit-published', occurredAt: at(2), version: 1
    }),
    toOperationalPolicyPublication({
      policyType: 'DISCOUNT',
      policyId: 'discount-policy-2',
      version: 2,
      maximumBasisPoints: 1500
    }, { eventId: 'event-discount-policy-published', occurredAt: at(2) }),
    toOperationalPolicyPublication({
      policyType: 'FINANCIAL_TRANSACTION_TAX',
      policyId: 'tax-policy-3',
      version: 3,
      rateBasisPoints: 300,
      eligiblePaymentMethodCodes: ['CARD_USD'],
      eligibleCurrencies: ['USD']
    }, { eventId: 'event-tax-policy-published', occurredAt: at(2) }),
    toExchangeRatePublication(ExchangeRate.create({
      id: 'rate-001', baseCurrency: 'USD', quoteCurrency: 'VES',
      rateValue: 36500, rateScale: 3, source: 'BCV', validFrom: at(0),
      registeredBy: 'user-001'
    }), { eventId: 'event-exchange-rate-updated', occurredAt: at(2), version: 4 }),
    toPaymentMethodPublication(cashMethod, {
      eventId: 'event-payment-method-published', occurredAt: at(2), version: 2
    }),
    toProductPublication(product, {
      eventId: 'event-product-published', occurredAt: at(3)
    })
  ];
};

const saleEvents = (): readonly DomainEventLike[] => {
  const sale = Sale.start({
    id: 'sale-001',
    shiftId: 'shift-001',
    currencyCode: 'USD',
    terminalId: 'terminal-001',
    originNodeId: 'node-001',
    startedBy: 'user-001',
    startedAt: at(0),
    eventId: 'event-sale-started'
  });
  sale.addItem({
    id: 'item-001',
    snapshot: ProductSnapshot.create({
      productId: 'product-001',
      description: 'Rice 1kg',
      price: Money.fromMinorUnits(1000, 'USD'),
      taxRate: TaxRate.fromBasisPoints(1600),
      unitCode: 'UNIT',
      unitScale: 0
    }),
    quantity: Quantity.fromScaled(2, 0),
    occurredAt: at(1),
    eventId: 'event-item-added'
  });
  sale.registerPayments({
    payments: [Payment.create({
      id: 'payment-001',
      method: cashMethod,
      amount: sale.commercialTotal,
      amountInSaleCurrency: sale.commercialTotal,
      exchangeRate: null,
      registeredBy: 'user-001',
      registeredAt: at(2)
    })],
    financialTransactionTax: Money.zero('USD'),
    occurredAt: at(2),
    eventIds: ['event-payment-registered']
  });
  sale.complete({ completedAt: at(3), eventId: 'event-sale-completed' });
  return sale.domainEvents;
};

const saleReturnEvents = (): readonly DomainEventLike[] => SaleReturn.register({
  id: 'return-001',
  saleId: 'sale-001',
  originalDocumentId: 'document-001',
  creditNoteId: 'credit-note-001',
  shiftId: 'shift-001',
  refund: Money.fromMinorUnits(2320, 'USD'),
  paymentMethodCode: 'CASH_USD',
  reason: 'Producto defectuoso',
  actorId: 'user-001',
  terminalId: 'terminal-001',
  originNodeId: 'node-001',
  occurredAt: at(4),
  eventId: 'event-sale-returned',
  lines: [{
    id: 'return-line-001',
    saleItemId: 'item-001',
    productId: 'product-001',
    stockItemId: 'stock-001',
    batchId: null,
    quantity: Quantity.fromScaled(2, 0),
    unitCost: Money.fromMinorUnits(800, 'USD')
  }]
}).domainEvents;

const shiftEvents = (): readonly DomainEventLike[] => {
  const shift = Shift.open({
    id: 'shift-001',
    cashRegister: CashRegister.create({
      id: 'register-001',
      name: 'Caja 1',
      terminalId: 'terminal-001',
      originNodeId: 'node-001'
    }),
    openingFunds: [{
      id: 'fund-001', method: cashMethod, amount: Money.fromMinorUnits(5000, 'USD')
    }],
    openedBy: 'user-001',
    openedAt: at(0),
    eventId: 'event-shift-opened'
  });
  shift.registerMovement({
    id: 'movement-001',
    type: 'SALE_PAYMENT',
    method: cashMethod,
    amount: Money.fromMinorUnits(2320, 'USD'),
    reason: 'Cobro de venta',
    registeredBy: 'user-001',
    terminalId: 'terminal-001',
    originNodeId: 'node-001',
    occurredAt: at(1),
    eventId: 'event-cash-movement',
    reference: { sourceId: 'sale-001', sourceEventId: 'event-sale-completed' }
  });
  shift.close({
    declaredBalances: [{ method: cashMethod, amount: Money.fromMinorUnits(7320, 'USD') }],
    closedBy: 'user-001',
    terminalId: 'terminal-001',
    originNodeId: 'node-001',
    closedAt: at(2),
    eventId: 'event-shift-closed'
  });
  return shift.domainEvents;
};

const fiscalDocumentEvents = (): readonly DomainEventLike[] => {
  const content = {
    referenceId: 'sale-001',
    type: 'INVOICE' as const,
    currencyCode: 'USD',
    lines: [{
      id: 'line-001',
      description: 'Rice 1kg',
      quantityScaled: 2,
      quantityScale: 0,
      unitPriceMinorUnits: 1000,
      taxRateBasisPoints: 1600,
      totalMinorUnits: 2320
    }],
    payments: [{ methodCode: 'CASH_USD', amountMinorUnits: 2320 }],
    totalMinorUnits: 2320,
    recipient: null
  };
  const issued = FiscalDocument.create({
    id: 'document-001',
    content,
    idempotencyKey: 'idempotency-001',
    requestFingerprint: 'fingerprint-001',
    terminalId: 'terminal-001',
    originNodeId: 'node-001',
    createdBy: 'user-001',
    createdAt: at(0),
    eventId: 'event-document-pending'
  });
  issued.startPrinting({ actorId: 'user-001', occurredAt: at(1), eventId: 'event-printing' });
  issued.markIssued({
    fiscalNumber: 'A-00000001',
    actorId: 'user-001',
    occurredAt: at(2),
    eventId: 'event-document-issued',
    evidence: committedEvidence
  });

  const failed = FiscalDocument.create({
    id: 'document-002',
    content: { ...content, referenceId: 'sale-002' },
    idempotencyKey: 'idempotency-002',
    requestFingerprint: 'fingerprint-002',
    terminalId: 'terminal-001',
    originNodeId: 'node-001',
    createdBy: 'user-001',
    createdAt: at(3),
    eventId: 'event-document-pending-2'
  });
  failed.startPrinting({ actorId: 'user-001', occurredAt: at(4), eventId: 'event-printing-2' });
  failed.recordError({
    code: 'FISCAL_PRINTER_PAPER_END',
    evidence: noCommitEvidence,
    retryable: true,
    actorId: 'user-001',
    occurredAt: at(5),
    eventId: 'event-document-error'
  });
  failed.markFailed({ actorId: 'user-001', occurredAt: at(6), eventId: 'event-document-failed' });

  return [...issued.domainEvents, ...failed.domainEvents];
};

const fiscalDayEvents = (): readonly DomainEventLike[] => {
  const day = FiscalDay.open({
    id: 'fiscal-day-001',
    businessDate: '2026-09-05',
    terminalId: 'terminal-001',
    originNodeId: 'node-001',
    openedBy: 'user-001',
    openedAt: at(0),
    eventId: 'event-day-opened'
  });
  for (const [type, id, number] of [['X', 'report-x', 'X-0001'], ['Z', 'report-z', 'Z-0001']] as const) {
    day.requestReport({
      id,
      type,
      idempotencyKey: `idempotency-${id}`,
      requestFingerprint: `fingerprint-${id}`,
      actorId: 'user-001',
      occurredAt: at(1),
      eventId: `event-${id}-requested`
    });
    day.startReport({
      reportId: id, actorId: 'user-001', occurredAt: at(2), eventId: `event-${id}-printing`
    });
    day.markReportIssued({
      reportId: id,
      reportNumber: number,
      actorId: 'user-001',
      occurredAt: at(3),
      eventId: `event-${id}-issued`,
      evidence: committedEvidence
    });
  }
  return day.domainEvents;
};

const producedIntegrationEvents = toBusinessEvents([
  ...catalogEvents(),
  ...catalogReferenceEvents(),
  ...saleEvents(),
  ...saleReturnEvents(),
  ...shiftEvents(),
  ...fiscalDocumentEvents(),
  ...fiscalDayEvents()
], context).filter((event) => SYNC_INTEGRATION_EVENT_TYPES.includes(event.eventType));

describe('catálogo de contratos de integración v1', () => {
  it('cubre los tipos que un productor real emite, sin contratos huérfanos', () => {
    expect(SYNC_EVENT_CONTRACTS_V1.map(({ eventType }) => eventType)).toEqual([
      'ProductCreated', 'PriceChanged', 'CategoryPublished', 'UnitOfMeasurePublished',
      'DiscountPolicyPublished', 'FinancialTransactionTaxPolicyPublished',
      'ExchangeRateUpdated', 'PaymentMethodPublished', 'ProductPublished',
      'SaleCompleted', 'SaleReturned', 'ShiftOpened',
      'CashMovementRegistered', 'ShiftClosed', 'FiscalDocumentIssued', 'FiscalDocumentFailed',
      'FiscalXReportIssued', 'FiscalZReportIssued'
    ]);
    expect(new Set(producedIntegrationEvents.map(({ eventType }) => eventType)))
      .toEqual(new Set(SYNC_INTEGRATION_EVENT_TYPES));
  });

  it('declara consumidor implementado solo donde existe', () => {
    expect(SYNC_EVENT_CONTRACTS_V1
      .filter(({ consumers }) => consumers.length > 0)
      .map(({ eventType, consumers }) => `${eventType}:${consumers.join(',')}`)).toEqual([
      'CategoryPublished:CATALOG_REFERENCE',
      'UnitOfMeasurePublished:CATALOG_REFERENCE',
      'DiscountPolicyPublished:CATALOG_REFERENCE',
      'FinancialTransactionTaxPolicyPublished:CATALOG_REFERENCE',
      'ExchangeRateUpdated:CATALOG_REFERENCE',
      'PaymentMethodPublished:CATALOG_REFERENCE',
      'ProductPublished:CATALOG_REFERENCE',
      'SaleCompleted:INVENTORY_AUTHORITY'
    ]);
  });

  it('liga cada contrato al agregado dueño del hecho', () => {
    expect(SYNC_EVENT_CONTRACTS_V1.map(({ eventType, aggregateType, direction }) =>
      `${eventType}:${aggregateType}:${direction}`)).toEqual([
      'ProductCreated:Product:COORDINATOR_TO_TERMINAL',
      'PriceChanged:Product:COORDINATOR_TO_TERMINAL',
      'CategoryPublished:Category:COORDINATOR_TO_TERMINAL',
      'UnitOfMeasurePublished:UnitOfMeasure:COORDINATOR_TO_TERMINAL',
      'DiscountPolicyPublished:OperationalPolicy:COORDINATOR_TO_TERMINAL',
      'FinancialTransactionTaxPolicyPublished:OperationalPolicy:COORDINATOR_TO_TERMINAL',
      'ExchangeRateUpdated:ExchangeRate:COORDINATOR_TO_TERMINAL',
      'PaymentMethodPublished:PaymentMethod:COORDINATOR_TO_TERMINAL',
      'ProductPublished:Product:COORDINATOR_TO_TERMINAL',
      'SaleCompleted:Sale:TERMINAL_TO_COORDINATOR',
      'SaleReturned:SaleReturn:TERMINAL_TO_COORDINATOR',
      'ShiftOpened:Shift:TERMINAL_TO_COORDINATOR',
      'CashMovementRegistered:Shift:TERMINAL_TO_COORDINATOR',
      'ShiftClosed:Shift:TERMINAL_TO_COORDINATOR',
      'FiscalDocumentIssued:FiscalDocument:TERMINAL_TO_COORDINATOR',
      'FiscalDocumentFailed:FiscalDocument:TERMINAL_TO_COORDINATOR',
      'FiscalXReportIssued:FiscalDay:TERMINAL_TO_COORDINATOR',
      'FiscalZReportIssued:FiscalDay:TERMINAL_TO_COORDINATOR'
    ]);
  });

  it.each(SYNC_INTEGRATION_EVENT_TYPES)(
    'valida el payload real que los productores emiten para %s',
    (eventType) => {
      const events = producedIntegrationEvents.filter((event) => event.eventType === eventType);
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        const wire = JSON.parse(JSON.stringify(toSyncEnvelope(event))) as unknown;
        const result = validateSyncEnvelope(wire);
        expect({ eventType, ok: result.ok, code: result.ok ? null : result.code })
          .toEqual({ eventType, ok: true, code: null });
      }
    }
  );

  it('declara las dependencias entre agregados que el receptor debe distinguir', () => {
    const dependencies = producedIntegrationEvents.flatMap((event) => {
      const contract = SYNC_EVENT_CONTRACTS_V1
        .find(({ eventType }) => eventType === event.eventType);
      return (contract?.dependencies(event.payload as Record<string, never>) ?? [])
        .map(({ aggregateType, aggregateId }) => `${event.eventType}->${aggregateType}:${aggregateId}`);
    });

    expect(dependencies).toEqual([
      'ProductPublished->Category:category-001',
      'ProductPublished->UnitOfMeasure:unit-001',
      'SaleCompleted->Shift:shift-001',
      'SaleReturned->Sale:sale-001',
      'CashMovementRegistered->Sale:sale-001',
      'FiscalDocumentIssued->Sale:sale-001'
    ]);
  });

  it('publica el estado vigente completo del producto, no un delta', () => {
    const published = producedIntegrationEvents
      .find(({ eventType }) => eventType === 'ProductPublished');

    expect(published).toMatchObject({
      aggregateId: 'product-001',
      aggregateType: 'Product',
      /** Alta, cambio de precio y actualización de detalles: cada uno avanza la versión. */
      aggregateVersion: 3,
      payload: {
        name: 'Rice',
        description: 'Rice 1kg',
        categoryId: 'category-001',
        unitId: 'unit-001',
        unitCode: 'UNIT',
        price: { minorUnits: 1200, currencyCode: 'USD' },
        taxRate: { basisPoints: 1600 },
        isActive: 'INACTIVE',
        barcodes: [
          { barcodeId: 'barcode-001', code: '1234', isActive: 'ACTIVE' },
          { barcodeId: 'barcode-002', code: '5678', isActive: 'INACTIVE' }
        ]
      }
    });
  });

  it('no repite la versión del maestro dentro del payload', () => {
    const referenceTypes = [
      'CategoryPublished',
      'UnitOfMeasurePublished',
      'DiscountPolicyPublished',
      'FinancialTransactionTaxPolicyPublished',
      'ExchangeRateUpdated',
      'PaymentMethodPublished',
      'ProductPublished'
    ];

    for (const eventType of referenceTypes) {
      const contract = SYNC_EVENT_CONTRACTS_V1.find((entry) => entry.eventType === eventType);
      expect({ eventType, hasVersionField: Object.keys(contract?.fields ?? {}).includes('version') })
        .toEqual({ eventType, hasVersionField: false });
    }
  });
});
