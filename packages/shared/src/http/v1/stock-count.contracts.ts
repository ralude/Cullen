import { problemDetailsSchema, type HttpContractV1 } from './common.contracts.js';

export type StockCountStatusResponse = 'OPEN' | 'COUNTED' | 'APPROVED' | 'REJECTED';

export type StockCountLineResponse = {
  readonly id: string;
  readonly productId: string;
  readonly stockItemId: string;
  readonly batchId: string | null;
  readonly countedQuantityScaled: number;
  readonly quantityScale: number;
};

export type StockCountDifferenceResponse = {
  readonly lineId: string;
  readonly stockItemId: string;
  readonly batchId: string | null;
  readonly quantityScale: number;
  readonly expectedScaled: number;
  readonly countedScaled: number;
  readonly differenceScaled: number;
};

export type StockCountResponse = {
  readonly id: string;
  readonly originNodeId: string;
  readonly status: StockCountStatusResponse;
  readonly openedBy: string;
  readonly openedAt: string;
  readonly lines: readonly StockCountLineResponse[];
  readonly differences: readonly StockCountDifferenceResponse[] | null;
  readonly closedAt: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly rejectedBy: string | null;
  readonly rejectedAt: string | null;
  readonly rejectionReason: string | null;
  readonly version: number;
};

export type OpenStockCountRequest = { readonly reason: string };
export type RecordStockCountLineRequest = {
  readonly productId: string;
  readonly quantity: string;
  readonly batchId?: string;
};
export type CloseStockCountRequest = { readonly reason: string };
export type ApproveStockCountRequest = { readonly reason: string };
export type RejectStockCountRequest = { readonly reason: string };

const id = { type: 'string', minLength: 1, maxLength: 128 } as const;
const headers = {
  type: 'object', required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 128 } }
} as const;
const reasonBody = {
  type: 'object', additionalProperties: false, required: ['reason'],
  properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } }
} as const;
const stockCountParams = {
  type: 'object', additionalProperties: false, required: ['stockCountId'],
  properties: { stockCountId: id }
} as const;

const lineSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'productId', 'stockItemId', 'batchId', 'countedQuantityScaled', 'quantityScale'],
  properties: {
    id, productId: id, stockItemId: id,
    batchId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    countedQuantityScaled: { type: 'integer', minimum: 0 },
    quantityScale: { type: 'integer', minimum: 0 }
  }
} as const;

const differenceSchema = {
  type: 'object', additionalProperties: false,
  required: ['lineId', 'stockItemId', 'batchId', 'quantityScale', 'expectedScaled', 'countedScaled', 'differenceScaled'],
  properties: {
    lineId: id, stockItemId: id,
    batchId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    quantityScale: { type: 'integer', minimum: 0 },
    expectedScaled: { type: 'integer' }, countedScaled: { type: 'integer', minimum: 0 },
    differenceScaled: { type: 'integer' }
  }
} as const;

const stockCountResponseSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'id', 'originNodeId', 'status', 'openedBy', 'openedAt', 'lines', 'differences',
    'closedAt', 'approvedBy', 'approvedAt', 'rejectedBy', 'rejectedAt', 'rejectionReason', 'version'
  ],
  properties: {
    id, originNodeId: id, status: { type: 'string', enum: ['OPEN', 'COUNTED', 'APPROVED', 'REJECTED'] },
    openedBy: id, openedAt: { type: 'string', format: 'date-time' },
    lines: { type: 'array', items: lineSchema },
    differences: { anyOf: [{ type: 'array', items: differenceSchema }, { type: 'null' }] },
    closedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    approvedBy: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    approvedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    rejectedBy: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    rejectedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    rejectionReason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    version: { type: 'integer', minimum: 1 }
  }
} as const;

const mutationResponses = {
  200: stockCountResponseSchema, 400: problemDetailsSchema, 401: problemDetailsSchema,
  403: problemDetailsSchema, 404: problemDetailsSchema, 409: problemDetailsSchema,
  503: problemDetailsSchema
} as const;

export const openStockCountContract = {
  method: 'POST', path: '/api/v1/inventory/counts',
  permission: 'inventory.count.perform', idempotency: 'REQUIRED',
  schema: { headers, body: reasonBody, response: { 201: stockCountResponseSchema, ...mutationResponses } },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY']
} as const satisfies HttpContractV1;

export const recordStockCountLineContract = {
  method: 'POST', path: '/api/v1/inventory/counts/:stockCountId/lines',
  permission: 'inventory.count.perform', idempotency: 'REQUIRED',
  schema: {
    params: stockCountParams, headers,
    body: {
      type: 'object', additionalProperties: false, required: ['productId', 'quantity'],
      properties: {
        productId: id, quantity: { type: 'string', pattern: '^\\d+([.,]\\d+)?$', maxLength: 24 },
        batchId: id
      }
    },
    response: mutationResponses
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'STOCK_COUNT_NOT_FOUND',
    'STOCK_ITEM_NOT_FOUND', 'STOCK_BATCH_REQUIRED', 'STOCK_BATCH_NOT_ACCEPTED', 'STOCK_BATCH_NOT_FOUND',
    'QUANTITY_INVALID_TEXT', 'QUANTITY_SCALE_EXCEEDED', 'STOCK_COUNT_LINE_QUANTITY_INVALID',
    'STOCK_COUNT_NOT_OPEN', 'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const closeStockCountContract = {
  method: 'POST', path: '/api/v1/inventory/counts/:stockCountId/close',
  permission: 'inventory.count.perform', idempotency: 'REQUIRED',
  schema: { params: stockCountParams, headers, body: reasonBody, response: mutationResponses },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'STOCK_COUNT_NOT_FOUND',
    'STOCK_ITEM_NOT_FOUND', 'STOCK_COUNT_NOT_OPEN', 'STOCK_COUNT_EMPTY',
    'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const approveStockCountContract = {
  method: 'POST', path: '/api/v1/inventory/counts/:stockCountId/approve',
  permission: 'inventory.count.approve', idempotency: 'REQUIRED',
  schema: { params: stockCountParams, headers, body: reasonBody, response: mutationResponses },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'STOCK_COUNT_NOT_FOUND',
    'STOCK_ITEM_NOT_FOUND', 'STOCK_COUNT_NOT_COUNTED', 'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const rejectStockCountContract = {
  method: 'POST', path: '/api/v1/inventory/counts/:stockCountId/reject',
  permission: 'inventory.count.approve', idempotency: 'REQUIRED',
  schema: { params: stockCountParams, headers, body: reasonBody, response: mutationResponses },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'STOCK_COUNT_NOT_FOUND',
    'STOCK_COUNT_NOT_COUNTED', 'STOCK_COUNT_REJECTION_REASON_REQUIRED',
    'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const getStockCountContract = {
  method: 'GET', path: '/api/v1/inventory/counts/:stockCountId', permission: 'inventory.count.read', idempotency: 'NONE',
  schema: {
    params: stockCountParams,
    response: { 200: stockCountResponseSchema, 401: problemDetailsSchema, 404: problemDetailsSchema }
  },
  errorCodes: ['UNAUTHORIZED', 'STOCK_COUNT_NOT_FOUND']
} as const satisfies HttpContractV1;

export const listStockCountsContract = {
  method: 'GET', path: '/api/v1/inventory/counts', permission: 'inventory.count.read', idempotency: 'NONE',
  schema: {
    querystring: {
      type: 'object', additionalProperties: false,
      properties: { status: { type: 'string', enum: ['OPEN', 'COUNTED', 'APPROVED', 'REJECTED'] } }
    },
    response: { 200: { type: 'array', items: stockCountResponseSchema }, 401: problemDetailsSchema }
  },
  errorCodes: ['UNAUTHORIZED']
} as const satisfies HttpContractV1;
