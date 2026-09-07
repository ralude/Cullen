import type { JsonValue } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import { findSyncContract } from './sync-contracts.js';

export type { JsonValue };

export type DomainEventLike = {
  readonly type: string;
  readonly eventId: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly aggregateVersion: number;
  readonly occurredAt: Date;
  readonly payload: unknown;
};

export type BusinessEventV1 = {
  readonly eventId: string;
  readonly eventType: string;
  /**
   * Versión del contrato de integración del payload. La fija el catálogo
   * cerrado; un tipo que no distribuye conserva `1`.
   */
  readonly contractVersion: number;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly aggregateVersion: number;
  readonly originNodeId: string;
  readonly correlationId: string;
  readonly actorId: string;
  readonly occurredAt: Date;
  readonly payload: JsonValue;
};

const toJsonValue = (value: unknown): JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value !== 'object') return String(value);

  const record = value as Record<string, unknown>;
  if (typeof record.minorUnits === 'number' && typeof record.currency === 'string') {
    return { minorUnits: record.minorUnits, currencyCode: record.currency };
  }
  if (typeof record.scaledValue === 'number' && typeof record.scale === 'number') {
    return { scaledValue: record.scaledValue, scale: record.scale };
  }
  if (typeof record.basisPoints === 'number') return { basisPoints: record.basisPoints };

  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, toJsonValue(entry)])
  );
};

export const toBusinessEvents = (
  events: readonly DomainEventLike[],
  context: ExecutionContext
): BusinessEventV1[] => events.map((event) => ({
  eventId: event.eventId,
  eventType: event.type,
  contractVersion: findSyncContract(event.type)?.contractVersion ?? 1,
  aggregateId: event.aggregateId,
  aggregateType: event.aggregateType,
  aggregateVersion: event.aggregateVersion,
  originNodeId: context.originNodeId,
  correlationId: context.correlationId,
  actorId: context.actorId,
  occurredAt: new Date(event.occurredAt),
  payload: toJsonValue(event.payload)
}));
