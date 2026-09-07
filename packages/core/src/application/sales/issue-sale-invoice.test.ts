import { describe, expect, it } from 'vitest';
import {
  ApplicationError, err, Money, ok, Quantity, TaxRate, type AppError, type Result
} from '@supermarket/shared';
import { ProductSnapshot } from '../../domain/catalog/index.js';
import { PaymentMethod } from '../../domain/currency/index.js';
import { createSaleRecipientSnapshot, Payment, Sale } from '../../domain/sales/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type { FiscalDocumentDto, IssueFiscalDocumentInput } from '../fiscal/index.js';
import type { SaleRepository } from '../ports/index.js';
import { IssueSaleInvoice } from './issue-sale-invoice.js';

const context: ExecutionContext = {
  actorId: 'user-001', terminalId: 'terminal-001', originNodeId: 'node-001',
  correlationId: 'correlation-001', idempotencyKey: 'invoice-001'
};

const cash = PaymentMethod.create({
  code: 'CASH_USD', name: 'Cash USD', kind: 'CASH', currencyCode: 'USD'
});

const completedSale = (): Sale => {
  const sale = Sale.start({
    id: 'sale-001', shiftId: 'shift-001', currencyCode: 'USD', terminalId: 'terminal-001',
    originNodeId: 'node-001', startedBy: 'user-001',
    startedAt: new Date('2026-08-15T10:00:00.000Z'), eventId: 'event-001'
  });
  sale.addItem({
    id: 'item-001',
    snapshot: ProductSnapshot.create({
      productId: 'product-001', description: 'Café', price: Money.fromMinorUnits(1000, 'USD'),
      taxRate: TaxRate.fromBasisPoints(1600), unitCode: 'UNIT', unitScale: 0
    }),
    quantity: Quantity.fromScaled(2, 0),
    occurredAt: new Date('2026-08-15T10:00:30.000Z'), eventId: 'event-002'
  });
  sale.registerPayments({
    payments: [Payment.create({
      id: 'payment-001', method: cash, amount: Money.fromMinorUnits(2320, 'USD'),
      amountInSaleCurrency: Money.fromMinorUnits(2320, 'USD'), exchangeRate: null,
      registeredBy: 'user-001', registeredAt: new Date('2026-08-15T10:01:00.000Z')
    })],
    financialTransactionTax: Money.zero('USD'),
    occurredAt: new Date('2026-08-15T10:01:00.000Z'), eventIds: ['event-003']
  });
  return sale;
};

const repositoryOf = (sale: Sale | null): SaleRepository => ({
  save: async () => undefined,
  findById: async () => sale
});

const issuerOf = (
  received: IssueFiscalDocumentInput[],
  outcome?: Result<FiscalDocumentDto, AppError>
) => ({
  execute: async (
    input: IssueFiscalDocumentInput
  ): Promise<Result<FiscalDocumentDto, AppError>> => {
    received.push(input);
    return outcome ?? ok({
      id: 'document-001', content: input.content, status: 'ISSUED', version: 3, attempts: 1,
      fiscalNumber: 'F-001', lastErrorCode: null,
      lastEvidence: {
        dispatchState: 'RESULT_RECEIVED', commandEffect: 'APPLIED',
        fiscalCommit: 'COMMITTED', printDelivery: 'COMPLETE'
      }
    } satisfies FiscalDocumentDto);
  }
});

describe('IssueSaleInvoice', () => {
  it('builds the invoice content from the completed sale', async () => {
    const sale = completedSale();
    sale.complete({ completedAt: new Date('2026-08-15T10:02:00.000Z'), eventId: 'event-004' });
    const received: IssueFiscalDocumentInput[] = [];
    const useCase = new IssueSaleInvoice(repositoryOf(sale), issuerOf(received));

    const result = await useCase.execute(
      { saleId: 'sale-001', reason: 'Emisión de factura' }, context
    );

    expect(result).toMatchObject({ ok: true, value: { fiscalNumber: 'F-001' } });
    expect(received).toHaveLength(1);
    /**
     * La referencia es la venta: es la que `ReturnSale` busca para restituir,
     * y la que impide emitir dos facturas distintas del mismo hecho.
     */
    expect(received[0]!.content).toEqual({
      referenceId: 'sale-001',
      type: 'INVOICE',
      currencyCode: 'USD',
      totalMinorUnits: sale.total.minorUnits,
      lines: [{
        id: 'item-001',
        description: 'Café',
        quantityScaled: 2,
        quantityScale: 0,
        unitPriceMinorUnits: 1000,
        taxRateBasisPoints: 1600,
        totalMinorUnits: sale.items[0]!.total.minorUnits
      }],
      payments: [{ methodCode: 'CASH_USD', amountMinorUnits: 2320 }],
      recipient: null
    });
    expect(received[0]!.reason).toBe('Emisión de factura');
  });

  it('copies the fiscal recipient captured by the sale', async () => {
    const sale = completedSale();
    sale.setRecipient({
      // Misma normalización que aplica `SetSaleRecipient`: el agregado guarda el snapshot.
      recipient: createSaleRecipientSnapshot({
        country: 'VE', type: 'RIF', value: 'J-12345678-9', name: 'Distribuidora Demo'
      }),
      occurredAt: new Date('2026-08-15T10:01:30.000Z'), eventId: 'event-recipient'
    });
    sale.complete({ completedAt: new Date('2026-08-15T10:02:00.000Z'), eventId: 'event-004' });
    const received: IssueFiscalDocumentInput[] = [];
    const useCase = new IssueSaleInvoice(repositoryOf(sale), issuerOf(received));

    const result = await useCase.execute({ saleId: 'sale-001', reason: 'Factura' }, context);

    expect(result.ok).toBe(true);
    expect(received[0]!.content.recipient).toMatchObject({
      normalizedValue: 'J123456789', name: 'Distribuidora Demo'
    });
  });

  it('refuses to invoice a sale that is not completed', async () => {
    const received: IssueFiscalDocumentInput[] = [];
    const useCase = new IssueSaleInvoice(repositoryOf(completedSale()), issuerOf(received));

    const result = await useCase.execute({ saleId: 'sale-001', reason: 'Factura' }, context);

    expect(result).toMatchObject({ ok: false, error: { code: 'SALE_INVALID_STATE' } });
    expect(received).toEqual([]);
  });

  it('does not expose a sale from another terminal', async () => {
    const sale = completedSale();
    sale.complete({ completedAt: new Date('2026-08-15T10:02:00.000Z'), eventId: 'event-004' });
    const received: IssueFiscalDocumentInput[] = [];
    const useCase = new IssueSaleInvoice(repositoryOf(sale), issuerOf(received));

    const result = await useCase.execute(
      { saleId: 'sale-001', reason: 'Factura' }, { ...context, terminalId: 'terminal-002' }
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'SALE_NOT_FOUND' } });
    expect(received).toEqual([]);
  });

  it('propagates the fiscal failure without inventing a document', async () => {
    const sale = completedSale();
    sale.complete({ completedAt: new Date('2026-08-15T10:02:00.000Z'), eventId: 'event-004' });
    const useCase = new IssueSaleInvoice(
      repositoryOf(sale),
      issuerOf([], err(new ApplicationError('FISCAL_DEVICE_OPERATION_PENDING', 'Pending.')))
    );

    const result = await useCase.execute({ saleId: 'sale-001', reason: 'Factura' }, context);

    expect(result).toMatchObject({
      ok: false, error: { code: 'FISCAL_DEVICE_OPERATION_PENDING' }
    });
  });
});
