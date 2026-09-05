import { describe, expect, it } from 'vitest';
import { Money, Quantity } from '@supermarket/shared';
import { PurchaseReceipt } from './purchase-receipt.js';

const start = (): PurchaseReceipt => PurchaseReceipt.start({
  id: 'receipt-001', supplierId: 'supplier-001',
  supplierSnapshot: {
    legalName: 'Proveedor Uno', tradeName: null,
    taxIdentity: { country: 'VE', type: 'RIF', value: 'J-12345678-9', normalizedValue: 'J123456789' },
    fiscalAddress: { countryCode: 'VE', addressLine: 'Caracas' }
  },
  sourceDocument: { type: 'INVOICE', number: 'FAC-001', series: null, controlNumber: null,
    issuedAt: new Date('2026-09-04T09:00:00.000Z') },
  effectiveAt: new Date('2026-09-04T10:00:00.000Z'), createdBy: 'actor-001', originNodeId: 'node-1',
  createdAt: new Date('2026-09-04T10:00:00.000Z'), replacesReceiptId: null,
  lines: [{
    id: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
    unitCode: 'UNIT', tracksBatches: false,
    quantity: Quantity.fromScaled(10, 0), batchId: null, batchLotNumber: null, batchExpiresAt: null,
    purchaseUnitCost: Money.fromMinorUnits(100, 'USD'),
    valuationUnitCost: Money.fromMinorUnits(100, 'USD'), exchangeRate: null
  }]
});

describe('PurchaseReceipt', () => {
  it('freezes its evidence when completed and reverses without rewriting it', () => {
    const receipt = start();
    expect(receipt.status).toBe('DRAFT');

    receipt.complete({ actorId: 'actor-001', occurredAt: new Date('2026-09-04T10:01:00.000Z'),
      eventId: 'event-completed' });
    expect(receipt.status).toBe('COMPLETED');
    expect(receipt.domainEvents.at(-1)?.type).toBe('PurchaseReceiptCompleted');
    expect(() => receipt.complete({ actorId: 'actor-001', occurredAt: new Date(), eventId: 'again' }))
      .toThrowError(expect.objectContaining({ code: 'PURCHASE_RECEIPT_INVALID_STATE' }));

    receipt.reverse({ actorId: 'actor-002', reason: 'Documento duplicado',
      occurredAt: new Date('2026-09-04T11:00:00.000Z'), eventId: 'event-reversed' });
    expect(receipt.status).toBe('REVERSED');
    expect(receipt.reversalReason).toBe('Documento duplicado');
    expect(receipt.lines[0]?.purchaseUnitCost.minorUnits).toBe(100);
  });

  it('requires a fiscal address for a Venezuelan source document', () => {
    expect(() => PurchaseReceipt.start({
      id: 'receipt-002', supplierId: 'supplier-001',
      supplierSnapshot: {
        legalName: 'Proveedor Uno', tradeName: null,
        taxIdentity: { country: 'VE', type: 'RIF', value: 'J-12345678-9', normalizedValue: 'J123456789' },
        fiscalAddress: null
      },
      sourceDocument: { type: 'DELIVERY_NOTE', number: 'NE-001', series: null,
        controlNumber: null, issuedAt: null },
      effectiveAt: new Date(), createdBy: 'actor-001', originNodeId: 'node-1', createdAt: new Date(),
      replacesReceiptId: null,
      lines: [{ id: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
        unitCode: 'UNIT', tracksBatches: false,
        quantity: Quantity.fromScaled(1, 0), batchId: null, batchLotNumber: null, batchExpiresAt: null,
        purchaseUnitCost: Money.fromMinorUnits(100, 'USD'),
        valuationUnitCost: Money.fromMinorUnits(100, 'USD'), exchangeRate: null }]
    })).toThrowError(expect.objectContaining({ code: 'PURCHASE_RECEIPT_FISCAL_ADDRESS_REQUIRED' }));
  });
});
