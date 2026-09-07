import { describe, expect, it } from 'vitest';
import { Category, Product, UnitOfMeasure } from '../../domain/catalog/index.js';
import { ExchangeRate, PaymentMethod } from '../../domain/currency/index.js';
import {
  ActivateDiscountPolicy,
  ActivateFinancialTransactionTaxPolicy,
  SaveCategory,
  SavePaymentMethod,
  SaveUnit
} from '../config/operational-config-use-cases.js';
import type { BusinessEventV1 } from '../events/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuthorizationService,
  CategoryRepository,
  OperationalMasterDataStore,
  OperationalPolicyWriter,
  OutboxStore,
  ProductRepository,
  UnitOfMeasureRepository,
  UnitOfWork
} from '../ports/index.js';
import type { ExchangeRateRepository } from '../ports/index.js';
import { UpdateExchangeRate } from '../currency/update-exchange-rate.js';
import { CreateProduct } from './create-product.js';
import { UpdatePrice } from './update-price.js';
import { UpdateProduct } from './update-product.js';

const now = new Date('2026-09-06T12:00:00.000Z');
const clock = { now: () => now };
const authorization: AuthorizationService = { authorize: async () => true };

const context: ExecutionContext = {
  actorId: 'user-001',
  actorRoleCodes: ['ADMIN'],
  terminalId: 'terminal-coordinator',
  originNodeId: 'node-coordinator',
  correlationId: 'correlation-001'
};

const category = Category.create({ id: 'category-001', name: 'Granos' });
const unit = UnitOfMeasure.create({ id: 'unit-001', code: 'UNIT', name: 'Unidad', quantityScale: 0 });

const sequence = (prefix: string): { generate: () => string } => {
  let issued = 0;
  return { generate: (): string => `${prefix}-${(issued += 1)}` };
};

class RecordingUnitOfWork implements UnitOfWork {
  inTransaction = false;

  async execute<T>(work: () => Promise<T>): Promise<T> {
    this.inTransaction = true;
    try {
      return await work();
    } finally {
      this.inTransaction = false;
    }
  }
}

/**
 * Registra si la publicación se encoló dentro de la transacción del comando:
 * el cambio autoritativo y su distribución deben confirmarse juntos.
 */
class RecordingOutbox implements OutboxStore {
  readonly enqueued: BusinessEventV1[] = [];
  readonly transactional: boolean[] = [];

  constructor(private readonly unitOfWork: RecordingUnitOfWork) {}

  async enqueue(events: readonly BusinessEventV1[]): Promise<void> {
    if (events.length > 0) this.transactional.push(this.unitOfWork.inTransaction);
    this.enqueued.push(...events);
  }

  async claimAvailable(): Promise<never[]> { return []; }
  async isClaimActive(): Promise<boolean> { return false; }
  async markPublished(): Promise<boolean> { return false; }
  async markFailed(): Promise<boolean> { return false; }
  async markBlocked(): Promise<boolean> { return false; }
  async markPaused(): Promise<boolean> { return false; }
  async resumeDelivery(): Promise<boolean> { return false; }
  async summarize(destinationNodeId: string): Promise<{
    destinationNodeId: string; pending: number; paused: number; blocked: number;
    lastPublishedAt: Date | null; lastError: string | null;
  }> {
    return {
      destinationNodeId, pending: 0, paused: 0, blocked: 0,
      lastPublishedAt: null, lastError: null
    };
  }
  async listPaused(): Promise<never[]> { return []; }
}

class FakeProductRepository implements ProductRepository {
  stored: Product | null = null;
  saves = 0;

  async save(value: Product): Promise<void> {
    this.saves += 1;
    this.stored = value;
  }

  async findById(): Promise<Product | null> { return this.stored; }
  async findByActiveBarcode(): Promise<Product | null> { return null; }
}

class FakeExchangeRateRepository implements ExchangeRateRepository {
  readonly rates: ExchangeRate[] = [];

  async save(rate: ExchangeRate): Promise<number> {
    this.rates.push(rate);
    return 2;
  }

  async findCurrentByPair(): Promise<ExchangeRate | null> { return null; }
  async findById(): Promise<ExchangeRate | null> { return null; }
}

const categories: CategoryRepository = {
  findById: async () => category,
  findAll: async () => [category]
};

const units: UnitOfMeasureRepository = {
  findByCode: async () => unit,
  findAll: async () => [unit]
};

class FakeMasterData implements OperationalMasterDataStore {
  private readonly versions = new Map<string, number>();
  savedCategory: Category | null = null;
  savedUnit: UnitOfMeasure | null = null;
  savedPaymentMethod: PaymentMethod | null = null;
  existingCategory: Category | null = null;
  existingUnit: UnitOfMeasure | null = null;

  async findCategoryById(): Promise<Category | null> { return this.existingCategory; }
  async listCategories(): Promise<readonly Category[]> { return []; }
  async saveCategory(value: Category): Promise<number> {
    this.savedCategory = value;
    return this.bump(`category:${value.id}`);
  }
  async isCategoryInUse(): Promise<boolean> { return false; }
  async findUnitByCode(): Promise<UnitOfMeasure | null> { return this.existingUnit; }
  async listUnits(): Promise<readonly UnitOfMeasure[]> { return []; }
  async saveUnit(value: UnitOfMeasure): Promise<number> {
    this.savedUnit = value;
    return this.bump(`unit:${value.id}`);
  }
  async isUnitInUse(): Promise<boolean> { return false; }
  async hasUnitHistory(): Promise<boolean> { return false; }
  async findPaymentMethodByCode(): Promise<null> { return null; }
  async listPaymentMethods(): Promise<never[]> { return []; }
  async savePaymentMethod(value: PaymentMethod): Promise<number> {
    this.savedPaymentMethod = value;
    return this.bump(`payment:${value.code}`);
  }
  async isPaymentMethodInUse(): Promise<boolean> { return false; }

  private bump(key: string): number {
    const next = (this.versions.get(key) ?? 0) + 1;
    this.versions.set(key, next);
    return next;
  }
}

const createInput = {
  name: 'Arroz',
  description: 'Arroz 1kg',
  categoryId: 'category-001',
  unitCode: 'UNIT',
  barcodes: ['1234'],
  priceMinorUnits: 1000,
  currencyCode: 'USD',
  taxRateBasisPoints: 1600,
  reason: 'Alta inicial'
};

type Harness = {
  readonly outbox: RecordingOutbox;
  readonly unitOfWork: RecordingUnitOfWork;
  readonly repository: FakeProductRepository;
  readonly create: CreateProduct;
  readonly update: UpdateProduct;
  readonly price: UpdatePrice;
};

const harness = (): Harness => {
  const unitOfWork = new RecordingUnitOfWork();
  const outbox = new RecordingOutbox(unitOfWork);
  const repository = new FakeProductRepository();
  return {
    outbox,
    unitOfWork,
    repository,
    create: new CreateProduct(
      sequence('id'), repository, categories, units, clock,
      authorization, unitOfWork, undefined, outbox
    ),
    update: new UpdateProduct(
      repository, categories, units, sequence('update'), clock,
      authorization, unitOfWork, undefined, undefined, outbox
    ),
    price: new UpdatePrice(
      repository, sequence('price'), sequence('history'), clock,
      authorization, unitOfWork, undefined, outbox
    )
  };
};

describe('productores de referencias de catálogo', () => {
  it('publica el estado completo al crear y no distribuye ProductCreated', async () => {
    const { create, outbox } = harness();

    await expect(create.execute(createInput, context)).resolves.toMatchObject({ ok: true });

    expect(outbox.enqueued.map(({ eventType }) => eventType)).toEqual(['ProductPublished']);
    expect(outbox.transactional).toEqual([true]);
    expect(outbox.enqueued[0]).toMatchObject({
      aggregateType: 'Product',
      aggregateVersion: 1,
      originNodeId: 'node-coordinator',
      correlationId: 'correlation-001',
      payload: {
        name: 'Arroz',
        categoryId: 'category-001',
        unitId: 'unit-001',
        unitCode: 'UNIT',
        isActive: 'ACTIVE',
        price: { minorUnits: 1000, currencyCode: 'USD' }
      }
    });
  });

  it('publica al cambiar el precio y no distribuye PriceChanged', async () => {
    const { create, price, outbox } = harness();
    await create.execute(createInput, context);

    await expect(price.execute({
      productId: 'id-1', priceMinorUnits: 1500, currencyCode: 'USD', reason: 'Ajuste'
    }, context)).resolves.toMatchObject({ ok: true });

    expect(outbox.enqueued.map(({ eventType }) => eventType))
      .toEqual(['ProductPublished', 'ProductPublished']);
    expect(outbox.enqueued[1]).toMatchObject({
      aggregateVersion: 2,
      payload: { price: { minorUnits: 1500, currencyCode: 'USD' } }
    });
    expect(outbox.transactional).toEqual([true, true]);
  });

  it('publica al actualizar detalles, que antes no producían ningún hecho', async () => {
    const { create, update, outbox } = harness();
    await create.execute(createInput, context);

    await expect(update.execute({
      productId: 'id-1', name: 'Arroz blanco', isActive: false, reason: 'Retiro de venta'
    }, context)).resolves.toMatchObject({ ok: true });

    expect(outbox.enqueued.map(({ eventType }) => eventType))
      .toEqual(['ProductPublished', 'ProductPublished']);
    expect(outbox.enqueued[1]).toMatchObject({
      aggregateVersion: 2,
      payload: { name: 'Arroz blanco', isActive: 'INACTIVE' }
    });
    expect(outbox.transactional).toEqual([true, true]);
  });

  it('avanza la versión en cada actualización consecutiva', async () => {
    const { create, update, outbox } = harness();
    await create.execute(createInput, context);
    await update.execute({ productId: 'id-1', name: 'Uno', reason: 'Primero' }, context);
    await update.execute({ productId: 'id-1', name: 'Dos', reason: 'Segundo' }, context);

    expect(outbox.enqueued.map(({ aggregateVersion }) => aggregateVersion)).toEqual([1, 2, 3]);
  });

  it('publica categoría y unidad con la versión que devuelve el maestro', async () => {
    const unitOfWork = new RecordingUnitOfWork();
    const outbox = new RecordingOutbox(unitOfWork);
    const store = new FakeMasterData();
    const saveCategory = new SaveCategory(
      store, authorization, sequence('category'), clock, unitOfWork, undefined, undefined, outbox
    );
    const saveUnit = new SaveUnit(
      store, authorization, sequence('unit'), clock, unitOfWork, undefined, undefined, outbox
    );

    await expect(saveCategory.execute({
      name: 'Granos', isActive: true, reason: 'Alta'
    }, context)).resolves.toMatchObject({ ok: true });
    await expect(saveUnit.execute({
      code: 'kg', name: 'Kilogramo', quantityScale: 3, isActive: true, reason: 'Alta'
    }, context)).resolves.toMatchObject({ ok: true });

    expect(outbox.enqueued.map(({ eventType, aggregateType, aggregateVersion }) =>
      `${eventType}:${aggregateType}:${aggregateVersion}`)).toEqual([
      'CategoryPublished:Category:1',
      'UnitOfMeasurePublished:UnitOfMeasure:1'
    ]);
    expect(outbox.enqueued[1]).toMatchObject({
      payload: { code: 'KG', name: 'Kilogramo', quantityScale: 3, isActive: 'ACTIVE' }
    });
    expect(outbox.transactional).toEqual([true, true]);
  });

  it('publica el estado completo del método de pago con versión monotónica', async () => {
    const unitOfWork = new RecordingUnitOfWork();
    const outbox = new RecordingOutbox(unitOfWork);
    const store = new FakeMasterData();
    const save = new SavePaymentMethod(
      store, authorization, sequence('payment'), clock, unitOfWork, undefined, undefined, outbox
    );

    await expect(save.execute({
      code: 'cash_usd',
      name: 'Efectivo USD',
      kind: 'CASH',
      currencyCode: 'usd',
      isActive: true,
      reason: 'Alta'
    }, context)).resolves.toMatchObject({ ok: true });

    expect(outbox.enqueued).toHaveLength(1);
    expect(outbox.enqueued[0]).toMatchObject({
      eventType: 'PaymentMethodPublished',
      aggregateType: 'PaymentMethod',
      aggregateId: 'CASH_USD',
      aggregateVersion: 1,
      payload: {
        name: 'Efectivo USD',
        kind: 'CASH',
        currencyCode: 'USD',
        isActive: 'ACTIVE'
      }
    });
    expect(outbox.transactional).toEqual([true]);
  });

  it('publica cada política nueva dentro de la misma transacción y omite una activación idéntica', async () => {
    const unitOfWork = new RecordingUnitOfWork();
    const outbox = new RecordingOutbox(unitOfWork);
    const writer: OperationalPolicyWriter = {
      activateDiscountPolicy: (_input, metadata) => ({
        created: true, policyId: metadata.policyId, version: 2
      }),
      activateFinancialTransactionTaxPolicy: (_input, metadata) => ({
        created: true, policyId: metadata.policyId, version: 3
      })
    };
    const generated = sequence('policy');
    const discount = new ActivateDiscountPolicy(
      writer, authorization, generated, clock, unitOfWork, undefined, undefined, outbox
    );
    const tax = new ActivateFinancialTransactionTaxPolicy(
      writer, authorization, generated, clock, unitOfWork, undefined, undefined, outbox
    );

    await discount.execute({ maximumBasisPoints: 1500, reason: 'Ajuste' }, context);
    await tax.execute({
      rateBasisPoints: 300,
      eligiblePaymentMethodCodes: [' card_usd ', 'CARD_USD'],
      eligibleCurrencies: ['usd', 'USD'],
      reason: 'Vigencia IGTF'
    }, context);

    expect(outbox.enqueued).toMatchObject([{
      eventType: 'DiscountPolicyPublished',
      aggregateType: 'OperationalPolicy',
      aggregateId: 'DISCOUNT',
      aggregateVersion: 2,
      payload: { policyId: 'policy-1', maximumBasisPoints: 1500 }
    }, {
      eventType: 'FinancialTransactionTaxPolicyPublished',
      aggregateType: 'OperationalPolicy',
      aggregateId: 'FINANCIAL_TRANSACTION_TAX',
      aggregateVersion: 3,
      payload: {
        policyId: 'policy-3',
        rateBasisPoints: 300,
        eligiblePaymentMethodCodes: ['CARD_USD'],
        eligibleCurrencies: ['USD']
      }
    }]);
    expect(outbox.transactional).toEqual([true, true]);

    const unchanged: OperationalPolicyWriter = {
      activateDiscountPolicy: () => ({
        created: false, policyId: 'discount-existing', version: 2
      }),
      activateFinancialTransactionTaxPolicy: () => ({
        created: false, policyId: 'tax-existing', version: 3
      })
    };
    await new ActivateDiscountPolicy(
      unchanged, authorization, generated, clock, unitOfWork, undefined, undefined, outbox
    ).execute({ maximumBasisPoints: 1500, reason: 'Sin cambio' }, context);

    expect(outbox.enqueued).toHaveLength(2);
  });

  it('publica la tasa confirmada con la versión persistida del par', async () => {
    const unitOfWork = new RecordingUnitOfWork();
    const outbox = new RecordingOutbox(unitOfWork);
    const repository = new FakeExchangeRateRepository();
    const update = new UpdateExchangeRate(
      sequence('rate'), repository, authorization, clock,
      unitOfWork, undefined, undefined, outbox
    );

    await update.execute({
      baseCurrency: 'USD', quoteCurrency: 'VES', rateValue: 36500, rateScale: 3,
      source: 'BCV', validFrom: new Date('2026-09-06T00:00:00.000Z'),
      reason: 'Confirmación diaria'
    }, context);

    expect(outbox.enqueued).toMatchObject([{
      eventType: 'ExchangeRateUpdated',
      aggregateType: 'ExchangeRate',
      aggregateId: 'USD/VES',
      aggregateVersion: 2,
      payload: {
        rateId: 'rate-1',
        baseCurrency: 'USD',
        quoteCurrency: 'VES',
        rateValue: 36500,
        rateScale: 3,
        source: 'BCV',
        validFrom: '2026-09-06T00:00:00.000Z',
        validUntil: null,
        registeredBy: 'user-001'
      }
    }]);
    expect(outbox.transactional).toEqual([true]);
  });

  it('no distribuye nada cuando el nodo no compone una salida', async () => {
    const unitOfWork = new RecordingUnitOfWork();
    const repository = new FakeProductRepository();
    const create = new CreateProduct(
      sequence('id'), repository, categories, units, clock, authorization, unitOfWork
    );

    await expect(create.execute(createInput, context)).resolves.toMatchObject({ ok: true });
    expect(repository.saves).toBe(1);
  });
});
