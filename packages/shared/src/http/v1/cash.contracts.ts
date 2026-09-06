import { problemDetailsSchema, type HttpContractV1 } from './common.contracts.js';

export type CashBalanceRequest = {
  readonly paymentMethodCode: string; readonly currencyCode: string;
  readonly amountMinorUnits: number;
};
export type OpenShiftRequest = {
  readonly cashRegisterId: string; readonly openingFunds: readonly CashBalanceRequest[];
};
export type RegisterCashMovementRequest = {
  readonly type: 'INCOME' | 'WITHDRAWAL'; readonly paymentMethodCode: string;
  readonly currencyCode: string; readonly amountMinorUnits: number; readonly reason: string;
};
export type CloseShiftRequest = {
  readonly declaredBalances: readonly CashBalanceRequest[];
  readonly reason?: string;
};
export type ShiftResponse = {
  readonly id: string; readonly cashRegisterId: string; readonly terminalId: string;
  readonly originNodeId: string; readonly status: 'OPEN' | 'CLOSED'; readonly version: number;
  readonly openedBy: string; readonly openedAt: string; readonly closedBy: string | null;
  readonly closedAt: string | null;
  readonly movements: readonly {
    readonly id: string; readonly type: string; readonly paymentMethodCode: string;
    readonly currencyCode: string; readonly amountMinorUnits: number; readonly reason: string;
    readonly registeredBy: string; readonly registeredAt: string;
  }[];
  readonly expectedBalances: readonly {
    readonly paymentMethodCode: string; readonly currencyCode: string; readonly minorUnits: number;
  }[];
  readonly closingBalances: readonly {
    readonly paymentMethodCode: string; readonly currencyCode: string;
    readonly expectedMinorUnits: number; readonly declaredMinorUnits: number;
    readonly differenceMinorUnits: number;
  }[] | null;
};

const id = { type: 'string', minLength: 1, maxLength: 128 } as const;
const currency = { type: 'string', pattern: '^[A-Z]{3,8}$' } as const;
const headers = {
  type: 'object', required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 128 } }
} as const;
const balance = {
  type: 'object', additionalProperties: false,
  required: ['paymentMethodCode', 'currencyCode', 'amountMinorUnits'],
  properties: {
    paymentMethodCode: id, currencyCode: currency,
    amountMinorUnits: { type: 'integer', minimum: 0 }
  }
} as const;
const shiftResponse = {
  type: 'object', additionalProperties: false,
  required: [
    'id', 'cashRegisterId', 'terminalId', 'originNodeId', 'status', 'version',
    'openedBy', 'openedAt', 'closedBy', 'closedAt', 'movements',
    'expectedBalances', 'closingBalances'
  ],
  properties: {
    id, cashRegisterId: id, terminalId: id, originNodeId: id,
    status: { type: 'string', enum: ['OPEN', 'CLOSED'] },
    version: { type: 'integer', minimum: 1 }, openedBy: id,
    openedAt: { type: 'string', format: 'date-time' },
    closedBy: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    closedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    movements: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: [
          'id', 'type', 'paymentMethodCode', 'currencyCode', 'amountMinorUnits',
          'reason', 'registeredBy', 'registeredAt'
        ],
        properties: {
          id, type: { type: 'string' }, paymentMethodCode: id, currencyCode: currency,
          amountMinorUnits: { type: 'integer', minimum: 0 }, reason: { type: 'string' },
          registeredBy: id, registeredAt: { type: 'string', format: 'date-time' }
        }
      }
    },
    expectedBalances: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['paymentMethodCode', 'currencyCode', 'minorUnits'],
        properties: { paymentMethodCode: id, currencyCode: currency, minorUnits: { type: 'integer' } }
      }
    },
    closingBalances: {
      anyOf: [{ type: 'null' }, {
        type: 'array', items: {
          type: 'object', additionalProperties: false,
          required: [
            'paymentMethodCode', 'currencyCode', 'expectedMinorUnits',
            'declaredMinorUnits', 'differenceMinorUnits'
          ],
          properties: {
            paymentMethodCode: id, currencyCode: currency,
            expectedMinorUnits: { type: 'integer' }, declaredMinorUnits: { type: 'integer' },
            differenceMinorUnits: { type: 'integer' }
          }
        }
      }]
    }
  }
} as const;
const responses = {
  200: shiftResponse, 400: problemDetailsSchema, 401: problemDetailsSchema,
  403: problemDetailsSchema, 404: problemDetailsSchema, 409: problemDetailsSchema,
  503: problemDetailsSchema
} as const;
const shiftParams = {
  type: 'object', additionalProperties: false, required: ['shiftId'], properties: { shiftId: id }
} as const;

export const openShiftContract = {
  method: 'POST', path: '/api/v1/cash/shifts', permission: 'cash.shift.open',
  idempotency: 'REQUIRED',
  schema: {
    headers,
    body: {
      type: 'object', additionalProperties: false, required: ['cashRegisterId', 'openingFunds'],
      properties: { cashRegisterId: id, openingFunds: { type: 'array', items: balance } }
    },
    response: { 201: shiftResponse, ...responses }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'CASH_REGISTER_NOT_FOUND',
    'SHIFT_ALREADY_OPEN', 'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const getOpenShiftContract = {
  method: 'GET', path: '/api/v1/cash-registers/:cashRegisterId/open-shift',
  permission: null, idempotency: 'NONE',
  schema: {
    params: {
      type: 'object', additionalProperties: false, required: ['cashRegisterId'],
      properties: { cashRegisterId: id }
    },
    response: { 200: shiftResponse, 401: problemDetailsSchema, 404: problemDetailsSchema }
  },
  errorCodes: ['UNAUTHORIZED', 'SHIFT_NOT_FOUND']
} as const satisfies HttpContractV1;

export const getShiftContract = {
  method: 'GET', path: '/api/v1/cash/shifts/:shiftId',
  permission: 'cash.shift.read', idempotency: 'NONE',
  schema: {
    params: shiftParams,
    response: {
      200: shiftResponse, 401: problemDetailsSchema, 403: problemDetailsSchema,
      404: problemDetailsSchema
    }
  },
  errorCodes: ['UNAUTHORIZED', 'FORBIDDEN', 'SHIFT_NOT_FOUND']
} as const satisfies HttpContractV1;

export const registerCashMovementContract = {
  method: 'POST', path: '/api/v1/cash/shifts/:shiftId/movements',
  permission: 'cash.movement.income|cash.movement.withdrawal', idempotency: 'REQUIRED',
  schema: {
    params: shiftParams, headers,
    body: {
      type: 'object', additionalProperties: false,
      required: ['type', 'paymentMethodCode', 'currencyCode', 'amountMinorUnits', 'reason'],
      properties: {
        type: { type: 'string', enum: ['INCOME', 'WITHDRAWAL'] },
        paymentMethodCode: id, currencyCode: currency,
        amountMinorUnits: { type: 'integer', minimum: 1 },
        reason: { type: 'string', minLength: 1, maxLength: 500 }
      }
    }, response: responses
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'SHIFT_NOT_FOUND',
    'CASH_WITHDRAWAL_INSUFFICIENT_FUNDS', 'IDEMPOTENCY_KEY_CONFLICT'
  ]
} as const satisfies HttpContractV1;

export const closeShiftContract = {
  method: 'POST', path: '/api/v1/cash/shifts/:shiftId/close',
  permission: 'cash.shift.close', idempotency: 'REQUIRED',
  schema: {
    params: shiftParams, headers,
    body: {
      type: 'object', additionalProperties: false, required: ['declaredBalances'],
      properties: {
        declaredBalances: { type: 'array', items: balance },
        reason: { type: 'string', minLength: 1, maxLength: 500 }
      }
    }, response: responses
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'SHIFT_NOT_FOUND',
    'SHIFT_INVALID_STATE', 'SHIFT_NEGATIVE_EXPECTED_REASON_REQUIRED', 'IDEMPOTENCY_KEY_CONFLICT'
  ]
} as const satisfies HttpContractV1;

export type CashRegisterResponse = { readonly id: string; readonly name: string };

const cashRegisterResponseSchema = {
  type: 'object', additionalProperties: false, required: ['id', 'name'],
  properties: { id: { type: 'string' }, name: { type: 'string' } }
} as const;

export const listCashRegistersContract = {
  method: 'GET', path: '/api/v1/cash-registers', permission: null, idempotency: 'NONE',
  schema: {
    response: {
      200: { type: 'array', items: cashRegisterResponseSchema },
      401: problemDetailsSchema
    }
  },
  errorCodes: ['UNAUTHORIZED']
} as const satisfies HttpContractV1;
