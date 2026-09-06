import { problemDetailsSchema, type HttpContractV1 } from './common.contracts.js';

export type CashClosureBalanceResponse = {
  readonly paymentMethodCode: string; readonly currencyCode: string;
  readonly expectedMinorUnits: number; readonly declaredMinorUnits: number;
  readonly differenceMinorUnits: number;
};
export type CashClosureReportResponse = {
  readonly shiftId: string; readonly cashRegisterId: string; readonly terminalId: string;
  readonly originNodeId: string; readonly openedBy: string; readonly openedAt: string;
  readonly closedBy: string | null; readonly closedAt: string | null;
  readonly movementCount: number;
  readonly balances: readonly CashClosureBalanceResponse[];
};
export type AuditReportResponse = {
  readonly auditId: string; readonly actorId: string;
  readonly actorRoleCodes: readonly string[]; readonly action: string;
  readonly entityType: string; readonly entityId: string; readonly reason: string;
  readonly terminalId: string; readonly originNodeId: string; readonly occurredAt: string;
  readonly correlationId: string;
};
export type FiscalOperationReportResponse = {
  readonly kind: 'DOCUMENT' | 'REPORT'; readonly id: string;
  readonly referenceId: string | null; readonly dayId: string | null;
  readonly operationType: string; readonly status: string; readonly attempts: number;
  readonly fiscalNumber: string | null; readonly lastErrorCode: string | null;
  readonly evidence: Readonly<Record<string, string>> | null; readonly requestedAt: string;
};
export type FiscalOperationsReportResponse = {
  readonly fiscalMode: 'SIMULATION';
  readonly operations: readonly FiscalOperationReportResponse[];
};
export type MarginReportResponse = {
  readonly productId: string;
  readonly currencyCode: string;
  readonly quantitySoldScaled: number;
  readonly quantityReturnedScaled: number;
  readonly quantityScale: number;
  readonly discountMinorUnits: number;
  readonly returnRevenueMinorUnits: number;
  readonly returnCostMinorUnits: number;
  readonly revenueMinorUnits: number | null;
  readonly costMinorUnits: number | null;
  readonly marginMinorUnits: number | null;
};

const id = { type: 'string', minLength: 1, maxLength: 128 } as const;
const timestamp = { type: 'string', format: 'date-time' } as const;
const nullableText = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const;
const period = {
  from: timestamp, to: timestamp,
  limit: { type: 'integer', minimum: 1, maximum: 500 }
} as const;
const readResponses = {
  400: problemDetailsSchema, 401: problemDetailsSchema, 403: problemDetailsSchema
} as const;

const cashClosureSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'shiftId', 'cashRegisterId', 'terminalId', 'originNodeId', 'openedBy', 'openedAt',
    'closedBy', 'closedAt', 'movementCount', 'balances'
  ],
  properties: {
    shiftId: id, cashRegisterId: id, terminalId: id, originNodeId: id, openedBy: id,
    openedAt: timestamp, closedBy: nullableText,
    closedAt: { anyOf: [timestamp, { type: 'null' }] },
    movementCount: { type: 'integer', minimum: 0 },
    balances: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: [
          'paymentMethodCode', 'currencyCode', 'expectedMinorUnits',
          'declaredMinorUnits', 'differenceMinorUnits'
        ],
        properties: {
          paymentMethodCode: id, currencyCode: { type: 'string' },
          expectedMinorUnits: { type: 'integer' }, declaredMinorUnits: { type: 'integer' },
          differenceMinorUnits: { type: 'integer' }
        }
      }
    }
  }
} as const;

const auditSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'auditId', 'actorId', 'actorRoleCodes', 'action', 'entityType', 'entityId',
    'reason', 'terminalId', 'originNodeId', 'occurredAt', 'correlationId'
  ],
  properties: {
    auditId: id, actorId: id, actorRoleCodes: { type: 'array', items: { type: 'string' } },
    action: { type: 'string' }, entityType: { type: 'string' }, entityId: id,
    reason: { type: 'string' }, terminalId: id, originNodeId: id,
    occurredAt: timestamp, correlationId: { type: 'string' }
  }
} as const;

const fiscalOperationSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'kind', 'id', 'referenceId', 'dayId', 'operationType', 'status', 'attempts',
    'fiscalNumber', 'lastErrorCode', 'evidence', 'requestedAt'
  ],
  properties: {
    kind: { type: 'string', enum: ['DOCUMENT', 'REPORT'] }, id, referenceId: nullableText,
    dayId: nullableText, operationType: { type: 'string' }, status: { type: 'string' },
    attempts: { type: 'integer', minimum: 0 }, fiscalNumber: nullableText,
    lastErrorCode: nullableText,
    evidence: {
      anyOf: [
        { type: 'object', additionalProperties: { type: 'string' } },
        { type: 'null' }
      ]
    },
    requestedAt: timestamp
  }
} as const;

export const getCashClosureReportContract = {
  method: 'GET', path: '/api/v1/reports/cash-closures',
  permission: 'reports.cash.read', idempotency: 'NONE',
  schema: {
    querystring: {
      type: 'object', additionalProperties: false,
      properties: { ...period, cashRegisterId: id }
    },
    response: { 200: { type: 'array', items: cashClosureSchema }, ...readResponses }
  },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN']
} as const satisfies HttpContractV1;

export const getAuditReportContract = {
  method: 'GET', path: '/api/v1/reports/audit',
  permission: 'reports.audit.read', idempotency: 'NONE',
  schema: {
    querystring: {
      type: 'object', additionalProperties: false,
      properties: {
        ...period, actorId: id,
        action: { type: 'string', maxLength: 200 },
        entityType: { type: 'string', maxLength: 200 }
      }
    },
    response: { 200: { type: 'array', items: auditSchema }, ...readResponses }
  },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN']
} as const satisfies HttpContractV1;

const marginSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'productId', 'currencyCode', 'quantitySoldScaled', 'quantityReturnedScaled', 'quantityScale',
    'discountMinorUnits', 'returnRevenueMinorUnits', 'returnCostMinorUnits',
    'revenueMinorUnits', 'costMinorUnits', 'marginMinorUnits'
  ],
  properties: {
    productId: id, currencyCode: { type: 'string' },
    quantitySoldScaled: { type: 'integer' }, quantityReturnedScaled: { type: 'integer' },
    quantityScale: { type: 'integer', minimum: 0 },
    discountMinorUnits: { type: 'integer' }, returnRevenueMinorUnits: { type: 'integer' },
    returnCostMinorUnits: { type: 'integer' },
    revenueMinorUnits: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    costMinorUnits: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    marginMinorUnits: { anyOf: [{ type: 'integer' }, { type: 'null' }] }
  }
} as const;

export const getMarginReportContract = {
  method: 'GET', path: '/api/v1/reports/margin',
  permission: 'reports.margin.read', idempotency: 'NONE',
  schema: {
    querystring: {
      type: 'object', additionalProperties: false, required: ['from', 'to'],
      properties: { ...period, currencyCode: { type: 'string', pattern: '^[A-Z]{3}$' } }
    },
    response: { 200: { type: 'array', items: marginSchema }, ...readResponses }
  },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN']
} as const satisfies HttpContractV1;

export type SalesReportResponse = {
  readonly currencyCode: string;
  readonly quantityScale: number;
  readonly salesCount: number;
  readonly lineCount: number;
  readonly quantitySoldScaled: number;
  readonly grossMinorUnits: number;
  readonly discountMinorUnits: number;
  readonly netMinorUnits: number;
};

const salesSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'currencyCode', 'quantityScale', 'salesCount', 'lineCount', 'quantitySoldScaled',
    'grossMinorUnits', 'discountMinorUnits', 'netMinorUnits'
  ],
  properties: {
    currencyCode: { type: 'string' }, quantityScale: { type: 'integer', minimum: 0 },
    salesCount: { type: 'integer', minimum: 0 }, lineCount: { type: 'integer', minimum: 0 },
    quantitySoldScaled: { type: 'integer' }, grossMinorUnits: { type: 'integer' },
    discountMinorUnits: { type: 'integer' }, netMinorUnits: { type: 'integer' }
  }
} as const;

export const getSalesReportContract = {
  method: 'GET', path: '/api/v1/reports/sales',
  permission: 'reports.sales.read', idempotency: 'NONE',
  schema: {
    querystring: {
      type: 'object', additionalProperties: false, required: ['from', 'to'],
      properties: { ...period, currencyCode: { type: 'string', pattern: '^[A-Z]{3}$' } }
    },
    response: { 200: { type: 'array', items: salesSchema }, ...readResponses }
  },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN']
} as const satisfies HttpContractV1;

export type InventoryReportResponse = {
  readonly stockItemId: string;
  readonly productId: string;
  readonly batchId: string | null;
  readonly lotNumber: string | null;
  readonly unitCode: string;
  readonly quantityScale: number;
  readonly onHandScaled: number;
  readonly expiresAt: string | null;
  readonly expiryStatus: 'NONE' | 'OK' | 'EXPIRING' | 'EXPIRED';
};

const inventorySchema = {
  type: 'object', additionalProperties: false,
  required: [
    'stockItemId', 'productId', 'batchId', 'lotNumber', 'unitCode', 'quantityScale',
    'onHandScaled', 'expiresAt', 'expiryStatus'
  ],
  properties: {
    stockItemId: id, productId: id, batchId: { anyOf: [id, { type: 'null' }] },
    lotNumber: nullableText, unitCode: { type: 'string' },
    quantityScale: { type: 'integer', minimum: 0 }, onHandScaled: { type: 'integer' },
    expiresAt: { anyOf: [timestamp, { type: 'null' }] },
    expiryStatus: { enum: ['NONE', 'OK', 'EXPIRING', 'EXPIRED'] }
  }
} as const;

export const getInventoryReportContract = {
  method: 'GET', path: '/api/v1/reports/inventory',
  permission: 'reports.inventory.read', idempotency: 'NONE',
  schema: {
    querystring: {
      type: 'object', additionalProperties: false, required: ['asOf'],
      properties: {
        asOf: timestamp,
        expiringWithinDays: { type: 'integer', minimum: 0, maximum: 3650 },
        limit: { type: 'integer', minimum: 1, maximum: 500 }
      }
    },
    response: { 200: { type: 'array', items: inventorySchema }, ...readResponses }
  },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN']
} as const satisfies HttpContractV1;

export const getFiscalOperationsReportContract = {
  method: 'GET', path: '/api/v1/reports/fiscal-operations',
  permission: 'reports.fiscal.read', idempotency: 'NONE',
  schema: {
    querystring: { type: 'object', additionalProperties: false, properties: period },
    response: {
      200: {
        type: 'object', additionalProperties: false, required: ['fiscalMode', 'operations'],
        properties: {
          fiscalMode: { const: 'SIMULATION' },
          operations: { type: 'array', items: fiscalOperationSchema }
        }
      },
      ...readResponses
    }
  },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN']
} as const satisfies HttpContractV1;
