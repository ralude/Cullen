import { problemDetailsSchema, type HttpContractV1 } from './common.contracts.js';

/**
 * Administración de identidad (ADR-0027) y enrolamiento local de credenciales
 * (ADR-0028). Ningún contrato transporta un PIN de otro operador: el
 * enrolamiento entrega un ticket y el PIN lo escribe su dueño.
 */
export type IdentityOperatorResponse = {
  readonly userId: string;
  readonly operatorCode: string;
  readonly displayName: string;
  readonly isActive: boolean;
  readonly roleIds: readonly string[];
  readonly roleCodes: readonly string[];
  /** Existe credencial en este nodo. Una concesión no la implica. */
  readonly hasLocalCredential: boolean;
  readonly credentialMustChange: boolean;
};

export type IdentityRoleResponse = {
  readonly roleId: string;
  readonly code: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly isAssignable: boolean;
  readonly permissionCodes: readonly string[];
  readonly memberCount: number;
};

export type IdentityDirectoryResponse = {
  readonly operators: readonly IdentityOperatorResponse[];
  readonly roles: readonly IdentityRoleResponse[];
  readonly permissionCodes: readonly string[];
};

export type CreateOperatorRequest = {
  readonly operatorCode: string;
  readonly displayName: string;
  readonly roleIds: readonly string[];
  readonly reason: string;
};
export type UpdateOperatorRequest = { readonly displayName: string; readonly reason: string };
export type ChangeOperatorStatusRequest = { readonly isActive: boolean; readonly reason: string };
export type AssignOperatorRolesRequest = {
  readonly roleIds: readonly string[];
  readonly reason: string;
};
export type ExpireOperatorCredentialRequest = { readonly reason: string };
export type CreateRoleRequest = {
  readonly code: string;
  readonly name: string;
  readonly permissionCodes: readonly string[];
  readonly reason: string;
};
export type UpdateRolePermissionsRequest = {
  readonly permissionCodes: readonly string[];
  readonly reason: string;
};
export type ChangeRoleStatusRequest = { readonly isActive: boolean; readonly reason: string };

export type AuthorizeCredentialEnrollmentRequest = {
  readonly operatorCode: string;
  readonly reason: string;
};

export type CredentialEnrollmentResponse = {
  readonly enrollmentId: string;
  readonly operatorCode: string;
  readonly displayName: string;
  /** Se entrega una sola vez y no se puede volver a consultar. */
  readonly enrollmentToken: string;
  readonly expiresAt: string;
  readonly replacesCredential: boolean;
};

const id = { type: 'string', minLength: 1, maxLength: 128 } as const;
const reason = { type: 'string', minLength: 1, maxLength: 500 } as const;
const permissionCodes = {
  type: 'array', maxItems: 200, items: { type: 'string', minLength: 1, maxLength: 128 }
} as const;
const roleIds = { type: 'array', maxItems: 50, items: id } as const;

const operatorParams = {
  type: 'object', additionalProperties: false, required: ['userId'], properties: { userId: id }
} as const;
const roleParams = {
  type: 'object', additionalProperties: false, required: ['roleId'], properties: { roleId: id }
} as const;

const operatorSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'userId', 'operatorCode', 'displayName', 'isActive', 'roleIds', 'roleCodes',
    'hasLocalCredential', 'credentialMustChange'
  ],
  properties: {
    userId: id, operatorCode: { type: 'string' }, displayName: { type: 'string' },
    isActive: { type: 'boolean' }, roleIds: { type: 'array', items: id },
    roleCodes: { type: 'array', items: { type: 'string' } },
    hasLocalCredential: { type: 'boolean' }, credentialMustChange: { type: 'boolean' }
  }
} as const;

const roleSchema = {
  type: 'object', additionalProperties: false,
  required: ['roleId', 'code', 'name', 'isActive', 'isAssignable', 'permissionCodes', 'memberCount'],
  properties: {
    roleId: id, code: { type: 'string' }, name: { type: 'string' },
    isActive: { type: 'boolean' }, isAssignable: { type: 'boolean' },
    permissionCodes: { type: 'array', items: { type: 'string' } },
    memberCount: { type: 'integer', minimum: 0 }
  }
} as const;

const commandResponses = {
  400: problemDetailsSchema, 401: problemDetailsSchema, 403: problemDetailsSchema,
  404: problemDetailsSchema, 409: problemDetailsSchema, 503: problemDetailsSchema
} as const;

const IDENTITY_COMMAND_ERRORS = [
  'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'AUTH_PIN_CHANGE_REQUIRED',
  'IDENTITY_NOT_OWNED_BY_NODE', 'IDENTITY_INPUT_INVALID', 'IDENTITY_LAST_ADMINISTRATOR',
  'DATABASE_BUSY'
] as const;

export const getIdentityDirectoryContract = {
  method: 'GET', path: '/api/v1/identity', permission: 'identity.user.manage|identity.role.manage',
  idempotency: 'NONE',
  schema: {
    response: {
      200: {
        type: 'object', additionalProperties: false,
        required: ['operators', 'roles', 'permissionCodes'],
        properties: {
          operators: { type: 'array', items: operatorSchema },
          roles: { type: 'array', items: roleSchema },
          permissionCodes: { type: 'array', items: { type: 'string' } }
        }
      },
      401: problemDetailsSchema, 403: problemDetailsSchema
    }
  },
  errorCodes: ['UNAUTHORIZED', 'FORBIDDEN', 'AUTH_PIN_CHANGE_REQUIRED']
} as const satisfies HttpContractV1;

export const createOperatorContract = {
  method: 'POST', path: '/api/v1/identity/operators', permission: 'identity.user.manage',
  idempotency: 'NONE',
  schema: {
    body: {
      type: 'object', additionalProperties: false,
      required: ['operatorCode', 'displayName', 'roleIds', 'reason'],
      properties: {
        operatorCode: { type: 'string', minLength: 2, maxLength: 32 },
        displayName: { type: 'string', minLength: 1, maxLength: 200 },
        roleIds, reason
      }
    },
    response: { 201: operatorSchema, ...commandResponses }
  },
  errorCodes: [
    ...IDENTITY_COMMAND_ERRORS, 'IDENTITY_OPERATOR_CODE_TAKEN', 'USER_ROLE_NOT_ASSIGNABLE',
    'IDENTITY_ROLE_NOT_FOUND', 'USER_DISPLAY_NAME_REQUIRED'
  ]
} as const satisfies HttpContractV1;

export const updateOperatorContract = {
  method: 'PUT', path: '/api/v1/identity/operators/:userId', permission: 'identity.user.manage',
  idempotency: 'NONE',
  schema: {
    params: operatorParams,
    body: {
      type: 'object', additionalProperties: false, required: ['displayName', 'reason'],
      properties: { displayName: { type: 'string', minLength: 1, maxLength: 200 }, reason }
    },
    response: { 200: operatorSchema, ...commandResponses }
  },
  errorCodes: [...IDENTITY_COMMAND_ERRORS, 'IDENTITY_OPERATOR_NOT_FOUND', 'USER_DISPLAY_NAME_REQUIRED']
} as const satisfies HttpContractV1;

export const changeOperatorStatusContract = {
  method: 'PUT', path: '/api/v1/identity/operators/:userId/status',
  permission: 'identity.user.manage', idempotency: 'NONE',
  schema: {
    params: operatorParams,
    body: {
      type: 'object', additionalProperties: false, required: ['isActive', 'reason'],
      properties: { isActive: { type: 'boolean' }, reason }
    },
    response: { 200: operatorSchema, ...commandResponses }
  },
  errorCodes: [...IDENTITY_COMMAND_ERRORS, 'IDENTITY_OPERATOR_NOT_FOUND']
} as const satisfies HttpContractV1;

export const assignOperatorRolesContract = {
  method: 'PUT', path: '/api/v1/identity/operators/:userId/roles',
  permission: 'identity.user.manage', idempotency: 'NONE',
  schema: {
    params: operatorParams,
    body: {
      type: 'object', additionalProperties: false, required: ['roleIds', 'reason'],
      properties: { roleIds, reason }
    },
    response: { 200: operatorSchema, ...commandResponses }
  },
  errorCodes: [
    ...IDENTITY_COMMAND_ERRORS, 'IDENTITY_OPERATOR_NOT_FOUND', 'IDENTITY_ROLE_NOT_FOUND',
    'USER_ROLE_NOT_ASSIGNABLE'
  ]
} as const satisfies HttpContractV1;

export const expireOperatorCredentialContract = {
  method: 'POST', path: '/api/v1/identity/operators/:userId/credential-expiration',
  permission: 'identity.user.manage', idempotency: 'NONE',
  schema: {
    params: operatorParams,
    body: {
      type: 'object', additionalProperties: false, required: ['reason'], properties: { reason }
    },
    response: { 204: { type: 'null' }, ...commandResponses }
  },
  errorCodes: [...IDENTITY_COMMAND_ERRORS, 'IDENTITY_CREDENTIAL_NOT_FOUND']
} as const satisfies HttpContractV1;

export const createRoleContract = {
  method: 'POST', path: '/api/v1/identity/roles', permission: 'identity.role.manage',
  idempotency: 'NONE',
  schema: {
    body: {
      type: 'object', additionalProperties: false,
      required: ['code', 'name', 'permissionCodes', 'reason'],
      properties: {
        code: { type: 'string', minLength: 1, maxLength: 32 },
        name: { type: 'string', minLength: 1, maxLength: 200 },
        permissionCodes, reason
      }
    },
    response: { 201: roleSchema, ...commandResponses }
  },
  errorCodes: [
    ...IDENTITY_COMMAND_ERRORS, 'IDENTITY_ROLE_CODE_TAKEN', 'IDENTITY_PERMISSION_UNKNOWN',
    'ROLE_INVALID_CODE', 'ROLE_NAME_REQUIRED'
  ]
} as const satisfies HttpContractV1;

export const updateRolePermissionsContract = {
  method: 'PUT', path: '/api/v1/identity/roles/:roleId/permissions',
  permission: 'identity.role.manage', idempotency: 'NONE',
  schema: {
    params: roleParams,
    body: {
      type: 'object', additionalProperties: false, required: ['permissionCodes', 'reason'],
      properties: { permissionCodes, reason }
    },
    response: { 200: roleSchema, ...commandResponses }
  },
  errorCodes: [
    ...IDENTITY_COMMAND_ERRORS, 'IDENTITY_ROLE_NOT_FOUND', 'IDENTITY_PERMISSION_UNKNOWN'
  ]
} as const satisfies HttpContractV1;

export const changeRoleStatusContract = {
  method: 'PUT', path: '/api/v1/identity/roles/:roleId/status',
  permission: 'identity.role.manage', idempotency: 'NONE',
  schema: {
    params: roleParams,
    body: {
      type: 'object', additionalProperties: false, required: ['isActive', 'reason'],
      properties: { isActive: { type: 'boolean' }, reason }
    },
    response: { 200: roleSchema, ...commandResponses }
  },
  errorCodes: [...IDENTITY_COMMAND_ERRORS, 'IDENTITY_ROLE_NOT_FOUND']
} as const satisfies HttpContractV1;

export const authorizeCredentialEnrollmentContract = {
  method: 'POST', path: '/api/v1/identity/credential-enrollments',
  permission: 'identity.credential.reset', idempotency: 'NONE',
  schema: {
    body: {
      type: 'object', additionalProperties: false, required: ['operatorCode', 'reason'],
      properties: { operatorCode: { type: 'string', minLength: 1, maxLength: 64 }, reason }
    },
    response: {
      201: {
        type: 'object', additionalProperties: false,
        required: [
          'enrollmentId', 'operatorCode', 'displayName', 'enrollmentToken', 'expiresAt',
          'replacesCredential'
        ],
        properties: {
          enrollmentId: id, operatorCode: { type: 'string' }, displayName: { type: 'string' },
          enrollmentToken: { type: 'string' },
          expiresAt: { type: 'string', format: 'date-time' },
          replacesCredential: { type: 'boolean' }
        }
      },
      ...commandResponses
    }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'AUTH_PIN_CHANGE_REQUIRED',
    'IDENTITY_INPUT_INVALID', 'IDENTITY_OPERATOR_NOT_FOUND', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;
