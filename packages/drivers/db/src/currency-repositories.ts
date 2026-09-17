/**
 * Persistencia de moneda: tasas de cambio con su historia y métodos de pago.
 */
import {
  ExchangeRate,
  PaymentMethod,
  type ExchangeRateHistoryRepository,
  type ExchangeRateRepository,
  type PaymentMethodKind,
  type PaymentMethodRepository
} from '@supermarket/core';
import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import type { DatabaseHandle } from './connection.js';
import { exchangeRates, paymentMethods } from './schema.js';
import { read, requireTransaction } from './unit-of-work.js';

export class DrizzlePaymentMethodRepository implements PaymentMethodRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(method: PaymentMethod): Promise<void> {
    requireTransaction(this.handle.sqlite);
    this.handle.db.insert(paymentMethods).values({ ...method, version: 1 }).onConflictDoUpdate({
      target: paymentMethods.code,
      set: {
        name: method.name,
        kind: method.kind,
        currencyCode: method.currencyCode,
        isActive: method.isActive
      }
    }).run();
  }

  findByCode(code: string): Promise<PaymentMethod | null> {
    return read(() => {
      const row = this.handle.db.select().from(paymentMethods)
        .where(eq(paymentMethods.code, code)).get();
      return row ? PaymentMethod.create({ ...row, kind: row.kind as PaymentMethodKind }) : null;
    });
  }

  findAll(): Promise<readonly PaymentMethod[]> {
    return read(() => this.handle.db.select().from(paymentMethods).all()
      .map((row) => PaymentMethod.create({ ...row, kind: row.kind as PaymentMethodKind })));
  }
}

export class DrizzleExchangeRateRepository implements ExchangeRateRepository, ExchangeRateHistoryRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(rate: ExchangeRate): Promise<number> {
    requireTransaction(this.handle.sqlite);
    const version = ((this.handle.sqlite.prepare(`
      select max(version) from exchange_rates where base_currency = ? and quote_currency = ?
    `).pluck().get(rate.baseCurrency, rate.quoteCurrency) as number | null) ?? 0) + 1;
    this.handle.db.insert(exchangeRates).values({
      id: rate.id,
      baseCurrency: rate.baseCurrency,
      quoteCurrency: rate.quoteCurrency,
      rateValue: rate.rateValue,
      rateScale: rate.rateScale,
      source: rate.source,
      validFrom: rate.validFrom.getTime(),
      validUntil: rate.validUntil?.getTime() ?? null,
      registeredBy: rate.registeredBy,
      version
    }).run();
    return version;
  }

  findById(id: string): Promise<ExchangeRate | null> {
    return read(() => this.restore(this.handle.db.select().from(exchangeRates)
      .where(eq(exchangeRates.id, id)).get()));
  }

  findCurrentByPair(base: string, quote: string, at: Date): Promise<ExchangeRate | null> {
    return read(() => this.restore(this.handle.db.select().from(exchangeRates).where(and(
      eq(exchangeRates.baseCurrency, base),
      eq(exchangeRates.quoteCurrency, quote),
      lte(exchangeRates.validFrom, at.getTime()),
      or(isNull(exchangeRates.validUntil), gt(exchangeRates.validUntil, at.getTime()))
    )).orderBy(desc(exchangeRates.validFrom)).get()));
  }

  findHistoryByPair(base: string, quote: string, limit = 100): Promise<readonly ExchangeRate[]> {
    return read(() => this.handle.db.select().from(exchangeRates).where(and(
      eq(exchangeRates.baseCurrency, base), eq(exchangeRates.quoteCurrency, quote)
    )).orderBy(desc(exchangeRates.validFrom), desc(exchangeRates.id)).limit(limit).all()
      .map((row) => this.restore(row) as ExchangeRate));
  }

  private restore(row: typeof exchangeRates.$inferSelect | undefined): ExchangeRate | null {
    return row ? ExchangeRate.create({
      ...row,
      validFrom: new Date(row.validFrom),
      validUntil: row.validUntil === null ? null : new Date(row.validUntil)
    }) : null;
  }
}
