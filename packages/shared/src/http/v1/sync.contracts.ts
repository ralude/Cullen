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

export type SyncReferenceEntryResponse = {
  readonly publishedBy: string | null;
  readonly publishedAt: string | null;
  readonly version: number | null;
  readonly count: number;
  readonly ageMilliseconds: number | null;
};

/**
 * Antigüedad de las referencias recibidas. `null` significa nunca recibida, no
 * vacía: un ping o un ACK de otro tipo no la actualizan.
 */
export type SyncReferenceFreshnessResponse = {
  readonly catalog: SyncReferenceEntryResponse;
  readonly exchangeRate: SyncReferenceEntryResponse & {
    readonly validUntil: string | null;
    readonly expired: boolean;
  };
  readonly operatorGrants: SyncReferenceEntryResponse & {
    readonly expiresAt: string | null;
    readonly expired: boolean;
  };
  readonly stockAvailability: SyncReferenceEntryResponse;
};

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
  readonly references: SyncReferenceFreshnessResponse;
  readonly lastPublishedAt: string | null;
  readonly lastError: string | null;
  readonly observedAt: string;
};

export type OperationalDeliveryResponse = {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly destinationNodeId: string;
  readonly status: 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'BLOCKED' | 'PAUSED';
  readonly attempts: number;
  readonly cycleAttempts: number;
  readonly nextAttemptAt: string;
  readonly leaseUntil: string | null;
  readonly publishedAt: string | null;
  readonly lastError: string | null;
  readonly occurredAt: string;
  readonly ageMilliseconds: number;
};

export type SaleAttentionResponse = {
  readonly saleId: string;
  readonly eventId: string;
  readonly correlationId: string;
  readonly originNodeId: string;
  readonly terminalId: string;
  readonly errorCode: string | null;
  readonly state: 'LOCAL_REJECTED' | 'DELIVERY_PENDING' | 'DELIVERY_BLOCKED'
    | 'APPLICATION_PENDING' | 'APPLICATION_UNKNOWN' | 'DISCREPANCY';
  readonly evidenceState: string;
  readonly occurredAt: string;
  readonly ageMilliseconds: number;
};

export type OperationalDiagnosticsResponse = {
  readonly observedAt: string;
  readonly deliveries: readonly OperationalDeliveryResponse[];
  readonly salesAttention: readonly SaleAttentionResponse[];
  readonly trace: null | {
    readonly events: readonly {
      readonly eventId: string;
      readonly eventType: string;
      readonly aggregateId: string;
      readonly aggregateType: string;
      readonly occurredAt: string;
    }[];
    readonly outbox: readonly {
      readonly eventId: string;
      readonly eventType: string;
      readonly aggregateId: string;
      readonly status: 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'BLOCKED';
      readonly attempts: number;
      readonly nextAttemptAt: string;
      readonly leaseUntil: string | null;
      readonly publishedAt: string | null;
      readonly lastError: string | null;
      readonly occurredAt: string;
    }[];
    readonly deliveries: readonly OperationalDeliveryResponse[];
    readonly audits: readonly {
      readonly auditId: string;
      readonly action: string;
      readonly entityType: string;
      readonly entityId: string;
      readonly occurredAt: string;
      readonly costEvidence: null | {
        readonly unitCostMinorUnits: number | null;
        readonly currencyCode: string | null;
        readonly source: string | null;
      };
    }[];
  };
};

export type ResumeSyncDeliveryRequest = { readonly reason: string };

export type SyncDiscrepancyActionRequest = { readonly reason: string };

const referenceEntrySchema = (extra: Record<string, unknown> = {}) => ({
  type: 'object',
  additionalProperties: false,
  required: [
    'publishedBy', 'publishedAt', 'version', 'count', 'ageMilliseconds', ...Object.keys(extra)
  ],
  properties: {
    publishedBy: { type: ['string', 'null'] },
    publishedAt: { type: ['string', 'null'] },
    version: { type: ['integer', 'null'] },
    count: { type: 'integer' },
    ageMilliseconds: { type: ['integer', 'null'] },
    ...extra
  }
} as const);

const referenceFreshnessSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['catalog', 'exchangeRate', 'operatorGrants', 'stockAvailability'],
  properties: {
    catalog: referenceEntrySchema(),
    exchangeRate: referenceEntrySchema({
      validUntil: { type: ['string', 'null'] },
      expired: { type: 'boolean' }
    }),
    operatorGrants: referenceEntrySchema({
      expiresAt: { type: ['string', 'null'] },
      expired: { type: 'boolean' }
    }),
    stockAvailability: referenceEntrySchema()
  }
} as const;

const syncStatusResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'destinationNodeId', 'status', 'connectivity', 'pendingDeliveries', 'pausedDeliveries',
    'blockedDeliveries', 'pendingApplications', 'openDiscrepancies', 'referencesUsable',
    'pendingReferences', 'references', 'lastPublishedAt', 'lastError', 'observedAt'
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
    references: referenceFreshnessSchema,
    lastPublishedAt: { type: ['string', 'null'] },
    lastError: { type: ['string', 'null'] },
    observedAt: { type: 'string' }
  }
} as const;

const deliveryDiagnosticSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'eventId', 'eventType', 'aggregateId', 'correlationId', 'destinationNodeId', 'status',
    'attempts', 'cycleAttempts', 'nextAttemptAt', 'leaseUntil', 'publishedAt', 'lastError',
    'occurredAt', 'ageMilliseconds'
  ],
  properties: {
    eventId: { type: 'string' },
    eventType: { type: 'string' },
    aggregateId: { type: 'string' },
    correlationId: { type: 'string' },
    destinationNodeId: { type: 'string' },
    status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'PUBLISHED', 'BLOCKED', 'PAUSED'] },
    attempts: { type: 'integer' },
    cycleAttempts: { type: 'integer' },
    nextAttemptAt: { type: 'string' },
    leaseUntil: { type: ['string', 'null'] },
    publishedAt: { type: ['string', 'null'] },
    lastError: { type: ['string', 'null'] },
    occurredAt: { type: 'string' },
    ageMilliseconds: { type: 'integer' }
  }
} as const;

const saleAttentionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'saleId', 'eventId', 'correlationId', 'originNodeId', 'terminalId', 'errorCode',
    'state', 'evidenceState', 'occurredAt', 'ageMilliseconds'
  ],
  properties: {
    saleId: { type: 'string' },
    eventId: { type: 'string' },
    correlationId: { type: 'string' },
    originNodeId: { type: 'string' },
    terminalId: { type: 'string' },
    errorCode: { type: ['string', 'null'] },
    state: {
      type: 'string',
      enum: [
        'LOCAL_REJECTED', 'DELIVERY_PENDING', 'DELIVERY_BLOCKED',
        'APPLICATION_PENDING', 'APPLICATION_UNKNOWN', 'DISCREPANCY'
      ]
    },
    evidenceState: { type: 'string' },
    occurredAt: { type: 'string' },
    ageMilliseconds: { type: 'integer' }
  }
} as const;

const operationalDiagnosticsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['observedAt', 'deliveries', 'salesAttention', 'trace'],
  properties: {
    observedAt: { type: 'string' },
    deliveries: { type: 'array', items: deliveryDiagnosticSchema },
    salesAttention: { type: 'array', items: saleAttentionSchema },
    trace: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['events', 'outbox', 'deliveries', 'audits'],
          properties: {
            events: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false,
                required: ['eventId', 'eventType', 'aggregateId', 'aggregateType', 'occurredAt'],
                properties: {
                  eventId: { type: 'string' }, eventType: { type: 'string' },
                  aggregateId: { type: 'string' }, aggregateType: { type: 'string' },
                  occurredAt: { type: 'string' }
                }
              }
            },
            outbox: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false,
                required: [
                  'eventId', 'eventType', 'aggregateId', 'status', 'attempts', 'nextAttemptAt',
                  'leaseUntil', 'publishedAt', 'lastError', 'occurredAt'
                ],
                properties: {
                  eventId: { type: 'string' }, eventType: { type: 'string' },
                  aggregateId: { type: 'string' },
                  status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'PUBLISHED', 'BLOCKED'] },
                  attempts: { type: 'integer' }, nextAttemptAt: { type: 'string' },
                  leaseUntil: { type: ['string', 'null'] },
                  publishedAt: { type: ['string', 'null'] },
                  lastError: { type: ['string', 'null'] }, occurredAt: { type: 'string' }
                }
              }
            },
            deliveries: { type: 'array', items: deliveryDiagnosticSchema },
            audits: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false,
                required: ['auditId', 'action', 'entityType', 'entityId', 'occurredAt', 'costEvidence'],
                properties: {
                  auditId: { type: 'string' }, action: { type: 'string' },
                  entityType: { type: 'string' }, entityId: { type: 'string' },
                  occurredAt: { type: 'string' },
                  costEvidence: {
                    anyOf: [
                      { type: 'null' },
                      {
                        type: 'object', additionalProperties: false,
                        required: ['unitCostMinorUnits', 'currencyCode', 'source'],
                        properties: {
                          unitCostMinorUnits: { type: ['integer', 'null'] },
                          currencyCode: { type: ['string', 'null'] },
                          source: { type: ['string', 'null'] }
                        }
                      }
                    ]
                  }
                }
              }
            }
          }
        }
      ]
    }
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

/**
 * Diagnóstico allowlist: expone estados, IDs y evidencia de costo, nunca
 * payloads de eventos, pagos ni cuerpos arbitrarios de auditoría.
 */
export const getOperationalDiagnosticsContract = {
  method: 'GET',
  path: '/api/v1/sync/destinations/:destinationNodeId/diagnostics',
  permission: 'sync.reception.review',
  idempotency: 'NONE',
  schema: {
    params: destinationParams,
    querystring: {
      type: 'object',
      additionalProperties: false,
      properties: { correlationId: { type: 'string', minLength: 8, maxLength: 128 } }
    },
    response: {
      200: operationalDiagnosticsSchema,
      401: problemDetailsSchema,
      403: problemDetailsSchema,
      503: problemDetailsSchema
    }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN',
    'SYNC_DESTINATION_INVALID', 'CORRELATION_ID_INVALID', 'DATABASE_BUSY'
  ]
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
    'stockAvailability', 'publishedAt'
  ],
  properties: {
    categories: { type: 'integer' },
    unitsOfMeasure: { type: 'integer' },
    paymentMethods: { type: 'integer' },
    operationalPolicies: { type: 'integer' },
    exchangeRates: { type: 'integer' },
    products: { type: 'integer' },
    stockAvailability: { type: 'integer' },
    publishedAt: { type: 'string' }
  }
} as const;

export type PublishOperatorGrantsRequest = { readonly reason: string };

const operatorGrantsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['operators', 'expiresAt', 'publishedAt'],
  properties: {
    operators: { type: 'integer' },
    expiresAt: { type: 'string' },
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

/**
 * Emite las concesiones de autorización de los operadores. Es el mismo caso de
 * uso que la renovación: cada emisión avanza la versión y declara ocho horas de
 * vigencia desde ese instante. Nunca transporta credenciales.
 */
export const publishOperatorGrantsContract = {
  method: 'POST',
  path: '/api/v1/sync/references/operator-grants/publish',
  permission: 'sync.reference.publish',
  idempotency: 'OPTIONAL',
  schema: {
    headers,
    body: reasonBody,
    response: { 200: operatorGrantsSchema, ...mutationResponses }
  },
  errorCodes: [
    'HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN',
    'SYNC_GRANT_REASON_REQUIRED', 'DATABASE_BUSY'
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

export type CoordinatedOperationStatusResponse =
  | 'PENDING_RECONCILIATION'
  | 'COMPLETED'
  | 'NEEDS_REVIEW';

export type CoordinatedOperationResponse = {
  readonly operationId: string;
  readonly kind: 'PURCHASE_RECEIPT_COMPLETION' | 'STOCK_COUNT_APPROVAL' | 'SALE_RETURN';
  readonly status: CoordinatedOperationStatusResponse;
  readonly fingerprint: string;
  readonly coordinatorNodeId: string | null;
  readonly reason: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly steps: readonly {
    readonly step: 'LOCAL_EFFECT' | 'COORDINATOR_EFFECT';
    readonly state: 'PENDING' | 'APPLIED' | 'REJECTED';
    readonly nodeId: string;
    readonly recordedAt: string;
  }[];
};

const coordinatedOperationSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'operationId', 'kind', 'status', 'fingerprint', 'coordinatorNodeId', 'reason',
    'startedAt', 'updatedAt', 'steps'
  ],
  properties: {
    operationId: { type: 'string' },
    kind: {
      type: 'string',
      enum: ['PURCHASE_RECEIPT_COMPLETION', 'STOCK_COUNT_APPROVAL', 'SALE_RETURN']
    },
    status: {
      type: 'string',
      enum: ['PENDING_RECONCILIATION', 'COMPLETED', 'NEEDS_REVIEW']
    },
    fingerprint: { type: 'string' },
    coordinatorNodeId: { type: ['string', 'null'] },
    reason: { type: 'string' },
    startedAt: { type: 'string' },
    updatedAt: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['step', 'state', 'nodeId', 'recordedAt'],
        properties: {
          step: { type: 'string', enum: ['LOCAL_EFFECT', 'COORDINATOR_EFFECT'] },
          state: { type: 'string', enum: ['PENDING', 'APPLIED', 'REJECTED'] },
          nodeId: { type: 'string' },
          recordedAt: { type: 'string' }
        }
      }
    }
  }
} as const;

/**
 * Operaciones distribuidas de stock por estado. Hace visible el «pendiente de
 * conciliación»: sin evidencia de todos los pasos obligatorios una operación no
 * se presenta como exitosa, y un timeout nunca la cancela.
 */
export const listCoordinatedOperationsContract = {
  method: 'GET',
  path: '/api/v1/sync/coordinated-operations/:status',
  permission: 'sync.reception.review',
  idempotency: 'NONE',
  schema: {
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: {
        status: {
          type: 'string',
          enum: ['PENDING_RECONCILIATION', 'COMPLETED', 'NEEDS_REVIEW']
        }
      }
    },
    response: {
      200: { type: 'array', items: coordinatedOperationSchema },
      400: problemDetailsSchema,
      401: problemDetailsSchema,
      403: problemDetailsSchema,
      503: problemDetailsSchema
    }
  },
  errorCodes: ['HTTP_VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'DATABASE_BUSY']
} as const satisfies HttpContractV1;
