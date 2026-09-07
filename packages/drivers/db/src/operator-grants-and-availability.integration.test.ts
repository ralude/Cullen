import { describe, expect, it } from 'vitest';
import { application, type SyncSenderContext } from '@supermarket/core';
import type { SyncEnvelopeV1 } from '@supermarket/shared';
import { SqliteCatalogReferenceProjection } from './catalog-reference-projection.js';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleAggregateAuthorityRegistry } from './sync-authority-registry.js';
import { DrizzleSyncInboxWorkStore } from './sync-inbox-work-store.js';
import { DrizzleSyncReceptionStore } from './sync-reception-store.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

/**
 * Concesiones y disponibilidad informativa: los dos verticales que cierran el
 * conjunto cerrado de referencias del corte 0 de 10.03.
 *
 * Todo pasa por el receptor y el procesador reales sobre SQLite, no por la
 * proyección invocada a mano: lo que se prueba es la ruta que usará la LAN.
 */

const ISSUED_AT = '2026-09-06T10:00:00.000Z';
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

let moment = new Date('2026-09-06T12:00:00.000Z');
const clock = { now: (): Date => moment };
let issued = 0;
const ids = { generate: (): string => `generated-${(issued += 1)}` };

const coordinator: SyncSenderContext = {
  verifiedNodeId: 'node-coordinator',
  verifiedTerminalId: null,
  coordinatorNodeId: 'node-coordinator'
};

const envelope = (overrides: Partial<SyncEnvelopeV1>): SyncEnvelopeV1 => ({
  protocolVersion: 1,
  eventId: 'event-1',
  eventType: 'OperatorGrantPublished',
  contractVersion: 1,
  aggregateId: 'user-coordinator-001',
  aggregateType: 'OperatorGrant',
  aggregateVersion: 1,
  originNodeId: 'node-coordinator',
  correlationId: 'correlation-001',
  actorId: 'user-001',
  occurredAt: ISSUED_AT,
  payload: {},
  ...overrides
});

const grantEnvelope = (
  version: number,
  overrides: {
    readonly expiresAt?: string;
    readonly isActive?: string;
    readonly permissionCodes?: readonly string[];
    readonly occurredAt?: string;
  } = {}
): SyncEnvelopeV1 => {
  const occurredAt = overrides.occurredAt ?? ISSUED_AT;
  return envelope({
    eventId: `event-grant-${version}`,
    aggregateVersion: version,
    occurredAt,
    payload: {
      operatorCode: 'CAJA01',
      displayName: 'Cajera 1',
      roleCodes: ['CASHIER'],
      permissionCodes: [...(overrides.permissionCodes ?? ['sales.complete'])],
      isActive: overrides.isActive ?? 'ACTIVE',
      expiresAt: overrides.expiresAt
        ?? new Date(new Date(occurredAt).getTime() + EIGHT_HOURS_MS).toISOString()
    }
  });
};

const productEnvelope = (): SyncEnvelopeV1 => envelope({
  eventId: 'event-product-1',
  eventType: 'ProductPublished',
  aggregateId: 'product-001',
  aggregateType: 'Product',
  aggregateVersion: 1,
  payload: {
    name: 'Arroz',
    description: 'Arroz 1kg',
    categoryId: 'category-001',
    unitId: 'unit-001',
    unitCode: 'UNIT',
    barcodes: [],
    price: { minorUnits: 1200, currencyCode: 'USD' },
    taxRate: { basisPoints: 1600 },
    isActive: 'ACTIVE'
  }
});

const categoryEnvelope = (): SyncEnvelopeV1 => envelope({
  eventId: 'event-category-1',
  eventType: 'CategoryPublished',
  aggregateId: 'category-001',
  aggregateType: 'Category',
  aggregateVersion: 1,
  payload: { name: 'Granos', isActive: 'ACTIVE' }
});

const unitEnvelope = (): SyncEnvelopeV1 => envelope({
  eventId: 'event-unit-1',
  eventType: 'UnitOfMeasurePublished',
  aggregateId: 'unit-001',
  aggregateType: 'UnitOfMeasure',
  aggregateVersion: 1,
  payload: { code: 'UNIT', name: 'Unidad', quantityScale: 0, isActive: 'ACTIVE' }
});

const availabilityEnvelope = (version: number, quantityScaled: number): SyncEnvelopeV1 =>
  envelope({
    eventId: `event-availability-${version}`,
    eventType: 'StockAvailabilityPublished',
    aggregateId: 'product-001',
    aggregateType: 'StockAvailability',
    aggregateVersion: version,
    payload: { quantityScaled, quantityScale: 0, unitCost: null }
  });

const batchAvailabilityEnvelope = (): SyncEnvelopeV1 => envelope({
  eventId: 'event-availability-batches',
  eventType: 'StockAvailabilityPublished',
  contractVersion: 2,
  aggregateId: 'product-001',
  aggregateType: 'StockAvailability',
  aggregateVersion: 6,
  payload: {
    stockItemId: 'stock-item-001',
    unitCode: 'UNIT',
    quantityScaled: 9,
    quantityScale: 0,
    batchTracking: 'TRACKED',
    batches: [{
      batchId: 'batch-001', lotNumber: 'LOT-001',
      expiresAt: '2027-01-01T00:00:00.000Z', quantityScaled: 9
    }],
    unitCost: { minorUnits: 250, currencyCode: 'USD' }
  }
});

type Terminal = {
  readonly handle: DatabaseHandle;
  readonly receive: application.ReceiveSyncEvent;
  readonly processor: application.ProcessSyncInbox;
};

const terminal = (): Terminal => {
  const handle = openDatabase(':memory:');
  applyMigrations(handle.sqlite);
  const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
  return {
    handle,
    receive: new application.ReceiveSyncEvent(
      'node-terminal-1',
      new DrizzleSyncReceptionStore(handle),
      new DrizzleAggregateAuthorityRegistry(handle),
      clock,
      unitOfWork,
      ids
    ),
    processor: new application.ProcessSyncInbox(
      new DrizzleSyncInboxWorkStore(handle),
      new Map([['CATALOG_REFERENCE', new application.CatalogReferenceConsumer(
        new SqliteCatalogReferenceProjection(handle)
      )]]),
      unitOfWork,
      clock,
      ids
    )
  };
};

const drain = async (node: Terminal, cycles = 3): Promise<void> => {
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    await node.processor.runBatch();
    moment = new Date(moment.getTime() + 120_000);
  }
};

const grantRow = (handle: DatabaseHandle): Record<string, unknown> | undefined =>
  handle.sqlite.prepare(`
    select operator_code as operatorCode, display_name as displayName,
      role_codes as roleCodes, permission_codes as permissionCodes,
      is_active as isActive, version, expires_at as expiresAt
    from identity_operator_grant
  `).get() as Record<string, unknown> | undefined;

const availabilityRow = (handle: DatabaseHandle): Record<string, unknown> | undefined =>
  handle.sqlite.prepare(`
    select product_id as productId, quantity_scaled as quantityScaled,
      quantity_scale as quantityScale, version, published_by as publishedBy
    from stock_availability_reference
  `).get() as Record<string, unknown> | undefined;

describe('concesiones de operador en la terminal', () => {
  it('aplica la concesión con la vigencia declarada por el coordinador', async () => {
    const node = terminal();
    await node.receive.execute(grantEnvelope(1), coordinator);
    await drain(node, 1);

    expect(grantRow(node.handle)).toEqual({
      operatorCode: 'CAJA01',
      displayName: 'Cajera 1',
      roleCodes: '["CASHIER"]',
      permissionCodes: '["sales.complete"]',
      isActive: 1,
      version: 1,
      expiresAt: new Date(ISSUED_AT).getTime() + EIGHT_HOURS_MS
    });
    node.handle.close();
  });

  it('recorta una vigencia que exceda las ocho horas de su emisión', async () => {
    const node = terminal();
    await node.receive.execute(grantEnvelope(1, {
      /** Un coordinador que pidiese treinta días no amplía la política. */
      expiresAt: new Date(new Date(ISSUED_AT).getTime() + 30 * 24 * 3_600_000).toISOString()
    }), coordinator);
    await drain(node, 1);

    expect(grantRow(node.handle)).toMatchObject({
      expiresAt: new Date(ISSUED_AT).getTime() + EIGHT_HOURS_MS
    });
    node.handle.close();
  });

  it('trata como incompatible una vigencia que no supera su emisión', async () => {
    const node = terminal();
    await node.receive.execute(grantEnvelope(1, { expiresAt: ISSUED_AT }), coordinator);
    await drain(node, 1);

    expect(grantRow(node.handle)).toBeUndefined();
    expect(node.handle.sqlite.prepare(
      "select reason_code from sync_discrepancy where event_id = 'event-grant-1'"
    ).pluck().get()).toBe('CATALOG_REFERENCE_PAYLOAD_INVALID');
    node.handle.close();
  });

  it('no retrocede la concesión con una versión atrasada', async () => {
    const node = terminal();
    await node.receive.execute(grantEnvelope(2, {
      permissionCodes: ['sales.complete', 'sales.void']
    }), coordinator);
    await drain(node, 1);
    await node.receive.execute(grantEnvelope(1, { isActive: 'INACTIVE' }), coordinator);
    await drain(node, 1);

    expect(grantRow(node.handle)).toMatchObject({
      isActive: 1,
      version: 2,
      permissionCodes: '["sales.complete","sales.void"]'
    });
    expect(node.handle.sqlite.prepare(
      "select state from sync_inbox_work where event_id = 'event-grant-1'"
    ).pluck().get()).toBe('APPLIED');
    node.handle.close();
  });

  it('renueva la vigencia con una emisión posterior y no con una reentrega', async () => {
    const node = terminal();
    await node.receive.execute(grantEnvelope(1), coordinator);
    await drain(node, 1);

    /** La misma concesión otra vez conserva su vencimiento original. */
    await node.receive.execute(grantEnvelope(1), coordinator);
    await drain(node, 1);
    expect(grantRow(node.handle)).toMatchObject({
      expiresAt: new Date(ISSUED_AT).getTime() + EIGHT_HOURS_MS
    });

    const later = '2026-09-06T14:00:00.000Z';
    await node.receive.execute(grantEnvelope(2, { occurredAt: later }), coordinator);
    await drain(node, 1);
    expect(grantRow(node.handle)).toMatchObject({
      version: 2,
      expiresAt: new Date(later).getTime() + EIGHT_HOURS_MS
    });
    node.handle.close();
  });

  it('no encola nada en la salida local ni escribe usuarios locales', async () => {
    const node = terminal();
    await node.receive.execute(grantEnvelope(1), coordinator);
    await drain(node, 1);

    expect(node.handle.sqlite.prepare('select count(*) from outbox_event').pluck().get()).toBe(0);
    expect(node.handle.sqlite.prepare('select count(*) from identity_users').pluck().get())
      .toBe(0);
    expect(node.handle.sqlite.prepare('select count(*) from identity_credentials').pluck().get())
      .toBe(0);
    node.handle.close();
  });
});

describe('disponibilidad informativa en la terminal', () => {
  it('espera a que su producto esté aplicado antes de proyectar el saldo', async () => {
    const node = terminal();
    await node.receive.execute(availabilityEnvelope(3, 12), coordinator);
    await drain(node, 2);

    expect(availabilityRow(node.handle)).toBeUndefined();
    expect(node.handle.sqlite.prepare(
      "select last_error from sync_inbox_work where event_id = 'event-availability-3'"
    ).pluck().get()).toBe('SYNC_DEPENDENCY_NOT_APPLIED');

    await node.receive.execute(categoryEnvelope(), coordinator);
    await node.receive.execute(unitEnvelope(), coordinator);
    await node.receive.execute(productEnvelope(), coordinator);
    await drain(node);

    expect(availabilityRow(node.handle)).toEqual({
      productId: 'product-001',
      quantityScaled: 12,
      quantityScale: 0,
      version: 3,
      publishedBy: 'node-coordinator'
    });
    node.handle.close();
  });

  it('no retrocede el saldo con una publicación atrasada ni lo duplica al reentregar', async () => {
    const node = terminal();
    await node.receive.execute(categoryEnvelope(), coordinator);
    await node.receive.execute(unitEnvelope(), coordinator);
    await node.receive.execute(productEnvelope(), coordinator);
    await node.receive.execute(availabilityEnvelope(5, 4), coordinator);
    await drain(node);

    await node.receive.execute(availabilityEnvelope(2, 99), coordinator);
    await node.receive.execute(availabilityEnvelope(5, 4), coordinator);
    await drain(node);

    expect(availabilityRow(node.handle)).toMatchObject({ quantityScaled: 4, version: 5 });
    expect(node.handle.sqlite.prepare(
      'select count(*) from stock_availability_reference'
    ).pluck().get()).toBe(1);
    node.handle.close();
  });

  it('no toca el inventario local: es un dato informativo, no un saldo', async () => {
    const node = terminal();
    await node.receive.execute(categoryEnvelope(), coordinator);
    await node.receive.execute(unitEnvelope(), coordinator);
    await node.receive.execute(productEnvelope(), coordinator);
    await node.receive.execute(availabilityEnvelope(2, 40), coordinator);
    await drain(node);

    expect(availabilityRow(node.handle)).toMatchObject({ quantityScaled: 40 });
    expect(node.handle.sqlite.prepare('select count(*) from stock_items').pluck().get()).toBe(0);
    expect(node.handle.sqlite.prepare('select count(*) from stock_movements').pluck().get())
      .toBe(0);
    node.handle.close();
  });

  it('proyecta las identidades y lotes de v2 fuera del inventario local', async () => {
    const node = terminal();
    await node.receive.execute(categoryEnvelope(), coordinator);
    await node.receive.execute(unitEnvelope(), coordinator);
    await node.receive.execute(productEnvelope(), coordinator);
    await node.receive.execute(batchAvailabilityEnvelope(), coordinator);
    await drain(node);

    expect(node.handle.sqlite.prepare(`
      select stock_item_id as stockItemId, unit_code as unitCode,
        tracks_batches as tracksBatches
      from stock_availability_reference where product_id = 'product-001'
    `).get()).toEqual({ stockItemId: 'stock-item-001', unitCode: 'UNIT', tracksBatches: 1 });
    expect(node.handle.sqlite.prepare(`
      select batch_id as batchId, lot_number as lotNumber, expires_at as expiresAt,
        quantity_scaled as quantityScaled
      from stock_batch_availability_reference where product_id = 'product-001'
    `).all()).toEqual([{
      batchId: 'batch-001', lotNumber: 'LOT-001',
      expiresAt: new Date('2027-01-01T00:00:00.000Z').getTime(), quantityScaled: 9
    }]);
    expect(node.handle.sqlite.prepare('select count(*) from stock_items').pluck().get()).toBe(0);
    await expect(new SqliteCatalogReferenceProjection(node.handle)
      .findStockAvailability('product-001')).resolves.toEqual({
        productId: 'product-001',
        stockItemId: 'stock-item-001',
        unitCode: 'UNIT',
        quantityScaled: 9,
        quantityScale: 0,
        tracksBatches: true,
        batches: [{
          batchId: 'batch-001',
          lotNumber: 'LOT-001',
          expiresAt: new Date('2027-01-01T00:00:00.000Z'),
          quantityScaled: 9
        }],
        unitCost: { minorUnits: 250, currencyCode: 'USD' },
        version: 6,
        publishedBy: 'node-coordinator',
        publishedAt: new Date(ISSUED_AT)
      });
    node.handle.close();
  });
});
