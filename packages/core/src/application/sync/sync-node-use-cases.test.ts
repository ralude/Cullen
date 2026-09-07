import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuditEntry,
  AuditWriter,
  AuthorizationService,
  Clock,
  IdGenerator,
  RegisteredSyncNode,
  SyncNodeRegistration,
  SyncNodeRegistry,
  UnitOfWork
} from '../ports/index.js';
import { ListSyncNodes, RegisterSyncNode, RevokeSyncNode } from './node-use-cases.js';
import { ResolveSyncSender } from './resolve-sync-sender.js';
import { SYNC_PERMISSIONS } from './permissions.js';

const clock: Clock = { now: () => new Date('2026-09-06T12:00:00.000Z') };
const unitOfWork: UnitOfWork = { execute: (work) => work() };
const ids: IdGenerator = { generate: () => 'audit-001' };

const context: ExecutionContext = {
  actorId: 'operator-001',
  actorRoleCodes: ['ADMIN'],
  terminalId: 'terminal-coordinator',
  originNodeId: 'node-coordinator',
  correlationId: 'correlation-001'
};

class FakeRegistry implements SyncNodeRegistry {
  readonly nodes = new Map<string, RegisteredSyncNode>();

  async findByCredentialFingerprint(fingerprint: string): Promise<RegisteredSyncNode | undefined> {
    return [...this.nodes.values()].find((node) => node.credentialFingerprint === fingerprint);
  }

  async findByNodeId(nodeId: string): Promise<RegisteredSyncNode | undefined> {
    return this.nodes.get(nodeId);
  }

  async coordinatorOf(storeId: string): Promise<RegisteredSyncNode | undefined> {
    return [...this.nodes.values()]
      .find((node) => node.storeId === storeId && node.role === 'COORDINATOR');
  }

  async list(): Promise<readonly RegisteredSyncNode[]> {
    return [...this.nodes.values()];
  }

  async deliveryDestinations(storeId: string, now: Date): Promise<readonly RegisteredSyncNode[]> {
    return [...this.nodes.values()].filter((node) => node.storeId === storeId &&
      node.status === 'ACTIVE' && node.notAfter.getTime() > now.getTime() &&
      node.addressHost !== null && node.addressPort !== null);
  }

  async register(registration: SyncNodeRegistration): Promise<void> {
    this.nodes.set(registration.nodeId, { ...registration, status: 'ACTIVE', revokedAt: null });
  }

  async revoke(nodeId: string, revokedAt: Date): Promise<boolean> {
    const node = this.nodes.get(nodeId);
    if (!node || node.status === 'REVOKED') return false;
    this.nodes.set(nodeId, { ...node, status: 'REVOKED', revokedAt });
    return true;
  }
}

const authorization = (granted: boolean): AuthorizationService => ({
  authorize: async (_context, permission) =>
    granted && permission === SYNC_PERMISSIONS.MANAGE_NODE
});

const auditWriter = (entries: AuditEntry[]): AuditWriter => ({
  append: async (appended) => { entries.push(...appended); }
});

const fingerprint = (seed: string): string => seed.repeat(64).slice(0, 64);

const registration = {
  nodeId: 'node-terminal-1',
  storeId: 'store-001',
  role: 'TERMINAL' as const,
  terminalId: 'terminal-001',
  credentialFingerprint: fingerprint('a'),
  notAfter: '2027-01-01T00:00:00.000Z',
  reason: 'Alta manual de la terminal 1.'
};

const coordinator = (registry: FakeRegistry): void => {
  registry.nodes.set('node-coordinator', {
    nodeId: 'node-coordinator',
    storeId: 'store-001',
    role: 'COORDINATOR',
    terminalId: null,
    credentialFingerprint: fingerprint('c'),
    addressHost: null,
    addressPort: null,
    notAfter: new Date('2027-01-01T00:00:00.000Z'),
    registeredAt: clock.now(),
    registeredBy: 'operator-001',
    registrationReason: 'Alta manual del coordinador.',
    status: 'ACTIVE',
    revokedAt: null
  });
};

describe('registro confiable de nodos', () => {
  it('registra un nodo con evidencia auditable', async () => {
    const registry = new FakeRegistry();
    const entries: AuditEntry[] = [];
    const useCase = new RegisterSyncNode(
      registry, authorization(true), clock, unitOfWork, ids, auditWriter(entries)
    );

    const result = await useCase.execute(registration, context);

    expect(result).toMatchObject({ ok: true });
    expect(registry.nodes.get('node-terminal-1')).toMatchObject({
      storeId: 'store-001', terminalId: 'terminal-001', status: 'ACTIVE'
    });
    expect(entries).toMatchObject([{
      action: 'SYNC_NODE_REGISTERED',
      actorId: 'operator-001',
      terminalId: 'terminal-coordinator',
      originNodeId: 'node-coordinator',
      occurredAt: clock.now(),
      reason: 'Alta manual de la terminal 1.'
    }]);
  });

  it('exige permiso para administrar la confianza', async () => {
    const registry = new FakeRegistry();
    const useCase = new RegisterSyncNode(registry, authorization(false), clock, unitOfWork, ids);

    await expect(useCase.execute(registration, context)).resolves.toMatchObject({
      ok: false, error: { code: 'FORBIDDEN' }
    });
    expect(registry.nodes.size).toBe(0);
  });

  it.each([
    ['una huella que no es SHA-256', { credentialFingerprint: 'abc' }, 'SYNC_NODE_FINGERPRINT_INVALID'],
    ['un motivo vacío', { reason: '   ' }, 'SYNC_NODE_REASON_REQUIRED'],
    ['una vigencia vencida', { notAfter: '2026-01-01T00:00:00.000Z' }, 'SYNC_NODE_CREDENTIAL_EXPIRED']
  ])('rechaza %s', async (_case, change, code) => {
    const registry = new FakeRegistry();
    const useCase = new RegisterSyncNode(registry, authorization(true), clock, unitOfWork, ids);

    await expect(useCase.execute({ ...registration, ...change }, context)).resolves
      .toMatchObject({ ok: false, error: { code } });
    expect(registry.nodes.size).toBe(0);
  });

  it('rechaza una terminal ausente y una terminal declarada por el coordinador', async () => {
    const registry = new FakeRegistry();
    const useCase = new RegisterSyncNode(registry, authorization(true), clock, unitOfWork, ids);
    const withoutTerminal = { ...registration } as Partial<typeof registration>;
    delete withoutTerminal.terminalId;

    await expect(useCase.execute(withoutTerminal as typeof registration, context)).resolves
      .toMatchObject({ ok: false, error: { code: 'SYNC_NODE_TERMINAL_REQUIRED' } });
    await expect(useCase.execute({ ...registration, role: 'COORDINATOR' }, context)).resolves
      .toMatchObject({ ok: false, error: { code: 'SYNC_NODE_TERMINAL_UNEXPECTED' } });
    expect(registry.nodes.size).toBe(0);
  });

  it('no reutiliza una huella ya registrada por otro nodo', async () => {
    const registry = new FakeRegistry();
    const useCase = new RegisterSyncNode(registry, authorization(true), clock, unitOfWork, ids);
    await useCase.execute(registration, context);

    await expect(useCase.execute({
      ...registration, nodeId: 'node-terminal-2', terminalId: 'terminal-002'
    }, context)).resolves.toMatchObject({ ok: false, error: { code: 'SYNC_NODE_CREDENTIAL_IN_USE' } });
  });

  it('revoca conservando la fila, el motivo y la auditoría', async () => {
    const registry = new FakeRegistry();
    const entries: AuditEntry[] = [];
    await new RegisterSyncNode(registry, authorization(true), clock, unitOfWork, ids)
      .execute(registration, context);
    const revoke = new RevokeSyncNode(
      registry, authorization(true), clock, unitOfWork, ids, auditWriter(entries)
    );

    const result = await revoke.execute({
      nodeId: 'node-terminal-1', reason: 'Terminal retirada del piso.'
    }, context);

    expect(result).toMatchObject({ ok: true, value: { status: 'REVOKED' } });
    expect(registry.nodes.get('node-terminal-1')?.status).toBe('REVOKED');
    expect(entries).toMatchObject([{ action: 'SYNC_NODE_REVOKED', reason: 'Terminal retirada del piso.' }]);
    await expect(revoke.execute({ nodeId: 'node-terminal-1', reason: 'Otra vez.' }, context))
      .resolves.toMatchObject({ ok: false, error: { code: 'SYNC_NODE_ALREADY_REVOKED' } });
  });

  it('lista nodos solo con permiso', async () => {
    const registry = new FakeRegistry();
    coordinator(registry);

    await expect(new ListSyncNodes(registry, authorization(true)).execute(context))
      .resolves.toMatchObject({ ok: true, value: [{ nodeId: 'node-coordinator' }] });
    await expect(new ListSyncNodes(registry, authorization(false)).execute(context))
      .resolves.toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
});

describe('resolución del emisor verificado', () => {
  const resolver = (registry: FakeRegistry): ResolveSyncSender =>
    new ResolveSyncSender('node-coordinator', registry, clock);

  const trusted = async (registry: FakeRegistry): Promise<void> => {
    coordinator(registry);
    await new RegisterSyncNode(registry, authorization(true), clock, unitOfWork, ids)
      .execute(registration, context);
  };

  it('devuelve nodo, terminal y coordinador verificados', async () => {
    const registry = new FakeRegistry();
    await trusted(registry);

    await expect(resolver(registry).execute({
      credentialFingerprint: fingerprint('a'), presentedNodeId: 'node-terminal-1'
    })).resolves.toEqual({
      ok: true,
      value: {
        verifiedNodeId: 'node-terminal-1',
        verifiedTerminalId: 'terminal-001',
        coordinatorNodeId: 'node-coordinator'
      }
    });
  });

  it('permite al coordinador entregar referencias a una terminal de su tienda', async () => {
    const registry = new FakeRegistry();
    await trusted(registry);
    const receiveReferences = new ResolveSyncSender('node-terminal-1', registry, clock);
    await expect(receiveReferences.execute({
      credentialFingerprint: fingerprint('c'), presentedNodeId: 'node-coordinator'
    })).resolves.toEqual({ ok: true, value: {
      verifiedNodeId: 'node-coordinator', verifiedTerminalId: null,
      coordinatorNodeId: 'node-coordinator'
    } });
  });

  it.each(['REVOKED', 'EXPIRED', 'ABSENT'] as const)(
    'no acepta referencias con receptor %s', async (state) => {
      const registry = new FakeRegistry();
      await trusted(registry);
      const own = registry.nodes.get('node-terminal-1')!;
      if (state === 'ABSENT') registry.nodes.delete(own.nodeId);
      else registry.nodes.set(own.nodeId, state === 'REVOKED'
        ? { ...own, status: 'REVOKED' }
        : { ...own, notAfter: new Date('2026-01-01T00:00:00.000Z') });
      await expect(new ResolveSyncSender(own.nodeId, registry, clock).execute({
        credentialFingerprint: fingerprint('c'), presentedNodeId: 'node-coordinator'
      })).resolves.toMatchObject({ ok: false, error: { code: 'SYNC_RECEIVER_NOT_ACTIVE' } });
    }
  );

  it('no permite que dos terminales intercambien hechos directamente', async () => {
    const registry = new FakeRegistry();
    await trusted(registry);
    registry.nodes.set('node-terminal-2', {
      ...registry.nodes.get('node-terminal-1')!, nodeId: 'node-terminal-2',
      terminalId: 'terminal-002', credentialFingerprint: fingerprint('b')
    });
    await expect(new ResolveSyncSender('node-terminal-1', registry, clock).execute({
      credentialFingerprint: fingerprint('b'), presentedNodeId: 'node-terminal-2'
    })).resolves.toMatchObject({ ok: false, error: { code: 'SYNC_NODE_ROLE_INVALID' } });
  });

  it('traduce indisponibilidad del registro sin rechazar permanentemente al nodo', async () => {
    const registry = new FakeRegistry();
    registry.findByCredentialFingerprint = async () => { throw new Error('private DB path'); };
    await expect(resolver(registry).execute({
      credentialFingerprint: fingerprint('a'), presentedNodeId: 'node-terminal-1'
    })).resolves.toMatchObject({ ok: false, error: { code: 'SYNC_RECEIVER_UNAVAILABLE' } });
  });

  it('falla cerrado ante una credencial desconocida', async () => {
    const registry = new FakeRegistry();
    await trusted(registry);

    await expect(resolver(registry).execute({
      credentialFingerprint: fingerprint('b'), presentedNodeId: 'node-terminal-1'
    })).resolves.toMatchObject({ ok: false, error: { code: 'SYNC_NODE_NOT_TRUSTED' } });
  });

  it('rechaza una identidad presentada que no coincide con la huella', async () => {
    const registry = new FakeRegistry();
    await trusted(registry);

    await expect(resolver(registry).execute({
      credentialFingerprint: fingerprint('a'), presentedNodeId: 'node-terminal-2'
    })).resolves.toMatchObject({ ok: false, error: { code: 'SYNC_NODE_IDENTITY_MISMATCH' } });
  });

  it('rechaza un nodo revocado', async () => {
    const registry = new FakeRegistry();
    await trusted(registry);
    await new RevokeSyncNode(registry, authorization(true), clock, unitOfWork, ids)
      .execute({ nodeId: 'node-terminal-1', reason: 'Equipo comprometido.' }, context);

    await expect(resolver(registry).execute({
      credentialFingerprint: fingerprint('a'), presentedNodeId: 'node-terminal-1'
    })).resolves.toMatchObject({ ok: false, error: { code: 'SYNC_NODE_REVOKED' } });
  });

  it('rechaza una credencial vencida', async () => {
    const registry = new FakeRegistry();
    await trusted(registry);
    const expired = new ResolveSyncSender('node-coordinator', registry,
      { now: () => new Date('2027-06-01T00:00:00.000Z') });

    await expect(expired.execute({
      credentialFingerprint: fingerprint('a'), presentedNodeId: 'node-terminal-1'
    })).resolves.toMatchObject({ ok: false, error: { code: 'SYNC_NODE_CREDENTIAL_EXPIRED' } });
  });

  it('rechaza un nodo de otra tienda y un rol que no entrega', async () => {
    const registry = new FakeRegistry();
    await trusted(registry);
    await new RegisterSyncNode(registry, authorization(true), clock, unitOfWork, ids).execute({
      ...registration,
      nodeId: 'node-foreign',
      storeId: 'store-002',
      terminalId: 'terminal-900',
      credentialFingerprint: fingerprint('d')
    }, context);

    await expect(resolver(registry).execute({
      credentialFingerprint: fingerprint('d'), presentedNodeId: 'node-foreign'
    })).resolves.toMatchObject({ ok: false, error: { code: 'SYNC_NODE_STORE_MISMATCH' } });
    await expect(resolver(registry).execute({
      credentialFingerprint: fingerprint('c'), presentedNodeId: 'node-coordinator'
    })).resolves.toMatchObject({ ok: false, error: { code: 'SYNC_NODE_ROLE_INVALID' } });
  });
});
