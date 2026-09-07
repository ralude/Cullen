import { describe, expect, it } from 'vitest';
import { SYNC_LIMITS_V1 } from '@supermarket/shared';
import type { BusinessEventV1 } from './business-event.js';
import { toSyncEnvelope, validateSyncEnvelope } from './sync-envelope.js';

const businessEvent = (overrides: Partial<BusinessEventV1> = {}): BusinessEventV1 => ({
  eventId: 'event-001',
  eventType: 'PriceChanged',
  contractVersion: 1,
  aggregateId: 'product-001',
  aggregateType: 'Product',
  aggregateVersion: 7,
  originNodeId: 'node-coordinator',
  correlationId: 'correlation-001',
  actorId: 'user-001',
  occurredAt: new Date('2026-09-05T10:00:00.000Z'),
  payload: {
    previousPrice: { minorUnits: 250, currencyCode: 'USD' },
    price: { minorUnits: 300, currencyCode: 'USD' },
    changedBy: 'user-001',
    reason: null
  },
  ...overrides
});

const wire = (event: BusinessEventV1 = businessEvent()): Record<string, unknown> =>
  JSON.parse(JSON.stringify(toSyncEnvelope(event))) as Record<string, unknown>;

const codeOf = (input: unknown): string | 'ok' => {
  const result = validateSyncEnvelope(input);
  return result.ok ? 'ok' : result.code;
};

describe('sobre de sincronización v1', () => {
  it('conserva identidad, UTC, actor, correlación y payload en el round-trip JSON', () => {
    const event = businessEvent();
    const result = validateSyncEnvelope(wire(event));

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.envelope).toEqual({
      protocolVersion: 1,
      eventId: 'event-001',
      eventType: 'PriceChanged',
      contractVersion: 1,
      aggregateId: 'product-001',
      aggregateType: 'Product',
      aggregateVersion: 7,
      originNodeId: 'node-coordinator',
      correlationId: 'correlation-001',
      actorId: 'user-001',
      occurredAt: '2026-09-05T10:00:00.000Z',
      payload: event.payload
    });
    expect(new Date(result.envelope.occurredAt).getTime()).toBe(event.occurredAt.getTime());
  });

  it('no transporta el estado de entrega del outbox', () => {
    const envelope = toSyncEnvelope({
      ...businessEvent(),
      ...{ status: 'PROCESSING', attempts: 4, leaseUntil: new Date() }
    } as BusinessEventV1);

    expect(Object.keys(envelope).sort()).toEqual([
      'actorId', 'aggregateId', 'aggregateType', 'aggregateVersion', 'contractVersion',
      'correlationId', 'eventId', 'eventType', 'occurredAt', 'originNodeId', 'payload',
      'protocolVersion'
    ]);
  });

  it.each([
    ['no es un objeto', 'not-an-envelope'],
    ['omite un campo obligatorio', (() => {
      const { actorId, ...rest } = wire();
      void actorId;
      return rest;
    })()],
    ['agrega un campo no declarado', { ...wire(), extra: 'value' }],
    ['trae una fecha inválida', { ...wire(), occurredAt: '2026-13-45T99:00:00Z' }],
    ['trae una fecha no canónica', { ...wire(), occurredAt: '2026-09-05T10:00:00+00:00' }],
    ['trae una versión fraccionaria', { ...wire(), aggregateVersion: 1.5 }],
    ['trae una versión no segura', { ...wire(), aggregateVersion: 2 ** 53 }],
    ['trae un identificador vacío', { ...wire(), eventId: '   ' }],
    ['trae un payload que no es objeto', { ...wire(), payload: [] }]
  ])('rechaza un sobre que %s', (_case, input) => {
    expect(codeOf(input)).toBe('SYNC_ENVELOPE_INVALID');
  });

  it('rechaza un número no finito sin coerción', () => {
    expect(codeOf({ ...wire(), aggregateVersion: Number.POSITIVE_INFINITY }))
      .toBe('SYNC_ENVELOPE_INVALID');
  });

  it('rechaza un sobre que excede el límite de bytes', () => {
    const oversized = {
      ...wire(businessEvent({
        eventType: 'ProductCreated',
        payload: {
          name: 'Rice',
          description: 'x'.repeat(SYNC_LIMITS_V1.maxEnvelopeBytes),
          price: { minorUnits: 250, currencyCode: 'USD' },
          taxRate: { basisPoints: 1600 }
        }
      }))
    };

    expect(codeOf(oversized)).toBe('SYNC_ENVELOPE_INVALID');
  });

  it('distingue versión de sobre, tipo desconocido y versión de payload', () => {
    expect(codeOf({ ...wire(), protocolVersion: 2 })).toBe('SYNC_PROTOCOL_VERSION_UNSUPPORTED');
    expect(codeOf({ ...wire(), eventType: 'StockMovementRegistered' }))
      .toBe('SYNC_EVENT_TYPE_UNKNOWN');
    expect(codeOf({ ...wire(), contractVersion: 2 })).toBe('SYNC_CONTRACT_VERSION_UNSUPPORTED');
    expect(codeOf({ ...wire(), aggregateType: 'Sale' })).toBe('SYNC_AGGREGATE_TYPE_MISMATCH');
  });

  it('no reinterpreta como v1 una versión de payload posterior', () => {
    const future = { ...wire(), contractVersion: 2, payload: { price: 'free' } };

    expect(codeOf(future)).toBe('SYNC_CONTRACT_VERSION_UNSUPPORTED');
    expect(validateSyncEnvelope(future)).not.toMatchObject({ ok: true });
  });

  it.each([
    ['omite un campo del contrato', { previousPrice: { minorUnits: 250, currencyCode: 'USD' } }],
    ['agrega un campo no declarado', {
      previousPrice: { minorUnits: 250, currencyCode: 'USD' },
      price: { minorUnits: 300, currencyCode: 'USD' },
      changedBy: 'user-001',
      reason: null,
      approvedBy: 'user-002'
    }],
    ['usa dinero fraccionario', {
      previousPrice: { minorUnits: 250.5, currencyCode: 'USD' },
      price: { minorUnits: 300, currencyCode: 'USD' },
      changedBy: 'user-001',
      reason: null
    }],
    ['usa una moneda inválida', {
      previousPrice: { minorUnits: 250, currencyCode: 'dolares' },
      price: { minorUnits: 300, currencyCode: 'USD' },
      changedBy: 'user-001',
      reason: null
    }],
    ['envía un texto sobre el límite', {
      previousPrice: { minorUnits: 250, currencyCode: 'USD' },
      price: { minorUnits: 300, currencyCode: 'USD' },
      changedBy: 'user-001',
      reason: 'x'.repeat(SYNC_LIMITS_V1.maxTextLength + 1)
    }]
  ])('rechaza un payload que %s', (_case, payload) => {
    expect(codeOf({ ...wire(), payload })).toBe('SYNC_PAYLOAD_INVALID');
  });

  it('rechaza un arreglo sobre el límite declarado', () => {
    const items = Array.from({ length: SYNC_LIMITS_V1.maxArrayLength + 1 }, (_entry, index) => ({
      itemId: `item-${index}`,
      productId: 'product-001',
      quantityScaled: 1,
      quantityScale: 0
    }));

    expect(codeOf({
      ...wire(businessEvent({ eventType: 'SaleCompleted', aggregateType: 'Sale' })),
      payload: {
        shiftId: 'shift-001',
        terminalId: 'terminal-001',
        total: { minorUnits: 1000, currencyCode: 'USD' },
        paidTotal: { minorUnits: 1000, currencyCode: 'USD' },
        payments: [],
        items
      }
    })).toBe('SYNC_PAYLOAD_INVALID');
  });
});
