import { describe, expect, it } from 'vitest';
import { Quantity } from '@supermarket/shared';
import { StockCount, StockCountLine, type StockCountDifference } from './stock-count.js';

const openedAt = new Date('2026-09-05T10:00:00.000Z');

const opened = (): StockCount => StockCount.open({
  id: 'count-001', openedBy: 'user-001', originNodeId: 'node-1', openedAt
});

describe('StockCount', () => {
  it('starts OPEN and records lines with an upsert by stock item and batch', () => {
    const count = opened();

    const first = count.recordLine({
      id: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(5, 0)
    });
    count.recordLine({
      id: 'line-002', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(8, 0)
    });

    expect(count.lines).toHaveLength(1);
    expect(count.lines[0]?.countedQuantity.scaledValue).toBe(8);
    expect(first.id).toBe('line-001');
    expect(count.version).toBe(3);
  });

  it('accepts a zero counted quantity but rejects a negative one', () => {
    const count = opened();

    expect(() => count.recordLine({
      id: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(0, 0)
    })).not.toThrow();

    expect(() => count.recordLine({
      id: 'line-002', productId: 'product-002', stockItemId: 'stock-002',
      countedQuantity: Quantity.fromScaled(-1, 0)
    })).toThrowError(expect.objectContaining({ code: 'STOCK_COUNT_LINE_QUANTITY_INVALID' }));
  });

  it('rejects recording a line once the count is no longer OPEN', () => {
    const count = opened();
    count.recordLine({
      id: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(5, 0)
    });
    count.close([{
      lineId: 'line-001', stockItemId: 'stock-001', batchId: null, quantityScale: 0,
      expectedScaled: 4, countedScaled: 5, differenceScaled: 1
    }], new Date('2026-09-05T11:00:00.000Z'));

    expect(() => count.recordLine({
      id: 'line-002', productId: 'product-002', stockItemId: 'stock-002',
      countedQuantity: Quantity.fromScaled(1, 0)
    })).toThrowError(expect.objectContaining({ code: 'STOCK_COUNT_NOT_OPEN' }));
  });

  it('rejects closing an empty count', () => {
    expect(() => opened().close([], new Date('2026-09-05T11:00:00.000Z')))
      .toThrowError(expect.objectContaining({ code: 'STOCK_COUNT_EMPTY' }));
  });

  it('rejects closing when the differences do not match the recorded lines exactly', () => {
    const count = opened();
    count.recordLine({
      id: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(5, 0)
    });

    expect(() => count.close([{
      lineId: 'line-999', stockItemId: 'stock-001', batchId: null, quantityScale: 0,
      expectedScaled: 4, countedScaled: 5, differenceScaled: 1
    }], new Date('2026-09-05T11:00:00.000Z')))
      .toThrowError(expect.objectContaining({ code: 'STOCK_COUNT_DIFFERENCE_MISMATCH' }));
  });

  it('freezes the differences at close and exposes them again on approval, unchanged', () => {
    const count = opened();
    count.recordLine({
      id: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(5, 0)
    });
    const differences: StockCountDifference[] = [{
      lineId: 'line-001', stockItemId: 'stock-001', batchId: null, quantityScale: 0,
      expectedScaled: 4, countedScaled: 5, differenceScaled: 1
    }];
    count.close(differences, new Date('2026-09-05T11:00:00.000Z'));

    expect(count.status).toBe('COUNTED');
    expect(count.differences).toEqual(differences);

    const returned = count.approve('supervisor-001', new Date('2026-09-05T12:00:00.000Z'));

    expect(count.status).toBe('APPROVED');
    expect(count.approvedBy).toBe('supervisor-001');
    expect(returned).toEqual(differences);
  });

  it('rejects approving or rejecting a count that has not been closed', () => {
    const count = opened();
    count.recordLine({
      id: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(5, 0)
    });

    expect(() => count.approve('supervisor-001', new Date('2026-09-05T12:00:00.000Z')))
      .toThrowError(expect.objectContaining({ code: 'STOCK_COUNT_NOT_COUNTED' }));
    expect(() => count.reject('supervisor-001', 'Motivo', new Date('2026-09-05T12:00:00.000Z')))
      .toThrowError(expect.objectContaining({ code: 'STOCK_COUNT_NOT_COUNTED' }));
  });

  it('rejects a closed count with a reason and leaves no inventory effect to derive', () => {
    const count = opened();
    count.recordLine({
      id: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
      countedQuantity: Quantity.fromScaled(5, 0)
    });
    count.close([{
      lineId: 'line-001', stockItemId: 'stock-001', batchId: null, quantityScale: 0,
      expectedScaled: 4, countedScaled: 5, differenceScaled: 1
    }], new Date('2026-09-05T11:00:00.000Z'));

    expect(() => count.reject('supervisor-001', '  ', new Date('2026-09-05T12:00:00.000Z')))
      .toThrowError(expect.objectContaining({ code: 'STOCK_COUNT_REJECTION_REASON_REQUIRED' }));

    count.reject('supervisor-001', 'Conteo con error de digitación', new Date('2026-09-05T12:00:00.000Z'));

    expect(count.status).toBe('REJECTED');
    expect(count.rejectedBy).toBe('supervisor-001');
    expect(count.rejectionReason).toBe('Conteo con error de digitación');
  });

  it('rehydrates a restored count with its lines, differences and terminal state', () => {
    const restored = StockCount.restore({
      id: 'count-002', openedBy: 'user-001', originNodeId: 'node-1', openedAt,
      status: 'APPROVED',
      lines: [StockCountLine.create({
        id: 'line-001', productId: 'product-001', stockItemId: 'stock-001',
        countedQuantity: Quantity.fromScaled(5, 0)
      })],
      differences: [{
        lineId: 'line-001', stockItemId: 'stock-001', batchId: null, quantityScale: 0,
        expectedScaled: 4, countedScaled: 5, differenceScaled: 1
      }],
      closedAt: new Date('2026-09-05T11:00:00.000Z'),
      approvedBy: 'supervisor-001', approvedAt: new Date('2026-09-05T12:00:00.000Z'),
      rejectedBy: null, rejectedAt: null, rejectionReason: null,
      version: 4
    });

    expect(restored.status).toBe('APPROVED');
    expect(restored.lines).toHaveLength(1);
    expect(restored.differences).toHaveLength(1);
    expect(restored.version).toBe(4);
  });
});
