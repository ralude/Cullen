import { describe, expect, it } from 'vitest';
import { Money, Quantity, TaxRate } from '@supermarket/shared';
import { ProductSnapshot } from '../../domain/catalog/index.js';
import { PaymentMethod } from '../../domain/currency/index.js';
import { ExchangeRate } from '../../domain/currency/index.js';
import { Sale } from '../../domain/sales/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type { SaleRepository } from '../ports/index.js';
import { RegisterMixedPayment } from './register-mixed-payment.js';

const context: ExecutionContext = {
  actorId: 'user-001',
  terminalId: 'terminal-001',
  originNodeId: 'node-001',
  correlationId: 'correlation-001'
};

class FakeSaleRepository implements SaleRepository {
  stored: Sale;

  constructor() {
    this.stored = Sale.start({
      id: 'sale-001', shiftId: 'shift-001', currencyCode: 'USD', terminalId: 'terminal-001', originNodeId: 'node-001',
      startedBy: 'user-001', startedAt: new Date('2026-08-15T10:00:00.000Z'), eventId: 'event-001'
    });
    this.stored.addItem({
      id: 'item-001',
      snapshot: ProductSnapshot.create({
        productId: 'product-001', description: 'Coffee', price: Money.fromMinorUnits(1000, 'USD'),
        taxRate: TaxRate.fromBasisPoints(0), unitCode: 'UNIT', unitScale: 0
      }), quantity: Quantity.fromScaled(1, 0),
      occurredAt: new Date('2026-08-15T10:00:30.000Z'), eventId: 'event-002'
    });
  }

  async save(sale: Sale): Promise<void> { this.stored = sale; }
  async findById(): Promise<Sale | null> { return this.stored; }
}

describe('RegisterMixedPayment', () => {
  it('registers an exact payment batch and preserves the method snapshot', async () => {
    const repository = new FakeSaleRepository();
    const useCase = new RegisterMixedPayment(
      repository,
      {
        findByCode: async () => PaymentMethod.create({ code: 'CASH_USD', name: 'Cash USD', kind: 'CASH', currencyCode: 'USD' }),
        findAll: async () => []
      },
      { findById: async () => null, findCurrentByPair: async () => null, save: async () => 1 },
      { getPolicy: async () => ({ id: 'igtf-001', rate: TaxRate.fromBasisPoints(0), eligiblePaymentMethodCodes: [], eligibleCurrencies: [] }) },
      { generate: () => 'payment-001' },
      { generate: () => 'event-003' },
      { now: () => new Date('2026-08-15T10:01:00.000Z') }
    );

    const result = await useCase.execute({
      saleId: 'sale-001',
      payments: [{ methodCode: 'CASH_USD', amountMinorUnits: 1000, currencyCode: 'USD' }]
    }, context);

    expect(result.ok).toBe(true);
    expect(repository.stored.payments).toHaveLength(1);
    expect(repository.stored.payments[0]?.method.code).toBe('CASH_USD');
  });

  it('calculates configurable IGTF from eligible payments', async () => {
    const repository = new FakeSaleRepository();
    const useCase = new RegisterMixedPayment(
      repository,
      {
        findByCode: async () => PaymentMethod.create({ code: 'CASH_USD', name: 'Cash USD', kind: 'CASH', currencyCode: 'USD' }),
        findAll: async () => []
      },
      { findById: async () => ExchangeRate.create({ id: 'rate-001', baseCurrency: 'EUR', quoteCurrency: 'USD', rateValue: 100, rateScale: 0, source: 'test', validFrom: new Date('2026-08-01T00:00:00Z'), registeredBy: 'user-001' }), findCurrentByPair: async () => null, save: async () => 1 },
      { getPolicy: async () => ({ id: 'igtf-001', rate: TaxRate.fromBasisPoints(300), eligiblePaymentMethodCodes: ['CASH_USD'], eligibleCurrencies: ['USD'] }) },
      { generate: () => 'payment-001' },
      { generate: () => 'event-003' },
      { now: () => new Date('2026-08-15T10:01:00.000Z') }
    );

    const result = await useCase.execute({
      saleId: 'sale-001',
      payments: [{ methodCode: 'CASH_USD', amountMinorUnits: 1030, currencyCode: 'USD' }]
    }, context);

    expect(result.ok).toBe(true);
    expect(repository.stored.financialTransactionTax.minorUnits).toBe(30);
    expect(repository.stored.total.minorUnits).toBe(1030);
  });
});

/**
 * El IGTF se cobra dentro del importe entregado con el método gravado, no
 * sobre él: si el cajero cobra 51,50 con tarjeta, esos 51,50 liquidan 50,00 de
 * la venta y 1,50 de impuesto. Calcularlo sobre el bruto volvía la base
 * recursiva —`X = efectivo + tasa·X`— y dejaba el pago mixto sin ningún
 * importe que un cajero pudiera deducir.
 */
describe('RegisterMixedPayment con IGTF sobre parte de la venta', () => {
  const mixedContext: ExecutionContext = context;

  class MixedRepository implements SaleRepository {
    stored: Sale;

    constructor() {
      this.stored = Sale.start({
        id: 'sale-001', shiftId: 'shift-001', currencyCode: 'USD', terminalId: 'terminal-001',
        originNodeId: 'node-001', startedBy: 'user-001',
        startedAt: new Date('2026-08-15T10:00:00.000Z'), eventId: 'event-001'
      });
      this.stored.addItem({
        id: 'item-001',
        snapshot: ProductSnapshot.create({
          productId: 'product-001', description: 'Coffee', price: Money.fromMinorUnits(10000, 'USD'),
          taxRate: TaxRate.fromBasisPoints(0), unitCode: 'UNIT', unitScale: 0
        }), quantity: Quantity.fromScaled(1, 0),
        occurredAt: new Date('2026-08-15T10:00:30.000Z'), eventId: 'event-002'
      });
    }

    async save(sale: Sale): Promise<void> { this.stored = sale; }
    async findById(): Promise<Sale | null> { return this.stored; }
  }

  const methods: Record<string, PaymentMethod> = {
    CASH: PaymentMethod.create({ code: 'CASH', name: 'Efectivo', kind: 'CASH', currencyCode: 'USD' }),
    CARD: PaymentMethod.create({ code: 'CARD', name: 'Tarjeta', kind: 'CARD', currencyCode: 'USD' })
  };

  const useCaseOver = (repository: MixedRepository): RegisterMixedPayment => new RegisterMixedPayment(
    repository,
    { findByCode: async (code: string) => methods[code] ?? null, findAll: async () => [] },
    { findById: async () => null, findCurrentByPair: async () => null, save: async () => 1 },
    { getPolicy: async () => ({
      id: 'igtf-001', rate: TaxRate.fromBasisPoints(300),
      eligiblePaymentMethodCodes: ['CARD'], eligibleCurrencies: ['USD']
    }) },
    { generate: () => 'payment-001' },
    { generate: () => 'event-003' },
    { now: () => new Date('2026-08-15T10:01:00.000Z') }
  );

  it('accepts the split a cashier can actually compute: half in cash, half plus IGTF on the card', async () => {
    const repository = new MixedRepository();

    const result = await useCaseOver(repository).execute({
      saleId: 'sale-001',
      payments: [
        { methodCode: 'CASH', amountMinorUnits: 5000, currencyCode: 'USD' },
        { methodCode: 'CARD', amountMinorUnits: 5150, currencyCode: 'USD' }
      ]
    }, mixedContext);

    expect(result.ok).toBe(true);
    /** 1,50 es el 3% de los 50,00 que la tarjeta liquida, no de los 51,50. */
    expect(repository.stored.financialTransactionTax.minorUnits).toBe(150);
    expect(repository.stored.total.minorUnits).toBe(10150);
    expect(repository.stored.balance.minorUnits).toBe(0);
  });

  it('taxes only the eligible method, leaving the cash portion untouched', async () => {
    const repository = new MixedRepository();

    await useCaseOver(repository).execute({
      saleId: 'sale-001',
      payments: [
        { methodCode: 'CASH', amountMinorUnits: 8000, currencyCode: 'USD' },
        { methodCode: 'CARD', amountMinorUnits: 2060, currencyCode: 'USD' }
      ]
    }, mixedContext);

    /** 3% de los 20,00 liquidados con tarjeta. */
    expect(repository.stored.financialTransactionTax.minorUnits).toBe(60);
    expect(repository.stored.total.minorUnits).toBe(10060);
  });

  it('keeps charging nothing when the whole sale is settled in cash', async () => {
    const repository = new MixedRepository();

    const result = await useCaseOver(repository).execute({
      saleId: 'sale-001',
      payments: [{ methodCode: 'CASH', amountMinorUnits: 10000, currencyCode: 'USD' }]
    }, mixedContext);

    expect(result.ok).toBe(true);
    expect(repository.stored.financialTransactionTax.minorUnits).toBe(0);
    expect(repository.stored.total.minorUnits).toBe(10000);
  });

  it('still balances when the whole sale is settled with the taxed method', async () => {
    const repository = new MixedRepository();

    const result = await useCaseOver(repository).execute({
      saleId: 'sale-001',
      payments: [{ methodCode: 'CARD', amountMinorUnits: 10300, currencyCode: 'USD' }]
    }, mixedContext);

    expect(result.ok).toBe(true);
    expect(repository.stored.financialTransactionTax.minorUnits).toBe(300);
    expect(repository.stored.total.minorUnits).toBe(10300);
  });

  it('rejects a batch that does not cover the sale plus its tax', async () => {
    const repository = new MixedRepository();

    const result = await useCaseOver(repository).execute({
      saleId: 'sale-001',
      payments: [
        { methodCode: 'CASH', amountMinorUnits: 5000, currencyCode: 'USD' },
        { methodCode: 'CARD', amountMinorUnits: 5000, currencyCode: 'USD' }
      ]
    }, mixedContext);

    expect(result.ok).toBe(false);
    expect(result.ok ? null : (result.error as { code: string }).code)
      .toBe('SALE_PAYMENT_TOTAL_MISMATCH');
  });

  it('rejects tendering more than the sale plus its tax', async () => {
    const repository = new MixedRepository();

    const result = await useCaseOver(repository).execute({
      saleId: 'sale-001',
      payments: [{ methodCode: 'CARD', amountMinorUnits: 20000, currencyCode: 'USD' }]
    }, mixedContext);

    expect(result.ok).toBe(false);
    expect(result.ok ? null : (result.error as { code: string }).code)
      .toBe('SALE_PAYMENT_TOTAL_MISMATCH');
  });
});
