import { DomainError, type Money } from '@supermarket/shared';
import type { ExchangeRate } from './exchange-rate.js';

/**
 * Servicio de dominio que convierte montos entre monedas usando una tasa
 * explícita, su escala y su vigencia. No usa floats.
 *
 * La aritmética es `Money.convertAtRate`, compartida con la pantalla y
 * consciente del exponente de cada moneda (ADR-0033); aquí solo se decide si
 * la tasa rige en ese instante.
 */
export class CurrencyConverter {
  convert(money: Money, rate: ExchangeRate, at: Date): Money {
    if (!rate.isValidAt(at)) {
      throw new DomainError(
        'CURRENCY_RATE_EXPIRED',
        'Exchange rate is not valid at the requested time.'
      );
    }

    return money.convertAtRate(rate);
  }
}
