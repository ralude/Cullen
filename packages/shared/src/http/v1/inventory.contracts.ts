import { problemDetailsSchema, type HttpContractV1 } from './common.contracts.js';

/**
 * La recepción solo declara negocio: qué producto, cuánto, de quién y con qué
 * recibo. El artículo de inventario, su unidad, su escala y si maneja lotes los
 * deriva la aplicación desde el catálogo o desde el artículo ya existente.
 */
export type ReceivePurchaseRequest = {
  readonly productId: string; readonly quantity: string;
  readonly supplierId: string; readonly receiptId: string; readonly reason: string;
  readonly lot?: { readonly lotNumber: string; readonly expiresAt?: string };
};
export type RegisterStockAdjustmentRequest = {
  readonly type: 'WASTE' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';
  readonly quantityScaled: number; readonly quantityScale: number;
  readonly batchId?: string; readonly reason: string; readonly referenceId: string;
};
export type KardexDto = {
  readonly id: string;
  readonly productId: string; readonly unitCode: string; readonly quantityScale: number;
  readonly currentBalanceScaled: number;
  readonly batches: readonly { readonly id: string; readonly lotNumber: string; readonly expiresAt: string | null }[];
  readonly movements: readonly {
    readonly id: string; readonly type: string; readonly direction: 'IN' | 'OUT';
    readonly quantityScaled: number; readonly quantityScale: number; readonly batchId: string | null;
    readonly actorId: string; readonly reason: string; readonly referenceId: string;
    readonly occurredAt: string;
  }[];
};

const id = { type: 'string', minLength: 1, maxLength: 128 } as const;
const headers = {
  type: 'object', required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 128 } }
} as const;
const movement = {
  type: 'object', additionalProperties: false,
  required: [
    'id', 'type', 'direction', 'quantityScaled', 'quantityScale', 'batchId',
    'actorId', 'reason', 'referenceId', 'occurredAt'
  ],
  properties: {
    id, type: { type: 'string' }, direction: { type: 'string', enum: ['IN', 'OUT'] },
    quantityScaled: { type: 'integer', minimum: 1 },
    quantityScale: { type: 'integer', minimum: 0 },
    batchId: { anyOf: [{ type: 'string' }, { type: 'null' }] }, actorId: id,
    reason: { type: 'string' }, referenceId: id,
    occurredAt: { type: 'string', format: 'date-time' }
  }
} as const;
const stockItem = {
  type: 'object', additionalProperties: false,
  required: [
    'id', 'productId', 'unitCode', 'quantityScale', 'tracksBatches',
    'balanceScaled', 'movements'
  ],
  properties: {
    id, productId: id, unitCode: { type: 'string' },
    quantityScale: { type: 'integer', minimum: 0 }, tracksBatches: { type: 'boolean' },
    balanceScaled: { type: 'integer' }, movements: { type: 'array', items: movement }
  }
} as const;
const responses = {
  200: stockItem, 400: problemDetailsSchema, 401: problemDetailsSchema,
  403: problemDetailsSchema, 404: problemDetailsSchema, 409: problemDetailsSchema,
  503: problemDetailsSchema
} as const;

export const receivePurchaseContract = {
  method: 'POST', path: '/api/v1/inventory/receipts',
  permission: 'inventory.purchase.receive', idempotency: 'REQUIRED',
  schema: {
    headers,
    body: {
      type: 'object', additionalProperties: false,
      required: ['productId', 'quantity', 'supplierId', 'receiptId', 'reason'],
      properties: {
        productId: id,
        quantity: { type: 'string', pattern: '^\\d+([.,]\\d+)?$', maxLength: 24 },
        supplierId: id, receiptId: id, reason: { type: 'string', minLength: 1, maxLength: 500 },
        lot: {
          type: 'object', additionalProperties: false, required: ['lotNumber'],
          properties: {
            lotNumber: { type: 'string', minLength: 1, maxLength: 128 },
            expiresAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    }, response: { 201: stockItem, ...responses }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'STOCK_BATCH_REQUIRED',
    'STOCK_BATCH_NOT_ACCEPTED', 'PRODUCT_NOT_FOUND', 'QUANTITY_INVALID_TEXT',
    'QUANTITY_SCALE_EXCEEDED', 'STOCK_MOVEMENT_QUANTITY_INVALID',
    'SUPPLIER_NOT_FOUND', 'SUPPLIER_NOT_ACTIVE', 'IDEMPOTENCY_KEY_CONFLICT'
  ]
} as const satisfies HttpContractV1;

export const registerStockAdjustmentContract = {
  method: 'POST', path: '/api/v1/inventory/stock-items/:stockItemId/adjustments',
  permission: 'inventory.waste.register|inventory.adjust', idempotency: 'REQUIRED',
  schema: {
    params: {
      type: 'object', additionalProperties: false, required: ['stockItemId'],
      properties: { stockItemId: id }
    }, headers,
    body: {
      type: 'object', additionalProperties: false,
      required: ['type', 'quantityScaled', 'quantityScale', 'reason', 'referenceId'],
      properties: {
        type: { type: 'string', enum: ['WASTE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT'] },
        quantityScaled: { type: 'integer', minimum: 1 },
        quantityScale: { type: 'integer', minimum: 0, maximum: 12 }, batchId: id,
        reason: { type: 'string', minLength: 1, maxLength: 500 }, referenceId: id
      }
    }, response: responses
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'STOCK_ITEM_NOT_FOUND',
    'STOCK_INSUFFICIENT_BALANCE', 'IDEMPOTENCY_KEY_CONFLICT'
  ]
} as const satisfies HttpContractV1;

export const getKardexContract = {
  method: 'GET', path: '/api/v1/inventory/products/:productId/kardex',
  permission: 'inventory.kardex.read', idempotency: 'NONE',
  schema: {
    params: {
      type: 'object', additionalProperties: false, required: ['productId'],
      properties: { productId: id }
    },
    querystring: {
      type: 'object', additionalProperties: false,
      properties: {
        batchId: id, from: { type: 'string', format: 'date-time' },
        to: { type: 'string', format: 'date-time' }, reason: { type: 'string', maxLength: 200 },
        limit: { type: 'integer', minimum: 1, maximum: 500 }
      }
    },
    response: {
      200: {
        type: 'object', additionalProperties: false,
        required: ['id', 'productId', 'unitCode', 'quantityScale', 'currentBalanceScaled', 'movements'],
        properties: {
          id, productId: id, unitCode: { type: 'string' }, quantityScale: { type: 'integer' },
          currentBalanceScaled: { type: 'integer' },
          batches: { type: 'array', items: {
            type: 'object', additionalProperties: false, required: ['id', 'lotNumber', 'expiresAt'],
            properties: { id, lotNumber: { type: 'string' }, expiresAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] } }
          } },
          movements: { type: 'array', items: movement }
        }
      },
      400: problemDetailsSchema, 401: problemDetailsSchema, 403: problemDetailsSchema,
      404: problemDetailsSchema
    }
  },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'STOCK_ITEM_NOT_FOUND', 'KARDEX_LIMIT_INVALID']
} as const satisfies HttpContractV1;
