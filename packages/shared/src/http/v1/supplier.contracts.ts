import { problemDetailsSchema, type HttpContractV1 } from './common.contracts.js';

export type SupplierStatusResponse = 'ACTIVE' | 'BLOCKED' | 'INACTIVE';

/**
 * Dirección fiscal mínima. Es opcional en el maestro y obligatoria antes de
 * completar una recepción venezolana con factura o guía de despacho, regla que
 * evalúa la aplicación cuando 9B.04 incorpore `PurchaseReceipt`.
 */
export type FiscalAddressPayload = {
  readonly countryCode: string;
  readonly addressLine: string;
};

export type SupplierResponse = {
  readonly id: string;
  readonly code: string;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly fiscalAddress: FiscalAddressPayload | null;
  readonly taxIdentity: {
    readonly country: string;
    readonly type: string;
    readonly value: string;
    readonly normalizedValue: string;
  };
  readonly status: SupplierStatusResponse;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
};

export type CreateSupplierRequest = {
  readonly legalName: string;
  readonly tradeName?: string;
  readonly fiscalAddress?: FiscalAddressPayload;
  readonly taxIdentity: { readonly country?: string; readonly type: string; readonly value: string };
  readonly reason: string;
};

export type UpdateSupplierRequest = {
  readonly legalName?: string;
  readonly tradeName?: string | null;
  readonly fiscalAddress?: FiscalAddressPayload | null;
  readonly reason: string;
};

export type ChangeSupplierStatusRequest = {
  readonly status: SupplierStatusResponse;
  readonly reason: string;
};

export type CorrectSupplierTaxIdentityRequest = {
  readonly taxIdentity: { readonly country?: string; readonly type: string; readonly value: string };
  readonly reason: string;
};

const idempotencyHeaders = {
  type: 'object', required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 128 } }
} as const;

const supplierParams = {
  type: 'object', additionalProperties: false, required: ['supplierId'],
  properties: { supplierId: { type: 'string', minLength: 1, maxLength: 128 } }
} as const;

const fiscalAddressSchema = {
  type: 'object', additionalProperties: false, required: ['countryCode', 'addressLine'],
  properties: {
    countryCode: { type: 'string', pattern: '^[A-Za-z]{2}$' },
    addressLine: { type: 'string', minLength: 1, maxLength: 500 }
  }
} as const;

const taxIdentitySchema = {
  type: 'object', additionalProperties: false, required: ['type', 'value'],
  properties: {
    country: { type: 'string', pattern: '^[A-Za-z]{2}$' },
    type: { type: 'string', minLength: 1, maxLength: 32 },
    value: { type: 'string', minLength: 1, maxLength: 64 }
  }
} as const;

const supplierResponseSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'id', 'code', 'legalName', 'tradeName', 'fiscalAddress', 'taxIdentity',
    'status', 'createdAt', 'updatedAt', 'version'
  ],
  properties: {
    id: { type: 'string' }, code: { type: 'string' }, legalName: { type: 'string' },
    tradeName: { type: ['string', 'null'] },
    fiscalAddress: { anyOf: [fiscalAddressSchema, { type: 'null' }] },
    taxIdentity: {
      type: 'object', additionalProperties: false,
      required: ['country', 'type', 'value', 'normalizedValue'],
      properties: {
        country: { type: 'string' }, type: { type: 'string' }, value: { type: 'string' },
        normalizedValue: { type: 'string' }
      }
    },
    status: { type: 'string', enum: ['ACTIVE', 'BLOCKED', 'INACTIVE'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    version: { type: 'integer', minimum: 1 }
  }
} as const;

const mutationResponses = {
  200: supplierResponseSchema, 400: problemDetailsSchema, 401: problemDetailsSchema,
  403: problemDetailsSchema, 404: problemDetailsSchema, 409: problemDetailsSchema,
  503: problemDetailsSchema
} as const;

export const createSupplierContract = {
  method: 'POST', path: '/api/v1/suppliers', permission: 'supplier.create', idempotency: 'REQUIRED',
  schema: {
    headers: idempotencyHeaders,
    body: {
      type: 'object', additionalProperties: false,
      required: ['legalName', 'taxIdentity', 'reason'],
      properties: {
        legalName: { type: 'string', minLength: 1, maxLength: 200 },
        tradeName: { type: 'string', maxLength: 200 },
        fiscalAddress: fiscalAddressSchema,
        taxIdentity: taxIdentitySchema,
        reason: { type: 'string', minLength: 1, maxLength: 500 }
      }
    },
    response: { 201: supplierResponseSchema, ...mutationResponses }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN',
    'SUPPLIER_LEGAL_NAME_REQUIRED', 'SUPPLIER_FISCAL_ADDRESS_COUNTRY_INVALID',
    'SUPPLIER_FISCAL_ADDRESS_LINE_REQUIRED', 'SUPPLIER_TAX_COUNTRY_INVALID',
    'SUPPLIER_TAX_TYPE_INVALID', 'SUPPLIER_TAX_IDENTITY_REQUIRED',
    'SUPPLIER_TAX_IDENTITY_INVALID', 'SUPPLIER_TAX_IDENTITY_CONFLICT',
    'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const listSuppliersContract = {
  method: 'GET', path: '/api/v1/suppliers', permission: 'supplier.read', idempotency: 'NONE',
  schema: {
    querystring: {
      type: 'object', additionalProperties: false,
      properties: { status: { type: 'string', enum: ['ACTIVE', 'BLOCKED', 'INACTIVE'] } }
    },
    response: {
      200: { type: 'array', items: supplierResponseSchema }, 401: problemDetailsSchema
    }
  },
  errorCodes: ['UNAUTHORIZED']
} as const satisfies HttpContractV1;

export const getSupplierContract = {
  method: 'GET', path: '/api/v1/suppliers/:supplierId', permission: 'supplier.read', idempotency: 'NONE',
  schema: {
    params: supplierParams,
    response: { 200: supplierResponseSchema, 401: problemDetailsSchema, 404: problemDetailsSchema }
  },
  errorCodes: ['UNAUTHORIZED', 'SUPPLIER_NOT_FOUND']
} as const satisfies HttpContractV1;

export const updateSupplierContract = {
  method: 'PATCH', path: '/api/v1/suppliers/:supplierId',
  permission: 'supplier.update', idempotency: 'REQUIRED',
  schema: {
    params: supplierParams, headers: idempotencyHeaders,
    body: {
      type: 'object', additionalProperties: false, required: ['reason'],
      anyOf: [{ required: ['legalName'] }, { required: ['tradeName'] }, { required: ['fiscalAddress'] }],
      properties: {
        legalName: { type: 'string', minLength: 1, maxLength: 200 },
        tradeName: { type: ['string', 'null'], maxLength: 200 },
        fiscalAddress: { anyOf: [fiscalAddressSchema, { type: 'null' }] },
        reason: { type: 'string', minLength: 1, maxLength: 500 }
      }
    },
    response: mutationResponses
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'SUPPLIER_NOT_FOUND',
    'SUPPLIER_LEGAL_NAME_REQUIRED', 'SUPPLIER_UPDATE_REQUIRED',
    'SUPPLIER_FISCAL_ADDRESS_COUNTRY_INVALID', 'SUPPLIER_FISCAL_ADDRESS_LINE_REQUIRED',
    'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const changeSupplierStatusContract = {
  method: 'PUT', path: '/api/v1/suppliers/:supplierId/status',
  permission: 'supplier.update', idempotency: 'REQUIRED',
  schema: {
    params: supplierParams, headers: idempotencyHeaders,
    body: {
      type: 'object', additionalProperties: false, required: ['status', 'reason'],
      properties: {
        status: { type: 'string', enum: ['ACTIVE', 'BLOCKED', 'INACTIVE'] },
        reason: { type: 'string', minLength: 1, maxLength: 500 }
      }
    },
    response: mutationResponses
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'SUPPLIER_NOT_FOUND',
    'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const correctSupplierTaxIdentityContract = {
  method: 'PUT', path: '/api/v1/suppliers/:supplierId/tax-identity',
  permission: 'supplier.tax_identity.correct', idempotency: 'REQUIRED',
  schema: {
    params: supplierParams, headers: idempotencyHeaders,
    body: {
      type: 'object', additionalProperties: false, required: ['taxIdentity', 'reason'],
      properties: {
        taxIdentity: taxIdentitySchema,
        reason: { type: 'string', minLength: 1, maxLength: 500 }
      }
    },
    response: mutationResponses
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'SUPPLIER_NOT_FOUND',
    'SUPPLIER_CORRECTION_REASON_REQUIRED', 'SUPPLIER_TAX_IDENTITY_CONFLICT',
    'SUPPLIER_TAX_COUNTRY_INVALID', 'SUPPLIER_TAX_TYPE_INVALID',
    'SUPPLIER_TAX_IDENTITY_REQUIRED', 'SUPPLIER_TAX_IDENTITY_INVALID',
    'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;
