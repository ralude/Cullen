import { problemDetailsSchema, type HttpContractV1 } from './common.contracts.js';

export type BranchStatusResponse = 'ACTIVE' | 'INACTIVE';
export type DeviceStatusResponse = 'ACTIVE' | 'INACTIVE';
export type DeviceTypeResponse = 'FISCAL_PRINTER' | 'BARCODE_SCANNER' | 'SCALE' | 'CASH_DRAWER';

export type BranchResponse = {
  readonly id: string;
  readonly code: string;
  readonly originNodeId: string;
  readonly name: string;
  readonly status: BranchStatusResponse;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
};

export type CreateBranchRequest = { readonly code: string; readonly name: string; readonly reason: string };
export type UpdateBranchRequest = { readonly name?: string; readonly reason: string };
export type ChangeBranchStatusRequest = { readonly status: BranchStatusResponse; readonly reason: string };

export type DeviceResponse = {
  readonly id: string;
  readonly type: DeviceTypeResponse;
  readonly originNodeId: string;
  readonly identifier: string;
  readonly terminalId: string;
  readonly branchId: string | null;
  readonly status: DeviceStatusResponse;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
};

export type DeclareDeviceRequest = {
  readonly type: DeviceTypeResponse;
  readonly identifier: string;
  readonly terminalId: string;
  readonly branchId?: string;
  readonly reason: string;
};
export type UpdateDeviceRequest = {
  readonly identifier?: string;
  readonly branchId?: string | null;
  readonly reason: string;
};
export type ChangeDeviceStatusRequest = { readonly status: DeviceStatusResponse; readonly reason: string };

export type CategoryConfigResponse = { readonly id: string; readonly name: string; readonly isActive: boolean };
export type UnitConfigResponse = {
  readonly id: string; readonly code: string; readonly name: string;
  readonly quantityScale: number; readonly isActive: boolean;
};
export type PaymentMethodConfigResponse = {
  readonly code: string; readonly name: string;
  readonly kind: 'CASH' | 'CARD' | 'MOBILE_PAYMENT' | 'BANK_TRANSFER' | 'OTHER';
  readonly currencyCode: string; readonly isActive: boolean;
};
export type OperationalMasterDataResponse = {
  readonly categories: readonly CategoryConfigResponse[];
  readonly units: readonly UnitConfigResponse[];
  readonly paymentMethods: readonly PaymentMethodConfigResponse[];
};
export type SaveCategoryRequest = { readonly id?: string; readonly name: string; readonly isActive: boolean; readonly reason: string };
export type SaveUnitRequest = {
  readonly code: string; readonly name: string; readonly quantityScale: number;
  readonly isActive: boolean; readonly reason: string;
};
export type SavePaymentMethodRequest = Omit<PaymentMethodConfigResponse, 'isActive'> & {
  readonly isActive: boolean; readonly reason: string;
};
export type ActivateDiscountPolicyRequest = { readonly maximumBasisPoints: number; readonly reason: string };
export type ActivateTaxPolicyRequest = {
  readonly rateBasisPoints: number; readonly eligiblePaymentMethodCodes: readonly string[];
  readonly eligibleCurrencies: readonly string[]; readonly reason: string;
};
export type PolicyActivationResponse = { readonly created: boolean; readonly policyId: string; readonly version: number };

const id = { type: 'string', minLength: 1, maxLength: 128 } as const;
const headers = {
  type: 'object', required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 128 } }
} as const;
const branchParams = {
  type: 'object', additionalProperties: false, required: ['branchId'],
  properties: { branchId: id }
} as const;
const deviceParams = {
  type: 'object', additionalProperties: false, required: ['deviceId'],
  properties: { deviceId: id }
} as const;

const branchResponseSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'code', 'originNodeId', 'name', 'status', 'createdAt', 'updatedAt', 'version'],
  properties: {
    id, code: { type: 'string' }, originNodeId: id, name: { type: 'string' },
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
    createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
    version: { type: 'integer', minimum: 1 }
  }
} as const;

const branchMutationResponses = {
  200: branchResponseSchema, 400: problemDetailsSchema, 401: problemDetailsSchema,
  403: problemDetailsSchema, 404: problemDetailsSchema, 409: problemDetailsSchema,
  503: problemDetailsSchema
} as const;

export const createBranchContract = {
  method: 'POST', path: '/api/v1/config/branches', permission: 'config.branch.manage', idempotency: 'REQUIRED',
  schema: {
    headers,
    body: {
      type: 'object', additionalProperties: false, required: ['code', 'name', 'reason'],
      properties: {
        code: { type: 'string', minLength: 1, maxLength: 32 }, name: { type: 'string', minLength: 1, maxLength: 200 },
        reason: { type: 'string', minLength: 1, maxLength: 500 }
      }
    },
    response: { 201: branchResponseSchema, ...branchMutationResponses }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'BRANCH_CODE_INVALID',
    'BRANCH_NAME_REQUIRED', 'BRANCH_CODE_CONFLICT', 'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const listBranchesContract = {
  method: 'GET', path: '/api/v1/config/branches', permission: 'config.branch.manage', idempotency: 'NONE',
  schema: {
    querystring: {
      type: 'object', additionalProperties: false,
      properties: { status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] } }
    },
    response: { 200: { type: 'array', items: branchResponseSchema }, 401: problemDetailsSchema }
  },
  errorCodes: ['UNAUTHORIZED']
} as const satisfies HttpContractV1;

export const getBranchContract = {
  method: 'GET', path: '/api/v1/config/branches/:branchId', permission: 'config.branch.manage', idempotency: 'NONE',
  schema: {
    params: branchParams,
    response: { 200: branchResponseSchema, 401: problemDetailsSchema, 404: problemDetailsSchema }
  },
  errorCodes: ['UNAUTHORIZED', 'BRANCH_NOT_FOUND']
} as const satisfies HttpContractV1;

export const updateBranchContract = {
  method: 'PATCH', path: '/api/v1/config/branches/:branchId',
  permission: 'config.branch.manage', idempotency: 'REQUIRED',
  schema: {
    params: branchParams, headers,
    body: {
      type: 'object', additionalProperties: false, required: ['reason'], anyOf: [{ required: ['name'] }],
      properties: { name: { type: 'string', minLength: 1, maxLength: 200 }, reason: { type: 'string', minLength: 1, maxLength: 500 } }
    },
    response: branchMutationResponses
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'BRANCH_NOT_FOUND',
    'BRANCH_NAME_REQUIRED', 'BRANCH_UPDATE_REQUIRED', 'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const changeBranchStatusContract = {
  method: 'PUT', path: '/api/v1/config/branches/:branchId/status',
  permission: 'config.branch.manage', idempotency: 'REQUIRED',
  schema: {
    params: branchParams, headers,
    body: {
      type: 'object', additionalProperties: false, required: ['status', 'reason'],
      properties: {
        status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] }, reason: { type: 'string', minLength: 1, maxLength: 500 }
      }
    },
    response: branchMutationResponses
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'BRANCH_NOT_FOUND',
    'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

const deviceResponseSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'type', 'originNodeId', 'identifier', 'terminalId', 'branchId', 'status', 'createdAt', 'updatedAt', 'version'],
  properties: {
    id, originNodeId: id, type: { type: 'string', enum: ['FISCAL_PRINTER', 'BARCODE_SCANNER', 'SCALE', 'CASH_DRAWER'] },
    identifier: { type: 'string' }, terminalId: { type: 'string' },
    branchId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
    createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
    version: { type: 'integer', minimum: 1 }
  }
} as const;

const deviceMutationResponses = {
  200: deviceResponseSchema, 400: problemDetailsSchema, 401: problemDetailsSchema,
  403: problemDetailsSchema, 404: problemDetailsSchema, 409: problemDetailsSchema,
  503: problemDetailsSchema
} as const;

export const declareDeviceContract = {
  method: 'POST', path: '/api/v1/config/devices', permission: 'config.device.manage', idempotency: 'REQUIRED',
  schema: {
    headers,
    body: {
      type: 'object', additionalProperties: false, required: ['type', 'identifier', 'terminalId', 'reason'],
      properties: {
        type: { type: 'string', enum: ['FISCAL_PRINTER', 'BARCODE_SCANNER', 'SCALE', 'CASH_DRAWER'] },
        identifier: { type: 'string', minLength: 1, maxLength: 128 },
        terminalId: { type: 'string', minLength: 1, maxLength: 128 },
        branchId: id, reason: { type: 'string', minLength: 1, maxLength: 500 }
      }
    },
    response: { 201: deviceResponseSchema, ...deviceMutationResponses }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'DEVICE_TYPE_INVALID',
    'DEVICE_IDENTIFIER_REQUIRED', 'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const listDevicesContract = {
  method: 'GET', path: '/api/v1/config/devices', permission: 'config.device.manage', idempotency: 'NONE',
  schema: {
    querystring: {
      type: 'object', additionalProperties: false,
      properties: {
        terminalId: { type: 'string', maxLength: 128 }, status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] }
      }
    },
    response: { 200: { type: 'array', items: deviceResponseSchema }, 401: problemDetailsSchema }
  },
  errorCodes: ['UNAUTHORIZED']
} as const satisfies HttpContractV1;

export const updateDeviceContract = {
  method: 'PATCH', path: '/api/v1/config/devices/:deviceId',
  permission: 'config.device.manage', idempotency: 'REQUIRED',
  schema: {
    params: deviceParams, headers,
    body: {
      type: 'object', additionalProperties: false, required: ['reason'],
      anyOf: [{ required: ['identifier'] }, { required: ['branchId'] }],
      properties: {
        identifier: { type: 'string', minLength: 1, maxLength: 128 },
        branchId: { anyOf: [id, { type: 'null' }] },
        reason: { type: 'string', minLength: 1, maxLength: 500 }
      }
    },
    response: deviceMutationResponses
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'DEVICE_NOT_FOUND',
    'DEVICE_IDENTIFIER_REQUIRED', 'DEVICE_UPDATE_REQUIRED', 'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const changeDeviceStatusContract = {
  method: 'PUT', path: '/api/v1/config/devices/:deviceId/status',
  permission: 'config.device.manage', idempotency: 'REQUIRED',
  schema: {
    params: deviceParams, headers,
    body: {
      type: 'object', additionalProperties: false, required: ['status', 'reason'],
      properties: {
        status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] }, reason: { type: 'string', minLength: 1, maxLength: 500 }
      }
    },
    response: deviceMutationResponses
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'DEVICE_NOT_FOUND',
    'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

const categoryConfigSchema = {
  type: 'object', additionalProperties: false, required: ['id', 'name', 'isActive'],
  properties: { id, name: { type: 'string' }, isActive: { type: 'boolean' } }
} as const;
const unitConfigSchema = {
  type: 'object', additionalProperties: false, required: ['id', 'code', 'name', 'quantityScale', 'isActive'],
  properties: { id, code: { type: 'string' }, name: { type: 'string' }, quantityScale: { type: 'integer', minimum: 0, maximum: 6 }, isActive: { type: 'boolean' } }
} as const;
const paymentMethodConfigSchema = {
  type: 'object', additionalProperties: false, required: ['code', 'name', 'kind', 'currencyCode', 'isActive'],
  properties: {
    code: { type: 'string' }, name: { type: 'string' },
    kind: { type: 'string', enum: ['CASH', 'CARD', 'MOBILE_PAYMENT', 'BANK_TRANSFER', 'OTHER'] },
    currencyCode: { type: 'string' }, isActive: { type: 'boolean' }
  }
} as const;
const reason = { type: 'string', minLength: 1, maxLength: 500 } as const;
const policyActivationSchema = {
  type: 'object', additionalProperties: false, required: ['created', 'policyId', 'version'],
  properties: { created: { type: 'boolean' }, policyId: id, version: { type: 'integer', minimum: 1 } }
} as const;
const operationalMutationResponses = {
  200: categoryConfigSchema, 400: problemDetailsSchema, 401: problemDetailsSchema,
  403: problemDetailsSchema, 404: problemDetailsSchema, 409: problemDetailsSchema, 503: problemDetailsSchema
} as const;

export const listOperationalMasterDataContract = {
  method: 'GET', path: '/api/v1/config/operational-master-data',
  permission: 'catalog.product.update|config.payment_method.manage', idempotency: 'NONE',
  schema: { response: {
    200: { type: 'object', additionalProperties: false, required: ['categories', 'units', 'paymentMethods'], properties: {
      categories: { type: 'array', items: categoryConfigSchema }, units: { type: 'array', items: unitConfigSchema },
      paymentMethods: { type: 'array', items: paymentMethodConfigSchema }
    } }, 401: problemDetailsSchema, 403: problemDetailsSchema
  } }, errorCodes: ['UNAUTHORIZED', 'FORBIDDEN']
} as const satisfies HttpContractV1;

export const saveCategoryContract = {
  method: 'PUT', path: '/api/v1/config/categories', permission: 'catalog.product.update', idempotency: 'REQUIRED',
  schema: { headers, body: { type: 'object', additionalProperties: false, required: ['name', 'isActive', 'reason'], properties: {
    id, name: { type: 'string', minLength: 1, maxLength: 200 }, isActive: { type: 'boolean' }, reason
  } }, response: operationalMutationResponses },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'CATEGORY_NOT_FOUND', 'CATEGORY_IN_USE', 'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY']
} as const satisfies HttpContractV1;

export const saveUnitContract = {
  method: 'PUT', path: '/api/v1/config/units', permission: 'catalog.product.update', idempotency: 'REQUIRED',
  schema: { headers, body: { type: 'object', additionalProperties: false, required: ['code', 'name', 'quantityScale', 'isActive', 'reason'], properties: {
    code: { type: 'string', minLength: 1, maxLength: 32 }, name: { type: 'string', minLength: 1, maxLength: 200 },
    quantityScale: { type: 'integer', minimum: 0, maximum: 6 }, isActive: { type: 'boolean' }, reason
  } }, response: { ...operationalMutationResponses, 200: unitConfigSchema } },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'UNIT_OF_MEASURE_SCALE_IN_USE', 'UNIT_OF_MEASURE_IN_USE', 'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY']
} as const satisfies HttpContractV1;

export const savePaymentMethodContract = {
  method: 'PUT', path: '/api/v1/config/payment-methods', permission: 'config.payment_method.manage', idempotency: 'REQUIRED',
  schema: { headers, body: { type: 'object', additionalProperties: false, required: ['code', 'name', 'kind', 'currencyCode', 'isActive', 'reason'], properties: {
    code: { type: 'string', minLength: 1, maxLength: 32 }, name: { type: 'string', minLength: 1, maxLength: 200 },
    kind: { type: 'string', enum: ['CASH', 'CARD', 'MOBILE_PAYMENT', 'BANK_TRANSFER', 'OTHER'] },
    currencyCode: { type: 'string', minLength: 3, maxLength: 3 }, isActive: { type: 'boolean' }, reason
  } }, response: { ...operationalMutationResponses, 200: paymentMethodConfigSchema } },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'PAYMENT_METHOD_IN_USE', 'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY']
} as const satisfies HttpContractV1;

export const activateDiscountPolicyContract = {
  method: 'POST', path: '/api/v1/config/policies/discount', permission: 'config.tax.manage', idempotency: 'REQUIRED',
  schema: { headers, body: { type: 'object', additionalProperties: false, required: ['maximumBasisPoints', 'reason'], properties: {
    maximumBasisPoints: { type: 'integer', minimum: 0, maximum: 10000 }, reason
  } }, response: { 200: policyActivationSchema, 400: problemDetailsSchema, 401: problemDetailsSchema, 403: problemDetailsSchema, 409: problemDetailsSchema, 503: problemDetailsSchema } },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY']
} as const satisfies HttpContractV1;

export const activateTaxPolicyContract = {
  method: 'POST', path: '/api/v1/config/policies/financial-transaction-tax', permission: 'config.tax.manage', idempotency: 'REQUIRED',
  schema: { headers, body: { type: 'object', additionalProperties: false, required: ['rateBasisPoints', 'eligiblePaymentMethodCodes', 'eligibleCurrencies', 'reason'], properties: {
    rateBasisPoints: { type: 'integer', minimum: 0, maximum: 10000 },
    eligiblePaymentMethodCodes: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 32 } },
    eligibleCurrencies: { type: 'array', items: { type: 'string', minLength: 3, maxLength: 3 } }, reason
  } }, response: { 200: policyActivationSchema, 400: problemDetailsSchema, 401: problemDetailsSchema, 403: problemDetailsSchema, 409: problemDetailsSchema, 503: problemDetailsSchema } },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY']
} as const satisfies HttpContractV1;

export type CreateCashRegisterRequest = { readonly name: string; readonly reason: string };
export type CashRegisterConfigResponse = {
  readonly id: string; readonly name: string; readonly terminalId: string;
  readonly originNodeId: string; readonly isActive: boolean;
};

const cashRegisterConfigSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'name', 'terminalId', 'originNodeId', 'isActive'],
  properties: {
    id: { type: 'string' }, name: { type: 'string' }, terminalId: { type: 'string' },
    originNodeId: { type: 'string' }, isActive: { type: 'boolean' }
  }
} as const;

/**
 * Alta de la caja de esta terminal. El cuerpo solo declara nombre y motivo: el
 * identificador, el terminal y el nodo los fija la identidad del proceso que
 * atiende, para que una petición no pueda declarar una caja de otra terminal.
 */
export const createCashRegisterContract = {
  method: 'POST', path: '/api/v1/config/cash-registers',
  permission: 'config.cash_register.manage', idempotency: 'REQUIRED',
  schema: {
    headers,
    body: {
      type: 'object', additionalProperties: false, required: ['name', 'reason'],
      properties: { name: { type: 'string', minLength: 1, maxLength: 200 }, reason }
    },
    response: { ...operationalMutationResponses, 201: cashRegisterConfigSchema }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'CASH_REGISTER_NAME_CONFLICT',
    'CASH_REGISTER_NAME_REQUIRED', 'IDEMPOTENCY_KEY_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;
