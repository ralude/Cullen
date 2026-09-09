import { describe, expect, it } from 'vitest';
import { BcvExchangeRateProvider, HttpExchangeRateProvider, UnavailableExchangeRateProvider } from './index.js';

const response = (body: unknown, ok = true): Response => new Response(JSON.stringify(body), {
  status: ok ? 200 : 503,
  headers: { 'content-type': 'application/json' }
});

describe('exchange-rate driver', () => {
  it('normalizes a decimal string without using a floating rate', async () => {
    const provider = new HttpExchangeRateProvider({
      endpoint: 'https://rates.invalid/latest', source: 'test',
      fetcher: async () => response({ rate: '365.125', observedAt: '2026-09-03T12:00:00.000Z' })
    });
    const result = await provider.getSuggestedRate('USD', 'VES');
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      value: expect.objectContaining({ rateValue: 365125, rateScale: 3 })
    }));
  });

  it('fails closed for network and malformed responses', async () => {
    const network = new HttpExchangeRateProvider({
      endpoint: 'https://rates.invalid/latest', source: 'test',
      fetcher: async () => { throw new Error('offline'); }
    });
    await expect(network.getSuggestedRate('USD', 'VES')).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'NETWORK_UNAVAILABLE' }) })
    );
    const malformed = new HttpExchangeRateProvider({
      endpoint: 'https://rates.invalid/latest', source: 'test',
      fetcher: async () => response({ rate: 36.5 })
    });
    await expect(malformed.getSuggestedRate('USD', 'VES')).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'EXCHANGE_RATE_PROVIDER_INVALID_RESPONSE' }) })
    );
  });

  it('reports an unconfigured provider without touching persistence', async () => {
    await expect(new UnavailableExchangeRateProvider().getSuggestedRate('USD', 'VES'))
      .resolves.toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'EXCHANGE_RATE_PROVIDER_NOT_CONFIGURED' }) }));
  });
});

describe('BcvExchangeRateProvider', () => {
  const bcvBody = {
    moneda: 'USD',
    fuente: 'oficial',
    nombre: 'Dólar',
    compra: null,
    venta: null,
    promedio: 820.1018,
    fechaActualizacion: '2026-09-09T00:00:00-04:00'
  };

  it('reads the published rate without ever parsing it as a float', async () => {
    const provider = new BcvExchangeRateProvider({
      fetcher: async () => response(bcvBody)
    });

    const result = await provider.getSuggestedRate('USD', 'VES');

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      value: expect.objectContaining({
        baseCurrency: 'USD',
        quoteCurrency: 'VES',
        rateValue: 8201018,
        rateScale: 4,
        observedAt: new Date('2026-09-09T00:00:00-04:00')
      })
    }));
  });

  it('names the Venezuelan central bank as the source, so the operator sees who published it', async () => {
    const provider = new BcvExchangeRateProvider({ fetcher: async () => response(bcvBody) });

    const result = await provider.getSuggestedRate('USD', 'VES');

    expect(result.ok && result.value.source).toContain('BCV');
  });

  /**
   * La tasa no se guarda sola: el proveedor solo sugiere y una persona la
   * confirma. Fijar la vigencia desde el día publicado evita que una sugerencia
   * traída de madrugada se registre como vigente desde ayer.
   */
  it('offers the publication instant as the validity start', async () => {
    const provider = new BcvExchangeRateProvider({ fetcher: async () => response(bcvBody) });

    const result = await provider.getSuggestedRate('USD', 'VES');

    expect(result.ok && result.value.validFrom).toEqual(new Date('2026-09-09T00:00:00-04:00'));
    expect(result.ok && result.value.validUntil).toBeNull();
  });

  it('only answers for the pair the central bank publishes', async () => {
    const provider = new BcvExchangeRateProvider({ fetcher: async () => response(bcvBody) });

    await expect(provider.getSuggestedRate('EUR', 'VES')).resolves.toEqual(
      expect.objectContaining({
        ok: false, error: expect.objectContaining({ code: 'EXCHANGE_RATE_PAIR_UNSUPPORTED' })
      })
    );
  });

  it('fails closed when the terminal has no internet', async () => {
    const provider = new BcvExchangeRateProvider({
      fetcher: async () => { throw new Error('offline'); }
    });

    await expect(provider.getSuggestedRate('USD', 'VES')).resolves.toEqual(
      expect.objectContaining({
        ok: false, error: expect.objectContaining({ code: 'NETWORK_UNAVAILABLE' })
      })
    );
  });

  it('rejects a payload without a usable published rate', async () => {
    const provider = new BcvExchangeRateProvider({
      fetcher: async () => response({ ...bcvBody, promedio: null })
    });

    await expect(provider.getSuggestedRate('USD', 'VES')).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'EXCHANGE_RATE_PROVIDER_INVALID_RESPONSE' })
      })
    );
  });
});
