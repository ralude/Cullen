import { describe, expect, it } from 'vitest';
import { permissionAlternatives } from '@supermarket/core';
import type {
  AuditEntry,
  AuditWriter,
  AuthorizationService,
  Clock,
  ExecutionContext,
  IdGenerator,
  SupplierRepository
} from '@supermarket/core';
import { Supplier, type SupplierStatus } from '../../domain/purchasing/index.js';
import { CorrectSupplierTaxIdentity, CreateSupplier } from './supplier-use-cases.js';
import { SUPPLIER_PERMISSIONS } from './permissions.js';

class MemorySuppliers implements SupplierRepository {
  readonly values = new Map<string, Supplier>();
  private sequence = 0;
  nextCode = async (): Promise<string> => `SUP-${String(++this.sequence).padStart(6, '0')}`;
  save = async (supplier: Supplier): Promise<void> => { this.values.set(supplier.id, supplier); };
  findById = async (id: string): Promise<Supplier | null> => this.values.get(id) ?? null;
  findByTaxIdentity = async (country: string, type: string, value: string): Promise<Supplier | null> =>
    [...this.values.values()].find((supplier) => {
      const identity = supplier.taxIdentity;
      return identity.country === country && identity.type === type && identity.normalizedValue === value;
    }) ?? null;
  findAll = async (status?: SupplierStatus): Promise<readonly Supplier[]> =>
    [...this.values.values()].filter((supplier) => status === undefined || supplier.status === status);
}

const context: ExecutionContext = {
  actorId: 'user-1', actorRoleCodes: ['ADMIN'], terminalId: 'terminal-1',
  originNodeId: 'node-1', correlationId: 'correlation-1'
};
const ids: IdGenerator = { generate: (() => { let value = 0; return () => `id-${++value}`; })() };
const clock: Clock = { now: () => new Date('2026-09-04T12:00:00Z') };
const allow = (...permissions: string[]): AuthorizationService => ({
  authorize: async (_context, permission) =>
    permissionAlternatives(permission).some((code) => permissions.includes(code))
});

describe('supplier use cases', () => {
  it('creates a supplier with generated identifiers and rejects an equivalent RIF', async () => {
    const repository = new MemorySuppliers();
    const service = new CreateSupplier(repository, allow(SUPPLIER_PERMISSIONS.CREATE), ids, clock);
    const first = await service.execute({
      legalName: 'Distribuidora Uno', taxIdentity: { type: 'RIF', value: 'J-12345678-9' }, reason: 'Alta'
    }, context);
    const duplicate = await service.execute({
      legalName: 'Duplicado', taxIdentity: { country: 've', type: 'rif', value: 'j123456789' }, reason: 'Alta'
    }, context);

    expect(first).toMatchObject({ ok: true, value: { id: 'id-1', code: 'SUP-000001', status: 'ACTIVE' } });
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'SUPPLIER_TAX_IDENTITY_CONFLICT' } });
  });

  it('requires the privileged permission and audits a tax identity correction', async () => {
    const repository = new MemorySuppliers();
    const supplier = Supplier.create({
      id: 'supplier-1', code: 'SUP-000001', legalName: 'Distribuidora Uno',
      taxIdentity: { country: 'VE', type: 'RIF', value: 'J-12345678-9' },
      createdAt: clock.now()
    });
    await repository.save(supplier);
    const entries: AuditEntry[] = [];
    const auditWriter: AuditWriter = { append: async (next) => { entries.push(...next); } };
    const denied = new CorrectSupplierTaxIdentity(repository, allow(), ids, clock, undefined, auditWriter);
    const allowed = new CorrectSupplierTaxIdentity(
      repository, allow(SUPPLIER_PERMISSIONS.CORRECT_TAX_IDENTITY), ids, clock, undefined, auditWriter
    );

    expect(await denied.execute({
      supplierId: supplier.id, taxIdentity: { type: 'RIF', value: 'J-12345677-0' }, reason: 'Error de captura'
    }, context)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await allowed.execute({
      supplierId: supplier.id, taxIdentity: { type: 'RIF', value: 'J-12345677-0' }, reason: 'Error de captura'
    }, context)).toMatchObject({ ok: true, value: { taxIdentity: { normalizedValue: 'J123456770' } } });
    expect(entries).toMatchObject([{
      action: 'SUPPLIER_TAX_IDENTITY_CORRECTED', entityId: supplier.id,
      reason: 'Error de captura', before: { taxIdentity: { normalizedValue: 'J123456789' } },
      after: { taxIdentity: { normalizedValue: 'J123456770' } }
    }]);
  });
});

