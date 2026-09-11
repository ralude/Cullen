import { describe, expect, it } from 'vitest';
import { ApplicationError, TaxRate } from '@supermarket/shared';
import { PaymentMethod } from '../../domain/currency/index.js';
import type {
  FinancialTransactionTaxPolicyProvider, PaymentMethodRepository
} from '../ports/index.js';
import { ListPaymentMethods } from './list-payment-methods.js';

class FakePaymentMethodRepository implements PaymentMethodRepository {
  constructor(private readonly methods: readonly PaymentMethod[]) {}

  async findByCode(code: string): Promise<PaymentMethod | null> {
    return this.methods.find((method) => method.code === code) ?? null;
  }

  async findAll(): Promise<readonly PaymentMethod[]> {
    return this.methods;
  }
}

const untaxed: FinancialTransactionTaxPolicyProvider = {
  getPolicy: async () => ({
    id: 'igtf-001', rate: TaxRate.fromBasisPoints(0),
    eligiblePaymentMethodCodes: [], eligibleCurrencies: []
  })
};

describe('ListPaymentMethods', () => {
  it('lists only active methods with their settlement currency', async () => {
    const cash = PaymentMethod.create({ code: 'CASH', name: 'Efectivo', kind: 'CASH', currencyCode: 'USD' });
    const card = PaymentMethod.create({ code: 'CARD', name: 'Tarjeta', kind: 'CARD', currencyCode: 'VES' });
    const retired = PaymentMethod.create({
      code: 'OLD', name: 'Retirado', kind: 'OTHER', currencyCode: 'USD', isActive: false
    });
    const useCase = new ListPaymentMethods(
      new FakePaymentMethodRepository([cash, card, retired]), untaxed
    );

    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { code: 'CASH', name: 'Efectivo', kind: 'CASH', currencyCode: 'USD', financialTransactionTaxBasisPoints: 0 },
      { code: 'CARD', name: 'Tarjeta', kind: 'CARD', currencyCode: 'VES', financialTransactionTaxBasisPoints: 0 }
    ]);
  });
});

/**
 * La pantalla marca «+IGTF» y precarga el bruto a partir de este número, sin
 * leer la política ni sus listas de elegibilidad. Ver la enmienda de ADR-0031
 * del 2026-09-11.
 */
describe('ListPaymentMethods y la tasa que publica por método', () => {
  const methods = [
    PaymentMethod.create({ code: 'CASH', name: 'Efectivo', kind: 'CASH', currencyCode: 'USD' }),
    PaymentMethod.create({ code: 'CARD', name: 'Tarjeta', kind: 'CARD', currencyCode: 'USD' }),
    PaymentMethod.create({ code: 'MOBILE', name: 'Pago móvil', kind: 'MOBILE_PAYMENT', currencyCode: 'VES' })
  ];

  const rateOf = (result: { code: string; financialTransactionTaxBasisPoints: number }[], code: string): number =>
    result.find((method) => method.code === code)?.financialTransactionTaxBasisPoints ?? -1;

  it('publishes the policy rate only where code and currency are both eligible', async () => {
    const useCase = new ListPaymentMethods(new FakePaymentMethodRepository(methods), {
      getPolicy: async () => ({
        id: 'igtf-001', rate: TaxRate.fromBasisPoints(300),
        eligiblePaymentMethodCodes: ['CARD', 'MOBILE'], eligibleCurrencies: ['USD']
      })
    });

    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const published = [...result.value];
    expect(rateOf(published, 'CARD')).toBe(300);
    /** Elegible por código, pero liquida en una moneda que no lo está. */
    expect(rateOf(published, 'MOBILE')).toBe(0);
    expect(rateOf(published, 'CASH')).toBe(0);
  });

  it('publishes zero for every method when the node has no active policy', async () => {
    const useCase = new ListPaymentMethods(new FakePaymentMethodRepository(methods), {
      getPolicy: async () => {
        throw new ApplicationError('POLICY_NOT_CONFIGURED', 'Financial transaction tax policy is not configured.');
      }
    });

    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((method) => method.financialTransactionTaxBasisPoints)).toEqual([0, 0, 0]);
  });

  it('does not hide a storage failure behind an untaxed method', async () => {
    const useCase = new ListPaymentMethods(new FakePaymentMethodRepository(methods), {
      getPolicy: async () => {
        throw new ApplicationError('DATABASE_UNAVAILABLE', 'Database is unavailable.');
      }
    });

    await expect(useCase.execute()).rejects.toThrowError('Database is unavailable.');
  });
});
