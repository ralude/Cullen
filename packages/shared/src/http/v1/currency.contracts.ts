import { problemDetailsSchema, type HttpContractV1 } from './common.contracts.js';

export type UpdateExchangeRateRequest = {
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly rateValue: number;
  readonly rateScale: number;
  readonly source: string;
  readonly validFrom: string;
  readonly validUntil?: string | null;
  readonly reason: string;
};

export type ExchangeRateResponse = {
  readonly id: string;
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly rateValue: number;
  readonly rateScale: number;
  readonly source: string;
  readonly validFrom: string;
  readonly validUntil: string | null;
  readonly registeredBy: string;
};

export type ExchangeRateSuggestionResponse = {
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly rateValue: number;
  readonly rateScale: number;
  readonly source: string;
  readonly observedAt: string;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
};

export type MixedPaymentRequest = {
  readonly targetCurrency: string;
  readonly payments: readonly {
    readonly amountMinorUnits: number;
    readonly currencyCode: string;
  }[];
};

const currencyCode = { type: 'string', pattern: '^[A-Z]{3,8}$' } as const;
const rateResponse = {
  type: 'object', additionalProperties: false,
  required: [
    'id', 'baseCurrency', 'quoteCurrency', 'rateValue', 'rateScale',
    'source', 'validFrom', 'validUntil', 'registeredBy'
  ],
  properties: {
    id: { type: 'string' }, baseCurrency: currencyCode, quoteCurrency: currencyCode,
    rateValue: { type: 'integer', minimum: 1 }, rateScale: { type: 'integer', minimum: 0 },
    source: { type: 'string' }, validFrom: { type: 'string', format: 'date-time' },
    validUntil: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    registeredBy: { type: 'string' }
  }
} as const;

export const updateExchangeRateContract = {
  method: 'POST', path: '/api/v1/currency/exchange-rates',
  permission: 'currency.rate.update', idempotency: 'REQUIRED',
  schema: {
    headers: {
      type: 'object', required: ['idempotency-key'],
      properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 128 } }
    },
    body: {
      type: 'object', additionalProperties: false,
      required: [
        'baseCurrency', 'quoteCurrency', 'rateValue', 'rateScale', 'source',
        'validFrom', 'reason'
      ],
      properties: {
        baseCurrency: currencyCode, quoteCurrency: currencyCode,
        rateValue: { type: 'integer', minimum: 1 },
        rateScale: { type: 'integer', minimum: 0, maximum: 12 },
        source: { type: 'string', minLength: 1, maxLength: 200 },
        validFrom: { type: 'string', format: 'date-time' },
        validUntil: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
        reason: { type: 'string', minLength: 1, maxLength: 500 }
      }
    },
    response: {
      201: rateResponse, 200: rateResponse, 400: problemDetailsSchema,
      401: problemDetailsSchema, 403: problemDetailsSchema,
      409: problemDetailsSchema, 503: problemDetailsSchema
    }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN',
    'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const getExchangeRateHistoryContract = {
  method: 'GET', path: '/api/v1/currency/exchange-rates',
  permission: null, idempotency: 'NONE',
  schema: {
    querystring: {
      type: 'object', additionalProperties: false,
      required: ['baseCurrency', 'quoteCurrency'],
      properties: {
        baseCurrency: currencyCode, quoteCurrency: currencyCode,
        limit: { type: 'integer', minimum: 1, maximum: 500 }
      }
    },
    response: {
      200: { type: 'array', items: rateResponse },
      400: problemDetailsSchema, 401: problemDetailsSchema
    }
  },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'CURRENCY_HISTORY_LIMIT_INVALID']
} as const satisfies HttpContractV1;

export const getSuggestedExchangeRateContract = {
  method: 'GET', path: '/api/v1/currency/exchange-rates/suggestion',
  permission: null, idempotency: 'NONE',
  schema: {
    querystring: {
      type: 'object', additionalProperties: false,
      required: ['baseCurrency', 'quoteCurrency'],
      properties: { baseCurrency: currencyCode, quoteCurrency: currencyCode }
    },
    response: {
      200: {
        type: 'object', additionalProperties: false, required: ['suggestion'],
        properties: {
          suggestion: {
            type: 'object', additionalProperties: false,
            required: [
              'baseCurrency', 'quoteCurrency', 'rateValue', 'rateScale', 'source',
              'observedAt', 'validFrom', 'validUntil'
            ],
            properties: {
              baseCurrency: currencyCode, quoteCurrency: currencyCode,
              rateValue: { type: 'integer', minimum: 1 },
              rateScale: { type: 'integer', minimum: 0, maximum: 8 },
              source: { type: 'string', minLength: 1 },
              observedAt: { type: 'string', format: 'date-time' },
              validFrom: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
              validUntil: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] }
            }
          }
        }
      },
      400: problemDetailsSchema, 401: problemDetailsSchema, 404: problemDetailsSchema,
      503: problemDetailsSchema
    }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'EXCHANGE_RATE_PROVIDER_NOT_CONFIGURED',
    'EXCHANGE_RATE_PROVIDER_INVALID_RESPONSE', 'EXCHANGE_RATE_PAIR_UNSUPPORTED',
    'NETWORK_UNAVAILABLE'
  ]
} as const satisfies HttpContractV1;

export const getCurrentExchangeRateContract = {
  method: 'GET', path: '/api/v1/currency/exchange-rates/current',
  permission: null, idempotency: 'NONE',
  schema: {
    querystring: {
      type: 'object', additionalProperties: false,
      required: ['baseCurrency', 'quoteCurrency'],
      properties: { baseCurrency: currencyCode, quoteCurrency: currencyCode }
    },
    response: {
      200: rateResponse, 400: problemDetailsSchema,
      401: problemDetailsSchema, 404: problemDetailsSchema
    }
  },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'CURRENCY_RATE_MISSING']
} as const satisfies HttpContractV1;

export const calculateMixedPaymentTotalsContract = {
  method: 'POST', path: '/api/v1/currency/mixed-payment-totals',
  permission: null, idempotency: 'NONE',
  schema: {
    body: {
      type: 'object', additionalProperties: false, required: ['targetCurrency', 'payments'],
      properties: {
        targetCurrency: currencyCode,
        payments: {
          type: 'array', minItems: 1,
          items: {
            type: 'object', additionalProperties: false,
            required: ['amountMinorUnits', 'currencyCode'],
            properties: {
              amountMinorUnits: { type: 'integer', minimum: 0 }, currencyCode
            }
          }
        }
      }
    },
    response: {
      200: {
        type: 'object', additionalProperties: false,
        required: ['totalMinorUnits', 'totalCurrency'],
        properties: { totalMinorUnits: { type: 'integer' }, totalCurrency: currencyCode }
      },
      400: problemDetailsSchema, 401: problemDetailsSchema, 404: problemDetailsSchema
    }
  },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'CURRENCY_RATE_MISSING']
} as const satisfies HttpContractV1;

export type PaymentMethodResponse = {
  readonly code: string;
  readonly name: string;
  readonly kind: 'CASH' | 'CARD' | 'MOBILE_PAYMENT' | 'BANK_TRANSFER' | 'OTHER';
  readonly currencyCode: string;
  /** Tasa de IGTF que cobra este método; 0 si no está gravado. Ver ADR-0031. */
  readonly financialTransactionTaxBasisPoints: number;
};

const paymentMethodResponseSchema = {
  type: 'object', additionalProperties: false,
  required: ['code', 'name', 'kind', 'currencyCode', 'financialTransactionTaxBasisPoints'],
  properties: {
    code: { type: 'string' }, name: { type: 'string' },
    kind: { type: 'string', enum: ['CASH', 'CARD', 'MOBILE_PAYMENT', 'BANK_TRANSFER', 'OTHER'] },
    currencyCode,
    financialTransactionTaxBasisPoints: { type: 'integer', minimum: 0 }
  }
} as const;

export const listPaymentMethodsContract = {
  method: 'GET', path: '/api/v1/currency/payment-methods', permission: null, idempotency: 'NONE',
  schema: {
    response: {
      200: { type: 'array', items: paymentMethodResponseSchema },
      401: problemDetailsSchema
    }
  },
  errorCodes: ['UNAUTHORIZED']
} as const satisfies HttpContractV1;
