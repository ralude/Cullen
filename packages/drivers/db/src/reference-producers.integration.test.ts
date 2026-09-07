import { describe, expect, it } from 'vitest';
import { application, StockItem } from '@supermarket/core';
import { Quantity } from '@supermarket/shared';
import { SqliteAuthenticationStore } from './authentication-store.js';
import {
  SqliteCatalogReferenceSource,
  SqliteOperatorGrantSource
} from './catalog-reference-source.js';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleOutboxStore } from './outbox-store.js';
import { DrizzleStockItemRepository } from './repositories.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

/**
 * Productores de las dos referencias que cierran el conjunto cerrado: la
 * emisión de concesiones y la disponibilidad informativa derivada del stock.
 *
 * El cambio autoritativo y su publicación se confirman juntos; una interrupción
 * antes del commit no deja publicaciones sueltas.
 */

const ISSUED_AT = new Date('2026-09-06T12:00:00.000Z');
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

let moment = ISSUED_AT;
const clock = { now: (): Date => moment };
let issued = 0;
const ids = { generate: (): string => `generated-${(issued += 1)}` };
const authorization = { authorize: async (): Promise<boolean> => true };

const context = {
  actorId: 'operator-001',
  actorRoleCodes: ['ADMIN'],
  terminalId: 'terminal-coordinator',
  originNodeId: 'node-coordinator',
  correlationId: 'correlation-grants'
};

const migrated = (): DatabaseHandle => {
  const handle = openDatabase(':memory:');
  applyMigrations(handle.sqlite);
  return handle;
};

const grantsFor = (handle: DatabaseHandle): application.PublishOperatorGrants =>
  new application.PublishOperatorGrants(
    new SqliteOperatorGrantSource(handle),
    new DrizzleOutboxStore(handle),
    authorization,
    clock,
    new SqliteUnitOfWork(handle.sqlite),
    ids
  );

const seedOperators = async (handle: DatabaseHandle): Promise<void> => {
  const store = new SqliteAuthenticationStore(handle);
  await store.provisionInitialAdmin({
    userId: 'user-001', roleId: 'role-admin', operatorCode: 'ADMIN01',
    displayName: 'Administradora', pinHash: 'encoded',
    permissions: ['sale.void', 'inventory.adjust'], now: ISSUED_AT
  });
  /** Un operador desactivado también se publica, para poder aplicar su revocación. */
  handle.sqlite.prepare(`
    insert into identity_users (
      id, operator_code, display_name, is_active, authorization_version, created_at
    ) values ('user-002', 'CAJA02', 'Cajera 2', 0, 1, ?)
  `).run(ISSUED_AT.getTime());
};

const publications = (handle: DatabaseHandle): unknown[] => handle.sqlite.prepare(`
  select event_type, aggregate_id, aggregate_version, payload from outbox_event
  order by aggregate_id, aggregate_version
`).all();

describe('emisión de concesiones de operador', () => {
  it('publica una concesión por operador con permisos y sin credenciales', async () => {
    const handle = migrated();
    await seedOperators(handle);

    const result = await grantsFor(handle).execute({ reason: 'Alta de terminal' }, context);

    expect(result).toMatchObject({
      ok: true,
      value: { operators: 2, expiresAt: new Date(ISSUED_AT.getTime() + EIGHT_HOURS_MS).toISOString() }
    });
    const rows = publications(handle) as {
      event_type: string; aggregate_id: string; aggregate_version: number; payload: string;
    }[];
    expect(rows.map(({ event_type, aggregate_id, aggregate_version }) =>
      ({ event_type, aggregate_id, aggregate_version }))).toEqual([
      { event_type: 'OperatorGrantPublished', aggregate_id: 'user-001', aggregate_version: 1 },
      { event_type: 'OperatorGrantPublished', aggregate_id: 'user-002', aggregate_version: 1 }
    ]);
    expect(JSON.parse(rows[0]?.payload as string)).toEqual({
      operatorCode: 'ADMIN01',
      displayName: 'Administradora',
      roleCodes: ['ADMIN'],
      permissionCodes: ['inventory.adjust', 'sale.void'],
      isActive: 'ACTIVE',
      expiresAt: new Date(ISSUED_AT.getTime() + EIGHT_HOURS_MS).toISOString()
    });
    expect(JSON.parse(rows[1]?.payload as string)).toMatchObject({
      operatorCode: 'CAJA02', isActive: 'INACTIVE', permissionCodes: []
    });
    /** Ninguna publicación transporta credenciales. */
    expect(rows.some(({ payload }) => /pin|hash|token|secret/i.test(payload))).toBe(false);
    handle.close();
  });

  it('cada emisión avanza la versión aunque los permisos no cambien', async () => {
    const handle = migrated();
    await seedOperators(handle);
    const grants = grantsFor(handle);
    await grants.execute({ reason: 'Alta' }, context);

    moment = new Date(ISSUED_AT.getTime() + 5 * 3_600_000);
    await grants.execute({ reason: 'Renovación' }, context);

    expect(handle.sqlite.prepare(`
      select aggregate_version from outbox_event
      where aggregate_id = 'user-001' order by aggregate_version
    `).pluck().all()).toEqual([1, 2]);
    expect(handle.sqlite.prepare(
      "select version from identity_operator_grant_version where user_id = 'user-001'"
    ).pluck().get()).toBe(2);
    moment = ISSUED_AT;
    handle.close();
  });

  it('renueva solo cuando a la vigencia le queda menos de la mitad', async () => {
    const handle = migrated();
    await seedOperators(handle);
    const grants = grantsFor(handle);
    await grants.execute({ reason: 'Alta' }, context);
    const afterFirst = handle.sqlite.prepare('select count(*) from outbox_event')
      .pluck().get() as number;

    /** Con siete horas por delante todavía no toca reemitir. */
    moment = new Date(ISSUED_AT.getTime() + 3_600_000);
    await expect(grants.renewIfDue(context)).resolves.toEqual({ ok: true, value: null });
    expect(handle.sqlite.prepare('select count(*) from outbox_event').pluck().get())
      .toBe(afterFirst);

    /** Pasada la mitad de la ventana, la reemisión mantiene ocho horas por delante. */
    moment = new Date(ISSUED_AT.getTime() + 5 * 3_600_000);
    const renewed = await grants.renewIfDue(context);
    expect(renewed).toMatchObject({
      ok: true,
      value: { expiresAt: new Date(moment.getTime() + EIGHT_HOURS_MS).toISOString() }
    });
    moment = ISSUED_AT;
    handle.close();
  });

  it('no deja publicaciones ni versiones si se interrumpe antes del commit', async () => {
    const handle = migrated();
    await seedOperators(handle);
    const source = new SqliteOperatorGrantSource(handle);
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);

    await expect(unitOfWork.execute(async () => {
      await source.nextGrantVersion('user-001', ISSUED_AT, new Date(ISSUED_AT.getTime() + 1000));
      throw new Error('interrupted before commit');
    })).rejects.toMatchObject({ code: 'DATABASE_OPERATION_FAILED' });

    expect(handle.sqlite.prepare('select count(*) from identity_operator_grant_version')
      .pluck().get()).toBe(0);
    expect(handle.sqlite.prepare('select count(*) from outbox_event').pluck().get()).toBe(0);
    handle.close();
  });
});

describe('disponibilidad informativa del coordinador', () => {
  const stockItem = (handle: DatabaseHandle, movements: number): StockItem => {
    const item = StockItem.create({
      id: 'stock-item-001', productId: 'product-001',
      unitCode: 'UNIT', quantityScale: 0, tracksBatches: false
    });
    for (let index = 0; index < movements; index += 1) {
      item.registerMovement({
        id: `movement-${index}`, type: 'PURCHASE_RECEIPT',
        quantity: Quantity.fromScaled(5, 0), actorId: 'operator-001',
        reason: 'Recepción', referenceId: `receipt-${index}`,
        occurredAt: ISSUED_AT, eventId: `event-movement-${index}`
      });
    }
    void handle;
    return item;
  };

  it('deriva el saldo y su versión del estado posterior a la mutación', () => {
    const handle = migrated();
    const item = stockItem(handle, 2);

    const [first, second] = [
      application.toStockAvailabilityPublications([item], ids, ISSUED_AT),
      application.toStockAvailabilityPublications([item], ids, ISSUED_AT)
    ];

    expect(first[0]).toMatchObject({
      type: 'StockAvailabilityPublished',
      aggregateId: 'product-001',
      aggregateType: 'StockAvailability',
      /** Dos movimientos: la versión es su cuenta más uno. */
      aggregateVersion: 3,
      payload: { quantityScaled: 10, quantityScale: 0, unitCost: null }
    });
    /** Derivar dos veces el mismo estado produce la misma versión y saldo. */
    expect(second[0]).toMatchObject({ aggregateVersion: 3, payload: { quantityScaled: 10 } });
    handle.close();
  });

  it('el corte inicial publica el saldo de cada ítem, incluido el saldo cero', async () => {
    const handle = migrated();
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const repository = new DrizzleStockItemRepository(handle);
    await unitOfWork.execute(() => repository.save(stockItem(handle, 2)));
    await unitOfWork.execute(() => repository.save(StockItem.create({
      id: 'stock-item-002', productId: 'product-002',
      unitCode: 'UNIT', quantityScale: 0, tracksBatches: false
    })));

    const availability = await new SqliteCatalogReferenceSource(handle).listStockAvailability();

    expect(availability).toEqual([
      {
        productId: 'product-001', quantityScaled: 10, quantityScale: 0,
        unitCost: null, version: 3
      },
      {
        productId: 'product-002', quantityScaled: 0, quantityScale: 0,
        unitCost: null, version: 1
      }
    ]);
    handle.close();
  });
});
