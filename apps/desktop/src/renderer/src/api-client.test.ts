import { describe, expect, it, vi } from 'vitest';
import { parseMinorUnits } from './amount-input.js';
import { createDesktopApi } from './api-client.js';
import { ApiProblemError } from './api-transport.js';

describe('desktop HTTP client', () => {
  it('recovers the current session with cookies and shared JSON contracts', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      actorId: 'user-1',
      displayName: 'Operador Uno',
      roleCodes: ['cashier'],
      permissionCodes: [],
      idleExpiresAt: '2026-09-02T18:00:00.000Z',
      absoluteExpiresAt: '2026-09-03T00:00:00.000Z'
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const api = createDesktopApi(fetcher as typeof fetch);

    const session = await api.currentSession();

    expect(session.displayName).toBe('Operador Uno');
    expect(fetcher).toHaveBeenCalledWith('/api/v1/auth/session', expect.objectContaining({
      method: 'GET',
      credentials: 'include',
      headers: expect.objectContaining({ accept: 'application/json' })
    }));
  });

  it('sends login input as JSON without exposing a token contract', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      actorId: 'user-1',
      displayName: 'Operador Uno',
      roleCodes: ['cashier'],
      permissionCodes: [],
      idleExpiresAt: '2026-09-02T18:00:00.000Z',
      absoluteExpiresAt: '2026-09-03T00:00:00.000Z'
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const api = createDesktopApi(fetcher as typeof fetch);

    const session = await api.login({ operatorCode: 'OP-01', pin: '123456' });

    expect(session).not.toHaveProperty('token');
    expect(fetcher).toHaveBeenCalledWith('/api/v1/auth/session', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ operatorCode: 'OP-01', pin: '123456' })
    }));
  });

  it('preserves the public problem envelope on HTTP errors', async () => {
    const problem = {
      type: 'urn:supermarket:problem:unauthorized',
      title: 'Session is invalid.',
      status: 401,
      code: 'UNAUTHORIZED',
      correlationId: 'correlation-1'
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(problem), {
      status: 401,
      headers: { 'content-type': 'application/problem+json' }
    }));

    await expect(createDesktopApi(fetcher as typeof fetch).currentSession())
      .rejects.toEqual(new ApiProblemError(problem));
  });

  it('accepts an empty logout response', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));

    await expect(createDesktopApi(fetcher as typeof fetch).logout()).resolves.toBeUndefined();
  });

  it('uses the shared sales path and idempotency key for a mutation', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      id: 'sale-1', status: 'DRAFT'
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const api = createDesktopApi(fetcher as typeof fetch);

    await api.addSaleItem('sale/1', {
      barcode: '759000000001', quantityScaled: 1, quantityScale: 0
    }, 'intent-1');

    expect(fetcher).toHaveBeenCalledWith('/api/v1/sales/sale%2F1/items', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'idempotency-key': 'intent-1' })
    }));
  });

  it('sends a total return with its mandatory reason and idempotency key', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      id: 'return-1', saleId: 'sale-1', creditNoteStatus: 'ISSUED', occurredAt: '2026-09-04T12:00:00.000Z', lines: []
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const api = createDesktopApi(fetcher as typeof fetch);

    await api.returnSale('sale/1', { reason: 'Producto defectuoso' }, 'return-intent-1');

    expect(fetcher).toHaveBeenCalledWith('/api/v1/sales/sale%2F1/return', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ reason: 'Producto defectuoso' }),
      headers: expect.objectContaining({ 'idempotency-key': 'return-intent-1' })
    }));
  });

  it('loads only active suppliers for the receipt selector', async () => {
    const fetcher = vi.fn(async () => new Response('[]', {
      status: 200, headers: { 'content-type': 'application/json' }
    }));

    await createDesktopApi(fetcher as typeof fetch).listSuppliers('ACTIVE');

    expect(fetcher).toHaveBeenCalledWith('/api/v1/suppliers?status=ACTIVE', expect.objectContaining({
      method: 'GET', credentials: 'include'
    }));
  });

  it('sends the supplier master commands with their idempotency key', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'supplier-1' }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    };
    const api = createDesktopApi(fetcher as unknown as typeof fetch);

    await api.createSupplier({
      legalName: 'Distribuidora Los Andes',
      taxIdentity: { country: 'VE', type: 'RIF', value: 'J-12345678-9' },
      reason: 'Alta de proveedor'
    }, 'intent-create');
    await api.updateSupplier('supplier/1', { tradeName: 'Los Andes', reason: 'Corrección' }, 'intent-update');
    await api.changeSupplierStatus('supplier-1', { status: 'BLOCKED', reason: 'Suspendido' }, 'intent-status');
    await api.correctSupplierTaxIdentity('supplier-1', {
      taxIdentity: { type: 'RIF', value: 'J-12345678-0' }, reason: 'Error de transcripción'
    }, 'intent-tax');

    expect(calls.map(({ url, init }) => [
      url, init.method, (init.headers as Record<string, string>)['idempotency-key']
    ])).toEqual([
      ['/api/v1/suppliers', 'POST', 'intent-create'],
      ['/api/v1/suppliers/supplier%2F1', 'PATCH', 'intent-update'],
      ['/api/v1/suppliers/supplier-1/status', 'PUT', 'intent-status'],
      ['/api/v1/suppliers/supplier-1/tax-identity', 'PUT', 'intent-tax']
    ]);
  });

  it('sends a receipt without technical stock data', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'stock-1' }), {
      status: 201, headers: { 'content-type': 'application/json' }
    }));

    await createDesktopApi(fetcher as typeof fetch).receivePurchase({
      productId: 'product-1', quantity: '10,5', supplierId: 'supplier-1',
      receiptId: 'receipt-1', reason: 'Compra recibida'
    }, 'intent-receipt');

    expect(fetcher).toHaveBeenCalledWith('/api/v1/inventory/receipts', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        productId: 'product-1', quantity: '10,5', supplierId: 'supplier-1',
        receiptId: 'receipt-1', reason: 'Compra recibida'
      })
    }));
  });

  it('sends the optional recipient without deriving its type in the renderer', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'sale-1' }), {
      status: 200, headers: { 'content-type': 'application/json' }
    }));
    const api = createDesktopApi(fetcher as typeof fetch);

    await api.setSaleRecipient('sale-1', {
      recipient: { country: 'VE', value: 'J-12345678-9', name: 'Bodega Central', address: null }
    }, 'intent-recipient');
    await api.setSaleRecipient('sale-1', { recipient: null }, 'intent-recipient-clear');

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/v1/sales/sale-1/recipient',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          recipient: {
            country: 'VE', value: 'J-12345678-9', name: 'Bodega Central', address: null
          }
        }),
        headers: expect.objectContaining({ 'idempotency-key': 'intent-recipient' })
      }));
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/v1/sales/sale-1/recipient',
      expect.objectContaining({ body: JSON.stringify({ recipient: null }) }));
  });

  it('parses decimal input into integer minor units without floating point', () => {
    expect(parseMinorUnits('12,30', 2)).toBe(1230);
    expect(parseMinorUnits('12', 2)).toBe(1200);
    expect(() => parseMinorUnits('12.345', 2)).toThrow('MONEY_INPUT_SCALE');
    expect(() => parseMinorUnits('12.3x', 2)).toThrow('MONEY_INPUT_INVALID');
  });
});
