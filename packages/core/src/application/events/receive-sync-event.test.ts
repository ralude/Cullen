import { describe, expect, it } from 'vitest';
import type { SyncEnvelopeV1 } from '@supermarket/shared';
import type {
  AggregateAuthority,
  AggregateAuthorityRegistry,
  Clock,
  IdGenerator,
  ReceivedSyncEvent,
  SyncCustodyRecord,
  SyncQuarantineEntry,
  SyncReceptionStore,
  SyncSenderContext,
  UnitOfWork
} from '../ports/index.js';
import { ReceiveSyncEvent } from './receive-sync-event.js';

const clock: Clock = { now: () => new Date('2026-09-05T12:00:00.000Z') };

const salePayload = {
  shiftId: 'shift-001',
  terminalId: 'terminal-001',
  total: { minorUnits: 2320, currencyCode: 'USD' },
  paidTotal: { minorUnits: 2320, currencyCode: 'USD' },
  payments: [{
    paymentId: 'payment-001',
    methodCode: 'CASH_USD',
    currencyCode: 'USD',
    amountMinorUnits: 2320
  }],
  items: [{ itemId: 'item-001', productId: 'product-001', quantityScaled: 2, quantityScale: 0 }]
};

const saleEnvelope = (overrides: Partial<SyncEnvelopeV1> = {}): SyncEnvelopeV1 => ({
  protocolVersion: 1,
  eventId: 'event-001',
  eventType: 'SaleCompleted',
  contractVersion: 1,
  aggregateId: 'sale-001',
  aggregateType: 'Sale',
  aggregateVersion: 4,
  originNodeId: 'node-terminal',
  correlationId: 'correlation-001',
  actorId: 'user-001',
  occurredAt: '2026-09-05T10:00:00.000Z',
  payload: salePayload,
  ...overrides
});

const productEnvelope = (overrides: Partial<SyncEnvelopeV1> = {}): SyncEnvelopeV1 => ({
  ...saleEnvelope(),
  eventId: 'event-product',
  eventType: 'ProductCreated',
  aggregateId: 'product-001',
  aggregateType: 'Product',
  aggregateVersion: 1,
  originNodeId: 'node-coordinator',
  payload: {
    name: 'Rice',
    description: 'Rice 1kg',
    price: { minorUnits: 1000, currencyCode: 'USD' },
    taxRate: { basisPoints: 1600 }
  },
  ...overrides
});

const shiftOpenedEnvelope = (originNodeId: string, payloadOrigin: string): SyncEnvelopeV1 => ({
  ...saleEnvelope(),
  eventId: 'event-shift',
  eventType: 'ShiftOpened',
  aggregateId: 'shift-001',
  aggregateType: 'Shift',
  aggregateVersion: 1,
  originNodeId,
  payload: {
    cashRegisterId: 'register-001',
    terminalId: 'terminal-001',
    originNodeId: payloadOrigin,
    openedBy: 'user-001',
    openingBalances: [{
      paymentMethodCode: 'CASH_USD', amount: { minorUnits: 5000, currencyCode: 'USD' }
    }]
  }
});

class FakeReceptionStore implements SyncReceptionStore {
  readonly entries = new Map<string, ReceivedSyncEvent>();
  readonly work = new Map<string, readonly string[]>();
  readonly quarantined: SyncQuarantineEntry[] = [];
  failing = false;
  /** Custodia que gana la carrera por la clave única durante `record`. */
  raceWinner: ReceivedSyncEvent | undefined;

  async findByEventId(eventId: string): Promise<ReceivedSyncEvent | undefined> {
    if (this.failing) throw new Error('receiver storage unavailable');
    return this.entries.get(eventId);
  }

  async highestReceivedVersion(
    aggregateType: string,
    aggregateId: string
  ): Promise<number | undefined> {
    const versions = [...this.entries.values()]
      .filter(({ envelope }) => envelope.aggregateType === aggregateType &&
        envelope.aggregateId === aggregateId)
      .map(({ envelope }) => envelope.aggregateVersion);
    return versions.length === 0 ? undefined : Math.max(...versions);
  }

  async record(entry: SyncCustodyRecord): Promise<'RECORDED' | 'DUPLICATE'> {
    if (this.failing) throw new Error('receiver storage unavailable');
    if (this.raceWinner) {
      this.entries.set(this.raceWinner.envelope.eventId, this.raceWinner);
      this.raceWinner = undefined;
      return 'DUPLICATE';
    }
    this.entries.set(entry.envelope.eventId, entry);
    this.work.set(entry.envelope.eventId, entry.consumers);
    return 'RECORDED';
  }

  async quarantine(entry: SyncQuarantineEntry): Promise<void> {
    this.quarantined.push(entry);
  }
}

const unitOfWork: UnitOfWork = { execute: (work) => work() };

const ids: IdGenerator = (() => {
  let issued = 0;
  return { generate: (): string => `quarantine-${(issued += 1)}` };
})();

const registry = (
  authorities: Readonly<Record<string, string>> = {}
): AggregateAuthorityRegistry => ({
  authorityFor: async (aggregateType, aggregateId): Promise<AggregateAuthority> => {
    const ownerNodeId = authorities[`${aggregateType}:${aggregateId}`];
    return ownerNodeId === undefined
      ? { resolution: 'UNRESOLVED' }
      : { resolution: 'RESOLVED', ownerNodeId };
  },
  register: async ({ ownerNodeId }) => ({ outcome: 'REGISTERED', ownerNodeId })
});

const terminalSender: SyncSenderContext = {
  verifiedNodeId: 'node-terminal',
  verifiedTerminalId: 'terminal-001',
  coordinatorNodeId: 'node-coordinator'
};

const coordinatorSender: SyncSenderContext = {
  verifiedNodeId: 'node-coordinator',
  verifiedTerminalId: null,
  coordinatorNodeId: 'node-coordinator'
};

const receiver = (
  store: SyncReceptionStore,
  authorities: Readonly<Record<string, string>> = { 'Sale:sale-001': 'node-terminal' }
): ReceiveSyncEvent =>
  new ReceiveSyncEvent('node-coordinator', store, registry(authorities), clock, unitOfWork, ids);

const reorderKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reorderKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .reverse()
    .map(([key, entry]) => [key, reorderKeys(entry)]));
};

describe('ReceiveSyncEvent', () => {
  it('acepta un hecho válido con custodia durable y aplicación pendiente', async () => {
    const store = new FakeReceptionStore();

    await expect(receiver(store).execute(saleEnvelope(), terminalSender)).resolves.toEqual({
      protocolVersion: 1,
      eventId: 'event-001',
      receiverNodeId: 'node-coordinator',
      status: 'ACCEPTED',
      application: 'PENDING_DEPENDENCY'
    });
    expect(store.entries.get('event-001')?.receivedAt).toEqual(clock.now());
  });

  it('devuelve el resultado previo ante una reentrega idéntica, sin efectos nuevos', async () => {
    const store = new FakeReceptionStore();
    const service = receiver(store);
    const first = await service.execute(saleEnvelope(), terminalSender);

    const repeated = await service.execute(saleEnvelope(), terminalSender);
    const reordered = await service.execute(reorderKeys(saleEnvelope()), terminalSender);

    expect(first).toMatchObject({ status: 'ACCEPTED' });
    expect(repeated).toEqual({
      protocolVersion: 1,
      eventId: 'event-001',
      receiverNodeId: 'node-coordinator',
      status: 'DUPLICATE',
      application: 'PENDING_DEPENDENCY'
    });
    expect(reordered).toEqual(repeated);
    expect(store.entries.size).toBe(1);
  });

  it.each([
    ['el actor', { actorId: 'user-002' }],
    ['la correlación', { correlationId: 'correlation-002' }],
    ['la fecha', { occurredAt: '2026-09-05T10:00:01.000Z' }],
    ['la versión del agregado', { aggregateVersion: 5 }],
    ['el payload', {
      payload: { ...salePayload, total: { minorUnits: 9999, currencyCode: 'USD' } }
    }]
  ])('trata como conflicto de identidad el mismo eventId con otro %s', async (_case, change) => {
    const store = new FakeReceptionStore();
    const service = receiver(store, {
      'Sale:sale-001': 'node-terminal', 'Sale:sale-002': 'node-terminal'
    });
    await service.execute(saleEnvelope(), terminalSender);

    await expect(service.execute(saleEnvelope(change), terminalSender)).resolves.toEqual({
      protocolVersion: 1,
      eventId: 'event-001',
      receiverNodeId: 'node-coordinator',
      status: 'REJECTED',
      code: 'SYNC_EVENT_IDENTITY_CONFLICT'
    });
    expect(store.entries.size).toBe(1);
    expect(store.quarantined).toMatchObject([{
      declaredEventId: 'event-001',
      senderNodeId: 'node-terminal',
      reasonCode: 'SYNC_EVENT_IDENTITY_CONFLICT'
    }]);
  });

  it('comprueba la identidad del emisor antes que el duplicado', async () => {
    const store = new FakeReceptionStore();
    const service = receiver(store, { 'Sale:sale-001': 'node-terminal' });
    await service.execute(saleEnvelope(), terminalSender);

    await expect(service.execute(saleEnvelope({ originNodeId: 'node-other' }), {
      ...terminalSender, verifiedNodeId: 'node-other'
    })).resolves.toMatchObject({ status: 'REJECTED', code: 'SYNC_SENDER_NOT_AUTHORIZED' });
    await expect(service.execute(saleEnvelope(), {
      ...terminalSender, verifiedNodeId: 'node-other'
    })).resolves.toMatchObject({ status: 'REJECTED', code: 'SYNC_SENDER_NOT_AUTHORIZED' });
  });

  it('rechaza un hecho de la terminal de otro nodo autorizado', async () => {
    const store = new FakeReceptionStore();

    await expect(receiver(store).execute(saleEnvelope(), {
      ...terminalSender, verifiedTerminalId: 'terminal-002'
    })).resolves.toMatchObject({ status: 'REJECTED', code: 'SYNC_SENDER_NOT_AUTHORIZED' });
    expect(store.entries.size).toBe(0);
  });

  it('relee y compara cuando otra entrega concurrente gana la clave única', async () => {
    const store = new FakeReceptionStore();
    const service = receiver(store);
    store.raceWinner = {
      envelope: saleEnvelope(),
      application: 'PENDING_DEPENDENCY',
      receivedAt: clock.now()
    };

    await expect(service.execute(saleEnvelope(), terminalSender)).resolves.toEqual({
      protocolVersion: 1,
      eventId: 'event-001',
      receiverNodeId: 'node-coordinator',
      status: 'DUPLICATE',
      application: 'PENDING_DEPENDENCY'
    });
    expect(store.entries.size).toBe(1);
  });

  it('no declara duplicado a ciegas si la carrera la ganó otro contenido', async () => {
    const store = new FakeReceptionStore();
    const service = receiver(store);
    store.raceWinner = {
      envelope: saleEnvelope({ actorId: 'user-002' }),
      application: 'PENDING_DEPENDENCY',
      receivedAt: clock.now()
    };

    await expect(service.execute(saleEnvelope(), terminalSender)).resolves.toMatchObject({
      status: 'REJECTED',
      code: 'SYNC_EVENT_IDENTITY_CONFLICT'
    });
  });

  it('acepta una referencia del coordinador y espera a sus maestros', async () => {
    const store = new FakeReceptionStore();
    const service = receiver(store, {});
    const publication = (overrides: Partial<SyncEnvelopeV1>): SyncEnvelopeV1 => ({
      ...saleEnvelope(),
      originNodeId: 'node-coordinator',
      aggregateVersion: 2,
      ...overrides
    });

    const product = await service.execute(publication({
      eventId: 'event-product-published',
      eventType: 'ProductPublished',
      aggregateId: 'product-001',
      aggregateType: 'Product',
      payload: {
        name: 'Rice',
        description: 'Rice 1kg',
        categoryId: 'category-001',
        unitId: 'unit-001',
        unitCode: 'UNIT',
        barcodes: [{ barcodeId: 'barcode-001', code: '1234', isActive: 'ACTIVE' }],
        price: { minorUnits: 1200, currencyCode: 'USD' },
        taxRate: { basisPoints: 1600 },
        isActive: 'ACTIVE'
      }
    }), coordinatorSender);
    const unit = await service.execute(publication({
      eventId: 'event-unit-published',
      eventType: 'UnitOfMeasurePublished',
      aggregateId: 'unit-001',
      aggregateType: 'UnitOfMeasure',
      aggregateVersion: 1,
      payload: { code: 'UNIT', name: 'Unidad', quantityScale: 0, isActive: 'ACTIVE' }
    }), coordinatorSender);

    expect(product).toMatchObject({ status: 'ACCEPTED', application: 'PENDING_DEPENDENCY' });
    expect(unit).toMatchObject({ status: 'ACCEPTED', application: 'PENDING_CONSUMER' });
    expect(store.work.get('event-product-published')).toEqual(['CATALOG_REFERENCE']);
  });

  it('no acepta una referencia entrante desde una terminal', async () => {
    const store = new FakeReceptionStore();

    await expect(receiver(store, {}).execute({
      ...saleEnvelope(),
      eventId: 'event-category-published',
      eventType: 'CategoryPublished',
      aggregateId: 'category-001',
      aggregateType: 'Category',
      aggregateVersion: 1,
      payload: { name: 'Granos', isActive: 'ACTIVE' }
    }, terminalSender)).resolves.toMatchObject({
      status: 'REJECTED', code: 'SYNC_AGGREGATE_OWNER_UNRESOLVED'
    });
    expect(store.entries.size).toBe(0);
  });

  it('registra el trabajo de aplicación declarado por el contrato', async () => {
    const store = new FakeReceptionStore();
    const service = receiver(store, {
      'Sale:sale-001': 'node-terminal', 'Shift:shift-001': 'node-terminal'
    });
    await service.execute(shiftOpenedEnvelope('node-terminal', 'node-terminal'), terminalSender);

    await service.execute(saleEnvelope(), terminalSender);

    expect(store.work.get('event-001')).toEqual(['INVENTORY_AUTHORITY']);
    expect(store.work.get('event-shift')).toEqual([]);
  });

  it('deduplica por eventId y admite varios hechos distintos de la misma versión', async () => {
    const store = new FakeReceptionStore();
    const service = receiver(store);

    const first = await service.execute(saleEnvelope({ eventId: 'event-a' }), terminalSender);
    const second = await service.execute(saleEnvelope({ eventId: 'event-b' }), terminalSender);

    expect([first, second].map(({ status }) => status)).toEqual(['ACCEPTED', 'ACCEPTED']);
    expect(store.entries.size).toBe(2);
  });

  it('admite versiones no contiguas y conserva un hecho atrasado para revisión', async () => {
    const store = new FakeReceptionStore();
    const service = receiver(store, {
      'Sale:sale-001': 'node-terminal', 'Shift:shift-001': 'node-terminal'
    });
    await service.execute({
      ...shiftOpenedEnvelope('node-terminal', 'node-terminal'), aggregateVersion: 9
    }, terminalSender);

    const later = await service.execute({
      ...shiftOpenedEnvelope('node-terminal', 'node-terminal'),
      eventId: 'event-shift-later',
      aggregateVersion: 14
    }, terminalSender);
    const late = await service.execute({
      ...shiftOpenedEnvelope('node-terminal', 'node-terminal'),
      eventId: 'event-shift-late',
      aggregateVersion: 11
    }, terminalSender);

    expect(later).toMatchObject({ status: 'ACCEPTED', application: 'PENDING_CONSUMER' });
    expect(late).toMatchObject({ status: 'ACCEPTED', application: 'PENDING_REVIEW' });
    expect(await store.highestReceivedVersion('Shift', 'shift-001')).toBe(14);
  });

  it('separa una dependencia ausente de un payload inválido', async () => {
    const store = new FakeReceptionStore();
    const service = receiver(store, {
      'Sale:sale-001': 'node-terminal', 'Shift:shift-001': 'node-terminal'
    });
    await service.execute(shiftOpenedEnvelope('node-terminal', 'node-terminal'), terminalSender);

    const withDependency = await service.execute(saleEnvelope(), terminalSender);
    const invalid = await service.execute(
      saleEnvelope({ eventId: 'event-invalid', payload: { shiftId: 'shift-001' } }),
      terminalSender
    );

    expect(withDependency).toMatchObject({ status: 'ACCEPTED', application: 'PENDING_CONSUMER' });
    expect(invalid).toMatchObject({ status: 'REJECTED', code: 'SYNC_PAYLOAD_INVALID' });
  });

  it('rechaza un emisor distinto del origen declarado', async () => {
    const store = new FakeReceptionStore();

    await expect(receiver(store).execute(saleEnvelope(), {
      ...terminalSender, verifiedNodeId: 'node-intruder'
    })).resolves.toMatchObject({ status: 'REJECTED', code: 'SYNC_SENDER_NOT_AUTHORIZED' });
    expect(store.entries.size).toBe(0);
  });

  it('no permite eludir el ownership declarando otro origen para el mismo agregado', async () => {
    const store = new FakeReceptionStore();

    await expect(receiver(store).execute(saleEnvelope({ originNodeId: 'node-other' }), {
      ...terminalSender, verifiedNodeId: 'node-other'
    })).resolves.toMatchObject({ status: 'REJECTED', code: 'SYNC_SENDER_NOT_AUTHORIZED' });
  });

  it('rechaza un origen incoherente con el que el payload declara', async () => {
    const store = new FakeReceptionStore();

    await expect(receiver(store, { 'Shift:shift-001': 'node-terminal' }).execute(
      shiftOpenedEnvelope('node-terminal', 'node-other'),
      terminalSender
    )).resolves.toMatchObject({ status: 'REJECTED', code: 'SYNC_SENDER_NOT_AUTHORIZED' });
  });

  it('no adopta al primer emisor como dueño de un agregado sin autoridad conocida', async () => {
    const store = new FakeReceptionStore();

    await expect(receiver(store, {}).execute(saleEnvelope(), terminalSender)).resolves
      .toMatchObject({ status: 'REJECTED', code: 'SYNC_AGGREGATE_OWNER_UNRESOLVED' });
    expect(store.entries.size).toBe(0);
  });

  it('exige coordinador verificado para el catálogo sin autoridad registrada', async () => {
    const store = new FakeReceptionStore();

    await expect(receiver(store, {}).execute(productEnvelope(), coordinatorSender))
      .resolves.toMatchObject({ status: 'ACCEPTED' });
    await expect(receiver(new FakeReceptionStore(), {}).execute(
      productEnvelope({ eventId: 'event-product-2', originNodeId: 'node-terminal' }),
      { verifiedNodeId: 'node-terminal', verifiedTerminalId: 'terminal-001', coordinatorNodeId: 'node-coordinator' }
    )).resolves.toMatchObject({ code: 'SYNC_AGGREGATE_OWNER_UNRESOLVED' });
    await expect(receiver(new FakeReceptionStore(), {}).execute(
      productEnvelope({ eventId: 'event-product-3' }),
      { verifiedNodeId: 'node-coordinator', verifiedTerminalId: null, coordinatorNodeId: null }
    )).resolves.toMatchObject({ code: 'SYNC_AGGREGATE_OWNER_UNRESOLVED' });
  });

  it('conserva el dueño registrado del catálogo frente a otro emisor', async () => {
    const store = new FakeReceptionStore();

    await expect(receiver(store, { 'Product:product-001': 'node-coordinator' }).execute(
      productEnvelope({ originNodeId: 'node-terminal' }),
      { verifiedNodeId: 'node-terminal', verifiedTerminalId: 'terminal-001', coordinatorNodeId: 'node-terminal' }
    )).resolves.toMatchObject({ status: 'REJECTED', code: 'SYNC_SENDER_NOT_AUTHORIZED' });
  });

  it('no confirma la recepción si el estado receptor no puede persistirla', async () => {
    const store = new FakeReceptionStore();
    store.failing = true;

    await expect(receiver(store).execute(saleEnvelope(), terminalSender)).resolves.toEqual({
      protocolVersion: 1,
      eventId: 'event-001',
      receiverNodeId: 'node-coordinator',
      status: 'RETRYABLE',
      code: 'SYNC_RECEIVER_UNAVAILABLE'
    });
    expect(store.entries.size).toBe(0);
  });

  it('diagnostica sin exponer payload ni datos del hecho rechazado', async () => {
    const store = new FakeReceptionStore();
    const receipt = await receiver(store).execute({
      protocolVersion: 1,
      eventId: 'event-001',
      payload: { pin: '1234' }
    }, terminalSender);

    expect(receipt).toEqual({
      protocolVersion: 1,
      eventId: 'event-001',
      receiverNodeId: 'node-coordinator',
      status: 'REJECTED',
      code: 'SYNC_ENVELOPE_INVALID'
    });
    expect(JSON.stringify(receipt)).not.toContain('1234');
    expect(store.quarantined).toMatchObject([{
      declaredEventId: 'event-001',
      senderNodeId: 'node-terminal',
      reasonCode: 'SYNC_ENVELOPE_INVALID',
      payloadBytes: 68
    }]);
    expect(JSON.stringify(store.quarantined)).not.toContain('1234');
  });
});
