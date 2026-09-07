import { request as httpsRequest, type RequestOptions } from 'node:https';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { application, type SyncNodeRegistration } from '@supermarket/core';
import type { SyncEnvelopeV1 } from '@supermarket/shared';
import {
  applyMigrations,
  DrizzleAggregateAuthorityRegistry,
  DrizzleSyncReceptionStore,
  openDatabase,
  SqliteSyncNodeRegistry,
  SqliteUnitOfWork,
  type DatabaseHandle
} from '@supermarket/driver-db';
import type { FastifyInstance } from 'fastify';
import {
  buildSyncApp,
  SYNC_AGGREGATES_ROUTE,
  SYNC_DESTINATION_HEADER,
  SYNC_EVENTS_ROUTE
} from './sync-app.ts';
import { issueNodeCertificate, type NodeCertificate } from './testing/certificates.ts';

const clock = { now: (): Date => new Date('2026-09-06T12:00:00.000Z') };
let issued = 0;
const ids = { generate: (): string => `generated-${(issued += 1)}` };

const coordinatorCertificate = issueNodeCertificate('node-coordinator');
const terminalCertificate = issueNodeCertificate('node-terminal-1');
const neighbourCertificate = issueNodeCertificate('node-terminal-2');
const foreignCertificate = issueNodeCertificate('node-foreign');
const untrustedCertificate = issueNodeCertificate('node-intruder');

const salePayload = (terminalId: string): Record<string, unknown> => ({
  shiftId: 'shift-001',
  terminalId,
  total: { minorUnits: 2320, currencyCode: 'USD' },
  paidTotal: { minorUnits: 2320, currencyCode: 'USD' },
  payments: [{
    paymentId: 'payment-001',
    methodCode: 'CASH_USD',
    currencyCode: 'USD',
    amountMinorUnits: 2320
  }],
  items: [{ itemId: 'item-001', productId: 'product-001', quantityScaled: 2, quantityScale: 0 }]
});

const saleEnvelope = (overrides: Partial<SyncEnvelopeV1> = {}): SyncEnvelopeV1 => ({
  protocolVersion: 1,
  eventId: 'event-001',
  eventType: 'SaleCompleted',
  contractVersion: 1,
  aggregateId: 'sale-001',
  aggregateType: 'Sale',
  aggregateVersion: 4,
  originNodeId: 'node-terminal-1',
  correlationId: 'correlation-001',
  actorId: 'user-001',
  occurredAt: '2026-09-06T10:00:00.000Z',
  payload: salePayload('terminal-001') as SyncEnvelopeV1['payload'],
  ...overrides
});

const node = (
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

let handle: DatabaseHandle;
let app: FastifyInstance;
let port: number;

const trust = async (registrations: readonly SyncNodeRegistration[]): Promise<void> => {
  const registry = new SqliteSyncNodeRegistry(handle);
  const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
  for (const registration of registrations) {
    await unitOfWork.execute(() => registry.register(registration));
  }
};

const grantAuthority = async (aggregateId: string, ownerNodeId: string): Promise<void> => {
  const registry = new DrizzleAggregateAuthorityRegistry(handle);
  await new SqliteUnitOfWork(handle.sqlite).execute(() => registry.register({
    aggregateType: 'Sale',
    aggregateId,
    ownerNodeId,
    source: 'MANUAL',
    evidenceFingerprint: `evidence-${aggregateId}`,
    registeredAt: clock.now(),
    registeredBy: 'operator-001'
  }));
};

type Response = { readonly status: number; readonly contentType: string; readonly body: unknown };

const post = (
  path: string,
  certificate: NodeCertificate,
  body: unknown,
  headers: Readonly<Record<string, string>> = { [SYNC_DESTINATION_HEADER]: 'node-coordinator' }
): Promise<Response> => new Promise((resolve, reject) => {
  const serialized = typeof body === 'string' ? body : JSON.stringify(body);
  const options: RequestOptions = {
    host: 'localhost',
    port,
    path,
    method: 'POST',
    ca: [coordinatorCertificate.certificatePem],
    key: certificate.privateKeyPem,
    cert: certificate.certificatePem,
    headers: { 'content-type': 'application/json', ...headers }
  };
  const call = httpsRequest(options, (response) => {
    let raw = '';
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => { raw += chunk; });
    response.on('end', () => resolve({
      status: response.statusCode ?? 0,
      contentType: response.headers['content-type'] ?? '',
      body: raw.length === 0 ? null : JSON.parse(raw) as unknown
    }));
  });
  call.on('error', reject);
  call.end(serialized);
});

const deliver = (
  certificate: NodeCertificate,
  body: unknown,
  headers?: Readonly<Record<string, string>>
): Promise<Response> => headers === undefined
  ? post(SYNC_EVENTS_ROUTE, certificate, body)
  : post(SYNC_EVENTS_ROUTE, certificate, body, headers);

beforeEach(async () => {
  handle = openDatabase(':memory:');
  applyMigrations(handle.sqlite);
  const registry = new SqliteSyncNodeRegistry(handle);
  app = buildSyncApp({
    receiverNodeId: 'node-coordinator',
    resolveSender: new application.ResolveSyncSender('node-coordinator', registry, clock),
    receiveSyncEvent: new application.ReceiveSyncEvent(
      'node-coordinator',
      new DrizzleSyncReceptionStore(handle),
      new DrizzleAggregateAuthorityRegistry(handle),
      clock,
      new SqliteUnitOfWork(handle.sqlite),
      ids
    ),
    registerOwnedAggregate: new application.RegisterOwnedAggregate(
      new DrizzleAggregateAuthorityRegistry(handle),
      clock,
      new SqliteUnitOfWork(handle.sqlite),
      ids
    ),
    https: {
      key: coordinatorCertificate.privateKeyPem,
      cert: coordinatorCertificate.certificatePem,
      ca: [
        terminalCertificate.certificatePem,
        neighbourCertificate.certificatePem,
        foreignCertificate.certificatePem
      ]
    }
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  port = typeof address === 'object' && address !== null ? address.port : 0;

  await trust([
    node({
      nodeId: 'node-coordinator',
      role: 'COORDINATOR',
      credentialFingerprint: coordinatorCertificate.fingerprint
    }),
    node({
      nodeId: 'node-terminal-1',
      terminalId: 'terminal-001',
      credentialFingerprint: terminalCertificate.fingerprint
    }),
    node({
      nodeId: 'node-terminal-2',
      terminalId: 'terminal-002',
      credentialFingerprint: neighbourCertificate.fingerprint
    }),
    node({
      nodeId: 'node-foreign',
      storeId: 'store-002',
      terminalId: 'terminal-900',
      credentialFingerprint: foreignCertificate.fingerprint
    })
  ]);
});

afterEach(async () => {
  await app.close();
  handle.close();
});

describe('transporte autenticado de sincronización', () => {
  it('acepta un hecho del nodo confiable y confirma después del commit', async () => {
    await grantAuthority('sale-001', 'node-terminal-1');

    const response = await deliver(terminalCertificate, saleEnvelope());

    expect(response.status).toBe(200);
    expect(response.contentType).toContain('application/json');
    expect(response.body).toEqual({
      protocolVersion: 1,
      eventId: 'event-001',
      receiverNodeId: 'node-coordinator',
      status: 'ACCEPTED',
      application: 'PENDING_DEPENDENCY'
    });
    expect(handle.sqlite.prepare('select count(*) from sync_inbox_event').pluck().get()).toBe(1);
  });

  it('devuelve el mismo resultado ante una reentrega, tras verificar identidad', async () => {
    await grantAuthority('sale-001', 'node-terminal-1');
    await deliver(terminalCertificate, saleEnvelope());

    const repeated = await deliver(terminalCertificate, saleEnvelope());
    const impersonated = await deliver(neighbourCertificate, saleEnvelope());

    expect(repeated.body).toMatchObject({ status: 'DUPLICATE' });
    expect(impersonated.status).toBe(422);
    expect(impersonated.body).toMatchObject({
      status: 'REJECTED', code: 'SYNC_SENDER_NOT_AUTHORIZED'
    });
    expect(handle.sqlite.prepare('select count(*) from sync_inbox_event').pluck().get()).toBe(1);
  });

  it('rechaza un certificado que el receptor no confía', async () => {
    await expect(deliver(untrustedCertificate, saleEnvelope())).rejects.toMatchObject({
      message: expect.stringMatching(/socket hang up|alert|EPROTO/)
    });
    expect(handle.sqlite.prepare('select count(*) from sync_inbox_event').pluck().get()).toBe(0);
  });

  it('rechaza un nodo revocado aunque su certificado siga siendo válido', async () => {
    await grantAuthority('sale-001', 'node-terminal-1');
    const registry = new SqliteSyncNodeRegistry(handle);
    await new SqliteUnitOfWork(handle.sqlite).execute(() => registry.revoke(
      'node-terminal-1', clock.now(), 'operator-001', 'Equipo retirado.'
    ));

    const response = await deliver(terminalCertificate, saleEnvelope());

    expect(response.status).toBe(403);
    expect(response.contentType).toContain('application/problem+json');
    expect(response.body).toMatchObject({ code: 'SYNC_NODE_REVOKED' });
    expect(response.body).not.toHaveProperty('eventId');
  });

  it('rechaza un nodo de otra tienda', async () => {
    const response = await deliver(foreignCertificate, saleEnvelope({
      eventId: 'event-foreign', originNodeId: 'node-foreign'
    }));

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'SYNC_NODE_STORE_MISMATCH' });
  });

  it('rechaza un hecho dirigido a otro coordinador', async () => {
    const response = await deliver(terminalCertificate, saleEnvelope(), {
      [SYNC_DESTINATION_HEADER]: 'node-otro-coordinador'
    });

    expect(response.status).toBe(421);
    expect(response.body).toMatchObject({ code: 'SYNC_DESTINATION_MISMATCH' });
    expect(response.body).not.toHaveProperty('eventId');
  });

  it('exige la identidad de destino en la solicitud', async () => {
    const response = await deliver(terminalCertificate, saleEnvelope(), {});

    expect(response.status).toBe(421);
    expect(response.body).toMatchObject({ code: 'SYNC_DESTINATION_MISMATCH' });
  });

  it('rechaza una terminal ajena al nodo verificado', async () => {
    await grantAuthority('sale-002', 'node-terminal-1');

    const response = await deliver(terminalCertificate, saleEnvelope({
      eventId: 'event-002',
      aggregateId: 'sale-002',
      payload: salePayload('terminal-002') as SyncEnvelopeV1['payload']
    }));

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'SYNC_SENDER_NOT_AUTHORIZED' });
  });

  it('no acepta un agregado sin autoridad registrada', async () => {
    const response = await deliver(terminalCertificate, saleEnvelope());

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'SYNC_AGGREGATE_OWNER_UNRESOLVED' });
    expect(handle.sqlite.prepare(
      'select reason_code, sender_node_id from sync_quarantine'
    ).all()).toEqual([{
      reason_code: 'SYNC_AGGREGATE_OWNER_UNRESOLVED', sender_node_id: 'node-terminal-1'
    }]);
  });

  it('responde un problema sin identidad de evento ante JSON inválido', async () => {
    const response = await deliver(terminalCertificate, '{"eventId":');

    expect(response.status).toBe(400);
    expect(response.contentType).toContain('application/problem+json');
    expect(response.body).toMatchObject({ code: 'SYNC_REQUEST_INVALID' });
    expect(response.body).not.toHaveProperty('eventId');
  });

  it('rechaza un sobre por encima del límite sin conservar su cuerpo', async () => {
    const oversized = await app.inject({
      method: 'POST',
      url: SYNC_EVENTS_ROUTE,
      headers: {
        'content-type': 'application/json',
        [SYNC_DESTINATION_HEADER]: 'node-coordinator'
      },
      payload: JSON.stringify(saleEnvelope({
        payload: {
          ...salePayload('terminal-001'),
          oversized: 'x'.repeat(300_000)
        } as SyncEnvelopeV1['payload']
      }))
    });

    expect(oversized.statusCode).toBe(413);
    expect(oversized.headers['content-type']).toContain('application/problem+json');
    expect(oversized.json()).toMatchObject({ code: 'SYNC_ENVELOPE_TOO_LARGE' });
    expect(oversized.json()).not.toHaveProperty('eventId');
    expect(handle.sqlite.prepare('select count(*) from sync_quarantine').pluck().get()).toBe(0);
    expect(handle.sqlite.prepare('select count(*) from sync_inbox_event').pluck().get()).toBe(0);
  });

  it('registra la autoridad de un agregado creado sin conexión y luego lo acepta', async () => {
    const evidence = 'a'.repeat(64);
    const alta = await post(SYNC_AGGREGATES_ROUTE, terminalCertificate, {
      aggregateType: 'Sale', aggregateId: 'sale-offline', evidenceFingerprint: evidence
    });
    const repeated = await post(SYNC_AGGREGATES_ROUTE, terminalCertificate, {
      aggregateType: 'Sale', aggregateId: 'sale-offline', evidenceFingerprint: evidence
    });

    const accepted = await deliver(terminalCertificate, saleEnvelope({
      eventId: 'event-offline', aggregateId: 'sale-offline'
    }));

    expect(alta.body).toEqual({
      protocolVersion: 1,
      aggregateType: 'Sale',
      aggregateId: 'sale-offline',
      status: 'REGISTERED',
      ownerNodeId: 'node-terminal-1'
    });
    expect(repeated.body).toMatchObject({ status: 'ALREADY_REGISTERED' });
    expect(accepted.body).toMatchObject({ status: 'ACCEPTED' });
  });

  it('no reasigna un agregado ya registrado ni delega tipos ajenos', async () => {
    await post(SYNC_AGGREGATES_ROUTE, terminalCertificate, {
      aggregateType: 'Sale', aggregateId: 'sale-offline', evidenceFingerprint: 'a'.repeat(64)
    });

    const stolen = await post(SYNC_AGGREGATES_ROUTE, neighbourCertificate, {
      aggregateType: 'Sale', aggregateId: 'sale-offline', evidenceFingerprint: 'b'.repeat(64)
    });
    const catalog = await post(SYNC_AGGREGATES_ROUTE, terminalCertificate, {
      aggregateType: 'Product', aggregateId: 'product-001', evidenceFingerprint: 'c'.repeat(64)
    });
    const malformed = await post(SYNC_AGGREGATES_ROUTE, terminalCertificate, {
      aggregateType: 'Sale', aggregateId: 'sale-x'
    });

    expect(stolen.status).toBe(409);
    expect(stolen.body).toMatchObject({ status: 'REJECTED', code: 'SYNC_AUTHORITY_CONFLICT' });
    expect(catalog.body).toMatchObject({ code: 'SYNC_AUTHORITY_TYPE_NOT_DELEGATED' });
    expect(malformed.status).toBe(400);
    expect(handle.sqlite.prepare(
      'select owner_node_id from sync_aggregate_authority where aggregate_id = ?'
    ).pluck().get('sale-offline')).toBe('node-terminal-1');
  });

  it('no expone rutas de operadores en el listener técnico', async () => {
    const response = await deliver(terminalCertificate, {}, {
      [SYNC_DESTINATION_HEADER]: 'node-coordinator'
    });

    expect(response.status).toBe(422);
    await expect(new Promise<Response>((resolve, reject) => {
      const call = httpsRequest({
        host: 'localhost',
        port,
        path: '/auth/session',
        method: 'POST',
        ca: [coordinatorCertificate.certificatePem],
        key: terminalCertificate.privateKeyPem,
        cert: terminalCertificate.certificatePem
      }, (result) => {
        let raw = '';
        result.setEncoding('utf8');
        result.on('data', (chunk: string) => { raw += chunk; });
        result.on('end', () => resolve({
          status: result.statusCode ?? 0,
          contentType: result.headers['content-type'] ?? '',
          body: raw.length === 0 ? null : JSON.parse(raw) as unknown
        }));
      });
      call.on('error', reject);
      call.end();
    })).resolves.toMatchObject({ status: 404, body: { code: 'SYNC_ROUTE_NOT_FOUND' } });
  });
});
