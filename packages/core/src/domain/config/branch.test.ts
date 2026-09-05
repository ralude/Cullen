import { describe, expect, it } from 'vitest';
import { Branch } from './branch.js';

describe('Branch', () => {
  it('normalizes the code, starts ACTIVE and updates its name with a new version', () => {
    const branch = Branch.create({
      id: 'branch-1', code: ' ccs-centro ', name: 'Sucursal Centro',
      originNodeId: 'node-1', createdAt: new Date('2026-09-05T12:00:00Z')
    });

    expect(branch.code).toBe('CCS-CENTRO');
    expect(branch.status).toBe('ACTIVE');
    expect(branch.version).toBe(1);

    branch.update({ name: 'Sucursal Centro Ampliada' }, new Date('2026-09-05T13:00:00Z'));

    expect(branch.name).toBe('Sucursal Centro Ampliada');
    expect(branch.version).toBe(2);
  });

  it('rejects an invalid code and an empty update', () => {
    expect(() => Branch.create({
      id: 'branch-1', code: 'ccs centro!', name: 'Sucursal',
      originNodeId: 'node-1', createdAt: new Date('2026-09-05T12:00:00Z')
    })).toThrowError(expect.objectContaining({ code: 'BRANCH_CODE_INVALID' }));

    const branch = Branch.create({
      id: 'branch-1', code: 'CCS', name: 'Sucursal', originNodeId: 'node-1', createdAt: new Date('2026-09-05T12:00:00Z')
    });
    expect(() => branch.update({}, new Date('2026-09-05T13:00:00Z')))
      .toThrowError(expect.objectContaining({ code: 'BRANCH_UPDATE_REQUIRED' }));
  });

  it('changes status without physical deletion and rehydrates its state', () => {
    const branch = Branch.create({
      id: 'branch-1', code: 'CCS', name: 'Sucursal', originNodeId: 'node-1', createdAt: new Date('2026-09-05T12:00:00Z')
    });
    branch.changeStatus('INACTIVE', new Date('2026-09-05T13:00:00Z'));

    const restored = Branch.restore({
      id: branch.id, code: branch.code, name: branch.name, originNodeId: branch.originNodeId,
      status: branch.status,
      createdAt: branch.createdAt, updatedAt: branch.updatedAt, version: branch.version
    });

    expect(restored.status).toBe('INACTIVE');
    expect(restored.version).toBe(2);
  });
});
