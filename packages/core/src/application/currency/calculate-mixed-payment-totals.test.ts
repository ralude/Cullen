import { describe, expect, it } from 'vitest';
import { ApplicationError } from '@supermarket/shared';
import { ExchangeRate } from '../../domain/currency/index.js';
import type { Clock, ExchangeRateRepository } from '../ports/index.js';
import { CalculateMixedPaymentTotals } from './calculate-mixed-payment-totals.js';

class FakeClock implements Clock {
  constructor(private readonly fixed: Date) {}

  now(): Date {
    return this.fixed;
  }
}

class FakeExchangeRateRepository implements ExchangeRateRepository {
  rates: ExchangeRate[] = [];

  async save(rate: ExchangeRate): Promise<number> {
    this.rates.push(rate);
    return this.rates.length;
  }

  async findCurrentByPair(
    baseCurrency: string,
    quoteCurrency: string,
    at: Date
  ): Promise<ExchangeRate | null> {
    return (
      this.rates.find(
        (r) =>
          r.baseCurrency === baseCurrency &&
          r.quoteCurrency === quoteCurrency &&
          r.isValidAt(at)
      ) ?? null
    );
  }

  async findById(rateId: string): Promise<ExchangeRate | null> {
    return this.rates.find((rate) => rate.id === rateId) ?? null;
  }
}

describe('CalculateMixedPaymentTotals', () => {
  const now = new Date('2026-08-10T12:00:00Z');

  async function seedRates(repository: FakeExchangeRateRepository): Promise<void> {
    await repository.save(
      ExchangeRate.create({
        id: 'rate-usd-ves',
        baseCurrency: 'USD',
        quoteCurrency: 'VES',
        rateValue: 36500,
        rateScale: 3,
        source: 'BCV',
        validFrom: new Date('2026-08-01T00:00:00Z'),
        registeredBy: 'user-001'
      })
    );
  }

  it('totals mixed payments in the target currency', async () => {
    const clock = new FakeClock(now);
    const repository = new FakeExchangeRateRepository();
    await seedRates(repository);

    const useCase = new CalculateMixedPaymentTotals(clock, repository);
    const result = await useCase.execute({
      targetCurrency: 'VES',
      payments: [
        { amountMinorUnits: 100000, currencyCode: 'VES' },
        { amountMinorUnits: 1000, currencyCode: 'USD' } // 10.00 USD -> 36500 VES
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.totalCurrency).toBe('VES');
    expect(result.value.totalMinorUnits).toBe(136500);
  });

  it('returns an error when a required rate is missing', async () => {
    const clock = new FakeClock(now);
    const repository = new FakeExchangeRateRepository();
    await seedRates(repository);

    const useCase = new CalculateMixedPaymentTotals(clock, repository);
    const result = await useCase.execute({
      targetCurrency: 'VES',
      payments: [{ amountMinorUnits: 1000, currencyCode: 'EUR' }]
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('CURRENCY_RATE_MISSING');
    expect(result.error).toBeInstanceOf(ApplicationError);
  });

  it('ignores expired rates', async () => {
    const clock = new FakeClock(now);
    const repository = new FakeExchangeRateRepository();
    await repository.save(
      ExchangeRate.create({
        id: 'rate-expired',
        baseCurrency: 'USD',
        quoteCurrency: 'VES',
        rateValue: 36000,
        rateScale: 3,
        source: 'BCV',
        validFrom: new Date('2026-07-01T00:00:00Z'),
        validUntil: new Date('2026-07-31T23:59:59Z'),
        registeredBy: 'user-001'
      })
    );

    const useCase = new CalculateMixedPaymentTotals(clock, repository);
    const result = await useCase.execute({
      targetCurrency: 'VES',
      payments: [{ amountMinorUnits: 1000, currencyCode: 'USD' }]
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('CURRENCY_RATE_MISSING');
  });
});
