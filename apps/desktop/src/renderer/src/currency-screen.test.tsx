import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ExchangeRateResponse, ExchangeRateSuggestionResponse } from '@supermarket/shared';
import { formatScaledDecimal } from './amount-input.js';
import type { OperationApi } from './api-client.js';
import { ApiProblemError } from './api-transport.js';
import {
  ageLabel,
  confirmManualRate,
  CurrencyScreen,
  loadCurrentAndHistory,
  loadSuggestion,
  suggestionToManualForm
} from './operation-screens.js';

const problem = (code: string, status: number) => new ApiProblemError({
  type: 'urn:supermarket:problem:' + code.toLowerCase(), title: 'Denied.',
  status, code, correlationId: 'correlation-1'
});

const pair = { baseCurrency: 'USD', quoteCurrency: 'VES' };

const currentRate: ExchangeRateResponse = {
  id: 'rate-current', baseCurrency: 'USD', quoteCurrency: 'VES', rateValue: 36500, rateScale: 3,
  source: 'Carga manual confirmada', validFrom: '2026-09-01T00:00:00.000Z', validUntil: null,
  registeredBy: 'user-001'
};

const suggestion: ExchangeRateSuggestionResponse = {
  baseCurrency: 'USD', quoteCurrency: 'VES', rateValue: 365125, rateScale: 3,
  source: 'Proveedor de prueba', observedAt: '2026-09-04T12:00:00.000Z',
  validFrom: '2026-09-04T00:00:00.000Z', validUntil: null
};

describe('currency screen data flow', () => {
  it('queries the current rate and history independently for the given pair and limit', async () => {
    const getCurrentExchangeRate = vi.fn(async () => currentRate);
    const getExchangeRateHistory = vi.fn(async () => [currentRate]);

    const result = await loadCurrentAndHistory(
      { getCurrentExchangeRate, getExchangeRateHistory }, pair, 50
    );

    expect(result).toEqual({ current: { ok: true, value: currentRate }, history: { ok: true, value: [currentRate] } });
    expect(getCurrentExchangeRate).toHaveBeenCalledWith(pair);
    expect(getExchangeRateHistory).toHaveBeenCalledWith({ ...pair, limit: 50 });
  });

  it('keeps history readable when the current rate is missing, and vice versa', async () => {
    const missingCurrent = await loadCurrentAndHistory({
      getCurrentExchangeRate: async () => { throw problem('CURRENCY_RATE_MISSING', 404); },
      getExchangeRateHistory: async () => [currentRate]
    }, pair);
    expect(missingCurrent.current.ok).toBe(false);
    if (!missingCurrent.current.ok) {
      expect(missingCurrent.current.error).toMatchObject({ problem: { code: 'CURRENCY_RATE_MISSING' } });
    }
    expect(missingCurrent.history).toEqual({ ok: true, value: [currentRate] });

    const missingHistory = await loadCurrentAndHistory({
      getCurrentExchangeRate: async () => currentRate,
      getExchangeRateHistory: async () => { throw problem('FORBIDDEN', 403); }
    }, pair);
    expect(missingHistory.current).toEqual({ ok: true, value: currentRate });
    expect(missingHistory.history.ok).toBe(false);
  });

  it('reads a suggestion without ever calling a write, and reports a provider failure as a controlled error', async () => {
    const ok = await loadSuggestion({ getSuggestedExchangeRate: async () => ({ suggestion }) }, pair);
    const failed = await loadSuggestion({
      getSuggestedExchangeRate: async () => { throw problem('NETWORK_UNAVAILABLE', 503); }
    }, pair);

    expect(ok).toEqual({ ok: true, value: suggestion });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toMatchObject({ problem: { code: 'NETWORK_UNAVAILABLE' } });
  });

  it('copies the suggestion into a reviewable manual form without ever calling UpdateExchangeRate', () => {
    const form = suggestionToManualForm(suggestion);

    expect(form).toEqual({
      value: formatScaledDecimal(365125, 3),
      source: 'Proveedor de prueba',
      validFrom: '2026-09-04',
      validUntil: '',
      reason: 'Sugerencia externa confirmada por el operador'
    });
  });

  it('falls back to today when the suggestion carries no suggested validity', () => {
    const form = suggestionToManualForm({ ...suggestion, validFrom: null, validUntil: null });

    expect(form.validFrom).toBe(new Date().toISOString().slice(0, 10));
    expect(form.validUntil).toBe('');
  });

  it('confirms a manual rate exclusively through UpdateExchangeRate with an exact scaled value and the given idempotency key', async () => {
    const updateExchangeRate = vi.fn(async () => currentRate);
    const form = {
      value: '366,000', source: 'Sugerencia externa confirmada por el operador',
      validFrom: '2026-09-04', validUntil: '', reason: 'Confirmado tras revisión'
    };

    const result = await confirmManualRate({ updateExchangeRate }, pair, form, 'intent-001');

    expect(result).toBe(currentRate);
    expect(updateExchangeRate).toHaveBeenCalledWith({
      baseCurrency: 'USD', quoteCurrency: 'VES', rateValue: 366000, rateScale: 3,
      source: 'Sugerencia externa confirmada por el operador',
      validFrom: new Date('2026-09-04').toISOString(), validUntil: null,
      reason: 'Confirmado tras revisión'
    }, 'intent-001');
  });

  it('rejects a decimal value with more fractional digits than the domain scale before calling the API', async () => {
    const updateExchangeRate = vi.fn();
    const form = { value: '36.123456789', source: 'x', validFrom: '2026-09-04', validUntil: '', reason: 'x' };

    await expect(confirmManualRate({ updateExchangeRate }, pair, form, 'intent-002'))
      .rejects.toThrow('RATE_INPUT_INVALID');
    expect(updateExchangeRate).not.toHaveBeenCalled();
  });

  it('buckets local age into minutes, hours and days without a synchronization claim', () => {
    const now = new Date('2026-09-04T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      expect(ageLabel(new Date(now.getTime() - 30_000).toISOString())).toBe('hace instantes');
      expect(ageLabel(new Date(now.getTime() - 5 * 60_000).toISOString())).toBe('hace 5 min');
      expect(ageLabel(new Date(now.getTime() - 3 * 3_600_000).toISOString())).toBe('hace 3 h');
      expect(ageLabel(new Date(now.getTime() - 2 * 86_400_000).toISOString())).toBe('hace 2 d');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('currency screen static rendering', () => {
  const props = {
    api: {} as OperationApi,
    capabilities: { fiscalMode: 'SIMULATION' as const, simulatedReportsEnabled: false },
    permissionCodes: ['currency.rate.update']
  };

  it('shows the four separated sections with honest empty states before any query', () => {
    const markup = renderToStaticMarkup(<CurrencyScreen {...props} />);

    expect(markup).toContain('Tasa vigente');
    expect(markup).toContain('Consulta el par para ver la tasa vigente.');
    expect(markup).toContain('Histórico local');
    expect(markup).toContain('Consulta el par para ver su histórico.');
    expect(markup).toContain('Sugerencia externa');
    expect(markup).toContain('Sin sugerencia solicitada todavía.');
    expect(markup).toContain('Carga manual');
    expect(markup).not.toContain('PROPUESTA');
  });

  it('never labels a suggestion as the current rate or a legal closing', () => {
    const markup = renderToStaticMarkup(<CurrencyScreen {...props} />);

    expect(markup).not.toContain('tasa vigente confirmada automáticamente');
    expect(markup).toContain('Una sugerencia externa es una propuesta efímera');
  });

  it('disables confirming a rate without currency.rate.update, and enables it once granted', () => {
    const withoutPermission = renderToStaticMarkup(<CurrencyScreen {...props} permissionCodes={[]} />);
    expect(withoutPermission).toContain('<button class="primary-button" type="submit" disabled="">Confirmar tasa</button>');

    const withPermission = renderToStaticMarkup(<CurrencyScreen {...props} />);
    expect(withPermission).toContain('<button class="primary-button" type="submit">Confirmar tasa</button>');
  });
});
