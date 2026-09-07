import { describe, expect, it } from 'vitest';
import { ApplicationError } from '@supermarket/shared';
import { ExchangeRate } from '../../domain/currency/index.js';
import type { Clock, ExchangeRateRepository } from '../ports/index.js';
import { GetCurrentExchangeRate } from './get-current-exchange-rate.js';

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

describe('GetCurrentExchangeRate', () => {
  const now = new Date('2026-08-10T12:00:00Z');

  it('returns the current valid rate for a pair', async () => {
    const clock = new FakeClock(now);
    const repository = new FakeExchangeRateRepository();
    await repository.save(
      ExchangeRate.create({
        id: 'rate-001',
        baseCurrency: 'USD',
        quoteCurrency: 'VES',
        rateValue: 36500,
        rateScale: 3,
        source: 'BCV',
        validFrom: new Date('2026-08-01T00:00:00Z'),
        registeredBy: 'user-001'
      })
    );

    const useCase = new GetCurrentExchangeRate(clock, repository);
    const result = await useCase.execute('USD', 'VES');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.rateValue).toBe(36500);
  });

  it('returns an error when no current rate exists', async () => {
    const clock = new FakeClock(now);
    const repository = new FakeExchangeRateRepository();
    const useCase = new GetCurrentExchangeRate(clock, repository);

    const result = await useCase.execute('USD', 'VES');

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

    const useCase = new GetCurrentExchangeRate(clock, repository);
    const result = await useCase.execute('USD', 'VES');

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('CURRENCY_RATE_MISSING');
  });
});
