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

/**
 * Paridad entre lo que la pantalla sugiere y lo que el nodo acepta. La
 * enmienda de ADR-0031 del 2026-09-11 permite al renderer precargar el bruto
 * de un método gravado, con dos condiciones: que use la misma primitiva
 * compartida que el nodo —`TaxRate.includeIn`, inversa de `extractFrom`— y que
 * redondee una sola vez, sobre la base gravada agregada. Estas pruebas fijan
 * ambas: si alguna dirección cambia, rompen aquí y no en la caja.
 */
describe('Sugerencia de la pantalla frente al cálculo del nodo', () => {
  const igtf = TaxRate.fromBasisPoints(300);

  /** Lo que la pantalla precargará para una porción comercial dada. */
  const suggestedGross = (commercialBase: number): number =>
    igtf.includeIn(Money.fromMinorUnits(commercialBase, 'USD')).minorUnits;

  class SaleOf implements SaleRepository {
    stored: Sale;

    constructor(priceMinorUnits: number) {
      this.stored = Sale.start({
        id: 'sale-001', shiftId: 'shift-001', currencyCode: 'USD', terminalId: 'terminal-001',
        originNodeId: 'node-001', startedBy: 'user-001',
        startedAt: new Date('2026-08-15T10:00:00.000Z'), eventId: 'event-001'
      });
      this.stored.addItem({
        id: 'item-001',
        snapshot: ProductSnapshot.create({
          productId: 'product-001', description: 'Coffee',
          price: Money.fromMinorUnits(priceMinorUnits, 'USD'),
          taxRate: TaxRate.fromBasisPoints(0), unitCode: 'UNIT', unitScale: 0
        }), quantity: Quantity.fromScaled(1, 0),
        occurredAt: new Date('2026-08-15T10:00:30.000Z'), eventId: 'event-002'
      });
    }

    async save(sale: Sale): Promise<void> { this.stored = sale; }
    async findById(): Promise<Sale | null> { return this.stored; }
  }

  const taxedMethods: Record<string, PaymentMethod> = {
    CASH: PaymentMethod.create({ code: 'CASH', name: 'Efectivo', kind: 'CASH', currencyCode: 'USD' }),
    CARD: PaymentMethod.create({ code: 'CARD', name: 'Tarjeta', kind: 'CARD', currencyCode: 'USD' }),
    MOBILE: PaymentMethod.create({ code: 'MOBILE', name: 'Pago móvil', kind: 'MOBILE_PAYMENT', currencyCode: 'USD' })
  };

  const useCaseOver = (repository: SaleOf): RegisterMixedPayment => new RegisterMixedPayment(
    repository,
    { findByCode: async (code: string) => taxedMethods[code] ?? null, findAll: async () => [] },
    { findById: async () => null, findCurrentByPair: async () => null, save: async () => 1 },
    { getPolicy: async () => ({
      id: 'igtf-001', rate: igtf,
      eligiblePaymentMethodCodes: ['CARD', 'MOBILE'], eligibleCurrencies: ['USD']
    }) },
    { generate: () => 'payment-001' },
    { generate: () => 'event-003' },
    { now: () => new Date('2026-08-15T10:01:00.000Z') }
  );

  it('accepts the gross the screen suggests for the only taxed method of the batch', async () => {
    const repository = new SaleOf(10000);

    const result = await useCaseOver(repository).execute({
      saleId: 'sale-001',
      payments: [
        { methodCode: 'CASH', amountMinorUnits: 5000, currencyCode: 'USD' },
        { methodCode: 'CARD', amountMinorUnits: suggestedGross(5000), currencyCode: 'USD' }
      ]
    }, context);

    expect(result.ok).toBe(true);
    /** El impuesto del nodo es exactamente el que la sugerencia incluyó. */
    expect(repository.stored.financialTransactionTax.minorUnits)
      .toBe(suggestedGross(5000) - 5000);
    expect(repository.stored.balance.minorUnits).toBe(0);
  });

  /**
   * 1,00 cobrado en dos mitades gravadas es el caso donde el redondeo se nota:
   * el 3% de 0,50 es 0,015 y sube a 0,02 en cada mitad.
   */
  it('balances a batch with two taxed methods when the rounding happens once over the aggregate base', async () => {
    const repository = new SaleOf(100);

    const result = await useCaseOver(repository).execute({
      saleId: 'sale-001',
      payments: [
        { methodCode: 'CARD', amountMinorUnits: 52, currencyCode: 'USD' },
        { methodCode: 'MOBILE', amountMinorUnits: suggestedGross(100) - 52, currencyCode: 'USD' }
      ]
    }, context);

    expect(result.ok).toBe(true);
    expect(suggestedGross(100)).toBe(103);
    expect(repository.stored.financialTransactionTax.minorUnits).toBe(3);
    expect(repository.stored.total.minorUnits).toBe(103);
  });

  it('rejects the same batch when each taxed payment rounds its own tax', async () => {
    const repository = new SaleOf(100);

    const result = await useCaseOver(repository).execute({
      saleId: 'sale-001',
      payments: [
        { methodCode: 'CARD', amountMinorUnits: suggestedGross(50), currencyCode: 'USD' },
        { methodCode: 'MOBILE', amountMinorUnits: suggestedGross(50), currencyCode: 'USD' }
      ]
    }, context);

    /** 0,52 + 0,52 entrega una unidad menor de más sobre el 1,03 que se debe. */
    expect(suggestedGross(50) * 2).toBe(104);
    expect(result.ok).toBe(false);
    expect(result.ok ? null : (result.error as { code: string }).code)
      .toBe('SALE_PAYMENT_TOTAL_MISMATCH');
  });
});

/**
 * El cobro venezolano corriente: una venta en dólares pagada en parte con
 * efectivo en dólares y en parte con pago móvil en bolívares, a la tasa
 * explícita que la pantalla envía (spec de pagos, CA-PM-01; ADR-0033).
 */
describe('RegisterMixedPayment con un pago en otra moneda', () => {
  const rate = ExchangeRate.create({
    id: 'rate-usd-ves', baseCurrency: 'USD', quoteCurrency: 'VES', rateValue: 47858, rateScale: 2,
    source: 'Tasa de prueba', validFrom: new Date('2026-08-15T00:00:00.000Z'), registeredBy: 'user-001'
  });
  const methods: Record<string, PaymentMethod> = {
    CASH_USD: PaymentMethod.create({ code: 'CASH_USD', name: 'Efectivo USD', kind: 'CASH', currencyCode: 'USD' }),
    MOBILE_VES: PaymentMethod.create({ code: 'MOBILE_VES', name: 'Pago móvil', kind: 'MOBILE_PAYMENT', currencyCode: 'VES' })
  };
  const useCaseFor = (repository: FakeSaleRepository, at = new Date('2026-08-15T10:01:00.000Z')) =>
    new RegisterMixedPayment(
      repository,
      { findByCode: async (code: string) => methods[code] ?? null, findAll: async () => Object.values(methods) },
      { findById: async (id: string) => id === rate.id ? rate : null, findCurrentByPair: async () => rate, save: async () => 1 },
      { getPolicy: async () => ({ id: 'igtf-001', rate: TaxRate.fromBasisPoints(300), eligiblePaymentMethodCodes: ['CASH_USD'], eligibleCurrencies: ['USD'] }) },
      { generate: () => 'payment-' + Math.random().toString(16).slice(2) },
      { generate: () => 'event-' + Math.random().toString(16).slice(2) },
      { now: () => at }
    );

  it('registers a USD cash tender plus a VES pago móvil converted at the explicit rate', async () => {
    const repository = new FakeSaleRepository();
    /**
     * Venta de 10,00: 4,00 en efectivo, que con IGTF al 3 % se cobran 4,12, y
     * 6,00 en bolívares —6 × 478,58 = 2.871,48 Bs—, que no pagan IGTF.
     */
    const result = await useCaseFor(repository).execute({
      saleId: 'sale-001',
      payments: [
        { methodCode: 'CASH_USD', amountMinorUnits: 412, currencyCode: 'USD' },
        { methodCode: 'MOBILE_VES', amountMinorUnits: 287148, currencyCode: 'VES', exchangeRateId: 'rate-usd-ves' }
      ]
    }, context);

    expect(result.ok).toBe(true);
    const ves = repository.stored.payments.find((payment) => payment.method.code === 'MOBILE_VES');
    expect(ves?.amount).toEqual(Money.fromMinorUnits(287148, 'VES'));
    expect(ves?.amountInSaleCurrency).toEqual(Money.fromMinorUnits(600, 'USD'));
    expect(ves?.exchangeRate?.id).toBe('rate-usd-ves');
    expect(repository.stored.financialTransactionTax.minorUnits).toBe(12);
    expect(repository.stored.total.minorUnits).toBe(1012);
  });

  it('keeps asking for the rate when the screen does not send one', async () => {
    const result = await useCaseFor(new FakeSaleRepository()).execute({
      saleId: 'sale-001',
      payments: [{ methodCode: 'MOBILE_VES', amountMinorUnits: 478580, currencyCode: 'VES' }]
    }, context);

    expect(result).toMatchObject({ ok: false, error: { code: 'EXCHANGE_RATE_REQUIRED' } });
  });

  it('rejects a rate that no longer applies at payment time', async () => {
    const result = await useCaseFor(new FakeSaleRepository(), new Date('2026-08-14T10:00:00.000Z')).execute({
      saleId: 'sale-001',
      payments: [{ methodCode: 'MOBILE_VES', amountMinorUnits: 478580, currencyCode: 'VES', exchangeRateId: 'rate-usd-ves' }]
    }, context);

    expect(result).toMatchObject({ ok: false, error: { code: 'CURRENCY_RATE_EXPIRED' } });
  });
});
