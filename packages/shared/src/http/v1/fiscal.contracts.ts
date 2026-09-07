import { problemDetailsSchema, type HttpContractV1 } from './common.contracts.js';

export type SimulatedFiscalReportRequest = {
  readonly dayId: string;
  readonly businessDate: string;
  readonly reason: string;
  readonly simulationConsent: 'ALLOW_SIMULATED_X_AND_Z';
};

export type SimulatedFiscalReportResponse = {
  readonly fiscalMode: 'SIMULATION';
  readonly report: {
    readonly dayId: string;
    readonly dayState: string;
    readonly id: string;
    readonly type: 'X' | 'Z';
    readonly status: string;
    readonly attempts: number;
    readonly reportNumber: string | null;
    readonly lastErrorCode: string | null;
    readonly lastEvidence: Readonly<Record<string, string>> | null;
  };
};

export type IssueSimulatedFiscalDocumentRequest = {
  readonly content: {
    readonly referenceId: string; readonly type: 'INVOICE' | 'CREDIT_NOTE';
    readonly currencyCode: string;
    readonly lines: readonly {
      readonly id: string; readonly description: string; readonly quantityScaled: number;
      readonly quantityScale: number; readonly unitPriceMinorUnits: number;
      readonly taxRateBasisPoints: number; readonly totalMinorUnits: number;
    }[];
    readonly payments: readonly { readonly methodCode: string; readonly amountMinorUnits: number }[];
    readonly totalMinorUnits: number;
    readonly recipient?: {
      readonly country: string; readonly type: string; readonly value: string;
      readonly normalizedValue: string; readonly name: string | null;
      readonly address: string | null;
    } | null;
  };
  readonly reason: string;
};

const evidenceSchema = {
  type: 'object', additionalProperties: false,
  required: ['dispatchState', 'commandEffect', 'fiscalCommit', 'printDelivery'],
  properties: {
    dispatchState: { type: 'string' }, commandEffect: { type: 'string' },
    fiscalCommit: { type: 'string' }, printDelivery: { type: 'string' }
  }
} as const;
const documentSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'id', 'content', 'status', 'version', 'attempts', 'fiscalNumber',
    'lastErrorCode', 'lastEvidence'
  ],
  properties: {
    id: { type: 'string' }, content: { type: 'object' }, status: { type: 'string' },
    version: { type: 'integer' }, attempts: { type: 'integer' },
    fiscalNumber: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    lastErrorCode: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    lastEvidence: { anyOf: [evidenceSchema, { type: 'null' }] }
  }
} as const;
const simulatedDocumentResponse = {
  type: 'object', additionalProperties: false, required: ['fiscalMode', 'document'],
  properties: { fiscalMode: { const: 'SIMULATION' }, document: documentSchema }
} as const;
const documentProblems = {
  400: problemDetailsSchema, 401: problemDetailsSchema, 403: problemDetailsSchema,
  404: problemDetailsSchema, 409: problemDetailsSchema, 503: problemDetailsSchema
} as const;
const documentParams = {
  type: 'object', additionalProperties: false, required: ['documentId'],
  properties: { documentId: { type: 'string', minLength: 1, maxLength: 128 } }
} as const;

export const issueSimulatedFiscalDocumentContract = {
  method: 'POST', path: '/api/v1/fiscal/documents',
  permission: 'fiscal.document.issue', idempotency: 'REQUIRED',
  schema: {
    headers: {
      type: 'object', required: ['idempotency-key'],
      properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 128 } }
    },
    body: {
      type: 'object', additionalProperties: false, required: ['content', 'reason'],
      properties: {
        content: {
          type: 'object', additionalProperties: false,
          required: ['referenceId', 'type', 'currencyCode', 'lines', 'payments', 'totalMinorUnits'],
          properties: {
            referenceId: { type: 'string', minLength: 1 },
            type: { type: 'string', enum: ['INVOICE', 'CREDIT_NOTE'] },
            currencyCode: { type: 'string', pattern: '^[A-Z]{3,8}$' },
            lines: {
              type: 'array', minItems: 1, items: {
                type: 'object', additionalProperties: false,
                required: [
                  'id', 'description', 'quantityScaled', 'quantityScale',
                  'unitPriceMinorUnits', 'taxRateBasisPoints', 'totalMinorUnits'
                ],
                properties: {
                  id: { type: 'string' }, description: { type: 'string', minLength: 1 },
                  quantityScaled: { type: 'integer', minimum: 1 },
                  quantityScale: { type: 'integer', minimum: 0 },
                  unitPriceMinorUnits: { type: 'integer', minimum: 0 },
                  taxRateBasisPoints: { type: 'integer', minimum: 0, maximum: 10000 },
                  totalMinorUnits: { type: 'integer', minimum: 0 }
                }
              }
            },
            payments: {
              type: 'array', minItems: 1, items: {
                type: 'object', additionalProperties: false,
                required: ['methodCode', 'amountMinorUnits'],
                properties: {
                  methodCode: { type: 'string', minLength: 1 },
                  amountMinorUnits: { type: 'integer', minimum: 0 }
                }
              }
            }, totalMinorUnits: { type: 'integer', minimum: 0 },
            /**
             * Copia opcional del receptor capturado en la venta. Ausente o
             * `null` en una venta anónima, que sigue siendo válida (ADR-0018).
             */
            recipient: {
              anyOf: [{
                type: 'object', additionalProperties: false,
                required: ['country', 'type', 'value', 'normalizedValue', 'name', 'address'],
                properties: {
                  country: { type: 'string', pattern: '^[A-Z]{2}$' },
                  type: { type: 'string', minLength: 1, maxLength: 32 },
                  value: { type: 'string', minLength: 1, maxLength: 64 },
                  normalizedValue: { type: 'string', minLength: 1, maxLength: 64 },
                  name: { anyOf: [{ type: 'string', minLength: 1, maxLength: 200 }, { type: 'null' }] },
                  address: { anyOf: [{ type: 'string', minLength: 1, maxLength: 200 }, { type: 'null' }] }
                }
              }, { type: 'null' }]
            }
          }
        }, reason: { type: 'string', minLength: 1, maxLength: 500 }
      }
    }, response: { 200: simulatedDocumentResponse, 201: simulatedDocumentResponse, ...documentProblems }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'IDEMPOTENCY_KEY_CONFLICT',
    'FISCAL_DEVICE_OPERATION_PENDING', 'FISCAL_RECONCILIATION_REQUIRED'
  ]
} as const satisfies HttpContractV1;

/**
 * Emisión de la factura de una venta ya completada. A diferencia del contrato
 * anterior, el contenido no viaja en la petición: el nodo lo deriva de la venta
 * con los snapshots que ésta congeló, para que la interfaz no pueda declarar
 * importes, impuestos ni receptor distintos de los que la venta cobró.
 */
export const issueSaleInvoiceContract = {
  method: 'POST', path: '/api/v1/sales/:saleId/fiscal-document',
  permission: 'fiscal.document.issue', idempotency: 'REQUIRED',
  schema: {
    params: {
      type: 'object', additionalProperties: false, required: ['saleId'],
      properties: { saleId: { type: 'string', minLength: 1, maxLength: 128 } }
    },
    headers: {
      type: 'object', required: ['idempotency-key'],
      properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 128 } }
    },
    body: {
      type: 'object', additionalProperties: false, required: ['reason'],
      properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } }
    },
    response: {
      200: simulatedDocumentResponse, 201: simulatedDocumentResponse, ...documentProblems
    }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'SALE_NOT_FOUND',
    'SALE_INVALID_STATE', 'IDEMPOTENCY_KEY_CONFLICT', 'FISCAL_DEVICE_OPERATION_PENDING',
    'FISCAL_RECONCILIATION_REQUIRED'
  ]
} as const satisfies HttpContractV1;

export const getSimulatedFiscalDocumentContract = {
  method: 'GET', path: '/api/v1/fiscal/documents/:documentId',
  permission: null, idempotency: 'NONE',
  schema: {
    params: documentParams,
    response: { 200: simulatedDocumentResponse, 401: problemDetailsSchema, 404: problemDetailsSchema }
  }, errorCodes: ['UNAUTHORIZED', 'FISCAL_DOCUMENT_NOT_FOUND']
} as const satisfies HttpContractV1;

export const reconcileSimulatedFiscalDocumentContract = {
  method: 'POST', path: '/api/v1/fiscal/documents/:documentId/reconcile',
  permission: 'fiscal.reconcile', idempotency: 'NONE',
  schema: {
    params: documentParams,
    body: {
      type: 'object', additionalProperties: false, required: ['reason'],
      properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } }
    }, response: { 200: simulatedDocumentResponse, ...documentProblems }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'FISCAL_DOCUMENT_NOT_FOUND',
    'FISCAL_RECONCILIATION_INCONCLUSIVE'
  ]
} as const satisfies HttpContractV1;

const reportRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['dayId', 'businessDate', 'reason', 'simulationConsent'],
  properties: {
    dayId: { type: 'string', minLength: 1, maxLength: 128 },
    businessDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    simulationConsent: { const: 'ALLOW_SIMULATED_X_AND_Z' }
  }
} as const;

const reportResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fiscalMode', 'report'],
  properties: {
    fiscalMode: { const: 'SIMULATION' },
    report: {
      type: 'object',
      additionalProperties: false,
      required: [
        'dayId', 'dayState', 'id', 'type', 'status', 'attempts',
        'reportNumber', 'lastErrorCode', 'lastEvidence'
      ],
      properties: {
        dayId: { type: 'string' },
        dayState: { type: 'string' },
        id: { type: 'string' },
        type: { enum: ['X', 'Z'] },
        status: { type: 'string' },
        attempts: { type: 'integer', minimum: 0 },
        reportNumber: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        lastErrorCode: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        lastEvidence: {
          anyOf: [
            { type: 'object', additionalProperties: { type: 'string' } },
            { type: 'null' }
          ]
        }
      }
    }
  }
} as const;

const contract = (type: 'x' | 'z', permission: string) => ({
  method: 'POST',
  path: `/api/v1/fiscal/reports/${type}`,
  permission,
  idempotency: 'REQUIRED',
  schema: {
    headers: {
      type: 'object',
      required: ['idempotency-key'],
      properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 128 } }
    },
    body: reportRequestSchema,
    response: {
      200: reportResponseSchema,
      400: problemDetailsSchema,
      401: problemDetailsSchema,
      403: problemDetailsSchema,
      409: problemDetailsSchema,
      503: problemDetailsSchema
    }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN',
    'FISCAL_IDEMPOTENCY_KEY_REQUIRED', 'FISCAL_REASON_REQUIRED',
    'FISCAL_DAY_ALREADY_OPEN', 'IDEMPOTENCY_KEY_CONFLICT',
    'FISCAL_RECONCILIATION_REQUIRED', 'FISCAL_REPORT_FAILED', 'DATABASE_BUSY'
  ]
}) as const satisfies HttpContractV1;

export const printSimulatedXReportContract = contract('x', 'fiscal.report.x');
export const printSimulatedZReportContract = contract('z', 'fiscal.report.z');
