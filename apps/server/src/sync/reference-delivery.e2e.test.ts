import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  application,
  Barcode,
  Category,
  ExchangeRate,
  PaymentMethod,
  Product,
  UnitOfMeasure,
  type BusinessEventV1,
  type SyncNodeRegistration
} from '@supermarket/core';
import { Money, TaxRate } from '@supermarket/shared';
import {
  applyMigrations,
  DrizzleAggregateAuthorityRegistry,
  DrizzleAuditWriter,
  DrizzleOutboxStore,
  DrizzlePaymentMethodRepository,
  DrizzleSyncInboxWorkStore,
  DrizzleCategoryRepository,
  DrizzleExchangeRateRepository,
  DrizzleProductRepository,
  DrizzleSyncReceptionStore,
  DrizzleUnitOfMeasureRepository,
  openDatabase,
  SqliteCatalogReferenceProjection,
  SqliteCatalogReferenceSource,
  SqliteDiscountPolicyProvider,
  SqliteFinancialTransactionTaxPolicyProvider,
  SqliteOperationalPolicyWriter,
  SqliteSyncNodeRegistry,
  SqliteUnitOfWork,
  type DatabaseHandle
} from '@supermarket/driver-db';
import type { FastifyInstance } from 'fastify';
import { createDestinationRelays } from './destination-relays.ts';
import { buildSyncApp } from './sync-app.ts';
import { SyncWorker } from './sync-worker.ts';
import { issueNodeCertificate, type NodeCertificate } from './testing/certificates.ts';

const COORDINATOR = 'node-coordinator';
const TERMINALS = ['node-terminal-1', 'node-terminal-2'] as const;

let moment = new Date('2026-09-06T12:00:00.000Z');
const clock = { now: (): Date => moment };
let issued = 0;
const ids = { generate: (): string => `generated-${(issued += 1)}` };

const certificates: Readonly<Record<string, NodeCertificate>> = {
  [COORDINATOR]: issueNodeCertificate(COORDINATOR),
  'node-terminal-1': issueNodeCertificate('node-terminal-1'),
  'node-terminal-2': issueNodeCertificate('node-terminal-2')
};

const terminalAuthorities = TERMINALS.map((nodeId) =>
  (certificates[nodeId] as NodeCertificate).certificatePem);

const publication = (
  eventId: string,
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  aggregateVersion: number,
  payload: BusinessEventV1['payload']
): BusinessEventV1 => ({
  eventId,
  eventType,
  contractVersion: 1,
  aggregateId,
  aggregateType,
  aggregateVersion,
  originNodeId: COORDINATOR,
  correlationId: `correlation-${eventId}`,
  actorId: 'operator-001',
  occurredAt: new Date('2026-09-06T09:00:00.000Z'),
  payload
});

const catalogPublications = (productVersion = 1, name = 'Arroz'): BusinessEventV1[] => [
  publication('event-category-1', 'CategoryPublished', 'Category', 'category-001', 1, {
    name: 'Granos', isActive: 'ACTIVE'
  }),
  publication('event-unit-1', 'UnitOfMeasurePublished', 'UnitOfMeasure', 'unit-001', 1, {
    code: 'UNIT', name: 'Unidad', quantityScale: 0, isActive: 'ACTIVE'
  }),
  publication(
    `event-product-${productVersion}`, 'ProductPublished', 'Product', 'product-001',
    productVersion,
    {
      name,
      description: 'Arroz 1kg',
      categoryId: 'category-001',
      unitId: 'unit-001',
      unitCode: 'UNIT',
      barcodes: [{ barcodeId: 'barcode-001', code: '1234', isActive: 'ACTIVE' }],
      price: { minorUnits: 1200, currencyCode: 'USD' },
      taxRate: { basisPoints: 1600 },
      isActive: 'ACTIVE'
    }
  )
];

type Node = {
  readonly nodeId: string;
  readonly handle: DatabaseHandle;
  readonly unitOfWork: SqliteUnitOfWork;
  readonly app: FastifyInstance | null;
  readonly port: number;
  readonly processor: application.ProcessSyncInbox;
};

let directory: string;
let coordinator: Node;
const terminals = new Map<string, Node>();

const registration = (
  overrides: Partial<SyncNodeRegistration> & Pick<SyncNodeRegistration, 'nodeId'>
): SyncNodeRegistration => ({
  storeId: 'store-001',
  role: 'TERMINAL',
  terminalId: null,
  credentialFingerprint: '',
  addressHost: null,
  addressPort: null,
  notAfter: new Date('2027-01-01T00:00:00.000Z'),
  registeredAt: clock.now(),
  registeredBy: 'operator-001',
  registrationReason: 'Alta manual de prueba.',
  ...overrides
});

const openNode = async (nodeId: string, listen: boolean): Promise<Node> => {
  const handle = openDatabase(join(directory, `${nodeId}.sqlite`));
  applyMigrations(handle.sqlite);
  const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
  const registry = new SqliteSyncNodeRegistry(handle);
  const certificate = certificates[nodeId] as NodeCertificate;

  const app = listen
    ? buildSyncApp({
      receiverNodeId: nodeId,
      resolveSender: new application.ResolveSyncSender(nodeId, registry, clock),
      receiveSyncEvent: new application.ReceiveSyncEvent(
        nodeId,
        new DrizzleSyncReceptionStore(handle),
        new DrizzleAggregateAuthorityRegistry(handle),
        clock,
        unitOfWork,
        ids
      ),
      registerOwnedAggregate: new application.RegisterOwnedAggregate(
        new DrizzleAggregateAuthorityRegistry(handle), clock, unitOfWork, ids,
        new DrizzleAuditWriter(handle)
      ),
      https: {
        key: certificate.privateKeyPem,
        cert: certificate.certificatePem,
        ca: nodeId === COORDINATOR
          ? terminalAuthorities
          : [(certificates[COORDINATOR] as NodeCertificate).certificatePem]
      }
    })
    : null;
  if (app) await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app?.server.address();

  return {
    nodeId,
    handle,
    unitOfWork,
    app,
    port: typeof address === 'object' && address !== null ? address.port : 0,
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

/** Cada nodo conoce la misma cohorte; el coordinador además sabe dónde escuchan. */
const trustCohort = async (node: Node): Promise<void> => {
  const registry = new SqliteSyncNodeRegistry(node.handle);
  const entries: SyncNodeRegistration[] = [
    registration({
      nodeId: COORDINATOR,
      role: 'COORDINATOR',
      credentialFingerprint: (certificates[COORDINATOR] as NodeCertificate).fingerprint
    })
  ];
  for (const nodeId of TERMINALS) {
    const terminal = terminals.get(nodeId);
    entries.push(registration({
      nodeId,
      terminalId: nodeId.replace('node-terminal-', 'terminal-00'),
      credentialFingerprint: (certificates[nodeId] as NodeCertificate).fingerprint,
      ...(node.nodeId === COORDINATOR && terminal
        ? { addressHost: 'localhost', addressPort: terminal.port }
        : {})
    }));
  }
  for (const entry of entries) {
    if (await registry.findByNodeId(entry.nodeId)) continue;
    await node.unitOfWork.execute(() => registry.register(entry));
  }
};

const coordinatorWorker = (): SyncWorker => new SyncWorker(createDestinationRelays({
  senderNodeId: COORDINATOR,
  registry: new SqliteSyncNodeRegistry(coordinator.handle),
  outbox: new DrizzleOutboxStore(coordinator.handle),
  unitOfWork: coordinator.unitOfWork,
  clock,
  material: {
    key: (certificates[COORDINATOR] as NodeCertificate).privateKeyPem,
    cert: (certificates[COORDINATOR] as NodeCertificate).certificatePem,
    ca: terminalAuthorities,
    timeoutMilliseconds: 2_000
  }
}), { intervalMilliseconds: 60_000 });

/** Un ciclo del coordinador seguido de la aplicación en cada terminal. */
const distribute = async (worker: SyncWorker, cycles = 4): Promise<void> => {
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    await worker.runOnce();
    for (const terminal of terminals.values()) {
      if (terminal.handle.sqlite.open) await terminal.processor.runBatch();
    }
    moment = new Date(moment.getTime() + 120_000);
  }
};

const enqueue = async (events: readonly BusinessEventV1[]): Promise<void> => {
  const outbox = new DrizzleOutboxStore(coordinator.handle);
  await coordinator.unitOfWork.execute(() => outbox.enqueue(events));
};

const projected = (node: Node): unknown => node.handle.sqlite
  .prepare('select name, price_minor_units, version from products').get();

const deliveries = (destinationNodeId: string): unknown[] => coordinator.handle.sqlite.prepare(`
  select event_id, status from sync_delivery
  where destination_node_id = ? order by event_id
`).all(destinationNodeId);

beforeEach(async () => {
  moment = new Date('2026-09-06T12:00:00.000Z');
  directory = mkdtempSync(join(tmpdir(), 'reference-delivery-'));
  for (const nodeId of TERMINALS) terminals.set(nodeId, await openNode(nodeId, true));
  coordinator = await openNode(COORDINATOR, true);
  for (const node of [coordinator, ...terminals.values()]) await trustCohort(node);
});

afterEach(async () => {
  for (const node of [coordinator, ...terminals.values()]) {
    if (node.app) await node.app.close();
    if (node.handle.sqlite.open) node.handle.close();
  }
  terminals.clear();
  rmSync(directory, { recursive: true, force: true });
});

const seedCoordinatorCatalog = async (): Promise<void> => {
  const unit = UnitOfMeasure.create({
    id: 'unit-001', code: 'UNIT', name: 'Unidad', quantityScale: 0
  });
  await coordinator.unitOfWork.execute(() =>
    new DrizzleCategoryRepository(coordinator.handle).save(Category.create({
      id: 'category-001', name: 'Granos'
    })));
  await coordinator.unitOfWork.execute(() =>
    new DrizzleUnitOfMeasureRepository(coordinator.handle).save(unit));
  await coordinator.unitOfWork.execute(() =>
    new DrizzlePaymentMethodRepository(coordinator.handle).save(PaymentMethod.create({
      code: 'CASH_USD', name: 'Efectivo USD', kind: 'CASH', currencyCode: 'USD'
    })));
  const policyWriter = new SqliteOperationalPolicyWriter(coordinator.handle);
  await coordinator.unitOfWork.execute(async () => policyWriter.activateDiscountPolicy(
    { maximumBasisPoints: 1500 },
    {
      policyId: 'discount-policy-1', createdBy: 'operator-001',
      reason: 'Configuración inicial', now: clock.now()
    }
  ));
  await coordinator.unitOfWork.execute(async () =>
    policyWriter.activateFinancialTransactionTaxPolicy({
      rateBasisPoints: 300,
      eligiblePaymentMethodCodes: ['CASH_USD'],
      eligibleCurrencies: ['USD']
    }, {
      policyId: 'tax-policy-1', createdBy: 'operator-001',
      reason: 'Configuración inicial', now: clock.now()
    }));
  const exchangeRates = new DrizzleExchangeRateRepository(coordinator.handle);
  for (const rate of [
    ExchangeRate.create({
      id: 'rate-expired', baseCurrency: 'USD', quoteCurrency: 'VES',
      rateValue: 34_000, rateScale: 3, source: 'BCV',
      validFrom: new Date('2026-09-04T00:00:00.000Z'),
      validUntil: new Date('2026-09-05T00:00:00.000Z'), registeredBy: 'operator-001'
    }),
    ExchangeRate.create({
      id: 'rate-current', baseCurrency: 'USD', quoteCurrency: 'VES',
      rateValue: 36_500, rateScale: 3, source: 'BCV',
      validFrom: new Date('2026-09-06T00:00:00.000Z'), registeredBy: 'operator-001'
    }),
    ExchangeRate.create({
      id: 'rate-future', baseCurrency: 'USD', quoteCurrency: 'VES',
      rateValue: 37_000, rateScale: 3, source: 'BCV',
      validFrom: new Date('2026-09-07T00:00:00.000Z'), registeredBy: 'operator-001'
    })
  ]) {
    await coordinator.unitOfWork.execute(() => exchangeRates.save(rate));
  }
  await coordinator.unitOfWork.execute(() =>
    new DrizzleProductRepository(coordinator.handle).save(Product.create({
      id: 'product-001',
      name: 'Arroz',
      description: 'Arroz 1kg',
      categoryId: 'category-001',
      unitOfMeasure: unit,
      barcodes: [Barcode.create({ id: 'barcode-001', value: '1234' })],
      price: Money.fromMinorUnits(1200, 'USD'),
      taxRate: TaxRate.fromBasisPoints(1600),
      priceHistoryId: 'history-001',
      recordedBy: 'operator-001',
      occurredAt: clock.now(),
      eventId: 'event-seed'
    })));
};

const referencesUsable = async (node: Node): Promise<unknown> => {
  const status = await new application.GetSyncStatus(
    new DrizzleOutboxStore(node.handle),
    new DrizzleSyncInboxWorkStore(node.handle),
    { lastKnownState: async () => 'ONLINE' as const },
    clock,
    { authorize: async () => true },
    new SqliteCatalogReferenceProjection(node.handle)
  ).execute(COORDINATOR, {
    actorId: 'operator-001',
    actorRoleCodes: ['ADMIN'],
    terminalId: 'terminal-001',
    originNodeId: node.nodeId,
    correlationId: 'correlation-status'
  });
  return status.ok ? status.value : status;
};

describe('distribución de referencias a las terminales', () => {
  it('entrega el catálogo a las dos terminales y cada una lo proyecta', async () => {
    await enqueue(catalogPublications());

    await distribute(coordinatorWorker());

    for (const terminal of terminals.values()) {
      expect(projected(terminal)).toEqual({
        name: 'Arroz', price_minor_units: 1200, version: 1
      });
      expect(terminal.handle.sqlite.prepare('select count(*) from categories').pluck().get())
        .toBe(1);
      /** La terminal no reenvía como propio el catálogo que recibió. */
      expect(terminal.handle.sqlite.prepare('select count(*) from outbox_event').pluck().get())
        .toBe(0);
    }
    expect(deliveries('node-terminal-1').every((entry) =>
      (entry as { status: string }).status === 'PUBLISHED')).toBe(true);
  });

  it('una terminal caída no bloquea a su vecina y se pone al día al volver', async () => {
    const offline = terminals.get('node-terminal-2') as Node;
    await offline.app?.close();
    offline.handle.close();
    await enqueue(catalogPublications());

    await distribute(coordinatorWorker());

    expect(projected(terminals.get('node-terminal-1') as Node)).toMatchObject({ version: 1 });
    expect(deliveries('node-terminal-1').every((entry) =>
      (entry as { status: string }).status === 'PUBLISHED')).toBe(true);
    expect(deliveries('node-terminal-2').every((entry) =>
      (entry as { status: string }).status === 'PENDING')).toBe(true);

    const revived = await openNode('node-terminal-2', true);
    terminals.set('node-terminal-2', revived);
    await trustCohort(revived);
    /** Al reabrir escucha en otro puerto: la dirección vive en el registro. */
    coordinator.handle.sqlite.prepare(
      'update sync_node set address_port = ? where node_id = ?'
    ).run(revived.port, 'node-terminal-2');

    await distribute(coordinatorWorker());

    expect(projected(revived)).toMatchObject({ name: 'Arroz', version: 1 });
    expect(deliveries('node-terminal-2').every((entry) =>
      (entry as { status: string }).status === 'PUBLISHED')).toBe(true);
  });

  it('no entrega a un nodo revocado y conserva sus pendientes', async () => {
    const registry = new SqliteSyncNodeRegistry(coordinator.handle);
    await coordinator.unitOfWork.execute(() => registry.revoke(
      'node-terminal-2', clock.now(), 'operator-001', 'Equipo retirado.'
    ));
    await enqueue(catalogPublications());

    await distribute(coordinatorWorker());

    expect(projected(terminals.get('node-terminal-1') as Node)).toMatchObject({ version: 1 });
    expect(projected(terminals.get('node-terminal-2') as Node)).toBeUndefined();
    /** Nunca se materializó una entrega hacia el destino retirado. */
    expect(deliveries('node-terminal-2')).toEqual([]);
    /**
     * `outbox_event.status` solo resume los destinos materializados, así que
     * marca publicado aunque el nodo revocado no recibiera nada. La autoridad
     * de entrega es `sync_delivery`, que no tiene fila para ese destino.
     */
    expect(coordinator.handle.sqlite.prepare(
      "select status from outbox_event where event_id = 'event-product-1'"
    ).pluck().get()).toBe('PUBLISHED');
  });

  it('aplica un cambio posterior del maestro conservando el orden por versión', async () => {
    await enqueue(catalogPublications());
    await distribute(coordinatorWorker());

    await enqueue([publication(
      'event-product-2', 'ProductPublished', 'Product', 'product-001', 2,
      {
        name: 'Arroz blanco',
        description: 'Arroz 1kg',
        categoryId: 'category-001',
        unitId: 'unit-001',
        unitCode: 'UNIT',
        barcodes: [{ barcodeId: 'barcode-001', code: '1234', isActive: 'ACTIVE' }],
        price: { minorUnits: 1500, currencyCode: 'USD' },
        taxRate: { basisPoints: 1600 },
        isActive: 'ACTIVE'
      }
    )]);
    await distribute(coordinatorWorker());

    for (const terminal of terminals.values()) {
      expect(projected(terminal)).toEqual({
        name: 'Arroz blanco', price_minor_units: 1500, version: 2
      });
    }
  });

  it('una terminal nueva recibe el corte inicial y solo entonces es utilizable', async () => {
    const joining = terminals.get('node-terminal-1') as Node;
    expect(await referencesUsable(joining)).toMatchObject({
      referencesUsable: false, pendingReferences: 0, status: 'SYNCING'
    });

    const bootstrap = new application.PublishCatalogBootstrap(
      new SqliteCatalogReferenceSource(coordinator.handle),
      new DrizzleOutboxStore(coordinator.handle),
      { authorize: async () => true },
      clock,
      coordinator.unitOfWork,
      ids
    );
    /** El coordinador tiene catálogo propio; el corte lo publica tal cual está. */
    await seedCoordinatorCatalog();
    await bootstrap.execute({ reason: 'Alta de terminal nueva' }, {
      actorId: 'operator-001',
      actorRoleCodes: ['ADMIN'],
      terminalId: 'terminal-coordinator',
      originNodeId: COORDINATOR,
      correlationId: 'correlation-bootstrap'
    });

    await distribute(coordinatorWorker());

    expect(projected(joining)).toMatchObject({ name: 'Arroz', version: 1 });
    expect(joining.handle.sqlite.prepare(`
      select name, currency_code, is_active, version from payment_methods where code = 'CASH_USD'
    `).get()).toEqual({
      name: 'Efectivo USD', currency_code: 'USD', is_active: 1, version: 1
    });
    await expect(new SqliteDiscountPolicyProvider(joining.handle).getPolicy()).resolves.toEqual({
      id: 'discount-policy-1', maximumBasisPoints: 1500
    });
    await expect(new SqliteFinancialTransactionTaxPolicyProvider(joining.handle).getPolicy())
      .resolves.toMatchObject({
        id: 'tax-policy-1',
        rate: { basisPoints: 300 },
        eligiblePaymentMethodCodes: ['CASH_USD'],
        eligibleCurrencies: ['USD']
      });
    const coordinatorRate = await new DrizzleExchangeRateRepository(coordinator.handle)
      .findCurrentByPair('USD', 'VES', moment);
    const joiningRate = await new DrizzleExchangeRateRepository(joining.handle)
      .findCurrentByPair('USD', 'VES', moment);
    expect(joiningRate).toEqual(coordinatorRate);
    expect(joining.handle.sqlite.prepare(`
      select id, version from exchange_rates order by version
    `).all()).toEqual([
      { id: 'rate-current', version: 2 },
      { id: 'rate-future', version: 3 }
    ]);
    expect(joining.handle.sqlite.prepare('select count(*) from outbox_event').pluck().get())
      .toBe(0);
    expect(await referencesUsable(joining)).toMatchObject({
      referencesUsable: true, pendingReferences: 0
    });
  });

  it('el coordinador no acepta una referencia entrante desde una terminal', async () => {
    const terminal = terminals.get('node-terminal-1') as Node;
    const outbox = new DrizzleOutboxStore(terminal.handle);
    await terminal.unitOfWork.execute(() => outbox.enqueue([{
      ...publication('event-forged', 'CategoryPublished', 'Category', 'category-999', 1, {
        name: 'Falsificada', isActive: 'ACTIVE'
      }),
      originNodeId: 'node-terminal-1'
    }]));

    await new application.OutboxRelay(
      COORDINATOR,
      outbox,
      new (await import('@supermarket/driver-security')).HttpsSyncEventPublisher({
        host: 'localhost',
        port: coordinator.port,
        destinationNodeId: COORDINATOR,
        key: (certificates['node-terminal-1'] as NodeCertificate).privateKeyPem,
        cert: (certificates['node-terminal-1'] as NodeCertificate).certificatePem,
        ca: [(certificates[COORDINATOR] as NodeCertificate).certificatePem],
        timeoutMilliseconds: 2_000
      }),
      terminal.unitOfWork,
      clock,
      { jitter: () => 0 }
    ).runBatch();

    expect(coordinator.handle.sqlite.prepare('select count(*) from categories').pluck().get())
      .toBe(0);
    expect(terminal.handle.sqlite.prepare(
      "select status, last_error from sync_delivery where event_id = 'event-forged'"
    ).get()).toEqual({ status: 'BLOCKED', last_error: 'SYNC_AGGREGATE_OWNER_UNRESOLVED' });
  });

  it('entrega concesiones y disponibilidad, y la terminal las aplica con su antigüedad', async () => {
    const joining = terminals.get('node-terminal-1') as Node;
    const issuedAt = new Date('2026-09-06T09:00:00.000Z');
    const expiresAt = new Date(issuedAt.getTime() + 8 * 60 * 60 * 1000);

    await seedCoordinatorCatalog();
    await enqueue([
      ...catalogPublications(),
      publication(
        'event-grant-1', 'OperatorGrantPublished', 'OperatorGrant', 'user-coordinator-001', 1,
        {
          operatorCode: 'CAJA01',
          displayName: 'Cajera 1',
          roleCodes: ['CASHIER'],
          permissionCodes: ['sales.complete'],
          isActive: 'ACTIVE',
          expiresAt: expiresAt.toISOString()
        }
      ),
      publication(
        'event-availability-1', 'StockAvailabilityPublished', 'StockAvailability',
        'product-001', 3, { quantityScaled: 12, quantityScale: 0 }
      )
    ]);

    await distribute(coordinatorWorker());

    expect(joining.handle.sqlite.prepare(`
      select operator_code as operatorCode, permission_codes as permissionCodes,
        is_active as isActive, expires_at as expiresAt
      from identity_operator_grant
    `).get()).toEqual({
      operatorCode: 'CAJA01',
      permissionCodes: '["sales.complete"]',
      isActive: 1,
      expiresAt: expiresAt.getTime()
    });
    expect(joining.handle.sqlite.prepare(`
      select product_id as productId, quantity_scaled as quantityScaled, version
      from stock_availability_reference
    `).get()).toEqual({ productId: 'product-001', quantityScaled: 12, version: 3 });

    /** La disponibilidad es informativa: no crea ni toca inventario local. */
    expect(joining.handle.sqlite.prepare('select count(*) from stock_items').pluck().get())
      .toBe(0);
    /** Y la terminal no reenvía nada de lo recibido. */
    expect(joining.handle.sqlite.prepare('select count(*) from outbox_event').pluck().get())
      .toBe(0);

    const status = await referencesUsable(joining) as {
      references: {
        catalog: { count: number; ageMilliseconds: number | null };
        operatorGrants: { count: number; expiresAt: string | null; expired: boolean };
        stockAvailability: { count: number; version: number | null };
        exchangeRate: { count: number; publishedAt: string | null };
      };
    };
    expect(status.references.operatorGrants).toMatchObject({
      count: 1, expiresAt: expiresAt.toISOString(), expired: false
    });
    expect(status.references.stockAvailability).toMatchObject({ count: 1, version: 3 });
    expect(status.references.catalog.count).toBe(1);
    expect(status.references.catalog.ageMilliseconds).toBeGreaterThan(0);
    /** Nunca recibida no es lo mismo que vacía: sin tasas, todo queda en `null`. */
    expect(status.references.exchangeRate).toMatchObject({ count: 0, publishedAt: null });
  });

  it('marca atención cuando la concesión proyectada ya venció', async () => {
    const joining = terminals.get('node-terminal-1') as Node;
    /** Emitida ocho horas antes del reloj actual: vencida al llegar. */
    const staleIssue = new Date(moment.getTime() - 9 * 60 * 60 * 1000);

    await seedCoordinatorCatalog();
    await enqueue([
      ...catalogPublications(),
      {
        ...publication(
          'event-grant-stale', 'OperatorGrantPublished', 'OperatorGrant',
          'user-coordinator-001', 1,
          {
            operatorCode: 'CAJA01',
            displayName: 'Cajera 1',
            roleCodes: ['CASHIER'],
            permissionCodes: ['sales.complete'],
            isActive: 'ACTIVE',
            expiresAt: new Date(staleIssue.getTime() + 8 * 60 * 60 * 1000).toISOString()
          }
        ),
        occurredAt: staleIssue
      }
    ]);

    await distribute(coordinatorWorker());

    const status = await referencesUsable(joining) as {
      status: string;
      references: { operatorGrants: { expired: boolean } };
    };
    expect(status.references.operatorGrants.expired).toBe(true);
    /** Atención prevalece sobre el rótulo general aunque no quede cola. */
    expect(status.status).toBe('ATTENTION_REQUIRED');
  });
});
