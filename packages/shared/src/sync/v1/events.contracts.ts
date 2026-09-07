import type { JsonObject } from '../../json.js';

/** Versión del sobre de transporte, independiente de la versión de cada payload. */
export const SYNC_PROTOCOL_VERSION_V1 = 1;

/**
 * Sobre JSON que transporta un hecho entre nodos. `protocolVersion` versiona el
 * sobre; `contractVersion` versiona el payload de cada `eventType`. Los
 * metadatos locales de la cola de salida (estado, intentos, lease) no viajan.
 */
export type SyncEnvelopeV1 = {
  readonly protocolVersion: number;
  readonly eventId: string;
  readonly eventType: string;
  readonly contractVersion: number;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly aggregateVersion: number;
  readonly originNodeId: string;
  readonly correlationId: string;
  readonly actorId: string;
  /** Texto UTC canónico producido por `Date#toISOString`. */
  readonly occurredAt: string;
  readonly payload: JsonObject;
};

export const SYNC_ENVELOPE_FIELDS_V1 = [
  'protocolVersion',
  'eventId',
  'eventType',
  'contractVersion',
  'aggregateId',
  'aggregateType',
  'aggregateVersion',
  'originNodeId',
  'correlationId',
  'actorId',
  'occurredAt',
  'payload'
] as const;

/**
 * Límites fijados contra los payloads que los productores actuales generan.
 * Un hecho que los exceda se rechaza; nunca se recorta para que quepa.
 */
export const SYNC_LIMITS_V1 = {
  maxEnvelopeBytes: 262_144,
  maxIdentifierLength: 128,
  maxTextLength: 1_024,
  maxArrayLength: 500,
  maxPayloadDepth: 6
} as const;

/**
 * Custodia durable y aplicación comercial son estados distintos: aceptar un
 * hecho no significa que un consumidor ya lo haya aplicado.
 */
export const SYNC_APPLICATION_STATES_V1 = [
  'PENDING_CONSUMER',
  'PENDING_DEPENDENCY',
  'PENDING_REVIEW'
] as const;
export type SyncApplicationStateV1 = (typeof SYNC_APPLICATION_STATES_V1)[number];

export const SYNC_RECEIPT_STATUSES_V1 = [
  'ACCEPTED',
  'DUPLICATE',
  'REJECTED',
  'RETRYABLE'
] as const;
export type SyncReceiptStatusV1 = (typeof SYNC_RECEIPT_STATUSES_V1)[number];

export type SyncReceiptV1 =
  | {
      readonly protocolVersion: number;
      readonly eventId: string;
      readonly receiverNodeId: string;
      readonly status: 'ACCEPTED' | 'DUPLICATE';
      readonly application: SyncApplicationStateV1;
    }
  | {
      readonly protocolVersion: number;
      readonly eventId: string;
      readonly receiverNodeId: string;
      readonly status: 'REJECTED' | 'RETRYABLE';
      readonly code: string;
    };

/** Rechazos permanentes: no se reintentan a ciegas. */
export const SYNC_REJECTION_CODES_V1 = [
  'SYNC_ENVELOPE_INVALID',
  'SYNC_PROTOCOL_VERSION_UNSUPPORTED',
  'SYNC_EVENT_TYPE_UNKNOWN',
  'SYNC_CONTRACT_VERSION_UNSUPPORTED',
  'SYNC_AGGREGATE_TYPE_MISMATCH',
  'SYNC_PAYLOAD_INVALID',
  'SYNC_SENDER_NOT_AUTHORIZED',
  'SYNC_AGGREGATE_OWNER_UNRESOLVED',
  'SYNC_EVENT_IDENTITY_CONFLICT'
] as const;
export type SyncRejectionCodeV1 = (typeof SYNC_REJECTION_CODES_V1)[number];

/** Fallos transitorios: persistencia/red indisponible o confirmación ambigua. */
export const SYNC_TRANSIENT_CODES_V1 = [
  'SYNC_RECEIVER_UNAVAILABLE',
  'SYNC_ACK_INVALID'
] as const;
export type SyncTransientCodeV1 = (typeof SYNC_TRANSIENT_CODES_V1)[number];

/**
 * Un código recibido de otro nodo solo se conserva si respeta esta forma:
 * evita que un mensaje remoto arbitrario termine en un log o en `last_error`.
 */
export const SYNC_CODE_PATTERN_V1 = /^[A-Z][A-Z0-9_]{2,63}$/;

export const isSyncRejectionCodeV1 = (value: string): value is SyncRejectionCodeV1 =>
  (SYNC_REJECTION_CODES_V1 as readonly string[]).includes(value);
