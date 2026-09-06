import { describe, expect, it } from 'vitest';
import type {
  AuditEntry, AuditWriter, AuthorizationService, Clock, ExecutionContext, IdGenerator,
  OperationalMasterDataStore, OperationalPolicyWriter, UnitOfWork
} from '@supermarket/core';
import { Category, UnitOfMeasure } from '../../domain/catalog/index.js';
import { PaymentMethod } from '../../domain/currency/index.js';
import {
  ActivateDiscountPolicy, ListOperationalMasterData, SaveCategory, SavePaymentMethod, SaveUnit
} from './operational-config-use-cases.js';
import { CONFIG_PERMISSIONS } from './permissions.js';

class MemoryStore implements OperationalMasterDataStore {
  categories = new Map<string, Category>(); units = new Map<string, UnitOfMeasure>();
  payments = new Map<string, PaymentMethod>(); usedCategories = new Set<string>();
  liveUnits = new Set<string>(); historicUnits = new Set<string>(); livePayments = new Set<string>();
  findCategoryById = async (id: string) => this.categories.get(id) ?? null;
  listCategories = async () => [...this.categories.values()];
  saveCategory = async (value: Category) => { this.categories.set(value.id, value); };
  isCategoryInUse = async (id: string) => this.usedCategories.has(id);
  findUnitByCode = async (code: string) => this.units.get(code) ?? null;
  listUnits = async () => [...this.units.values()];
  saveUnit = async (value: UnitOfMeasure) => { this.units.set(value.code, value); };
  isUnitInUse = async (id: string) => this.liveUnits.has(id);
  hasUnitHistory = async (id: string) => this.historicUnits.has(id);
  findPaymentMethodByCode = async (code: string) => this.payments.get(code) ?? null;
  listPaymentMethods = async () => [...this.payments.values()];
  savePaymentMethod = async (value: PaymentMethod) => { this.payments.set(value.code, value); };
  isPaymentMethodInUse = async (code: string) => this.livePayments.has(code);
}

const context: ExecutionContext = {
  actorId: 'admin-1', actorRoleCodes: ['ADMIN'], terminalId: 'terminal-1',
  originNodeId: 'node-1', correlationId: 'correlation-1', idempotencyKey: 'intent-1'
};
const allow = (...permissions: string[]): AuthorizationService => ({
  authorize: async (_context, permission) => permissions.includes(permission)
});
const ids: IdGenerator = { generate: (() => { let next = 0; return () => `id-${++next}`; })() };
const clock: Clock = { now: () => new Date('2026-09-05T12:00:00Z') };
const unitOfWork: UnitOfWork = { execute: async (work) => work() };
const audit: AuditEntry[] = [];
const auditWriter: AuditWriter = { append: async (entries) => { audit.push(...entries); } };

describe('operational configuration use cases', () => {
  it('authorizes administrative reads before querying each section', async () => {
    const store = new MemoryStore();
    store.categories.set('cat-1', Category.create({ id: 'cat-1', name: 'Víveres' }));
    store.payments.set('CASH', PaymentMethod.create({ code: 'CASH', name: 'Efectivo', kind: 'CASH', currencyCode: 'VES' }));
    const denied = await new ListOperationalMasterData(store, allow()).execute(context);
    expect(denied).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    const catalogOnly = await new ListOperationalMasterData(store, allow('catalog.product.update')).execute(context);
    expect(catalogOnly).toMatchObject({ ok: true, value: { categories: [{ id: 'cat-1' }], paymentMethods: [] } });
  });

  it('creates and deactivates without physical deletion, preserving operator audit evidence', async () => {
    audit.length = 0;
    const store = new MemoryStore();
    const useCase = new SaveCategory(store, allow('catalog.product.update'), ids, clock, unitOfWork, auditWriter);
    const created = await useCase.execute({ name: 'Limpieza', isActive: true, reason: 'Alta solicitada' }, context);
    const id = created.ok ? created.value.id : '';
    const deactivated = await useCase.execute({ id, name: 'Limpieza', isActive: false, reason: 'Retiro comercial' }, context);
    expect(deactivated).toMatchObject({ ok: true, value: { id, isActive: false } });
    expect(store.categories.has(id)).toBe(true);
    expect(audit.at(-1)).toMatchObject({ actorId: 'admin-1', terminalId: 'terminal-1', originNodeId: 'node-1', reason: 'Retiro comercial' });
  });

  it('blocks incompatible changes while a master has live or historical usage', async () => {
    const store = new MemoryStore();
    store.units.set('KG', UnitOfMeasure.create({ id: 'unit-1', code: 'KG', name: 'Kilogramo', quantityScale: 3 }));
    store.historicUnits.add('unit-1'); store.liveUnits.add('unit-1');
    const units = new SaveUnit(store, allow('catalog.product.update'), ids, clock, unitOfWork);
    expect(await units.execute({ code: 'KG', name: 'Kilogramo', quantityScale: 2, isActive: true, reason: 'Cambio' }, context))
      .toMatchObject({ ok: false, error: { code: 'UNIT_OF_MEASURE_SCALE_IN_USE' } });
    expect(await units.execute({ code: 'KG', name: 'Kilogramo', quantityScale: 3, isActive: false, reason: 'Baja' }, context))
      .toMatchObject({ ok: false, error: { code: 'UNIT_OF_MEASURE_IN_USE' } });

    store.payments.set('CASH', PaymentMethod.create({ code: 'CASH', name: 'Efectivo', kind: 'CASH', currencyCode: 'VES' }));
    store.livePayments.add('CASH');
    const payments = new SavePaymentMethod(store, allow(CONFIG_PERMISSIONS.MANAGE_PAYMENT_METHOD), ids, clock, unitOfWork);
    expect(await payments.execute({ code: 'CASH', name: 'Efectivo', kind: 'CASH', currencyCode: 'VES', isActive: false, reason: 'Baja' }, context))
      .toMatchObject({ ok: false, error: { code: 'PAYMENT_METHOD_IN_USE' } });
  });

  it('activates an append-only policy version with the tax permission and real reason', async () => {
    audit.length = 0;
    const calls: unknown[] = [];
    const writer: OperationalPolicyWriter = {
      activateDiscountPolicy: (input, metadata) => { calls.push({ input, metadata }); return { created: true, policyId: metadata.policyId, version: 2 }; },
      activateFinancialTransactionTaxPolicy: (_input, metadata) => ({ created: true, policyId: metadata.policyId, version: 1 })
    };
    const result = await new ActivateDiscountPolicy(
      writer, allow(CONFIG_PERMISSIONS.MANAGE_TAX), ids, clock, unitOfWork, auditWriter
    ).execute({ maximumBasisPoints: 1500, reason: 'Ajuste aprobado' }, context);
    expect(result).toMatchObject({ ok: true, value: { created: true, version: 2 } });
    expect(calls).toHaveLength(1);
    expect(audit.at(-1)).toMatchObject({ action: 'DISCOUNT_POLICY_ACTIVATED', reason: 'Ajuste aprobado' });
  });
});
