import { describe, expect, it } from 'vitest';
import { ExchangeRate } from '../../domain/currency/index.js';
import type { AuthorizationService, ExchangeRateRepository, IdGenerator } from '../ports/index.js';
import type { ExecutionContext } from '../execution-context.js';
import { UpdateExchangeRate } from './update-exchange-rate.js';

class FakeIdGenerator implements IdGenerator {
  nextId = 'generated-rate-id';
  generate(): string {
    return this.nextId;
  }
}

class FakeExchangeRateRepository implements ExchangeRateRepository {
  rates: ExchangeRate[] = [];

  async save(rate: ExchangeRate): Promise<number> {
    this.rates.push(rate);
    return this.rates.length;
  }

  async findCurrentByPair(): Promise<ExchangeRate | null> {
    return null;
  }

  async findById(): Promise<ExchangeRate | null> {
    return null;
  }
}

const context: ExecutionContext = {
  actorId: 'user-001', terminalId: 'terminal-001', originNodeId: 'node-001',
  correlationId: 'correlation-001', actorRoleCodes: ['ADMIN']
};
const authorization = (allowed = true): AuthorizationService => ({ authorize: async () => allowed });
const clock = { now: () => new Date('2026-08-01T00:00:00Z') };

describe('UpdateExchangeRate', () => {
  it('registers a new exchange rate', async () => {
    const idGenerator = new FakeIdGenerator();
    const repository = new FakeExchangeRateRepository();
    const useCase = new UpdateExchangeRate(idGenerator, repository, authorization(), clock);

    const result = await useCase.execute({
      baseCurrency: 'USD',
      quoteCurrency: 'VES',
      rateValue: 36500,
      rateScale: 3,
      source: 'BCV',
      validFrom: new Date('2026-08-01T00:00:00Z'),
      reason: 'Official daily rate'
    }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.id).toBe('generated-rate-id');
    expect(result.value.baseCurrency).toBe('USD');
    expect(result.value.quoteCurrency).toBe('VES');
    expect(repository.rates).toHaveLength(1);
    expect(repository.rates[0]?.id).toBe('generated-rate-id');
  });

  it('returns a domain error for invalid input', async () => {
    const idGenerator = new FakeIdGenerator();
    const repository = new FakeExchangeRateRepository();
    const useCase = new UpdateExchangeRate(idGenerator, repository, authorization(), clock);

    const result = await useCase.execute({
      baseCurrency: 'USD',
      quoteCurrency: 'USD',
      rateValue: 36500,
      rateScale: 3,
      source: 'BCV',
      validFrom: new Date('2026-08-01T00:00:00Z'),
      reason: 'Official daily rate'
    }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('EXCHANGE_RATE_INVALID_PAIR');
    expect(repository.rates).toHaveLength(0);
  });

  it('does not persist a rate when permission is denied', async () => {
    const repository = new FakeExchangeRateRepository();
    const useCase = new UpdateExchangeRate(
      new FakeIdGenerator(), repository, authorization(false), clock
    );

    const result = await useCase.execute({
      baseCurrency: 'USD', quoteCurrency: 'VES', rateValue: 36500, rateScale: 3,
      source: 'BCV', validFrom: new Date('2026-08-01T00:00:00Z'), reason: 'Daily rate'
    }, context);

    expect(result).toEqual(expect.objectContaining({
      ok: false, error: expect.objectContaining({ code: 'FORBIDDEN' })
    }));
    expect(repository.rates).toHaveLength(0);
  });
});
