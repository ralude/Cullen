import { afterEach, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  DrizzleCashRegisterRepository,
  DrizzleExchangeRateRepository,
  DrizzlePaymentMethodRepository,
  openDatabase,
  SqliteDiscountPolicyProvider,
  SqliteFinancialTransactionTaxPolicyProvider,
  type DatabaseHandle
} from '@supermarket/driver-db';
import { bootstrapOperations, parseReferenceRate } from './bootstrap-operations.ts';

const identity = {
  terminalId: '01991992-a860-7000-8000-000000000001',
  originNodeId: '01991992-a860-7000-8000-000000000002'
};

const options = {
  currencyCode: 'USD',
  discountMaximumBasisPoints: 1500,
  financialTransactionTaxBasisPoints: 300,
  financialTransactionTaxPaymentMethods: ['CARD'],
  financialTransactionTaxCurrencies: ['USD'],
  cashRegisterId: '0199a0f0-0000-7000-8000-000000005001',
  cashRegisterName: 'Caja 1'
};

describe('operations bootstrap', () => {
  let handle: DatabaseHandle | undefined;

  afterEach(() => {
    handle?.close();
    handle = undefined;
  });

  const setup = (): DatabaseHandle => {
    const opened = openDatabase(':memory:');
    handle = opened;
    applyMigrations(opened.sqlite);
    return opened;
  };

  it('provisions a cash register owned by the running node, its payment methods and both policies', async () => {
    const database = setup();

    const result = await bootstrapOperations(database, identity, options);

    expect(result).toMatchObject({
      cashRegisterId: options.cashRegisterId,
      paymentMethodCodes: ['CASH', 'CARD'],
      discountPolicyCreated: true,
      taxPolicyCreated: true
    });
    const register = await new DrizzleCashRegisterRepository(database)
      .findById(options.cashRegisterId);
    expect(() => register?.assertOperationalFor(identity.terminalId, identity.originNodeId))
      .not.toThrow();
    const cash = await new DrizzlePaymentMethodRepository(database).findByCode('CASH');
    expect(cash).toMatchObject({ kind: 'CASH', currencyCode: 'USD', isActive: true });
    await expect(new SqliteDiscountPolicyProvider(database).getPolicy())
      .resolves.toMatchObject({ maximumBasisPoints: 1500 });
    const tax = await new SqliteFinancialTransactionTaxPolicyProvider(database).getPolicy();
    expect(tax.rate.basisPoints).toBe(300);
    expect(tax.eligiblePaymentMethodCodes).toEqual(['CARD']);
  });

  it('is repeatable: a second run with the same configuration adds no policy version', async () => {
    const database = setup();

    const first = await bootstrapOperations(database, identity, options);
    const second = await bootstrapOperations(database, identity, options);

    expect(first.discountPolicyCreated).toBe(true);
    expect(second.discountPolicyCreated).toBe(false);
    expect(second.taxPolicyCreated).toBe(false);
    expect(second.discountPolicyVersion).toBe(first.discountPolicyVersion);
    expect(database.sqlite.prepare('select count(*) from operational_policy_versions')
      .pluck().get()).toBe(2);
    expect(database.sqlite.prepare('select count(*) from cash_registers').pluck().get()).toBe(1);
    expect(database.sqlite.prepare('select count(*) from payment_methods').pluck().get()).toBe(2);
  });

  it('rejects a cash register that would not belong to the running terminal', async () => {
    const database = setup();
    await bootstrapOperations(database, identity, options);

    const register = await new DrizzleCashRegisterRepository(database)
      .findById(options.cashRegisterId);

    expect(() => register?.assertOperationalFor('otro-terminal', identity.originNodeId))
      .toThrowError(expect.objectContaining({ code: 'CASH_REGISTER_OWNERSHIP_MISMATCH' }));
  });

  /**
   * Perfil venezolano: dólares y bolívares en caja, como cobra una tienda real.
   * Los métodos en VES quedan configurados aunque todavía no se puedan cobrar
   * en una venta en USD (D-001); eso lo resuelve la etapa E1, no el seed.
   */
  it('provisions the Venezuelan payment profile with methods in USD and VES', async () => {
    const database = setup();

    const result = await bootstrapOperations(database, identity, {
      ...options, paymentMethodProfile: 'venezuela',
      financialTransactionTaxPaymentMethods: ['CASH_USD', 'ZELLE_USD']
    });

    expect(result.paymentMethodCodes).toEqual([
      'CASH_USD', 'ZELLE_USD', 'CASH_VES', 'CARD_VES', 'MOBILE_VES', 'TRANSFER_VES'
    ]);
    const methods = new DrizzlePaymentMethodRepository(database);
    await expect(methods.findByCode('CASH_VES'))
      .resolves.toMatchObject({ name: 'Efectivo Bs', kind: 'CASH', currencyCode: 'VES' });
    await expect(methods.findByCode('MOBILE_VES'))
      .resolves.toMatchObject({ name: 'Pago móvil', kind: 'MOBILE_PAYMENT', currencyCode: 'VES' });
    await expect(methods.findByCode('CARD_VES'))
      .resolves.toMatchObject({ name: 'Punto de venta', kind: 'CARD', currencyCode: 'VES' });
    await expect(methods.findByCode('ZELLE_USD'))
      .resolves.toMatchObject({ kind: 'BANK_TRANSFER', currencyCode: 'USD' });
  });

  it('registers the declared USD/VES rate once and a new one only when it changes', async () => {
    const database = setup();
    const rates = new DrizzleExchangeRateRepository(database);
    const withRate = {
      ...options, referenceRate: { value: '478,58', source: 'Tasa de demostración, no oficial' }
    };

    const first = await bootstrapOperations(database, identity, withRate);
    const repeated = await bootstrapOperations(database, identity, withRate);

    expect(first.referenceRateRegistered).toBe(true);
    expect(repeated.referenceRateRegistered).toBe(false);
    const current = await rates.findCurrentByPair('USD', 'VES', new Date());
    expect(current).toMatchObject({
      rateValue: 47858, rateScale: 2, source: 'Tasa de demostración, no oficial'
    });
    expect(database.sqlite.prepare('select count(*) from exchange_rates').pluck().get()).toBe(1);

    const changed = await bootstrapOperations(database, identity, {
      ...options, referenceRate: { value: '480', source: 'Tasa de demostración, no oficial' }
    });
    expect(changed.referenceRateRegistered).toBe(true);
    expect(database.sqlite.prepare('select count(*) from exchange_rates').pluck().get()).toBe(2);
  });

  it('registers no rate when none is declared', async () => {
    const database = setup();

    const result = await bootstrapOperations(database, identity, options);

    expect(result.referenceRateRegistered).toBe(false);
    expect(database.sqlite.prepare('select count(*) from exchange_rates').pluck().get()).toBe(0);
  });
});

describe('reference rate option', () => {
  it.each([
    ['478,58', { rateValue: 47858, rateScale: 2 }],
    ['478.58', { rateValue: 47858, rateScale: 2 }],
    ['480', { rateValue: 480, rateScale: 0 }],
    ['820.1018', { rateValue: 8201018, rateScale: 4 }]
  ])('reads %s as an exact scaled integer', (text, expected) => {
    expect(parseReferenceRate(text)).toEqual(expected);
  });

  it.each(['', '0', '0,00', '-5', 'abc', '1.123456789', '1.000,50'])(
    'rejects %j', (text) => {
      expect(() => parseReferenceRate(text)).toThrowError(/tasa USD\/VES/);
    }
  );
});
