import { describe, expect, it } from 'vitest';
import { permissionAlternatives } from '@supermarket/core';
import type {
  AuditEntry,
  AuditWriter,
  AuthorizationService,
  BranchRepository,
  Clock,
  DeviceRepository,
  ExecutionContext,
  IdGenerator
} from '@supermarket/core';
import { Branch, type BranchStatus, Device, type DeviceStatus } from '../../domain/config/index.js';
import { ChangeBranchStatus, CreateBranch, GetBranch, ListBranches, UpdateBranch } from './branch-use-cases.js';
import { ChangeDeviceStatus, DeclareDevice, ListDevices, UpdateDevice } from './device-use-cases.js';
import { CONFIG_PERMISSIONS } from './permissions.js';

class MemoryBranches implements BranchRepository {
  readonly values = new Map<string, Branch>();
  save = async (branch: Branch): Promise<void> => { this.values.set(branch.id, branch); };
  findById = async (id: string): Promise<Branch | null> => this.values.get(id) ?? null;
  findByCode = async (code: string): Promise<Branch | null> =>
    [...this.values.values()].find((branch) => branch.code === code) ?? null;
  findAll = async (status?: BranchStatus): Promise<readonly Branch[]> =>
    [...this.values.values()].filter((branch) => status === undefined || branch.status === status);
}

class MemoryDevices implements DeviceRepository {
  readonly values = new Map<string, Device>();
  save = async (device: Device): Promise<void> => { this.values.set(device.id, device); };
  findById = async (id: string): Promise<Device | null> => this.values.get(id) ?? null;
  findByIdentifier = async (identifier: string): Promise<Device | null> =>
    [...this.values.values()].find((device) =>
      device.identifier.toUpperCase() === identifier.toUpperCase()) ?? null;
  findAll = async (
    filter: { readonly terminalId?: string; readonly status?: DeviceStatus } = {}
  ): Promise<readonly Device[]> => [...this.values.values()].filter((device) =>
    (filter.terminalId === undefined || device.terminalId === filter.terminalId) &&
    (filter.status === undefined || device.status === filter.status)
  );
}

const context: ExecutionContext = {
  actorId: 'user-1', actorRoleCodes: ['ADMIN'], terminalId: 'terminal-1',
  originNodeId: 'node-1', correlationId: 'correlation-1'
};
const ids: IdGenerator = { generate: (() => { let value = 0; return () => `id-${++value}`; })() };
const clock: Clock = { now: () => new Date('2026-09-05T12:00:00Z') };
const allow = (...permissions: string[]): AuthorizationService => ({
  authorize: async (_context, permission) =>
    permissionAlternatives(permission).some((code) => permissions.includes(code))
});
const evidence = (): { audit: AuditEntry[] } => ({ audit: [] });
const auditWriter = (audit: AuditEntry[]): AuditWriter => ({ append: async (entries) => { audit.push(...entries); } });

describe('branch use cases', () => {
  it('creates a branch, rejects a duplicate code and updates its name with a new version', async () => {
    const repository = new MemoryBranches();
    const recorded = evidence();
    const create = new CreateBranch(
      repository, allow(CONFIG_PERMISSIONS.MANAGE_BRANCH), ids, clock, undefined, auditWriter(recorded.audit)
    );
    const created = await create.execute({ code: 'ccs-centro', name: 'Sucursal Centro', reason: 'Alta' }, context);
    expect(created).toMatchObject({ ok: true, value: { code: 'CCS-CENTRO', status: 'ACTIVE' } });

    const duplicate = await create.execute({ code: 'CCS-CENTRO', name: 'Otra', reason: 'Alta' }, context);
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'BRANCH_CODE_CONFLICT' } });

    const branchId = created.ok ? created.value.id : '';
    const update = new UpdateBranch(
      repository, allow(CONFIG_PERMISSIONS.MANAGE_BRANCH), ids, clock, undefined, auditWriter(recorded.audit)
    );
    const updated = await update.execute({ branchId, name: 'Sucursal Centro Ampliada', reason: 'Corrección' }, context);
    expect(updated).toMatchObject({ ok: true, value: { name: 'Sucursal Centro Ampliada', version: 2 } });
    expect(recorded.audit.map((entry) => entry.action)).toEqual(['BRANCH_CREATED', 'BRANCH_UPDATED']);
  });

  it('denies creation without the permission and leaves no evidence', async () => {
    const repository = new MemoryBranches();
    const create = new CreateBranch(repository, allow('nothing'), ids, clock);
    const result = await create.execute({ code: 'CCS', name: 'Sucursal', reason: 'Alta' }, context);

    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(repository.values.size).toBe(0);
  });

  it('changes status without physical deletion and reads by status', async () => {
    const repository = new MemoryBranches();
    const branch = Branch.create({
      id: 'branch-1', code: 'CCS', name: 'Sucursal', originNodeId: 'node-1', createdAt: clock.now()
    });
    await repository.save(branch);
    const changeStatus = new ChangeBranchStatus(repository, allow(CONFIG_PERMISSIONS.MANAGE_BRANCH), ids, clock);
    const result = await changeStatus.execute({ branchId: 'branch-1', status: 'INACTIVE', reason: 'Cierre' }, context);

    expect(result).toMatchObject({ ok: true, value: { status: 'INACTIVE' } });
    const authorization = allow(CONFIG_PERMISSIONS.MANAGE_BRANCH);
    expect(await new ListBranches(repository, authorization).execute('ACTIVE', context))
      .toMatchObject({ ok: true, value: [] });
    expect(await new GetBranch(repository, authorization).execute('branch-1', context))
      .toMatchObject({ ok: true, value: { status: 'INACTIVE' } });
  });
});

describe('device use cases', () => {
  it('declares a device optionally tagged with a branch and requires the device permission', async () => {
    const repository = new MemoryDevices();
    const denied = await new DeclareDevice(repository, allow('nothing'), ids, clock).execute({
      type: 'FISCAL_PRINTER', identifier: 'SN-0001', terminalId: 'terminal-001', reason: 'Alta'
    }, context);
    expect(denied).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    const declare = new DeclareDevice(repository, allow(CONFIG_PERMISSIONS.MANAGE_DEVICE), ids, clock);
    const declared = await declare.execute({
      type: 'FISCAL_PRINTER', identifier: 'SN-0001', terminalId: 'terminal-001',
      branchId: 'branch-1', reason: 'Alta de impresora'
    }, context);

    expect(declared).toMatchObject({
      ok: true, value: { type: 'FISCAL_PRINTER', branchId: 'branch-1', status: 'ACTIVE' }
    });
    expect(await declare.execute({
      type: 'BARCODE_SCANNER', identifier: 'sn-0001', terminalId: 'terminal-002', reason: 'Alta'
    }, context)).toMatchObject({ ok: false, error: { code: 'DEVICE_IDENTIFIER_CONFLICT' } });
  });

  it('updates identifier and clears the branch tag, then filters listings by station and status', async () => {
    const repository = new MemoryDevices();
    await repository.save(Device.create({
      id: 'device-1', type: 'BARCODE_SCANNER', identifier: 'SN-0001', terminalId: 'terminal-001',
      originNodeId: 'node-1', branchId: 'branch-1', createdAt: clock.now()
    }));
    await repository.save(Device.create({
      id: 'device-2', type: 'SCALE', identifier: 'SN-0002', terminalId: 'terminal-002',
      originNodeId: 'node-1', createdAt: clock.now()
    }));

    const update = new UpdateDevice(repository, allow(CONFIG_PERMISSIONS.MANAGE_DEVICE), ids, clock);
    const updated = await update.execute({
      deviceId: 'device-1', identifier: 'SN-0003', branchId: null, reason: 'Reasignación'
    }, context);
    expect(updated).toMatchObject({ ok: true, value: { identifier: 'SN-0003', branchId: null } });

    const changeStatus = new ChangeDeviceStatus(repository, allow(CONFIG_PERMISSIONS.MANAGE_DEVICE), ids, clock);
    await changeStatus.execute({ deviceId: 'device-2', status: 'INACTIVE', reason: 'Baja' }, context);

    const authorization = allow(CONFIG_PERMISSIONS.MANAGE_DEVICE);
    const listedByStation = await new ListDevices(repository, authorization)
      .execute({ terminalId: 'terminal-001' }, context);
    expect(listedByStation).toMatchObject({ ok: true, value: [{ id: 'device-1' }] });
    const activeOnly = await new ListDevices(repository, authorization)
      .execute({ status: 'ACTIVE' }, context);
    expect(activeOnly).toMatchObject({ ok: true, value: [{ id: 'device-1' }] });
  });
});
