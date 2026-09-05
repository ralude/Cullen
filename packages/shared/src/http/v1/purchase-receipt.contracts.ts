import { problemDetailsSchema, type HttpContractV1 } from './common.contracts.js';

export type PurchaseReceiptSourceDocumentPayload = {
  readonly type: 'INVOICE' | 'DELIVERY_NOTE';
  readonly number: string;
  readonly series?: string;
  readonly controlNumber?: string;
  readonly issuedAt?: string;
};

export type StartPurchaseReceiptLinePayload = {
  readonly productId: string;
  readonly quantity: string;
  readonly lot?: { readonly lotNumber: string; readonly expiresAt?: string };
  readonly purchaseUnitCostMinorUnits: number;
  readonly purchaseCurrency: string;
  readonly exchangeRateId?: string;
};

export type StartPurchaseReceiptRequest = {
  readonly replacesReceiptId?: string;
  readonly supplierId: string;
  readonly sourceDocument: PurchaseReceiptSourceDocumentPayload;
  readonly effectiveAt: string;
  readonly lines: readonly StartPurchaseReceiptLinePayload[];
  readonly reason: string;
};

export type CompletePurchaseReceiptRequest = { readonly reason: string };
export type ReversePurchaseReceiptRequest = { readonly reason: string };

export type PurchaseReceiptLineResponse = {
  readonly id: string;
  readonly productId: string;
  readonly stockItemId: string;
  readonly quantityScaled: number;
  readonly quantityScale: number;
  readonly batchId: string | null;
  readonly purchaseUnitCostMinorUnits: number;
  readonly purchaseCurrency: string;
  readonly valuationUnitCostMinorUnits: number;
  readonly valuationCurrency: string;
  readonly exchangeRateId: string | null;
};

export type PurchaseReceiptResponse = {
  readonly id: string;
  readonly originNodeId: string;
  readonly supplierId: string;
  readonly status: 'DRAFT' | 'COMPLETED' | 'REVERSED';
  readonly sourceDocument: {
    readonly type: string;
    readonly number: string;
    readonly series: string | null;
    readonly controlNumber: string | null;
    readonly issuedAt: string | null;
  };
  readonly effectiveAt: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly reversedAt: string | null;
  readonly reversedBy: string | null;
  readonly reversalReason: string | null;
  readonly lines: readonly PurchaseReceiptLineResponse[];
  readonly version: number;
};

const idempotencyHeaders = {
  type: 'object', required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 128 } }
} as const;

const receiptParams = {
  type: 'object', additionalProperties: false, required: ['receiptId'],
  properties: { receiptId: { type: 'string', minLength: 1, maxLength: 128 } }
} as const;

const lineResponseSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'id', 'productId', 'stockItemId', 'quantityScaled', 'quantityScale', 'batchId',
    'purchaseUnitCostMinorUnits', 'purchaseCurrency', 'valuationUnitCostMinorUnits',
    'valuationCurrency', 'exchangeRateId'
  ],
  properties: {
    id: { type: 'string' }, productId: { type: 'string' }, stockItemId: { type: 'string' },
    quantityScaled: { type: 'integer' }, quantityScale: { type: 'integer', minimum: 0 },
    batchId: { type: ['string', 'null'] },
    purchaseUnitCostMinorUnits: { type: 'integer' }, purchaseCurrency: { type: 'string' },
    valuationUnitCostMinorUnits: { type: 'integer' }, valuationCurrency: { type: 'string' },
    exchangeRateId: { type: ['string', 'null'] }
  }
} as const;

const receiptResponseSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'id', 'originNodeId', 'supplierId', 'status', 'sourceDocument', 'effectiveAt', 'createdBy', 'createdAt',
    'completedAt', 'reversedAt', 'reversedBy', 'reversalReason', 'lines', 'version'
  ],
  properties: {
    id: { type: 'string' }, originNodeId: { type: 'string' }, supplierId: { type: 'string' },
    status: { type: 'string', enum: ['DRAFT', 'COMPLETED', 'REVERSED'] },
    sourceDocument: {
      type: 'object', additionalProperties: false,
      required: ['type', 'number', 'series', 'controlNumber', 'issuedAt'],
      properties: {
        type: { type: 'string', enum: ['INVOICE', 'DELIVERY_NOTE'] },
        number: { type: 'string' },
        series: { type: ['string', 'null'] },
        controlNumber: { type: ['string', 'null'] },
        issuedAt: { type: ['string', 'null'], format: 'date-time' }
      }
    },
    effectiveAt: { type: 'string', format: 'date-time' },
    createdBy: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' },
    completedAt: { type: ['string', 'null'], format: 'date-time' },
    reversedAt: { type: ['string', 'null'], format: 'date-time' },
    reversedBy: { type: ['string', 'null'] }, reversalReason: { type: ['string', 'null'] },
    lines: { type: 'array', items: lineResponseSchema },
    version: { type: 'integer', minimum: 1 }
  }
} as const;

const mutationResponses = {
  200: receiptResponseSchema, 400: problemDetailsSchema, 401: problemDetailsSchema,
  403: problemDetailsSchema, 404: problemDetailsSchema, 409: problemDetailsSchema,
  503: problemDetailsSchema
} as const;

const lineSchema = {
  type: 'object', additionalProperties: false,
  required: ['productId', 'quantity', 'purchaseUnitCostMinorUnits', 'purchaseCurrency'],
  properties: {
    productId: { type: 'string', minLength: 1, maxLength: 128 },
    quantity: { type: 'string', minLength: 1, maxLength: 32 },
    lot: {
      type: 'object', additionalProperties: false, required: ['lotNumber'],
      properties: {
        lotNumber: { type: 'string', minLength: 1, maxLength: 64 },
        expiresAt: { type: 'string', format: 'date-time' }
      }
    },
    purchaseUnitCostMinorUnits: { type: 'integer', minimum: 0 },
    purchaseCurrency: { type: 'string', pattern: '^[A-Za-z]{3}$' },
    exchangeRateId: { type: 'string', minLength: 1, maxLength: 128 }
  }
} as const;

export const startPurchaseReceiptContract = {
  method: 'POST', path: '/api/v1/purchase-receipts',
  permission: 'purchase_receipt.start', idempotency: 'REQUIRED',
  schema: {
    headers: idempotencyHeaders,
    body: {
      type: 'object', additionalProperties: false,
      required: ['supplierId', 'sourceDocument', 'effectiveAt', 'lines', 'reason'],
      properties: {
        replacesReceiptId: { type: 'string', minLength: 1, maxLength: 128 },
        supplierId: { type: 'string', minLength: 1, maxLength: 128 },
        sourceDocument: {
          type: 'object', additionalProperties: false, required: ['type', 'number'],
          properties: {
            type: { type: 'string', enum: ['INVOICE', 'DELIVERY_NOTE'] },
            number: { type: 'string', minLength: 1, maxLength: 64 },
            series: { type: 'string', maxLength: 32 },
            controlNumber: { type: 'string', maxLength: 64 },
            issuedAt: { type: 'string', format: 'date-time' }
          }
        },
        effectiveAt: { type: 'string', format: 'date-time' },
        lines: { type: 'array', minItems: 1, items: lineSchema },
        reason: { type: 'string', minLength: 1, maxLength: 500 }
      }
    },
    response: { 201: receiptResponseSchema, ...mutationResponses }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'PURCHASE_RECEIPT_LINES_REQUIRED',
    'PURCHASE_RECEIPT_NOT_FOUND', 'PURCHASE_RECEIPT_NOT_DRAFT', 'SUPPLIER_NOT_FOUND',
    'PRODUCT_NOT_FOUND', 'STOCK_BATCH_REQUIRED', 'STOCK_BATCH_NOT_ACCEPTED',
    'PURCHASE_RECEIPT_EXCHANGE_RATE_REQUIRED', 'PURCHASE_RECEIPT_EXCHANGE_RATE_NOT_FOUND',
    'PURCHASE_RECEIPT_EXCHANGE_RATE_MISMATCH', 'PURCHASE_RECEIPT_EXCHANGE_RATE_EXPIRED',
    'PURCHASE_RECEIPT_FISCAL_ADDRESS_REQUIRED', 'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const completePurchaseReceiptContract = {
  method: 'PUT', path: '/api/v1/purchase-receipts/:receiptId/complete',
  permission: 'purchase_receipt.complete', idempotency: 'REQUIRED',
  schema: {
    params: receiptParams, headers: idempotencyHeaders,
    body: {
      type: 'object', additionalProperties: false, required: ['reason'],
      properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } }
    },
    response: mutationResponses
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'PURCHASE_RECEIPT_NOT_FOUND',
    'PURCHASE_RECEIPT_INVALID_STATE', 'PURCHASE_RECEIPT_SOURCE_DUPLICATED', 'SUPPLIER_NOT_ACTIVE',
    'STOCK_ITEM_NOT_FOUND', 'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const reversePurchaseReceiptContract = {
  method: 'PUT', path: '/api/v1/purchase-receipts/:receiptId/reverse',
  permission: 'purchase_receipt.reverse', idempotency: 'REQUIRED',
  schema: {
    params: receiptParams, headers: idempotencyHeaders,
    body: {
      type: 'object', additionalProperties: false, required: ['reason'],
      properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } }
    },
    response: mutationResponses
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'PURCHASE_RECEIPT_NOT_FOUND',
    'PURCHASE_RECEIPT_INVALID_STATE', 'PURCHASE_RECEIPT_MOVEMENT_NOT_FOUND', 'STOCK_ITEM_NOT_FOUND',
    'STOCK_INSUFFICIENT', 'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const getPurchaseReceiptContract = {
  method: 'GET', path: '/api/v1/purchase-receipts/:receiptId', permission: 'purchase_receipt.read', idempotency: 'NONE',
  schema: {
    params: receiptParams,
    response: { 200: receiptResponseSchema, 401: problemDetailsSchema, 404: problemDetailsSchema }
  },
  errorCodes: ['UNAUTHORIZED', 'PURCHASE_RECEIPT_NOT_FOUND']
} as const satisfies HttpContractV1;
