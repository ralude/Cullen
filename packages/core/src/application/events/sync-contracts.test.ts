import { describe, expect, it } from 'vitest';
import { Money, Quantity, TaxRate } from '@supermarket/shared';
import { Barcode, Category, Product, ProductSnapshot, UnitOfMeasure } from '../../domain/catalog/index.js';
import { CashRegister, Shift } from '../../domain/cash/index.js';
import { ExchangeRate, PaymentMethod } from '../../domain/currency/index.js';
import { FiscalDay, FiscalDocument } from '../../domain/fiscal/index.js';
import { StockCount, StockItem } from '../../domain/inventory/index.js';
import { PurchaseReceipt } from '../../domain/purchasing/index.js';
import { Payment, Sale, SaleReturn } from '../../domain/sales/index.js';
import {
  toCategoryPublication,
  toExchangeRatePublication,
  toOperationalPolicyPublication,
  toPaymentMethodPublication,
  toOperatorGrantPublication,
  toProductPublication,
  toUnitOfMeasurePublication
} from '../catalog/reference-publications.js';
import { toStockAvailabilityPublications } from '../inventory/index.js';
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

const purchaseReceiptEvents = (): readonly DomainEventLike[] => {
  const receipt = PurchaseReceipt.start({
    id: 'receipt-001', supplierId: 'supplier-001', supplierSnapshot: {
      legalName: 'Supplier', tradeName: null,
      taxIdentity: { country: 'US', type: 'OTHER', value: 'SUP-001', normalizedValue: 'SUP001' },
      fiscalAddress: null
    },
    sourceDocument: { type: 'INVOICE', number: 'INV-001', series: null,
      controlNumber: null, issuedAt: at(1) },
    effectiveAt: at(2), createdBy: 'user-001', originNodeId: 'node-001', createdAt: at(2),
    replacesReceiptId: null,
    lines: [{
      id: 'line-001', productId: 'product-001', stockItemId: 'stock-item-001',
      unitCode: 'UNIT', tracksBatches: true, quantity: Quantity.fromScaled(4, 0),
      batchId: 'batch-001', batchLotNumber: 'LOT-001', batchExpiresAt: at(60),
      purchaseUnitCost: Money.fromMinorUnits(90, 'USD'),
      valuationUnitCost: Money.fromMinorUnits(100, 'USD'), exchangeRate: null
    }]
  });
  receipt.complete({
    actorId: 'user-001', terminalId: 'terminal-001', reason: 'Received purchase',
    occurredAt: at(3), eventId: 'event-purchase-completed'
  });
  return receipt.domainEvents;
};

const stockCountEvents = (): readonly DomainEventLike[] => {
  const count = StockCount.open({
    id: 'count-001', openedBy: 'user-001', originNodeId: 'node-001', openedAt: at(0)
  });
  count.recordLine({
    id: 'count-line-001', productId: 'product-001', stockItemId: 'stock-item-001',
    countedQuantity: Quantity.fromScaled(8, 0)
  });
  count.close([{
    lineId: 'count-line-001', stockItemId: 'stock-item-001', batchId: null,
    quantityScale: 0, expectedScaled: 5, countedScaled: 8, differenceScaled: 3,
    stockAvailabilityVersion: 7
  }], at(2));
  count.approve({
    actorId: 'user-001', terminalId: 'terminal-001', reason: 'Conteo aprobado',
    occurredAt: at(3), eventId: 'event-stock-count-approved'
  });
  return count.domainEvents;
};

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

/** Ítem con un movimiento aplicado: el saldo publicado es el del coordinador. */
const availableStockItem = (): StockItem => {
  const item = StockItem.create({
    id: 'stock-item-001',
    productId: 'product-001',
    unitCode: 'UNIT',
    quantityScale: 0,
    tracksBatches: true
  });
  item.registerBatch({
    id: 'batch-001',
    lotNumber: 'LOT-001',
    expiresAt: at(60)
  });
  item.registerMovement({
    id: 'movement-001',
    type: 'PURCHASE_RECEIPT',
    quantity: Quantity.fromScaled(12, 0),
    batchId: 'batch-001',
    actorId: 'user-001',
    reason: 'Recepción inicial',
    referenceId: 'receipt-001',
    occurredAt: at(2),
    eventId: 'event-stock-movement'
  });
  return item;
};

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
    }),
    toOperatorGrantPublication({
      userId: 'user-001',
      operatorCode: 'CAJA01',
      displayName: 'Cajera 1',
      roleCodes: ['CASHIER'],
      permissionCodes: ['sales.complete', 'sales.start'],
      isActive: true,
      version: 5
    }, { eventId: 'event-operator-grant-published', occurredAt: at(3) }),
    ...toStockAvailabilityPublications(
      [availableStockItem()],
      { generate: () => 'event-stock-availability-published' },
      at(3)
    )
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
  ...purchaseReceiptEvents(),
  ...stockCountEvents(),
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
      'ExchangeRateUpdated', 'PaymentMethodPublished', 'OperatorGrantPublished',
      'StockAvailabilityPublished', 'StockAvailabilityPublished', 'ProductPublished',
      'PurchaseReceiptCompleted', 'StockCountApproved',
      'SaleCompleted', 'SaleCompleted', 'SaleReturned', 'ShiftOpened',
      'CashMovementRegistered', 'ShiftClosed', 'FiscalDocumentIssued', 'FiscalDocumentFailed',
      'FiscalXReportIssued', 'FiscalZReportIssued'
    ]);
    expect(new Set(producedIntegrationEvents.map(({ eventType }) => eventType)))
      .toEqual(new Set(SYNC_INTEGRATION_EVENT_TYPES));
  });

  it('declara consumidor implementado solo donde existe', () => {
    expect(SYNC_EVENT_CONTRACTS_V1
      .filter(({ consumers }) => consumers.length > 0)
      .map(({ eventType, contractVersion, consumers }) =>
        `${eventType}.v${contractVersion}:${consumers.join(',')}`)).toEqual([
      'CategoryPublished.v1:CATALOG_REFERENCE',
      'UnitOfMeasurePublished.v1:CATALOG_REFERENCE',
      'DiscountPolicyPublished.v1:CATALOG_REFERENCE',
      'FinancialTransactionTaxPolicyPublished.v1:CATALOG_REFERENCE',
      'ExchangeRateUpdated.v1:CATALOG_REFERENCE',
      'PaymentMethodPublished.v1:CATALOG_REFERENCE',
      'OperatorGrantPublished.v1:CATALOG_REFERENCE',
      'StockAvailabilityPublished.v1:CATALOG_REFERENCE',
      'StockAvailabilityPublished.v2:CATALOG_REFERENCE',
      'ProductPublished.v1:CATALOG_REFERENCE',
      'PurchaseReceiptCompleted.v1:INVENTORY_AUTHORITY',
      'StockCountApproved.v1:INVENTORY_AUTHORITY',
      'SaleCompleted.v1:INVENTORY_AUTHORITY,COMMERCIAL_PROJECTION',
      'SaleCompleted.v2:INVENTORY_AUTHORITY,COMMERCIAL_PROJECTION',
      'SaleReturned.v1:COMMERCIAL_PROJECTION',
      'ShiftOpened.v1:COMMERCIAL_PROJECTION',
      'CashMovementRegistered.v1:COMMERCIAL_PROJECTION',
      'ShiftClosed.v1:COMMERCIAL_PROJECTION',
      'FiscalDocumentIssued.v1:COMMERCIAL_PROJECTION',
      'FiscalDocumentFailed.v1:COMMERCIAL_PROJECTION',
      'FiscalXReportIssued.v1:COMMERCIAL_PROJECTION',
      'FiscalZReportIssued.v1:COMMERCIAL_PROJECTION'
    ]);
  });

  it('liga cada contrato al agregado dueño del hecho', () => {
    expect(SYNC_EVENT_CONTRACTS_V1.map(({ eventType, contractVersion, aggregateType, direction }) =>
      `${eventType}.v${contractVersion}:${aggregateType}:${direction}`)).toEqual([
      'ProductCreated.v1:Product:COORDINATOR_TO_TERMINAL',
      'PriceChanged.v1:Product:COORDINATOR_TO_TERMINAL',
      'CategoryPublished.v1:Category:COORDINATOR_TO_TERMINAL',
      'UnitOfMeasurePublished.v1:UnitOfMeasure:COORDINATOR_TO_TERMINAL',
      'DiscountPolicyPublished.v1:OperationalPolicy:COORDINATOR_TO_TERMINAL',
      'FinancialTransactionTaxPolicyPublished.v1:OperationalPolicy:COORDINATOR_TO_TERMINAL',
      'ExchangeRateUpdated.v1:ExchangeRate:COORDINATOR_TO_TERMINAL',
      'PaymentMethodPublished.v1:PaymentMethod:COORDINATOR_TO_TERMINAL',
      'OperatorGrantPublished.v1:OperatorGrant:COORDINATOR_TO_TERMINAL',
      'StockAvailabilityPublished.v1:StockAvailability:COORDINATOR_TO_TERMINAL',
      'StockAvailabilityPublished.v2:StockAvailability:COORDINATOR_TO_TERMINAL',
      'ProductPublished.v1:Product:COORDINATOR_TO_TERMINAL',
      'PurchaseReceiptCompleted.v1:PurchaseReceipt:TERMINAL_TO_COORDINATOR',
      'StockCountApproved.v1:StockCount:TERMINAL_TO_COORDINATOR',
      'SaleCompleted.v1:Sale:TERMINAL_TO_COORDINATOR',
      'SaleCompleted.v2:Sale:TERMINAL_TO_COORDINATOR',
      'SaleReturned.v1:SaleReturn:TERMINAL_TO_COORDINATOR',
      'ShiftOpened.v1:Shift:TERMINAL_TO_COORDINATOR',
      'CashMovementRegistered.v1:Shift:TERMINAL_TO_COORDINATOR',
      'ShiftClosed.v1:Shift:TERMINAL_TO_COORDINATOR',
      'FiscalDocumentIssued.v1:FiscalDocument:TERMINAL_TO_COORDINATOR',
      'FiscalDocumentFailed.v1:FiscalDocument:TERMINAL_TO_COORDINATOR',
      'FiscalXReportIssued.v1:FiscalDay:TERMINAL_TO_COORDINATOR',
      'FiscalZReportIssued.v1:FiscalDay:TERMINAL_TO_COORDINATOR'
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
      return (contract?.dependencies(event.payload as Record<string, never>, event.aggregateId) ?? [])
        .map(({ aggregateType, aggregateId }) => `${event.eventType}->${aggregateType}:${aggregateId}`);
    });

    expect(dependencies).toEqual([
      'ProductPublished->Category:category-001',
      'ProductPublished->UnitOfMeasure:unit-001',
      'StockAvailabilityPublished->Product:product-001',
      'SaleCompleted->Shift:shift-001',
      'SaleReturned->Sale:sale-001',
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

  it('publica disponibilidad v2 con identidad autoritativa y saldos por lote', () => {
    const published = producedIntegrationEvents
      .find(({ eventType }) => eventType === 'StockAvailabilityPublished');

    expect(published).toMatchObject({
      contractVersion: 2,
      aggregateId: 'product-001',
      payload: {
        stockItemId: 'stock-item-001',
        unitCode: 'UNIT',
        quantityScaled: 12,
        quantityScale: 0,
        batchTracking: 'TRACKED',
        batches: [{
          batchId: 'batch-001',
          lotNumber: 'LOT-001',
          expiresAt: at(60).toISOString(),
          quantityScaled: 12
        }],
        unitCost: null
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
      'OperatorGrantPublished',
      'StockAvailabilityPublished',
      'ProductPublished'
    ];

    for (const eventType of referenceTypes) {
      const contract = SYNC_EVENT_CONTRACTS_V1.find((entry) => entry.eventType === eventType);
      expect({ eventType, hasVersionField: Object.keys(contract?.fields ?? {}).includes('version') })
        .toEqual({ eventType, hasVersionField: false });
    }
  });
});
