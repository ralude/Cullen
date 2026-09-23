import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { stdout } from 'node:process';
import { CashRegister, ExchangeRate, PaymentMethod } from '@supermarket/core';
import {
  applyMigrations,
  DrizzleCashRegisterRepository,
  DrizzleExchangeRateRepository,
  DrizzlePaymentMethodRepository,
  openDatabase,
  SqliteOperationalPolicyWriter,
  SqliteUnitOfWork,
  type DatabaseHandle
} from '@supermarket/driver-db';
import {
  loadNodeIdentity,
  SystemClock,
  UuidV7Generator,
  type NodeIdentity
} from '@supermarket/driver-security';

/**
 * `basic` conserva los dos métodos históricos en la moneda indicada, de los
 * que dependen el quickstart, la demo publicada y el manual. `venezuela`
 * siembra lo que cobra una tienda venezolana, en dólares y en bolívares.
 */
export type PaymentMethodProfile = 'basic' | 'venezuela';

/** Tasa USD/VES declarada por quien prepara el nodo; nunca se inventa. */
export type ReferenceRateOption = { readonly value: string; readonly source: string };

export type OperationsBootstrapOptions = {
  readonly paymentMethodProfile?: PaymentMethodProfile;
  readonly referenceRate?: ReferenceRateOption;
  readonly currencyCode: string;
  readonly discountMaximumBasisPoints: number;
  readonly financialTransactionTaxBasisPoints: number;
  readonly financialTransactionTaxPaymentMethods: readonly string[];
  readonly financialTransactionTaxCurrencies: readonly string[];
  readonly cashRegisterId: string;
  readonly cashRegisterName: string;
};

export type OperationsBootstrapResult = {
  readonly cashRegisterId: string;
  readonly paymentMethodCodes: readonly string[];
  readonly discountPolicyCreated: boolean;
  readonly discountPolicyVersion: number;
  readonly taxPolicyCreated: boolean;
  readonly taxPolicyVersion: number;
  readonly referenceRateRegistered: boolean;
};

const MAX_RATE_SCALE = 8;

/**
 * Lee la tasa como entero con escala, sin pasar por un flotante. Acepta coma o
 * punto decimal y rechaza separadores de miles: «1.000,50» es ambiguo.
 */
export const parseReferenceRate = (text: string): { rateValue: number; rateScale: number } => {
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(text.trim());
  const fraction = match?.[2] ?? '';
  const rateValue = match ? Number(match[1]! + fraction) : Number.NaN;
  if (!match || fraction.length > MAX_RATE_SCALE || !Number.isSafeInteger(rateValue) || rateValue <= 0) {
    throw new Error(
      `La tasa USD/VES debe ser un decimal positivo con hasta ${MAX_RATE_SCALE} decimales, ` +
      'sin separador de miles; por ejemplo 478,58.'
    );
  }
  return { rateValue, rateScale: fraction.length };
};

const paymentMethodsFor = (
  profile: PaymentMethodProfile,
  currencyCode: string
): readonly PaymentMethod[] => profile === 'basic'
  ? [
      PaymentMethod.create({ code: 'CASH', name: 'Efectivo', kind: 'CASH', currencyCode }),
      PaymentMethod.create({ code: 'CARD', name: 'Tarjeta', kind: 'CARD', currencyCode })
    ]
  : [
      PaymentMethod.create({ code: 'CASH_USD', name: 'Efectivo USD', kind: 'CASH', currencyCode: 'USD' }),
      PaymentMethod.create({ code: 'ZELLE_USD', name: 'Zelle', kind: 'BANK_TRANSFER', currencyCode: 'USD' }),
      PaymentMethod.create({ code: 'CASH_VES', name: 'Efectivo Bs', kind: 'CASH', currencyCode: 'VES' }),
      PaymentMethod.create({ code: 'CARD_VES', name: 'Punto de venta', kind: 'CARD', currencyCode: 'VES' }),
      PaymentMethod.create({ code: 'MOBILE_VES', name: 'Pago móvil', kind: 'MOBILE_PAYMENT', currencyCode: 'VES' }),
      PaymentMethod.create({ code: 'TRANSFER_VES', name: 'Transferencia', kind: 'BANK_TRANSFER', currencyCode: 'VES' })
    ];

const DEFAULT_CASH_REGISTER_ID = '0199a0f0-0000-7000-8000-000000005001';
const CREATED_BY = 'bootstrap:operations';
const REASON = 'Configuración operativa inicial de desarrollo';

/**
 * Provisiona la configuración operativa mínima para operar caja y venta en un
 * nodo local: una caja del terminal actual, métodos de pago y las políticas de
 * descuento e IGTF. No inventa valores regulatorios: la tasa, el tope y la
 * elegibilidad se reciben explícitamente.
 */
export const bootstrapOperations = async (
  handle: DatabaseHandle,
  identity: NodeIdentity,
  options: OperationsBootstrapOptions
): Promise<OperationsBootstrapResult> => {
  const currencyCode = options.currencyCode.trim().toUpperCase();
  const cashRegister = CashRegister.create({
    id: options.cashRegisterId,
    name: options.cashRegisterName,
    terminalId: identity.terminalId,
    originNodeId: identity.originNodeId
  });
  const paymentMethods = paymentMethodsFor(options.paymentMethodProfile ?? 'basic', currencyCode);
  const ids = new UuidV7Generator();
  const now = new SystemClock().now();
  const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
  const policyWriter = new SqliteOperationalPolicyWriter(handle);

  return unitOfWork.execute(async () => {
    await new DrizzleCashRegisterRepository(handle).save(cashRegister);
    const paymentMethodRepository = new DrizzlePaymentMethodRepository(handle);
    for (const method of paymentMethods) await paymentMethodRepository.save(method);
    const discount = policyWriter.activateDiscountPolicy(
      { maximumBasisPoints: options.discountMaximumBasisPoints },
      { policyId: ids.generate(), createdBy: CREATED_BY, reason: REASON, now }
    );
    const tax = policyWriter.activateFinancialTransactionTaxPolicy(
      {
        rateBasisPoints: options.financialTransactionTaxBasisPoints,
        eligiblePaymentMethodCodes: options.financialTransactionTaxPaymentMethods,
        eligibleCurrencies: options.financialTransactionTaxCurrencies
      },
      { policyId: ids.generate(), createdBy: CREATED_BY, reason: REASON, now }
    );
    const referenceRateRegistered = options.referenceRate === undefined
      ? false
      : await registerReferenceRate(handle, options.referenceRate, ids.generate(), now);
    return {
      cashRegisterId: cashRegister.id,
      paymentMethodCodes: paymentMethods.map((method) => method.code),
      discountPolicyCreated: discount.created,
      discountPolicyVersion: discount.version,
      taxPolicyCreated: tax.created,
      taxPolicyVersion: tax.version,
      referenceRateRegistered
    };
  });
};

/**
 * Registra la tasa declarada desde ahora y sin cierre, salvo que la vigente ya
 * tenga el mismo valor, escala y fuente: repetir el comando no llena el
 * histórico. Como los métodos de pago, se guarda por el repositorio —que lleva
 * la versión del par— y no se publica por LAN; eso lo hace el bootstrap de
 * referencias del coordinador.
 */
const registerReferenceRate = async (
  handle: DatabaseHandle,
  option: ReferenceRateOption,
  id: string,
  now: Date
): Promise<boolean> => {
  const { rateValue, rateScale } = parseReferenceRate(option.value);
  const source = option.source.trim();
  const repository = new DrizzleExchangeRateRepository(handle);
  const current = await repository.findCurrentByPair('USD', 'VES', now);
  if (current && current.rateValue === rateValue && current.rateScale === rateScale &&
    current.source === source) return false;
  await repository.save(ExchangeRate.create({
    id, baseCurrency: 'USD', quoteCurrency: 'VES', rateValue, rateScale, source,
    validFrom: now, validUntil: null, registeredBy: CREATED_BY
  }));
  return true;
};

type CliOptions = OperationsBootstrapOptions & { readonly databasePath: string };

const readOption = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  return !value || value.startsWith('--') ? undefined : value;
};

const readRequiredOption = (args: readonly string[], name: string): string => {
  const value = readOption(args, name);
  if (value === undefined) throw new Error(`Falta la opción requerida ${name}.`);
  return value;
};

const readBasisPoints = (args: readonly string[], name: string): number => {
  const value = Number(readRequiredOption(args, name));
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${name} debe ser un entero entre 0 y 10000 puntos base.`);
  }
  return value;
};

const readCodes = (args: readonly string[], name: string): readonly string[] =>
  (readOption(args, name) ?? '').split(',')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code.length > 0);

const parseCliOptions = (args: readonly string[]): CliOptions => {
  const databasePath = readRequiredOption(args, '--database').trim();
  if (databasePath === ':memory:') {
    throw new Error('El comando requiere una base persistente; :memory: no está permitido.');
  }
  const financialTransactionTaxBasisPoints = readBasisPoints(args, '--igtf-basis-points');
  const financialTransactionTaxPaymentMethods = readCodes(args, '--igtf-payment-methods');
  const financialTransactionTaxCurrencies = readCodes(args, '--igtf-currencies');
  if (
    financialTransactionTaxBasisPoints > 0 &&
    (financialTransactionTaxPaymentMethods.length === 0 ||
      financialTransactionTaxCurrencies.length === 0)
  ) {
    throw new Error(
      'Una tasa de IGTF mayor que cero exige --igtf-payment-methods y --igtf-currencies; ' +
      'sin ambas listas la tasa nunca se aplicaría.'
    );
  }
  const profileText = (readOption(args, '--payment-methods') ?? 'basic').trim().toLowerCase();
  if (profileText !== 'basic' && profileText !== 'venezuela') {
    throw new Error('--payment-methods admite basic o venezuela.');
  }
  const rateText = readOption(args, '--usd-ves-rate');
  const rateSource = readOption(args, '--usd-ves-rate-source')?.trim();
  if (rateText === undefined && rateSource !== undefined) {
    throw new Error('--usd-ves-rate-source solo tiene sentido junto a --usd-ves-rate.');
  }
  if (rateText !== undefined) parseReferenceRate(rateText);
  return {
    databasePath,
    paymentMethodProfile: profileText,
    ...(rateText === undefined ? {} : {
      referenceRate: { value: rateText, source: rateSource || 'Tasa de demostración, no oficial' }
    }),
    currencyCode: readRequiredOption(args, '--currency').trim().toUpperCase(),
    discountMaximumBasisPoints: readBasisPoints(args, '--discount-max-basis-points'),
    financialTransactionTaxBasisPoints,
    financialTransactionTaxPaymentMethods,
    financialTransactionTaxCurrencies,
    cashRegisterId: readOption(args, '--cash-register-id')?.trim() ?? DEFAULT_CASH_REGISTER_ID,
    cashRegisterName: readOption(args, '--cash-register-name')?.trim() ?? 'Caja 1'
  };
};

const describePolicy = (created: boolean, version: number): string =>
  created ? `versión ${version} activada` : `versión ${version} ya activa, sin cambios`;

export const runBootstrapOperationsCli = async (args: readonly string[]): Promise<void> => {
  let handle: DatabaseHandle | undefined;
  try {
    const options = parseCliOptions(args);
    const identity = loadNodeIdentity(process.env.NODE_IDENTITY_PATH);
    handle = openDatabase(resolve(options.databasePath));
    applyMigrations(handle.sqlite);
    const result = await bootstrapOperations(handle, identity, options);
    stdout.write(
      'Configuración operativa lista.\n' +
      `  Caja: ${result.cashRegisterId} (${options.cashRegisterName})\n` +
      `  Terminal: ${identity.terminalId}\n` +
      `  Nodo: ${identity.originNodeId}\n` +
      `  Métodos de pago: ${result.paymentMethodCodes.join(', ')}` +
      (options.paymentMethodProfile === 'venezuela' ? ' en USD y VES\n' : ` en ${options.currencyCode}\n`) +
      (options.referenceRate === undefined ? '' :
        `  Tasa USD/VES: ${options.referenceRate.value} · ${options.referenceRate.source} ` +
        `(${result.referenceRateRegistered ? 'registrada desde ahora' : 'ya vigente, sin cambios'})\n`) +
      `  Descuento máximo: ${options.discountMaximumBasisPoints} pb ` +
      `(${describePolicy(result.discountPolicyCreated, result.discountPolicyVersion)})\n` +
      `  IGTF: ${options.financialTransactionTaxBasisPoints} pb ` +
      `(${describePolicy(result.taxPolicyCreated, result.taxPolicyVersion)})\n` +
      `  IGTF aplica a: ${options.financialTransactionTaxPaymentMethods.join(', ') || 'ningún método'} ` +
      `en ${options.financialTransactionTaxCurrencies.join(', ') || 'ninguna moneda'}\n`
    );
  } catch (error) {
    stdout.write(
      'No se pudo preparar la configuración operativa: ' +
      `${error instanceof Error ? error.message : 'error desconocido'}\n` +
      'Uso: pnpm --filter @supermarket/server bootstrap-operations:dev -- --database <ruta> ' +
      '--currency <ABC> --discount-max-basis-points <entero> --igtf-basis-points <entero> ' +
      '[--igtf-payment-methods <CSV>] [--igtf-currencies <CSV>] ' +
      '[--cash-register-id <texto>] [--cash-register-name <texto>] ' +
      '[--payment-methods basic|venezuela] [--usd-ves-rate <decimal>] ' +
      '[--usd-ves-rate-source <texto>]\n'
    );
    process.exitCode = 1;
  } finally {
    handle?.close();
  }
};

const isMainModule = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) await runBootstrapOperationsCli(process.argv.slice(2));
