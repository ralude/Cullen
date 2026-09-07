import {
  SYNC_LIMITS_V1,
  SYNC_PROTOCOL_VERSION_V1,
  type JsonObject,
  type JsonValue,
  type SyncEnvelopeV1,
  type SyncRejectionCodeV1
} from '@supermarket/shared';
import type { BusinessEventV1 } from './business-event.js';
import {
  findSyncContract,
  matchesSpec,
  withinDepth,
  type SyncEventContractV1
} from './sync-contracts.js';

export type SyncEnvelopeValidation =
  | {
      readonly ok: true;
      readonly envelope: SyncEnvelopeV1;
      readonly contract: SyncEventContractV1;
    }
  | { readonly ok: false; readonly code: SyncRejectionCodeV1 };

/**
 * Construye el sobre por campos permitidos. Un spread del evento reclamado
 * filtraría `status`, `attempts` y el lease del outbox hacia la red.
 */
export const toSyncEnvelope = (event: BusinessEventV1): SyncEnvelopeV1 => ({
  protocolVersion: SYNC_PROTOCOL_VERSION_V1,
  eventId: event.eventId,
  eventType: event.eventType,
  contractVersion: event.contractVersion,
  aggregateId: event.aggregateId,
  aggregateType: event.aggregateType,
  aggregateVersion: event.aggregateVersion,
  originNodeId: event.originNodeId,
  correlationId: event.correlationId,
  actorId: event.actorId,
  occurredAt: event.occurredAt.toISOString(),
  payload: event.payload as JsonObject
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIdentifier = (value: unknown): value is string => typeof value === 'string' &&
  value.trim().length > 0 && value.length <= SYNC_LIMITS_V1.maxIdentifierLength;

const isPositiveVersion = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

/** Solo acepta la representación UTC canónica que produce `toISOString`. */
const isCanonicalUtcTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
};

const ENVELOPE_FIELDS = [
  'protocolVersion', 'eventId', 'eventType', 'contractVersion', 'aggregateId',
  'aggregateType', 'aggregateVersion', 'originNodeId', 'correlationId', 'actorId',
  'occurredAt', 'payload'
] as const;

const hasExactEnvelopeFields = (value: Record<string, unknown>): boolean => {
  const received = Object.keys(value);
  return received.length === ENVELOPE_FIELDS.length &&
    ENVELOPE_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(value, field));
};

const isSerializableJson = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isSerializableJson);
  if (isPlainObject(value)) return Object.values(value).every(isSerializableJson);
  return false;
};

const reject = (code: SyncRejectionCodeV1): SyncEnvelopeValidation => ({ ok: false, code });

/**
 * Valida un sobre recibido desde `unknown`. Distingue estructura inválida,
 * versión de sobre incompatible, tipo desconocido y versión de payload
 * incompatible: ninguno se reinterpreta como v1.
 */
export const validateSyncEnvelope = (input: unknown): SyncEnvelopeValidation => {
  if (!isPlainObject(input) || !hasExactEnvelopeFields(input)) {
    return reject('SYNC_ENVELOPE_INVALID');
  }
  if (!isSerializableJson(input)) return reject('SYNC_ENVELOPE_INVALID');
  if (new TextEncoder().encode(JSON.stringify(input)).length > SYNC_LIMITS_V1.maxEnvelopeBytes) {
    return reject('SYNC_ENVELOPE_INVALID');
  }

  if (input.protocolVersion !== SYNC_PROTOCOL_VERSION_V1) {
    return isPositiveVersion(input.protocolVersion)
      ? reject('SYNC_PROTOCOL_VERSION_UNSUPPORTED')
      : reject('SYNC_ENVELOPE_INVALID');
  }

  const identifiers = ['eventId', 'eventType', 'aggregateId', 'aggregateType', 'originNodeId',
    'correlationId', 'actorId'] as const;
  if (!identifiers.every((field) => isIdentifier(input[field]))) {
    return reject('SYNC_ENVELOPE_INVALID');
  }
  if (!isPositiveVersion(input.aggregateVersion)) return reject('SYNC_ENVELOPE_INVALID');
  if (!isPositiveVersion(input.contractVersion)) return reject('SYNC_ENVELOPE_INVALID');
  if (!isCanonicalUtcTimestamp(input.occurredAt)) return reject('SYNC_ENVELOPE_INVALID');
  if (!isPlainObject(input.payload)) return reject('SYNC_ENVELOPE_INVALID');
  if (!withinDepth(input.payload as JsonValue, SYNC_LIMITS_V1.maxPayloadDepth)) {
    return reject('SYNC_ENVELOPE_INVALID');
  }

  /**
   * El catálogo se indexa por `(eventType, contractVersion)`. Un tipo conocido
   * en una versión que este receptor no publica es un rechazo de versión, no de
   * tipo: distinguirlos permite que el emisor sepa qué corregir.
   */
  if (findSyncContract(input.eventType as string) === undefined) {
    return reject('SYNC_EVENT_TYPE_UNKNOWN');
  }
  const contract = findSyncContract(input.eventType as string, input.contractVersion);
  if (!contract) return reject('SYNC_CONTRACT_VERSION_UNSUPPORTED');
  if (input.aggregateType !== contract.aggregateType) {
    return reject('SYNC_AGGREGATE_TYPE_MISMATCH');
  }
  if (!matchesSpec({ kind: 'object', fields: contract.fields }, input.payload as JsonValue)) {
    return reject('SYNC_PAYLOAD_INVALID');
  }

  return {
    ok: true,
    contract,
    envelope: {
      protocolVersion: SYNC_PROTOCOL_VERSION_V1,
      eventId: input.eventId as string,
      eventType: input.eventType as string,
      contractVersion: input.contractVersion,
      aggregateId: input.aggregateId as string,
      aggregateType: input.aggregateType as string,
      aggregateVersion: input.aggregateVersion,
      originNodeId: input.originNodeId as string,
      correlationId: input.correlationId as string,
      actorId: input.actorId as string,
      occurredAt: input.occurredAt,
      payload: input.payload as JsonObject
    }
  };
};
