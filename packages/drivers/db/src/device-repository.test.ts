import { describe, expect, it } from 'vitest';
import { Device } from '@supermarket/core';
import { openDatabase } from './connection.js';
import { applyMigrations } from './migrations.js';
import { DrizzleDeviceRepository } from './device-repository.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

describe('DrizzleDeviceRepository', () => {
  it('round-trips state, filters by station and status, and rejects physical deletion', async () => {
    const handle = openDatabase(':memory:');
    applyMigrations(handle.sqlite);
    const repository = new DrizzleDeviceRepository(handle);
    const uow = new SqliteUnitOfWork(handle.sqlite);

    const printer = Device.create({
      id: 'device-1', type: 'FISCAL_PRINTER', identifier: 'SN-0001', terminalId: 'terminal-001',
      originNodeId: 'node-1', createdAt: new Date('2026-09-05T12:00:00Z')
    });
    await uow.execute(() => repository.save(printer));
    const scale = Device.create({
      id: 'device-2', type: 'SCALE', identifier: 'SN-0002', terminalId: 'terminal-002',
      originNodeId: 'node-1', createdAt: new Date('2026-09-05T12:00:00Z')
    });
    await uow.execute(() => repository.save(scale));
    scale.changeStatus('INACTIVE', new Date('2026-09-05T13:00:00Z'));
    await uow.execute(() => repository.save(scale));

    expect(await repository.findById('device-1')).toMatchObject({ type: 'FISCAL_PRINTER', branchId: null });
    expect(await repository.findByIdentifier('sn-0001')).toMatchObject({ id: 'device-1' });
    expect((await repository.findAll({ terminalId: 'terminal-001' })).map(({ id }) => id)).toEqual(['device-1']);
    expect((await repository.findAll({ status: 'ACTIVE' })).map(({ id }) => id)).toEqual(['device-1']);
    expect(await repository.findAll()).toHaveLength(2);
    // The unique index from migration 0024 rejects a case-insensitive identifier collision
    // even when the application-level guard is bypassed.
    expect(() => handle.sqlite.prepare(`
      insert into devices (
        id, origin_node_id, type, identifier, terminal_id, branch_id, status,
        created_at, updated_at, version
      ) values ('device-3', 'node-1', 'SCALE', 'sn-0001', 'terminal-003', null, 'ACTIVE', 1, 1, 1)
    `).run()).toThrowError(/UNIQUE|constraint/i);

    expect(() => handle.sqlite.prepare("delete from devices where id = 'device-1'").run())
      .toThrowError('devices cannot be deleted');
    handle.close();
  });
});
