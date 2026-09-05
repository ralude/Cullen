import { describe, expect, it } from 'vitest';
import { Device } from './device.js';

describe('Device', () => {
  it('declares a device for a station, optionally tagged with a branch', () => {
    const device = Device.create({
      id: 'device-1', type: 'FISCAL_PRINTER', identifier: 'SN-0001', terminalId: 'terminal-001', originNodeId: 'node-1',
      branchId: 'branch-1', createdAt: new Date('2026-09-05T12:00:00Z')
    });

    expect(device.status).toBe('ACTIVE');
    expect(device.branchId).toBe('branch-1');
    expect(device.version).toBe(1);
  });

  it('rejects an invalid type and requires a non-empty identifier', () => {
    expect(() => Device.create({
      id: 'device-1', type: 'PRINTER' as never, identifier: 'SN-0001',
      terminalId: 'terminal-001', originNodeId: 'node-1', createdAt: new Date('2026-09-05T12:00:00Z')
    })).toThrowError(expect.objectContaining({ code: 'DEVICE_TYPE_INVALID' }));

    expect(() => Device.create({
      id: 'device-1', type: 'SCALE', identifier: '  ', terminalId: 'terminal-001', originNodeId: 'node-1',
      createdAt: new Date('2026-09-05T12:00:00Z')
    })).toThrowError(expect.objectContaining({ code: 'DEVICE_IDENTIFIER_REQUIRED' }));
  });

  it('updates its identifier and can clear its branch tag, bumping the version', () => {
    const device = Device.create({
      id: 'device-1', type: 'BARCODE_SCANNER', identifier: 'SN-0001', terminalId: 'terminal-001', originNodeId: 'node-1',
      branchId: 'branch-1', createdAt: new Date('2026-09-05T12:00:00Z')
    });

    device.update({ identifier: 'SN-0002', branchId: null }, new Date('2026-09-05T13:00:00Z'));

    expect(device.identifier).toBe('SN-0002');
    expect(device.branchId).toBeNull();
    expect(device.version).toBe(2);
  });

  it('changes status and rehydrates its state without inventing a branch reference', () => {
    const device = Device.create({
      id: 'device-1', type: 'CASH_DRAWER', identifier: 'SN-0001', terminalId: 'terminal-001', originNodeId: 'node-1',
      createdAt: new Date('2026-09-05T12:00:00Z')
    });
    device.changeStatus('INACTIVE', new Date('2026-09-05T13:00:00Z'));

    const restored = Device.restore({
      id: device.id, type: device.type, identifier: device.identifier, terminalId: device.terminalId,
      originNodeId: device.originNodeId, branchId: device.branchId, status: device.status,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt, version: device.version
    });

    expect(restored.branchId).toBeNull();
    expect(restored.status).toBe('INACTIVE');
  });
});
