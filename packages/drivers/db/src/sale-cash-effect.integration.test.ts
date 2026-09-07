import { describe, expect, it } from 'vitest';
import {
  application,
  Barcode,
  Category,
  CashRegister,
  PaymentMethod,
  Product,
  UnitOfMeasure,
  type FinancialTransactionTaxPolicyProvider
} from '@supermarket/core';
import { Money, TaxRate } from '@supermarket/shared';
import { DrizzleAuditWriter } from './audit-writer.js';
import { DrizzleBusinessEventStore } from './business-event-store.js';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { DrizzleIdempotencyStore } from './idempotency-store.js';
import { applyMigrations } from './migrations.js';
import { SqliteOpenSalesProbe } from './open-sales-probe.js';
import { DrizzleOutboxStore } from './outbox-store.js';
import { DrizzleProductSnapshotProvider } from './product-snapshot-provider.js';
import {
  DrizzleCashRegisterRepository,
  DrizzleCategoryRepository,
  DrizzleExchangeRateRepository,
  DrizzlePaymentMethodRepository,
  DrizzleProductRepository,
  DrizzleSaleRepository,
  DrizzleShiftRepository,
  DrizzleUnitOfMeasureRepository
} from './repositories.js';
import { SqliteUnitOfWork } from './unit-of-work.js';

/**
 * El turno pertenece a la terminal que lo abrió, así que el cobro de una venta
 * completada es una escritura local del mismo nodo y no una entrega. Esta
 * prueba fija esa garantía sobre SQLite real: completar deja el movimiento del
 * turno, su ledger, su salida y su auditoría en la misma transacción; repetir
 * no duplica; y un turno que no puede recibir el cobro revierte la venta.
 */

const OPENED_AT = new Date('2026-09-07T08:00:00.000Z');
const SOLD_AT = new Date('2026-09-07T10:00:00.000Z');

const context = {
  actorId: 'user-001', actorRoleCodes: ['cashier'], terminalId: 'terminal-001',
  originNodeId: 'node-001', correlationId: 'correlation-001'
};

const noTax: FinancialTransactionTaxPolicyProvider = {
  getPolicy: async () => ({
    id: 'tax-policy-001',
    rate: TaxRate.fromBasisPoints(0),
    eligiblePaymentMethodCodes: [],
    eligibleCurrencies: []
  })
};

type Harness = {
  readonly handle: DatabaseHandle;
  readonly shifts: DrizzleShiftRepository;
  readonly sales: DrizzleSaleRepository;
  readonly startSale: application.StartSale;
  readonly addItem: application.AddItemToSale;
  readonly registerPayment: application.RegisterMixedPayment;
  readonly completeSale: application.CompleteSale;
  readonly closeShift: application.CloseShift;
};

const sequentialIds = (prefix: string): { generate: () => string } => {
  let issued = 0;
  return { generate: (): string => `${prefix}-${(issued += 1)}` };
};

const harness = async (): Promise<Harness> => {
  const handle = openDatabase(':memory:');
  applyMigrations(handle.sqlite);
  const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
  const registers = new DrizzleCashRegisterRepository(handle);
  const methods = new DrizzlePaymentMethodRepository(handle);
  const shifts = new DrizzleShiftRepository(handle);
  const sales = new DrizzleSaleRepository(handle);
  const ledger = new DrizzleBusinessEventStore(handle);
  const outbox = new DrizzleOutboxStore(handle);
  const audit = new DrizzleAuditWriter(handle);
  const idempotency = new DrizzleIdempotencyStore(handle);
  const unit = UnitOfMeasure.create({
    id: 'unit-001', code: 'UNIT', name: 'Unidad', quantityScale: 0
  });

  await unitOfWork.execute(async () => {
    await registers.save(CashRegister.create({
      id: 'register-001', name: 'Caja 1', terminalId: 'terminal-001', originNodeId: 'node-001'
    }));
    await methods.save(PaymentMethod.create({
      code: 'CASH_USD', name: 'Efectivo USD', kind: 'CASH', currencyCode: 'USD'
    }));
    await new DrizzleCategoryRepository(handle).save(
      Category.create({ id: 'category-001', name: 'Granos' })
    );
    await new DrizzleUnitOfMeasureRepository(handle).save(unit);
    await new DrizzleProductRepository(handle).save(Product.create({
      id: 'product-001', name: 'Arroz', description: 'Arroz 1kg',
      categoryId: 'category-001', unitOfMeasure: unit,
      barcodes: [Barcode.create({ id: 'barcode-001', value: '1234' })],
      price: Money.fromMinorUnits(1_200, 'USD'), taxRate: TaxRate.fromBasisPoints(0),
      priceHistoryId: 'history-001', recordedBy: 'user-001',
      occurredAt: OPENED_AT, eventId: 'event-product-created'
    }));
  });

  const open = new application.OpenShift(
    registers, shifts, methods, { authorize: async () => true },
    { generate: () => 'shift-001' }, { generate: () => 'opening-001' },
    { generate: () => 'shift-event-001' }, { now: () => OPENED_AT },
    unitOfWork, ledger, outbox, audit, { generate: () => 'audit-open' }
  );
  expect((await open.execute({
    cashRegisterId: 'register-001',
    openingFunds: [{ paymentMethodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: 5_000 }]
  }, context)).ok).toBe(true);

  return {
    handle,
    shifts,
    sales,
    startSale: new application.StartSale(
      { generate: () => 'sale-001' }, { generate: () => 'sale-event-001' },
      sales, { now: () => SOLD_AT }, shifts, unitOfWork, ledger, idempotency
    ),
    addItem: new application.AddItemToSale(
      sales, new DrizzleProductSnapshotProvider(handle),
      { generate: () => 'item-001' }, { generate: () => 'sale-event-002' },
      { now: () => SOLD_AT }, unitOfWork, ledger, idempotency
    ),
    registerPayment: new application.RegisterMixedPayment(
      sales, methods, new DrizzleExchangeRateRepository(handle), noTax,
      { generate: () => 'payment-001' }, { generate: () => 'sale-event-003' },
      { now: () => SOLD_AT }, unitOfWork, ledger, idempotency
    ),
    completeSale: new application.CompleteSale(
      sales, { generate: () => 'sale-event-004' }, { now: () => SOLD_AT },
      new application.ApplySaleCompletedToShift(
        shifts, methods, sequentialIds('cash-event'), sequentialIds('cash-audit'),
        application.ambientUnitOfWork, ledger, outbox, audit
      ),
      unitOfWork, ledger, outbox, idempotency
    ),
    closeShift: new application.CloseShift(
      shifts, methods, { authorize: async () => true },
      { generate: () => 'shift-event-close' }, { now: () => SOLD_AT },
      unitOfWork, ledger, outbox, audit, { generate: () => 'audit-close' },
      new SqliteOpenSalesProbe(handle)
    )
  };
};

const draftSale = async (kit: Harness): Promise<void> => {
  expect((await kit.startSale.execute(
    { currencyCode: 'USD', shiftId: 'shift-001' },
    { ...context, idempotencyKey: 'start-001' }
  )).ok).toBe(true);
  expect((await kit.addItem.execute(
    { saleId: 'sale-001', barcode: '1234', quantityScaled: 1, quantityScale: 0 },
    { ...context, idempotencyKey: 'add-001' }
  )).ok).toBe(true);
  expect((await kit.registerPayment.execute(
    {
      saleId: 'sale-001',
      payments: [{ methodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: 1_200 }]
    },
    { ...context, idempotencyKey: 'pay-001' }
  )).ok).toBe(true);
};

const movementRows = (handle: DatabaseHandle): unknown[] => handle.sqlite.prepare(`
  select id, type, amount_minor_units as amountMinorUnits, source_id as sourceId
  from cash_movements where shift_id = 'shift-001' order by registered_at, id
`).all();

describe('efecto de caja de una venta completada', () => {
  it('asienta el cobro en el turno, una sola vez, con ledger, salida y auditoría', async () => {
    const kit = await harness();
    await draftSale(kit);

    const first = await kit.completeSale.execute(
      { saleId: 'sale-001' }, { ...context, idempotencyKey: 'complete-001' }
    );
    const repeated = await kit.completeSale.execute(
      { saleId: 'sale-001' }, { ...context, idempotencyKey: 'complete-001' }
    );

    expect(first.ok).toBe(true);
    expect(repeated).toEqual(first);
    expect((await kit.sales.findById('sale-001'))?.status).toBe('COMPLETED');

    // El cobro vive en el turno y suma al saldo esperado del arqueo.
    expect(movementRows(kit.handle)).toEqual([
      { id: 'opening-001', type: 'OPENING_FLOAT', amountMinorUnits: 5_000, sourceId: null },
      { id: 'payment-001', type: 'SALE_PAYMENT', amountMinorUnits: 1_200, sourceId: 'sale-001' }
    ]);
    const shift = await kit.shifts.findById('shift-001');
    expect(shift?.balanceFor('CASH_USD', 'USD').minorUnits).toBe(6_200);

    expect(kit.handle.sqlite.prepare(
      "select event_type from business_event where aggregate_id = 'shift-001' order by aggregate_version"
    ).pluck().all()).toEqual(['ShiftOpened', 'CashMovementRegistered']);
    expect(kit.handle.sqlite.prepare(
      'select distinct event_type from outbox_event order by event_type'
    ).pluck().all()).toEqual(['CashMovementRegistered', 'SaleCompleted', 'ShiftOpened']);
    expect(kit.handle.sqlite.prepare(
      "select action from audit_log where action = 'SALE_PAYMENT_REGISTERED_IN_SHIFT'"
    ).pluck().all()).toEqual(['SALE_PAYMENT_REGISTERED_IN_SHIFT']);
    kit.handle.close();
  });

  it('rechaza el arqueo mientras el turno conserve una venta sin cerrar', async () => {
    const kit = await harness();
    await draftSale(kit);
    const close = {
      shiftId: 'shift-001',
      declaredBalances: [
        { paymentMethodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: 6_200 }
      ]
    };

    const blocked = await kit.closeShift.execute(
      close, { ...context, idempotencyKey: 'close-001' }
    );

    expect(blocked).toMatchObject({ ok: false, error: { code: 'SHIFT_HAS_OPEN_SALES' } });
    expect((await kit.shifts.findById('shift-001'))?.status).toBe('OPEN');
    expect(kit.handle.sqlite.prepare(
      "select count(*) from business_event where event_type = 'ShiftClosed'"
    ).pluck().get()).toBe(0);

    // Cobrado el carrito, el mismo arqueo procede y cuadra con el cobro asentado.
    expect((await kit.completeSale.execute(
      { saleId: 'sale-001' }, { ...context, idempotencyKey: 'complete-001' }
    )).ok).toBe(true);
    const closed = await kit.closeShift.execute(
      close, { ...context, idempotencyKey: 'close-002' }
    );

    expect(closed.ok).toBe(true);
    expect((await kit.shifts.findById('shift-001'))?.closingBalances)
      .toMatchObject([{ paymentMethodCode: 'CASH_USD' }]);
    expect((await kit.shifts.findById('shift-001'))?.closingBalances?.[0]?.difference.minorUnits)
      .toBe(0);
    kit.handle.close();
  });
});
