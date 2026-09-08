import { problemDetailsSchema, type HttpContractV1 } from './common.contracts.js';

export type LoginRequest = { readonly operatorCode: string; readonly pin: string };
export type SessionResponse = {
  readonly actorId: string;
  readonly displayName: string;
  readonly roleCodes: readonly string[];
  readonly permissionCodes: readonly string[];
  readonly idleExpiresAt: string;
  readonly absoluteExpiresAt: string;
  /**
   * La sesión es válida pero está restringida al cambio de PIN (ADR-0027 D3):
   * cualquier otra petición autenticada recibe `AUTH_PIN_CHANGE_REQUIRED`.
   */
  readonly credentialMustChange: boolean;
};

export type ChangeOwnPinRequest = {
  readonly currentPin: string;
  readonly newPin: string;
};

export type CompleteCredentialEnrollmentRequest = {
  readonly enrollmentToken: string;
  readonly pin: string;
};

export const loginContract = {
  method: 'POST', path: '/api/v1/auth/session', permission: null, idempotency: 'NONE',
  schema: {
    body: {
      type: 'object', additionalProperties: false, required: ['operatorCode', 'pin'],
      properties: {
        operatorCode: { type: 'string', minLength: 1, maxLength: 64 },
        pin: { type: 'string', pattern: '^[0-9]{6,12}$' }
      }
    },
    response: {
      200: {
        type: 'object', additionalProperties: false,
        required: [
          'actorId', 'displayName', 'roleCodes', 'permissionCodes',
          'idleExpiresAt', 'absoluteExpiresAt', 'credentialMustChange'
        ],
        properties: {
          actorId: { type: 'string' }, displayName: { type: 'string' },
          roleCodes: { type: 'array', items: { type: 'string' } },
          permissionCodes: { type: 'array', items: { type: 'string' } },
          idleExpiresAt: { type: 'string' }, absoluteExpiresAt: { type: 'string' },
          credentialMustChange: { type: 'boolean' }
        }
      },
      400: problemDetailsSchema,
      401: problemDetailsSchema
    }
  },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'AUTHENTICATION_FAILED']
} as const satisfies HttpContractV1;

export const currentSessionContract = {
  method: 'GET', path: '/api/v1/auth/session', permission: null, idempotency: 'NONE',
  schema: { response: { 200: loginContract.schema.response[200], 401: problemDetailsSchema } },
  errorCodes: ['UNAUTHORIZED']
} as const satisfies HttpContractV1;

export const logoutContract = {
  method: 'DELETE', path: '/api/v1/auth/session', permission: null, idempotency: 'NONE',
  schema: { response: { 204: { type: 'null' }, 401: problemDetailsSchema } },
  errorCodes: ['UNAUTHORIZED']
} as const satisfies HttpContractV1;


/**
 * Cambio del PIN propio. Exige sesión válida y ningún permiso: es la única
 * operación que una sesión restringida puede ejecutar además de cerrarse.
 */
export const changeOwnPinContract = {
  method: 'PUT', path: '/api/v1/auth/pin', permission: null, idempotency: 'NONE',
  schema: {
    body: {
      type: 'object', additionalProperties: false, required: ['currentPin', 'newPin'],
      properties: {
        currentPin: { type: 'string', pattern: '^[0-9]{6,12}$' },
        newPin: { type: 'string', pattern: '^[0-9]{6,12}$' }
      }
    },
    response: {
      204: { type: 'null' }, 400: problemDetailsSchema, 401: problemDetailsSchema,
      404: problemDetailsSchema, 503: problemDetailsSchema
    }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'AUTHENTICATION_FAILED',
    'AUTH_PIN_POLICY_VIOLATION', 'IDENTITY_CREDENTIAL_NOT_FOUND'
  ]
} as const satisfies HttpContractV1;

/**
 * Consumo del ticket de enrolamiento (ADR-0028). No exige sesión: el operador
 * todavía no puede iniciarla. La autoridad es el ticket de un solo uso.
 */
export const completeCredentialEnrollmentContract = {
  method: 'POST', path: '/api/v1/auth/credential-enrollment', permission: null,
  idempotency: 'NONE',
  schema: {
    body: {
      type: 'object', additionalProperties: false, required: ['enrollmentToken', 'pin'],
      properties: {
        enrollmentToken: { type: 'string', minLength: 1, maxLength: 256 },
        pin: { type: 'string', pattern: '^[0-9]{6,12}$' }
      }
    },
    response: {
      200: {
        type: 'object', additionalProperties: false, required: ['operatorCode'],
        properties: { operatorCode: { type: 'string' } }
      },
      400: problemDetailsSchema, 404: problemDetailsSchema, 409: problemDetailsSchema,
      503: problemDetailsSchema
    }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'AUTH_PIN_POLICY_VIOLATION', 'IDENTITY_ENROLLMENT_NOT_FOUND',
    'IDENTITY_ENROLLMENT_EXPIRED', 'IDENTITY_ENROLLMENT_CONSUMED',
    'IDENTITY_ENROLLMENT_NODE_MISMATCH', 'IDENTITY_OPERATOR_NOT_FOUND'
  ]
} as const satisfies HttpContractV1;
