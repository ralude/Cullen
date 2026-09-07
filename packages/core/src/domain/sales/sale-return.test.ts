import { describe, expect, it } from 'vitest';
import { Money, Quantity } from '@supermarket/shared';
import { SaleReturn } from './sale-return.js';

const lines = [{
  id: 'return-line-001',
  saleItemId: 'sale-item-001',
  productId: 'product-001',
  stockItemId: 'stock-001',
  batchId: 'batch-001',
  quantity: Quantity.fromScaled(2, 0),
  unitCost: Money.fromMinorUnits(120, 'USD')
}];

const register = (overrides: Partial<Parameters<typeof SaleReturn.register>[0]> = {}): SaleReturn =>
  SaleReturn.register({
    id: 'return-001',
    saleId: 'sale-001',
    saleEventId: 'event-sale-completed',
    originalDocumentId: 'document-001',
    creditNoteId: 'document-002',
    shiftId: 'shift-001',
    refund: Money.fromMinorUnits(500, 'USD'),
    paymentMethodCode: 'CASH',
    reason: 'Producto defectuoso',
    actorId: 'actor-001',
    terminalId: 'terminal-001',
    originNodeId: 'node-001',
    occurredAt: new Date('2026-09-04T12:00:00.000Z'),
    eventId: 'event-001',
    lines,
    ...overrides
  });

describe('SaleReturn', () => {
  it('congela la evidencia de la venta original sin modificarla', () => {
    const saleReturn = register();

    expect(saleReturn.saleId).toBe('sale-001');
    expect(saleReturn.originalDocumentId).toBe('document-001');
    expect(saleReturn.creditNoteId).toBe('document-002');
    expect(saleReturn.refund.minorUnits).toBe(500);
    expect(saleReturn.lines[0]?.batchId).toBe('batch-001');
    expect(saleReturn.lines[0]?.unitCost?.minorUnits).toBe(120);
  });

  it('emite un hecho en pasado que no copia datos personales', () => {
    const event = register().domainEvents.at(-1);

    expect(event?.type).toBe('SaleReturned');
    expect(event?.aggregateType).toBe('SaleReturn');
    expect(event?.payload).toEqual({
      saleId: 'sale-001',
      saleEventId: 'event-sale-completed',
      originalDocumentId: 'document-001',
      creditNoteId: 'document-002',
      shiftId: 'shift-001',
      terminalId: 'terminal-001',
      refundMinorUnits: 500,
      currencyCode: 'USD',
      paymentMethodCode: 'CASH',
      reason: 'Producto defectuoso',
      lineCount: 1,
      /** La restitución viaja con lote y costo originales, no con un promedio. */
      lines: [{
        lineId: 'return-line-001',
        saleItemId: 'sale-item-001',
        productId: 'product-001',
        stockItemId: 'stock-001',
        batchId: 'batch-001',
        quantityScaled: 2,
        quantityScale: 0,
        unitCost: { minorUnits: 120, currencyCode: 'USD' }
      }]
    });
  });

  it('exige la salida que restituye antes de registrar la devolución', () => {
    expect(() => register({ saleEventId: '  ' }))
      .toThrowError(expect.objectContaining({ code: 'SALE_RETURN_SALE_EVENT_REQUIRED' }));
  });

  it('exige motivo, actor y al menos una línea', () => {
    expect(() => register({ reason: '   ' }))
      .toThrowError(expect.objectContaining({ code: 'SALE_RETURN_REASON_REQUIRED' }));
    expect(() => register({ actorId: '' }))
      .toThrowError(expect.objectContaining({ code: 'SALE_RETURN_ACTOR_REQUIRED' }));
    expect(() => register({ lines: [] }))
      .toThrowError(expect.objectContaining({ code: 'SALE_RETURN_LINES_REQUIRED' }));
  });

  it('rechaza un reintegro no positivo porque no hay nada que devolver', () => {
    expect(() => register({ refund: Money.zero('USD') }))
      .toThrowError(expect.objectContaining({ code: 'SALE_RETURN_REFUND_INVALID' }));
  });

  it('rechaza una línea duplicada de la misma línea de venta', () => {
    expect(() => register({ lines: [...lines, { ...lines[0]!, id: 'return-line-002' }] }))
      .toThrowError(expect.objectContaining({ code: 'SALE_RETURN_LINE_DUPLICATED' }));
  });

  it('permite conservar dos lotes de una misma línea cuando la salida fue dividida por FEFO', () => {
    const secondLot = { ...lines[0]!, id: 'return-line-002', batchId: 'batch-002' };
    expect(() => register({ lines: [...lines, secondLot] })).not.toThrow();
  });

  it('copia sus líneas para que el llamador no pueda reescribir la evidencia', () => {
    const mutable = [{ ...lines[0]! }];
    const saleReturn = SaleReturn.register({
      id: 'return-002', saleId: 'sale-002', saleEventId: 'event-sale-completed',
      originalDocumentId: 'document-003',
      creditNoteId: 'document-004', shiftId: 'shift-001',
      refund: Money.fromMinorUnits(100, 'USD'), paymentMethodCode: 'CASH',
      reason: 'Cambio de opinión', actorId: 'actor-001', terminalId: 'terminal-001',
      originNodeId: 'node-001', occurredAt: new Date('2026-09-04T12:00:00.000Z'),
      eventId: 'event-002', lines: mutable
    });

    mutable[0]!.batchId = 'otro-lote';

    expect(saleReturn.lines[0]?.batchId).toBe('batch-001');
  });
});
