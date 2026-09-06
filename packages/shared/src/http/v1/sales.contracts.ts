import { problemDetailsSchema, type HttpContractV1 } from './common.contracts.js';

export type StartSaleRequest = { readonly currencyCode: string; readonly shiftId: string };
export type AddSaleItemRequest = {
  readonly barcode: string; readonly quantityScaled: number; readonly quantityScale: number;
};
export type ApplySaleDiscountRequest = {
  readonly itemId: string; readonly basisPoints: number; readonly reason: string;
};
export type RegisterSalePaymentsRequest = {
  readonly payments: readonly {
    readonly methodCode: string; readonly amountMinorUnits: number;
    readonly currencyCode: string; readonly exchangeRateId?: string;
  }[];
};
export type VoidSaleRequest = { readonly reason: string };
export type ReturnSaleRequest = { readonly reason: string };

/** `recipient: null` retira el snapshot; la venta anónima sigue siendo válida. */
export type SetSaleRecipientRequest = {
  readonly recipient: {
    readonly country: string; readonly type?: string | null; readonly value: string;
    readonly name?: string | null; readonly address?: string | null;
  } | null;
};

export type SaleResponse = {
  readonly id: string; readonly shiftId: string; readonly currencyCode: string;
  readonly terminalId: string; readonly originNodeId: string; readonly status: string;
  readonly version: number;
  readonly items: readonly {
    readonly id: string; readonly productId: string; readonly description: string;
    readonly quantityScaled: number; readonly quantityScale: number; readonly unitCode: string;
    readonly grossMinorUnits: number; readonly discountMinorUnits: number;
    readonly taxableMinorUnits: number; readonly taxMinorUnits: number;
    readonly totalMinorUnits: number; readonly discountBasisPoints: number | null;
  }[];
  readonly payments: readonly {
    readonly id: string; readonly methodCode: string; readonly methodKind: string;
    readonly currencyCode: string; readonly amountMinorUnits: number;
    readonly amountInSaleCurrencyMinorUnits: number; readonly exchangeRateId: string | null;
  }[];
  readonly subtotalMinorUnits: number; readonly discountTotalMinorUnits: number;
  readonly taxableBaseMinorUnits: number; readonly taxTotalMinorUnits: number;
  readonly financialTransactionTaxMinorUnits: number; readonly totalMinorUnits: number;
  readonly paidTotalMinorUnits: number; readonly balanceMinorUnits: number;
  readonly completedAt: string | null; readonly voidedAt: string | null;
  readonly voidReason: string | null;
  readonly recipient: {
    readonly country: string; readonly type: string; readonly value: string;
    readonly normalizedValue: string; readonly name: string | null;
    readonly address: string | null;
  } | null;
};

export type SaleReturnResponse = {
  readonly id: string; readonly saleId: string; readonly originalDocumentId: string;
  readonly creditNoteId: string; readonly creditNoteStatus: string;
  readonly creditNoteFiscalNumber: string | null; readonly shiftId: string;
  readonly refundMinorUnits: number; readonly currencyCode: string;
  readonly paymentMethodCode: string; readonly reason: string; readonly occurredAt: string;
  readonly lines: readonly {
    readonly id: string; readonly saleItemId: string; readonly productId: string;
    readonly stockItemId: string; readonly batchId: string | null;
    readonly quantityScaled: number; readonly quantityScale: number;
    readonly unitCostMinorUnits: number | null; readonly costCurrencyCode: string | null;
  }[];
};

const id = { type: 'string', minLength: 1, maxLength: 128 } as const;
const currency = { type: 'string', pattern: '^[A-Z]{3,8}$' } as const;
const integerMoney = { type: 'integer', minimum: 0 } as const;
const idempotencyHeaders = {
  type: 'object', required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 128 } }
} as const;
const saleParams = {
  type: 'object', additionalProperties: false, required: ['saleId'],
  properties: { saleId: id }
} as const;
const saleItemParams = {
  type: 'object', additionalProperties: false, required: ['saleId', 'itemId'],
  properties: { saleId: id, itemId: id }
} as const;

const identification = { type: 'string', minLength: 1, maxLength: 64 } as const;
const recipientText = { type: 'string', minLength: 1, maxLength: 200 } as const;
const recipientSchema = {
  type: 'object', additionalProperties: false,
  required: ['country', 'type', 'value', 'normalizedValue', 'name', 'address'],
  properties: {
    country: { type: 'string', pattern: '^[A-Z]{2}$' },
    type: { type: 'string', minLength: 1, maxLength: 32 },
    value: identification, normalizedValue: identification,
    name: { anyOf: [recipientText, { type: 'null' }] },
    address: { anyOf: [recipientText, { type: 'null' }] }
  }
} as const;

const saleResponseSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'id', 'shiftId', 'currencyCode', 'terminalId', 'originNodeId', 'status', 'version',
    'items', 'payments', 'subtotalMinorUnits', 'discountTotalMinorUnits',
    'taxableBaseMinorUnits', 'taxTotalMinorUnits', 'financialTransactionTaxMinorUnits',
    'totalMinorUnits', 'paidTotalMinorUnits', 'balanceMinorUnits', 'completedAt',
    'voidedAt', 'voidReason', 'recipient'
  ],
  properties: {
    id, shiftId: id, currencyCode: currency, terminalId: id, originNodeId: id,
    status: { type: 'string', enum: ['DRAFT', 'COMPLETED', 'VOIDED'] },
    version: { type: 'integer', minimum: 1 },
    items: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: [
          'id', 'productId', 'description', 'quantityScaled', 'quantityScale', 'unitCode',
          'grossMinorUnits', 'discountMinorUnits', 'taxableMinorUnits', 'taxMinorUnits',
          'totalMinorUnits', 'discountBasisPoints'
        ],
        properties: {
          id, productId: id, description: { type: 'string' },
          quantityScaled: { type: 'integer', minimum: 1 },
          quantityScale: { type: 'integer', minimum: 0 }, unitCode: { type: 'string' },
          grossMinorUnits: integerMoney, discountMinorUnits: integerMoney,
          taxableMinorUnits: integerMoney, taxMinorUnits: integerMoney,
          totalMinorUnits: integerMoney,
          discountBasisPoints: { anyOf: [{ type: 'integer' }, { type: 'null' }] }
        }
      }
    },
    payments: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: [
          'id', 'methodCode', 'methodKind', 'currencyCode', 'amountMinorUnits',
          'amountInSaleCurrencyMinorUnits', 'exchangeRateId'
        ],
        properties: {
          id, methodCode: { type: 'string' }, methodKind: { type: 'string' },
          currencyCode: currency, amountMinorUnits: integerMoney,
          amountInSaleCurrencyMinorUnits: integerMoney,
          exchangeRateId: { anyOf: [{ type: 'string' }, { type: 'null' }] }
        }
      }
    },
    subtotalMinorUnits: integerMoney, discountTotalMinorUnits: integerMoney,
    taxableBaseMinorUnits: integerMoney, taxTotalMinorUnits: integerMoney,
    financialTransactionTaxMinorUnits: integerMoney, totalMinorUnits: integerMoney,
    paidTotalMinorUnits: integerMoney,
    balanceMinorUnits: { type: 'integer' },
    completedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    voidedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    voidReason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    recipient: { anyOf: [recipientSchema, { type: 'null' }] }
  }
} as const;

const saleReturnResponseSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'id', 'saleId', 'originalDocumentId', 'creditNoteId', 'creditNoteStatus',
    'creditNoteFiscalNumber', 'shiftId', 'refundMinorUnits', 'currencyCode',
    'paymentMethodCode', 'reason', 'occurredAt', 'lines'
  ],
  properties: {
    id, saleId: id, originalDocumentId: id, creditNoteId: id,
    creditNoteStatus: { type: 'string' },
    creditNoteFiscalNumber: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    shiftId: id, refundMinorUnits: { type: 'integer', minimum: 1 }, currencyCode: currency,
    paymentMethodCode: id, reason: { type: 'string', minLength: 1, maxLength: 500 },
    occurredAt: { type: 'string', format: 'date-time' },
    lines: {
      type: 'array', minItems: 1, items: {
        type: 'object', additionalProperties: false,
        required: [
          'id', 'saleItemId', 'productId', 'stockItemId', 'batchId', 'quantityScaled',
          'quantityScale', 'unitCostMinorUnits', 'costCurrencyCode'
        ],
        properties: {
          id, saleItemId: id, productId: id, stockItemId: id,
          batchId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          quantityScaled: { type: 'integer', minimum: 1 }, quantityScale: { type: 'integer', minimum: 0 },
          unitCostMinorUnits: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
          costCurrencyCode: { anyOf: [currency, { type: 'null' }] }
        }
      }
    }
  }
} as const;

const commandResponses = {
  200: saleResponseSchema, 400: problemDetailsSchema, 401: problemDetailsSchema,
  403: problemDetailsSchema, 404: problemDetailsSchema, 409: problemDetailsSchema,
  503: problemDetailsSchema
} as const;
const commonCommandErrors = [
  'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'SALE_NOT_FOUND',
  'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
] as const;

export const startSaleContract = {
  method: 'POST', path: '/api/v1/sales', permission: null, idempotency: 'REQUIRED',
  schema: {
    headers: idempotencyHeaders,
    body: {
      type: 'object', additionalProperties: false, required: ['currencyCode', 'shiftId'],
      properties: { currencyCode: currency, shiftId: id }
    },
    response: { 201: saleResponseSchema, ...commandResponses }
  },
  errorCodes: [...commonCommandErrors, 'SHIFT_NOT_FOUND', 'SHIFT_INVALID_STATE', 'SHIFT_OWNERSHIP_MISMATCH']
} as const satisfies HttpContractV1;

export const getSaleContract = {
  method: 'GET', path: '/api/v1/sales/:saleId', permission: null, idempotency: 'NONE',
  schema: { params: saleParams, response: { 200: saleResponseSchema, 401: problemDetailsSchema, 404: problemDetailsSchema } },
  errorCodes: ['UNAUTHORIZED', 'SALE_NOT_FOUND']
} as const satisfies HttpContractV1;

export const addSaleItemContract = {
  method: 'POST', path: '/api/v1/sales/:saleId/items', permission: null, idempotency: 'REQUIRED',
  schema: {
    params: saleParams, headers: idempotencyHeaders,
    body: {
      type: 'object', additionalProperties: false,
      required: ['barcode', 'quantityScaled', 'quantityScale'],
      properties: {
        barcode: id, quantityScaled: { type: 'integer', minimum: 1 },
        quantityScale: { type: 'integer', minimum: 0, maximum: 12 }
      }
    }, response: commandResponses
  },
  errorCodes: [...commonCommandErrors, 'PRODUCT_NOT_FOUND', 'QUANTITY_SCALE_MISMATCH']
} as const satisfies HttpContractV1;

export const removeSaleItemContract = {
  method: 'DELETE', path: '/api/v1/sales/:saleId/items/:itemId', permission: null,
  idempotency: 'REQUIRED',
  schema: { params: saleItemParams, headers: idempotencyHeaders, response: commandResponses },
  errorCodes: [...commonCommandErrors, 'SALE_ITEM_NOT_FOUND']
} as const satisfies HttpContractV1;

export const applySaleDiscountContract = {
  method: 'POST', path: '/api/v1/sales/:saleId/discounts',
  permission: 'sale.apply_discount', idempotency: 'REQUIRED',
  schema: {
    params: saleParams, headers: idempotencyHeaders,
    body: {
      type: 'object', additionalProperties: false, required: ['itemId', 'basisPoints', 'reason'],
      properties: {
        itemId: id, basisPoints: { type: 'integer', minimum: 1, maximum: 10000 },
        reason: { type: 'string', minLength: 1, maxLength: 500 }
      }
    }, response: commandResponses
  },
  errorCodes: [...commonCommandErrors, 'FORBIDDEN', 'POLICY_NOT_CONFIGURED', 'DISCOUNT_EXCEEDS_POLICY']
} as const satisfies HttpContractV1;

export const registerSalePaymentsContract = {
  method: 'POST', path: '/api/v1/sales/:saleId/payments', permission: null,
  idempotency: 'REQUIRED',
  schema: {
    params: saleParams, headers: idempotencyHeaders,
    body: {
      type: 'object', additionalProperties: false, required: ['payments'],
      properties: {
        payments: {
          type: 'array', minItems: 1, items: {
            type: 'object', additionalProperties: false,
            required: ['methodCode', 'amountMinorUnits', 'currencyCode'],
            properties: {
              methodCode: id, amountMinorUnits: { type: 'integer', minimum: 1 },
              currencyCode: currency, exchangeRateId: id
            }
          }
        }
      }
    }, response: commandResponses
  },
  errorCodes: [
    ...commonCommandErrors, 'POLICY_NOT_CONFIGURED', 'PAYMENT_METHOD_NOT_FOUND',
    'EXCHANGE_RATE_REQUIRED', 'EXCHANGE_RATE_NOT_FOUND', 'SALE_PAYMENT_TOTAL_MISMATCH'
  ]
} as const satisfies HttpContractV1;

export const completeSaleContract = {
  method: 'POST', path: '/api/v1/sales/:saleId/complete', permission: null,
  idempotency: 'REQUIRED',
  schema: { params: saleParams, headers: idempotencyHeaders, response: commandResponses },
  errorCodes: [...commonCommandErrors, 'SALE_PAYMENT_TOTAL_MISMATCH', 'SALE_INVALID_STATE']
} as const satisfies HttpContractV1;

/**
 * La identificación del receptor no tiene permiso propio: comparte la frontera
 * de sesión de la edición ordinaria de la venta (ADR-0018).
 */
export const setSaleRecipientContract = {
  method: 'PUT', path: '/api/v1/sales/:saleId/recipient', permission: null,
  idempotency: 'REQUIRED',
  schema: {
    params: saleParams, headers: idempotencyHeaders,
    body: {
      type: 'object', additionalProperties: false, required: ['recipient'],
      properties: {
        recipient: {
          anyOf: [{
            type: 'object', additionalProperties: false,
            required: ['country', 'value'],
            properties: {
              country: { type: 'string', minLength: 2, maxLength: 2 },
              type: { type: 'string', minLength: 1, maxLength: 32 },
              value: identification,
              name: { anyOf: [recipientText, { type: 'null' }] },
              address: { anyOf: [recipientText, { type: 'null' }] }
            }
          }, { type: 'null' }]
        }
      }
    }, response: commandResponses
  },
  errorCodes: [
    ...commonCommandErrors, 'SALE_INVALID_STATE', 'SALE_RECIPIENT_COUNTRY_INVALID',
    'SALE_RECIPIENT_TYPE_INVALID', 'SALE_RECIPIENT_IDENTIFICATION_REQUIRED',
    'SALE_RECIPIENT_IDENTIFICATION_INVALID'
  ]
} as const satisfies HttpContractV1;

export const voidSaleContract = {
  method: 'POST', path: '/api/v1/sales/:saleId/void', permission: 'sale.void',
  idempotency: 'REQUIRED',
  schema: {
    params: saleParams, headers: idempotencyHeaders,
    body: {
      type: 'object', additionalProperties: false, required: ['reason'],
      properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } }
    }, response: commandResponses
  },
  errorCodes: [...commonCommandErrors, 'FORBIDDEN', 'SALE_INVALID_STATE']
} as const satisfies HttpContractV1;

export const returnSaleContract = {
  method: 'POST', path: '/api/v1/sales/:saleId/return', permission: 'sale.return',
  idempotency: 'REQUIRED',
  schema: {
    params: saleParams, headers: idempotencyHeaders,
    body: {
      type: 'object', additionalProperties: false, required: ['reason'],
      properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } }
    },
    response: { 201: saleReturnResponseSchema, 200: saleReturnResponseSchema,
      400: problemDetailsSchema, 401: problemDetailsSchema, 403: problemDetailsSchema,
      404: problemDetailsSchema, 409: problemDetailsSchema, 503: problemDetailsSchema }
  },
  errorCodes: [
    ...commonCommandErrors, 'FORBIDDEN', 'SALE_INVALID_STATE',
    'SALE_RETURN_REASON_REQUIRED', 'SALE_RETURN_MIXED_PAYMENT_UNSUPPORTED',
    'SALE_ALREADY_RETURNED', 'SALE_RETURN_DOCUMENT_NOT_ISSUED', 'SHIFT_NOT_OPEN',
    'STOCK_ITEM_NOT_FOUND', 'SALE_RETURN_STOCK_NOT_RESTORABLE',
    'FISCAL_DOCUMENT_NOT_FOUND', 'FISCAL_RECONCILIATION_REQUIRED',
    'FISCAL_DOCUMENT_FAILED'
  ]
} as const satisfies HttpContractV1;

export type SaleHistoryVersionResponse = {
  readonly version: number;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly actorId: string;
  readonly status: 'DRAFT' | 'COMPLETED' | 'VOIDED' | 'RETURNED';
  readonly itemIds: readonly string[];
  readonly discountTotalMinorUnits: number;
  readonly paymentTotalMinorUnits: number;
  readonly totalMinorUnits: number | null;
  readonly recipientAttached: boolean;
  readonly refundMinorUnits: number | null;
};

const saleHistoryVersionSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'version', 'eventType', 'occurredAt', 'actorId', 'status', 'itemIds',
    'discountTotalMinorUnits', 'paymentTotalMinorUnits', 'totalMinorUnits',
    'recipientAttached', 'refundMinorUnits'
  ],
  properties: {
    version: { type: 'integer', minimum: 1 }, eventType: { type: 'string' },
    occurredAt: { type: 'string', format: 'date-time' }, actorId: id,
    status: { enum: ['DRAFT', 'COMPLETED', 'VOIDED', 'RETURNED'] },
    itemIds: { type: 'array', items: id },
    discountTotalMinorUnits: { type: 'integer' }, paymentTotalMinorUnits: { type: 'integer' },
    totalMinorUnits: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    recipientAttached: { type: 'boolean' },
    refundMinorUnits: { anyOf: [{ type: 'integer' }, { type: 'null' }] }
  }
} as const;

export const getSaleHistoryContract = {
  method: 'GET', path: '/api/v1/sales/:saleId/history',
  permission: 'sale.history.read', idempotency: 'NONE',
  schema: {
    params: saleParams,
    querystring: {
      type: 'object', additionalProperties: false,
      properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } }
    },
    response: {
      200: { type: 'array', items: saleHistoryVersionSchema },
      400: problemDetailsSchema, 401: problemDetailsSchema, 403: problemDetailsSchema,
      404: problemDetailsSchema
    }
  },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'SALE_HISTORY_NOT_FOUND']
} as const satisfies HttpContractV1;
