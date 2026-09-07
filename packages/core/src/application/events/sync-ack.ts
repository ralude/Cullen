import {
  SYNC_CODE_PATTERN_V1,
  SYNC_PROTOCOL_VERSION_V1,
  type SyncEnvelopeV1
} from '@supermarket/shared';

/**
 * Resultado de una entrega desde la salida local. Solo una aceptación o un
 * duplicado durables, correspondientes al evento y al destino de la solicitud,
 * permiten completar la publicación.
 */
export type SyncDeliveryOutcome =
  | { readonly outcome: 'CONFIRMED' }
  | { readonly outcome: 'REJECTED'; readonly code: string }
  | { readonly outcome: 'RETRYABLE'; readonly code: string };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ACK_FIELDS = ['protocolVersion', 'eventId', 'receiverNodeId', 'status'] as const;

const hasFields = (
  value: Record<string, unknown>,
  extra: 'application' | 'code'
): boolean => {
  const expected = [...ACK_FIELDS, extra];
  return Object.keys(value).length === expected.length &&
    expected.every((field) => Object.prototype.hasOwnProperty.call(value, field));
};

const ambiguous: SyncDeliveryOutcome = { outcome: 'RETRYABLE', code: 'SYNC_ACK_INVALID' };

/**
 * Interpreta la confirmación remota. Un éxito de transporte aislado, un ACK mal
 * formado o uno de otro evento/destino no confirma la entrega: se conserva la
 * reentrega del mismo `eventId`.
 */
export const interpretSyncAck = (
  raw: unknown,
  request: { readonly envelope: SyncEnvelopeV1; readonly destinationNodeId: string | null }
): SyncDeliveryOutcome => {
  if (!isPlainObject(raw)) return ambiguous;
  if (raw.protocolVersion !== SYNC_PROTOCOL_VERSION_V1) return ambiguous;
  if (raw.eventId !== request.envelope.eventId) return ambiguous;
  if (typeof raw.receiverNodeId !== 'string' || raw.receiverNodeId.trim().length === 0) {
    return ambiguous;
  }
  if (request.destinationNodeId !== null && raw.receiverNodeId !== request.destinationNodeId) {
    return ambiguous;
  }

  if (raw.status === 'ACCEPTED' || raw.status === 'DUPLICATE') {
    return hasFields(raw, 'application') && typeof raw.application === 'string'
      ? { outcome: 'CONFIRMED' }
      : ambiguous;
  }
  if (raw.status === 'REJECTED' || raw.status === 'RETRYABLE') {
    if (!hasFields(raw, 'code') || typeof raw.code !== 'string' ||
      !SYNC_CODE_PATTERN_V1.test(raw.code)) {
      return ambiguous;
    }
    return raw.status === 'REJECTED'
      ? { outcome: 'REJECTED', code: raw.code }
      : { outcome: 'RETRYABLE', code: raw.code };
  }
  return ambiguous;
};
