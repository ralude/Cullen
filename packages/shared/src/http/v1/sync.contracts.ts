import { problemDetailsSchema, type HttpContractV1 } from './common.contracts.js';

export type SyncNodeRoleResponse = 'COORDINATOR' | 'TERMINAL';
export type SyncNodeStatusResponse = 'ACTIVE' | 'REVOKED';

export type SyncNodeResponse = {
  readonly nodeId: string;
  readonly storeId: string;
  readonly role: SyncNodeRoleResponse;
  readonly terminalId: string | null;
  readonly credentialFingerprint: string;
  /** Dónde escucha el nodo si recibe entregas; host y puerto van juntos. */
  readonly addressHost: string | null;
  readonly addressPort: number | null;
  readonly status: SyncNodeStatusResponse;
  readonly notAfter: string;
  readonly registeredAt: string;
  readonly revokedAt: string | null;
};

export type RegisterSyncNodeRequest = {
  readonly nodeId: string;
  readonly storeId: string;
  readonly role: SyncNodeRoleResponse;
  readonly terminalId?: string;
  readonly credentialFingerprint: string;
  readonly addressHost?: string;
  readonly addressPort?: number;
  readonly notAfter: string;
  readonly reason: string;
};

export type RevokeSyncNodeRequest = { readonly reason: string };

const headers = {
  type: 'object',
  properties: { 'idempotency-key': { type: 'string', minLength: 8, maxLength: 128 } }
} as const;

const syncNodeResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'nodeId', 'storeId', 'role', 'terminalId', 'credentialFingerprint',
    'addressHost', 'addressPort', 'status', 'notAfter', 'registeredAt', 'revokedAt'
  ],
  properties: {
    nodeId: { type: 'string' },
    storeId: { type: 'string' },
    role: { type: 'string', enum: ['COORDINATOR', 'TERMINAL'] },
    terminalId: { type: ['string', 'null'] },
    credentialFingerprint: { type: 'string' },
    addressHost: { type: ['string', 'null'] },
    addressPort: { type: ['integer', 'null'] },
    status: { type: 'string', enum: ['ACTIVE', 'REVOKED'] },
    notAfter: { type: 'string' },
    registeredAt: { type: 'string' },
    revokedAt: { type: ['string', 'null'] }
  }
} as const;

const mutationResponses = {
  400: problemDetailsSchema,
  401: problemDetailsSchema,
  403: problemDetailsSchema,
  404: problemDetailsSchema,
  409: problemDetailsSchema,
  503: problemDetailsSchema
} as const;

/**
 * Administración de la confianza entre nodos. Vive en la API de operadores en
 * loopback y exige sesión y permiso: la identidad de máquina del transporte
 * nunca da acceso a estas rutas.
 */
export const registerSyncNodeContract = {
  method: 'POST',
  path: '/api/v1/sync/nodes',
  permission: 'sync.node.manage',
  idempotency: 'OPTIONAL',
  schema: {
    headers,
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['nodeId', 'storeId', 'role', 'credentialFingerprint', 'notAfter', 'reason'],
      properties: {
        nodeId: { type: 'string', minLength: 2, maxLength: 128 },
        storeId: { type: 'string', minLength: 2, maxLength: 128 },
        role: { type: 'string', enum: ['COORDINATOR', 'TERMINAL'] },
        terminalId: { type: 'string', minLength: 2, maxLength: 128 },
        credentialFingerprint: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        addressHost: { type: 'string', minLength: 1, maxLength: 253 },
        addressPort: { type: 'integer', minimum: 1, maximum: 65535 },
        notAfter: { type: 'string', minLength: 20, maxLength: 40 },
        reason: { type: 'string', minLength: 1, maxLength: 500 }
      }
    },
    response: { 201: syncNodeResponseSchema, ...mutationResponses }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'SYNC_NODE_IDENTIFIER_INVALID',
    'SYNC_NODE_FINGERPRINT_INVALID', 'SYNC_NODE_TERMINAL_REQUIRED',
    'SYNC_NODE_TERMINAL_UNEXPECTED', 'SYNC_NODE_VALIDITY_INVALID', 'SYNC_NODE_REASON_REQUIRED',
    'SYNC_NODE_CREDENTIAL_EXPIRED', 'SYNC_NODE_ALREADY_REGISTERED', 'SYNC_NODE_CREDENTIAL_IN_USE',
    'SYNC_NODE_ADDRESS_INCOMPLETE', 'SYNC_NODE_ADDRESS_INVALID',
    'SYNC_NODE_REGISTRATION_CONFLICT', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const revokeSyncNodeContract = {
  method: 'POST',
  path: '/api/v1/sync/nodes/:nodeId/revocation',
  permission: 'sync.node.manage',
  idempotency: 'OPTIONAL',
  schema: {
    headers,
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['nodeId'],
      properties: { nodeId: { type: 'string', minLength: 2, maxLength: 128 } }
    },
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['reason'],
      properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } }
    },
    response: { 200: syncNodeResponseSchema, ...mutationResponses }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'SYNC_NODE_NOT_FOUND',
    'SYNC_NODE_ALREADY_REVOKED', 'SYNC_NODE_REASON_REQUIRED', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export type SyncStatusResponse =
  | 'OFFLINE'
  | 'CONNECTING'
  | 'SYNCING'
  | 'SYNCED'
  | 'ATTENTION_REQUIRED';

export type SyncDestinationStatusResponse = {
  readonly destinationNodeId: string;
  readonly status: SyncStatusResponse;
  readonly connectivity: 'ONLINE' | 'OFFLINE' | 'CONNECTING' | 'UNKNOWN';
  readonly pendingDeliveries: number;
  readonly pausedDeliveries: number;
  readonly blockedDeliveries: number;
  readonly pendingApplications: number;
  readonly openDiscrepancies: number;
  readonly referencesUsable: boolean;
  readonly pendingReferences: number;
  readonly lastPublishedAt: string | null;
  readonly lastError: string | null;
  readonly observedAt: string;
};

export type ResumeSyncDeliveryRequest = { readonly reason: string };

export type SyncDiscrepancyActionRequest = { readonly reason: string };

const syncStatusResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'destinationNodeId', 'status', 'connectivity', 'pendingDeliveries', 'pausedDeliveries',
    'blockedDeliveries', 'pendingApplications', 'openDiscrepancies', 'referencesUsable',
    'pendingReferences', 'lastPublishedAt', 'lastError', 'observedAt'
  ],
  properties: {
    destinationNodeId: { type: 'string' },
    status: {
      type: 'string',
      enum: ['OFFLINE', 'CONNECTING', 'SYNCING', 'SYNCED', 'ATTENTION_REQUIRED']
    },
    connectivity: { type: 'string', enum: ['ONLINE', 'OFFLINE', 'CONNECTING', 'UNKNOWN'] },
    pendingDeliveries: { type: 'integer' },
    pausedDeliveries: { type: 'integer' },
    blockedDeliveries: { type: 'integer' },
    pendingApplications: { type: 'integer' },
    openDiscrepancies: { type: 'integer' },
    referencesUsable: { type: 'boolean' },
    pendingReferences: { type: 'integer' },
    lastPublishedAt: { type: ['string', 'null'] },
    lastError: { type: ['string', 'null'] },
    observedAt: { type: 'string' }
  }
} as const;

const pausedDeliverySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['eventId', 'destinationNodeId', 'lastError', 'pausedAt'],
  properties: {
    eventId: { type: 'string' },
    destinationNodeId: { type: 'string' },
    lastError: { type: ['string', 'null'] },
    pausedAt: { type: 'string' }
  }
} as const;

const discrepancySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'discrepancyId', 'eventId', 'consumer', 'reasonCode', 'detail', 'status',
    'openedAt', 'resolvedAt'
  ],
  properties: {
    discrepancyId: { type: 'string' },
    eventId: { type: 'string' },
    consumer: { type: 'string' },
    reasonCode: { type: 'string' },
    detail: {},
    status: { type: 'string', enum: ['OPEN', 'RESOLVED'] },
    openedAt: { type: 'string' },
    resolvedAt: { type: ['string', 'null'] }
  }
} as const;

const destinationParams = {
  type: 'object',
  additionalProperties: false,
  required: ['destinationNodeId'],
  properties: { destinationNodeId: { type: 'string', minLength: 2, maxLength: 128 } }
} as const;

const reasonBody = {
  type: 'object',
  additionalProperties: false,
  required: ['reason'],
  properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } }
} as const;

/**
 * Estado observable de la sincronización hacia un destino. Es una lectura de
 * evidencia durable: no confirma entregas ni promete actualidad global.
 */
export const getSyncStatusContract = {
  method: 'GET',
  path: '/api/v1/sync/destinations/:destinationNodeId/status',
  permission: 'sync.reception.review',
  idempotency: 'NONE',
  schema: {
    params: destinationParams,
    response: {
      200: syncStatusResponseSchema,
      401: problemDetailsSchema,
      403: problemDetailsSchema,
      503: problemDetailsSchema
    }
  },
  errorCodes: ['UNAUTHORIZED', 'FORBIDDEN', 'DATABASE_BUSY']
} as const satisfies HttpContractV1;

export const listPausedDeliveriesContract = {
  method: 'GET',
  path: '/api/v1/sync/destinations/:destinationNodeId/paused',
  permission: 'sync.reception.review',
  idempotency: 'NONE',
  schema: {
    params: destinationParams,
    response: {
      200: { type: 'array', items: pausedDeliverySchema },
      401: problemDetailsSchema,
      403: problemDetailsSchema,
      503: problemDetailsSchema
    }
  },
  errorCodes: ['UNAUTHORIZED', 'FORBIDDEN', 'DATABASE_BUSY']
} as const satisfies HttpContractV1;

/**
 * Reanudación manual autorizada de una entrega agotada. Conserva identidad,
 * payload e historia del hecho: no existe un descarte que lo pierda.
 */
export const resumeSyncDeliveryContract = {
  method: 'POST',
  path: '/api/v1/sync/destinations/:destinationNodeId/deliveries/:eventId/resumption',
  permission: 'sync.delivery.resume',
  idempotency: 'OPTIONAL',
  schema: {
    headers,
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['destinationNodeId', 'eventId'],
      properties: {
        destinationNodeId: { type: 'string', minLength: 2, maxLength: 128 },
        eventId: { type: 'string', minLength: 1, maxLength: 128 }
      }
    },
    body: reasonBody,
    response: { 200: pausedDeliverySchema, ...mutationResponses }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'SYNC_DELIVERY_NOT_PAUSED',
    'SYNC_RESUME_REASON_REQUIRED', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const listSyncDiscrepanciesContract = {
  method: 'GET',
  path: '/api/v1/sync/discrepancies',
  permission: 'sync.reception.review',
  idempotency: 'NONE',
  schema: {
    querystring: {
      type: 'object',
      additionalProperties: false,
      properties: { status: { type: 'string', enum: ['OPEN', 'RESOLVED'] } }
    },
    response: {
      200: { type: 'array', items: discrepancySchema },
      401: problemDetailsSchema,
      403: problemDetailsSchema,
      503: problemDetailsSchema
    }
  },
  errorCodes: ['UNAUTHORIZED', 'FORBIDDEN', 'DATABASE_BUSY']
} as const satisfies HttpContractV1;

export const retrySyncDiscrepancyContract = {
  method: 'POST',
  path: '/api/v1/sync/discrepancies/:discrepancyId/retry',
  permission: 'sync.discrepancy.resolve',
  idempotency: 'OPTIONAL',
  schema: {
    headers,
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['discrepancyId'],
      properties: { discrepancyId: { type: 'string', minLength: 1, maxLength: 128 } }
    },
    body: reasonBody,
    response: { 200: discrepancySchema, ...mutationResponses }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'SYNC_DISCREPANCY_NOT_FOUND',
    'SYNC_DISCREPANCY_ALREADY_RESOLVED', 'SYNC_DISCREPANCY_REASON_REQUIRED', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

/**
 * Cierre de una discrepancia. Solo evidencia de aplicación permite marcarla
 * resuelta: un reconocimiento no borra la obligación de inventario.
 */
export const resolveSyncDiscrepancyContract = {
  method: 'POST',
  path: '/api/v1/sync/discrepancies/:discrepancyId/resolution',
  permission: 'sync.discrepancy.resolve',
  idempotency: 'OPTIONAL',
  schema: {
    headers,
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['discrepancyId'],
      properties: { discrepancyId: { type: 'string', minLength: 1, maxLength: 128 } }
    },
    body: reasonBody,
    response: { 200: discrepancySchema, ...mutationResponses }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'SYNC_DISCREPANCY_NOT_FOUND',
    'SYNC_DISCREPANCY_ALREADY_RESOLVED', 'SYNC_DISCREPANCY_NOT_APPLIED',
    'SYNC_DISCREPANCY_REASON_REQUIRED', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export type PublishCatalogBootstrapRequest = { readonly reason: string };

const catalogBootstrapSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'categories', 'unitsOfMeasure', 'paymentMethods', 'operationalPolicies', 'exchangeRates', 'products',
    'publishedAt'
  ],
  properties: {
    categories: { type: 'integer' },
    unitsOfMeasure: { type: 'integer' },
    paymentMethods: { type: 'integer' },
    operationalPolicies: { type: 'integer' },
    exchangeRates: { type: 'integer' },
    products: { type: 'integer' },
    publishedAt: { type: 'string' }
  }
} as const;

/**
 * Publica el corte inicial de catálogo y métodos de pago. Usa los mismos
 * contratos que un cambio ordinario, así que repetirlo es seguro: el consumidor
 * descarta lo que no sea posterior a lo ya aplicado.
 */
export const publishCatalogBootstrapContract = {
  method: 'POST',
  path: '/api/v1/sync/references/catalog/bootstrap',
  permission: 'sync.reference.publish',
  idempotency: 'OPTIONAL',
  schema: {
    headers,
    body: reasonBody,
    response: { 200: catalogBootstrapSchema, ...mutationResponses }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN',
    'SYNC_BOOTSTRAP_REASON_REQUIRED', 'DATABASE_BUSY'
  ]
} as const satisfies HttpContractV1;

export const listSyncNodesContract = {
  method: 'GET',
  path: '/api/v1/sync/nodes',
  permission: 'sync.node.manage',
  idempotency: 'NONE',
  schema: {
    response: {
      200: { type: 'array', items: syncNodeResponseSchema },
      401: problemDetailsSchema,
      403: problemDetailsSchema,
      503: problemDetailsSchema
    }
  },
  errorCodes: ['UNAUTHORIZED', 'FORBIDDEN', 'DATABASE_BUSY']
} as const satisfies HttpContractV1;
