/**
 * Arnés de medición de la Fase 12.
 *
 * Corre escenarios reproducibles sobre el nodo real —Fastify, aplicación y
 * SQLite— y escribe cada observación individual junto a su resumen. No es
 * código productivo: vive fuera de `src/` y no entra al bundle.
 *
 * El protocolo —warm-up, muestra, estadísticos y margen de ruido— lo fija
 * [el manifiesto](../../../docs/cronograma/fase-12-optimizacion/performance-manifest.json);
 * este archivo lo ejecuta. Si los dos se separan, manda el manifiesto.
 *
 *   pnpm --filter @supermarket/server perf
 *   pnpm --filter @supermarket/server perf -- --scenario sale-journey --sample 10
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, totalmem, cpus, platform, release } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  Barcode, Category, CashRegister, PaymentMethod, Product, StockItem, UnitOfMeasure
} from '@supermarket/core';
import {
  DrizzleCashRegisterRepository, DrizzleCategoryRepository, DrizzlePaymentMethodRepository,
  DrizzleProductRepository, DrizzleStockItemRepository, DrizzleUnitOfMeasureRepository,
  SqliteOperationalPolicyWriter, SqliteUnitOfWork
} from '@supermarket/driver-db';
import {
  Money, Quantity, TaxRate,
  type SalesReportResponse, type ShiftResponse, type SimulatedFiscalDocumentResponse
} from '@supermarket/shared';
import { buildApp } from '../src/app.ts';
import { ADMIN_PERMISSIONS, createSecurityRuntime, type SecurityRuntime } from '../src/runtime.ts';
import { LanCycleBenchmark } from './lan-cycle.ts';
import {
  countTraffic, measureSystemLoad, median, medianBytes, microsToMs, recordResources,
  summarizeProcessResources,
  type ProcessResources, type ScenarioResources
} from './resources.ts';
import {
  measureStartup, prepareStartupArtifact, removeStartupArtifact, type StartupProcessUsage
} from './startup.ts';

type Observation = {
  readonly scenario: string;
  readonly run: number;
  readonly ms: number;
  /** Recursos del mismo intervalo, cuando el escenario los observa. */
  readonly cpuUserMs?: number;
  readonly cpuSystemMs?: number;
  readonly rssBytes?: number;
};

type Summary = {
  readonly scenario: string;
  readonly sample: number;
  readonly medianMs: number;
  readonly p90Ms?: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly iqrMs: number;
  /** Dispersión dentro de la serie; no sustituye la deriva entre series. */
  readonly relativeIqr: number;
};

const PRODUCTS = 200;

/**
 * Profundidades de historia de inventario del perfil de crecimiento. No son
 * cifras de una tienda concreta: son los tamaños que hacen visible el riesgo
 * que la auditoría de Fase 11 dejó registrado sin benchmark —el repositorio
 * carga todos los movimientos y `StockItem.restore` los reejecuta—, y que
 * 12.03 exige recorrer «en escala habitual y de crecimiento».
 */
/**
 * El sembrado guarda por tramos porque un solo `save` con ~9.000 movimientos
 * nuevos desborda la pila: Drizzle arma un INSERT con una fila por movimiento y
 * `mergeQueries` recurre por fila. El techo está entre 8.000 y 9.000, medido el
 * 2026-09-11; queda registrado en el informe del perfil de crecimiento. Aquí se
 * rodea porque lo que este arnés mide es la profundidad de la historia, no el
 * tamaño del lote que la escribe.
 */
const SAVE_CHUNK = 1_000;

/**
 * Ventas completadas que el perfil de crecimiento deja en la base antes de
 * medir. Sin ellas el reporte de ventas leería un período vacío: un número
 * excelente que no mide nada.
 */
const SEEDED_SALES = 300;

/** Fondo de apertura del turno, en centavos de USD. */
const OPENING_CASH = 50_000;

const DEFAULT_HISTORY_DEPTHS = [100, 1_000, 10_000];

/** Rechazar entradas inválidas antes de crear bases o publicar resultados. */
const invalidArgument: () => never = () => {
  throw new Error('PERF_INVALID_ARGUMENT: revisa perfil, escenario, muestra, warm-up y profundidades.');
};

const parseOptions = (args: readonly string[]) => {
  const values = new Map<string, string>();
  const scenarios: string[] = [];
  const allowed = ['--profile', '--scenario', '--sample', '--warmup', '--depths', '--max-load'];
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]!;
    if (key === '--') continue;
    const value = args[++index];
    if (!allowed.includes(key) || !value || value.startsWith('--')) invalidArgument();
    if (key === '--scenario') scenarios.push(value);
    else {
      if (values.has(key)) invalidArgument();
      values.set(key, value);
    }
  }
  const integer = (raw: string, minimum: number): number => {
    if (!/^\d+$/.test(raw)) invalidArgument();
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum) invalidArgument();
    return value;
  };
  const profile = values.get('--profile') ?? 'habitual';
  if (profile !== 'habitual' && profile !== 'crecimiento') invalidArgument();
  const historyDepths = values.has('--depths')
    ? values.get('--depths')!.split(',').map((value) => integer(value, 1))
    : DEFAULT_HISTORY_DEPTHS;
  if (new Set(historyDepths).size !== historyDepths.length) invalidArgument();
  if (values.has('--depths') && profile !== 'crecimiento') invalidArgument();
  return {
    profile,
    historyDepths,
    maxLoadPercent: values.has('--max-load') ? integer(values.get('--max-load')!, 0) : 15,
    warmup: values.has('--warmup')
      ? { mode: 'fixed' as const, runs: integer(values.get('--warmup')!, 0) }
      : { mode: 'auto' as const },
    sample: integer(values.get('--sample') ?? (profile === 'crecimiento' ? '10' : '30'), 1),
    scenarios: [...new Set(scenarios)]
  };
};

const options = parseOptions(process.argv.slice(2));
const HISTORY_DEPTHS = options.historyDepths;

/**
 * Warm-up proporcional al costo del escenario. El piloto del 2026-09-16 mostró
 * que un warm-up fijo de 5 no sirve a esta escala: `catalog-barcode` derivaba
 * 71,6 % entre series y medía 1,0–1,7 ms sin calentar, contra 0,888 ms y 3,3 %
 * de deriva una vez caliente. No es ruido, es código todavía sin optimizar
 * entrando a la muestra.
 *
 * Un warm-up fijo alto tampoco sirve: 200 repeticiones cuestan 0,18 s en
 * `catalog-barcode` y unos diez minutos en `kardex-10k`. Por eso el warm-up
 * termina cuando se agota lo primero de dos topes —repeticiones o tiempo
 * acumulado del camino medido—, con un piso que todo escenario cumple. Un
 * escenario de microsegundos llega al tope de repeticiones; uno de segundos se
 * queda en el piso, que es lo que ya hacía.
 *
 * Las repeticiones realmente usadas se publican con cada serie: el protocolo
 * sigue siendo reproducible aunque el número no sea el mismo en cada escenario.
 */
const WARMUP_MIN_RUNS = 5;
const WARMUP_MAX_RUNS = 200;
const WARMUP_BUDGET_MS = 1_000;

/**
 * Corre el warm-up y devuelve cuántas repeticiones consumió. Recibe el índice
 * de repetición que toca para que los identificadores idempotentes y los
 * asientos del escenario sigan siendo únicos entre warm-up y muestra.
 */
const warmUp = async (runOnce: (run: number) => Promise<number>): Promise<number> => {
  if (options.warmup.mode === 'fixed') {
    for (let run = 0; run < options.warmup.runs; run += 1) await runOnce(run);
    return options.warmup.runs;
  }
  let runs = 0;
  let accumulated = 0;
  while (runs < WARMUP_MIN_RUNS || (runs < WARMUP_MAX_RUNS && accumulated < WARMUP_BUDGET_MS)) {
    accumulated += await runOnce(runs);
    runs += 1;
  }
  return runs;
};

const depthLabel = (depth: number): string =>
  depth >= 1_000 && depth % 1_000 === 0 ? depth / 1_000 + 'k' : String(depth);

const historyProductId = (depth: number): string => 'history-' + depthLabel(depth);
const OPERATOR = { operatorCode: 'PERF01', displayName: 'Medición', pin: '123456' };

const profile = (): string => options.profile;

const quantile = (sorted: readonly number[], fraction: number): number => {
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
};

const summarize = (scenario: string, observations: readonly number[]): Summary => {
  const sorted = [...observations].sort((left, right) => left - right);
  const median = quantile(sorted, 0.5);
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  return {
    scenario,
    sample: sorted.length,
    medianMs: Number(median.toFixed(3)),
    ...(sorted.length >= 30 ? { p90Ms: Number(quantile(sorted, 0.9).toFixed(3)) } : {}),
    minMs: Number(sorted[0]!.toFixed(3)),
    maxMs: Number(sorted.at(-1)!.toFixed(3)),
    iqrMs: Number(iqr.toFixed(3)),
    relativeIqr: Number((median === 0 ? 0 : iqr / median).toFixed(4))
  };
};

/**
 * Sumidero del registro técnico. La medición paga el costo de componer cada
 * línea —que el nodo también paga— pero no el de escribirla: mezclada con el
 * resumen, la salida sería ilegible y el disco entraría en la medición.
 */
const discard = { write: (): void => undefined };

const AT = new Date('2026-09-11T12:00:00.000Z');
/** El runtime usa su reloj real; el período se ancla al inicio de cada proceso. */
const reportAnchor = new Date();
const reportPeriod = {
  from: new Date(reportAnchor.getTime() - 86_400_000).toISOString(),
  to: new Date(reportAnchor.getTime() + 86_400_000).toISOString()
};
const inventoryAsOf = new Date(Math.max(
  reportAnchor.getTime() + 86_400_000,
  AT.getTime() + Math.max(...HISTORY_DEPTHS) * 1_000
)).toISOString();

/**
 * Semilla determinista: misma base para toda corrida y toda repetición. Los
 * identificadores y barcodes son secuenciales para que el escenario de barcode
 * pueda recorrerlos sin depender del orden de inserción.
 */
const seed = async (runtime: SecurityRuntime): Promise<void> => {
  const handle = runtime.handle;
  const unit = UnitOfMeasure.create({ id: 'unit-001', code: 'UNIT', name: 'Unidad', quantityScale: 0 });
  await new SqliteUnitOfWork(handle.sqlite).execute(async () => {
    await new DrizzleUnitOfMeasureRepository(handle).save(unit);
    await new DrizzleCategoryRepository(handle).save(
      Category.create({ id: 'category-001', name: 'Víveres' })
    );
    await new DrizzleCashRegisterRepository(handle).save(CashRegister.create({
      id: 'register-001', name: 'Caja 1', terminalId: 'terminal-001', originNodeId: 'node-001'
    }));
    const methods = new DrizzlePaymentMethodRepository(handle);
    await methods.save(PaymentMethod.create({
      code: 'CASH_USD', name: 'Efectivo USD', kind: 'CASH', currencyCode: 'USD'
    }));
    await methods.save(PaymentMethod.create({
      code: 'CARD_USD', name: 'Tarjeta USD', kind: 'CARD', currencyCode: 'USD'
    }));
    /** Segundo método no gravado: con él la jornada cobra un lote mixto y factura. */
    await methods.save(PaymentMethod.create({
      code: 'TRANSFER_USD', name: 'Transferencia USD', kind: 'BANK_TRANSFER', currencyCode: 'USD'
    }));
    new SqliteOperationalPolicyWriter(handle).activateDiscountPolicy(
      { maximumBasisPoints: 1_500 },
      { policyId: 'policy-discount', createdBy: 'perf', reason: 'Medición', now: AT }
    );
    new SqliteOperationalPolicyWriter(handle).activateFinancialTransactionTaxPolicy(
      {
        rateBasisPoints: 300,
        eligiblePaymentMethodCodes: ['CARD_USD'],
        eligibleCurrencies: ['USD']
      },
      { policyId: 'policy-igtf', createdBy: 'perf', reason: 'Medición', now: AT }
    );
    const products = new DrizzleProductRepository(handle);
    const stock = new DrizzleStockItemRepository(handle);
    for (let index = 1; index <= PRODUCTS; index += 1) {
      const suffix = String(index).padStart(4, '0');
      await products.save(Product.create({
        id: 'product-' + suffix, name: 'Producto ' + suffix, description: 'Artículo de medición',
        categoryId: 'category-001', unitOfMeasure: unit,
        barcodes: [Barcode.create({ id: 'barcode-' + suffix, value: '75900000' + suffix })],
        price: Money.fromMinorUnits(1_000 + index, 'USD'), taxRate: TaxRate.fromBasisPoints(1_600),
        priceHistoryId: 'history-' + suffix, recordedBy: 'perf',
        occurredAt: AT, eventId: 'event-product-' + suffix
      }));
      const item = StockItem.create({
        id: 'stock-' + suffix, productId: 'product-' + suffix, unitCode: 'UNIT',
        quantityScale: 0, tracksBatches: false
      });
      item.registerMovement({
        id: 'receipt-' + suffix, type: 'PURCHASE_RECEIPT', quantity: Quantity.fromScaled(10_000, 0),
        actorId: 'perf', reason: 'Inventario de medición', referenceId: 'purchase-' + suffix,
        occurredAt: AT, eventId: 'stock-event-' + suffix,
        unitCost: Money.fromMinorUnits(800, 'USD')
      });
      await stock.save(item);
    }
  });
};

/**
 * Historia profunda de inventario para el perfil de crecimiento: un producto
 * por profundidad, con sus movimientos construidos por el dominio —no
 * insertados a mano— para que lo medido sea lo que el nodo realmente escribe y
 * rehidrata. Se siembra una sola vez por corrida y fuera de toda medición.
 */
const seedHistory = async (runtime: SecurityRuntime): Promise<void> => {
  const handle = runtime.handle;
  const unit = UnitOfMeasure.create({ id: 'unit-001', code: 'UNIT', name: 'Unidad', quantityScale: 0 });
  for (const depth of HISTORY_DEPTHS) {
    const label = depthLabel(depth);
    await new SqliteUnitOfWork(handle.sqlite).execute(async () => {
      await new DrizzleProductRepository(handle).save(Product.create({
        id: historyProductId(depth), name: 'Historia ' + label, description: 'Producto con historia',
        categoryId: 'category-001', unitOfMeasure: unit,
        barcodes: [Barcode.create({ id: 'barcode-history-' + label, value: '76900000' + label.padStart(4, '0') })],
        price: Money.fromMinorUnits(1_500, 'USD'), taxRate: TaxRate.fromBasisPoints(1_600),
        priceHistoryId: 'history-price-' + label, recordedBy: 'perf',
        occurredAt: AT, eventId: 'event-history-' + label
      }));
      const item = StockItem.create({
        id: 'stock-history-' + label, productId: historyProductId(depth), unitCode: 'UNIT',
        quantityScale: 0, tracksBatches: false
      });
      const stock = new DrizzleStockItemRepository(handle);
      for (let movement = 1; movement <= depth; movement += 1) {
        item.registerMovement({
          id: 'movement-' + label + '-' + movement, type: 'PURCHASE_RECEIPT',
          quantity: Quantity.fromScaled(1, 0),
          actorId: 'perf', reason: 'Historia de medición',
          referenceId: 'reference-' + label + '-' + movement,
          occurredAt: new Date(AT.getTime() + movement * 1_000),
          eventId: 'event-movement-' + label + '-' + movement,
          unitCost: Money.fromMinorUnits(800, 'USD')
        });
        if (movement % SAVE_CHUNK === 0) await stock.save(item);
      }
      await stock.save(item);
    });
  }
};

/**
 * Producto que le toca a una repetición. La siembra recorre repeticiones
 * negativas, así que el resto se normaliza en vez de salirse del catálogo.
 */
const productSuffix = (run: number): string =>
  String(((run % PRODUCTS) + PRODUCTS) % PRODUCTS + 1).padStart(4, '0');
/**
 * Jornada principal: abrir venta, agregar línea, cobrar con un lote mixto,
 * completar y emitir el documento fiscal simulado. La emisión es un comando
 * propio de la venta ya completada —el nodo deriva su contenido de los
 * snapshots que la venta congeló—, así que la medición no vuelve a declarar
 * importes ni impuestos. La usa el escenario y también la siembra del perfil
 * de crecimiento, para que la historia comercial se construya por el mismo
 * camino que se mide.
 */
const journey = async (place: Station, run: number): Promise<number> => {
  const suffix = productSuffix(run);
  const key = (step: string): string => 'perf-' + step + '-' + run;
  return timed(async () => {
    const started = await place.app.inject({
      method: 'POST', url: '/api/v1/sales',
      headers: { cookie: place.cookie, 'idempotency-key': key('start') },
      payload: { shiftId: place.shiftId, currencyCode: 'USD' }
    });
    expect200(started.statusCode, 'abrir venta');
    const saleId = (started.json() as { readonly id: string }).id;
    const added = await place.app.inject({
      method: 'POST', url: '/api/v1/sales/' + saleId + '/items',
      headers: { cookie: place.cookie, 'idempotency-key': key('item') },
      payload: { barcode: '75900000' + suffix, quantityScaled: 1, quantityScale: 0 }
    });
    expect200(added.statusCode, 'agregar línea');
    const sale = added.json() as { readonly totalMinorUnits: number };
    /**
     * Cobro mixto de dos métodos no gravados: la mitad en efectivo y el resto
     * por transferencia. La jornada medida **no** usa el método gravado con
     * IGTF porque una venta que cobró IGTF no puede emitir su factura hoy
     * —D-003 en [defectos conocidos](../../../docs/cronograma/defectos-conocidos.md)—,
     * y una jornada sin documento no cubre el escenario 4. La política de IGTF
     * sigue sembrada: el dataset conserva el caso, no lo borra.
     */
    const cash = Number(BigInt(sale.totalMinorUnits) / 2n);
    const transfer = sale.totalMinorUnits - cash;
    const paid = await place.app.inject({
      method: 'POST', url: '/api/v1/sales/' + saleId + '/payments',
      headers: { cookie: place.cookie, 'idempotency-key': key('pay') },
      payload: {
        payments: [
          { methodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: cash },
          { methodCode: 'TRANSFER_USD', currencyCode: 'USD', amountMinorUnits: transfer }
        ]
      }
    });
    expect200(paid.statusCode, 'registrar pagos');
    const completed = await place.app.inject({
      method: 'POST', url: '/api/v1/sales/' + saleId + '/complete',
      headers: { cookie: place.cookie, 'idempotency-key': key('complete') }
    });
    expect200(completed.statusCode, 'completar venta');
    const invoiced = await place.app.inject({
      method: 'POST', url: '/api/v1/sales/' + saleId + '/fiscal-document',
      headers: { cookie: place.cookie, 'idempotency-key': key('invoice') },
      payload: { reason: 'Factura de la jornada de medición' }
    });
    expect200(invoiced.statusCode, 'emitir documento');
    const issued = invoiced.json<SimulatedFiscalDocumentResponse>();
    if (issued.fiscalMode !== 'SIMULATION' || issued.document.status !== 'ISSUED'
      || issued.document.fiscalNumber === null) {
      throw new Error('PERF_DATASET_MISMATCH: la jornada no dejó un documento emitido en simulación.');
    }
    place.charged.sales += 1;
    place.charged.cashMinorUnits += cash;
    place.charged.transferMinorUnits += transfer;
  });
};

type Station = {
  readonly runtime: SecurityRuntime;
  readonly app: ReturnType<typeof buildApp>;
  readonly cookie: string;
  readonly shiftId: string;
  /**
   * Lo que la estación cobró, contado por el mismo camino que lo cobró:
   * preparación y repeticiones suman aquí para que la verificación compare el
   * turno contra lo ocurrido y no contra una cifra escrita a mano.
   */
  readonly charged: { sales: number; cashMinorUnits: number; transferMinorUnits: number };
  close(): Promise<void>;
};

/** Estación lista para operar: base migrada, semilla, sesión y turno abierto. */
const station = async (databasePath: string): Promise<Station> => {
  const runtime = createSecurityRuntime(databasePath, {
    terminalId: 'terminal-001', originNodeId: 'node-001'
  });
  const app = buildApp(runtime.dependencies, { logDestination: discard });
  try {
    const provisioned = await runtime.provisionInitialAdmin.execute({
      ...OPERATOR, permissions: ADMIN_PERMISSIONS
    });
    if (!provisioned.ok) throw new Error('No se pudo provisionar el administrador de medición.');
    await seed(runtime);
    if (profile() === 'crecimiento') await seedHistory(runtime);
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/session',
      payload: { operatorCode: OPERATOR.operatorCode, pin: OPERATOR.pin }
    });
    if (login.statusCode !== 200) throw new Error('Ingreso rechazado: ' + login.statusCode);
    const cookie = login.headers['set-cookie'];
    const session = Array.isArray(cookie) ? cookie.join('; ') : String(cookie ?? '');
    const opened = await app.inject({
      method: 'POST', url: '/api/v1/cash/shifts',
      headers: { cookie: session, 'idempotency-key': 'perf-shift' },
      payload: {
        cashRegisterId: 'register-001',
        openingFunds: [
          { paymentMethodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: OPENING_CASH }
        ]
      }
    });
    if (opened.statusCode !== 201) throw new Error('Turno rechazado: ' + opened.statusCode);
    const place: Station = {
      runtime, app, cookie: session,
      shiftId: (opened.json() as { readonly id: string }).id,
      charged: { sales: 0, cashMinorUnits: 0, transferMinorUnits: 0 },
      close: async (): Promise<void> => { await app.close(); runtime.handle.close(); }
    };
    if (profile() === 'crecimiento') {
      for (let sale = 0; sale < SEEDED_SALES; sale += 1) await journey(place, -1 - sale);
    }
    return place;
  } catch (error) {
    await app.close();
    runtime.handle.close();
    throw error;
  }
};

type Scenario = {
  readonly id: string;
  /** Prepara lo que el escenario necesita y devuelve la medición de una repetición. */
  readonly run: (station: Station, run: number) => Promise<number>;
  /**
   * Comprobación posterior a la serie y fuera de toda medición: aborta si el
   * escenario no dejó los asientos que dice ejercitar, y devuelve el recuento
   * que se publica como evidencia junto al resumen. Una latencia excelente de
   * una operación que no asentó nada no es una medición. Recibe las
   * repeticiones corridas, warm-up incluido, porque también ellas asientan.
   */
  readonly verify?: (station: Station, runs: number) => Promise<Record<string, number>>;
};

/**
 * CPU del último intervalo cronometrado. Vive fuera de `timed` porque los
 * escenarios devuelven una latencia y no un par: quien mide la lee enseguida,
 * antes de que otra repetición la reemplace.
 */
let lastIntervalCpu: NodeJS.CpuUsage = { user: 0, system: 0 };

const timed = async (action: () => Promise<void>): Promise<number> => {
  const cpu = process.cpuUsage();
  const started = performance.now();
  await action();
  const elapsed = performance.now() - started;
  lastIntervalCpu = process.cpuUsage(cpu);
  return elapsed;
};

const expect200 = (status: number, what: string): void => {
  if (status !== 200 && status !== 201) throw new Error(what + ' devolvió ' + status);
};

/**
 * Una lectura vacía es un número excelente que no mide nada. Los escenarios de
 * lectura exigen filas para que su medición signifique algo.
 */
const expectRows = (body: string, expected: number, what: string): void => {
  const rows: unknown = JSON.parse(body);
  if (!Array.isArray(rows) || rows.length !== expected) {
    throw new Error('PERF_DATASET_MISMATCH: ' + what + ' no devolvió la cantidad de filas prevista.');
  }
};

const productCount = (): number => PRODUCTS + (profile() === 'crecimiento' ? HISTORY_DEPTHS.length : 0);

/** Recuento sobre la base de la estación, usado solo por las verificaciones. */
const count = (place: Station, sql: string, ...parameters: readonly string[]): number =>
  Number(place.runtime.handle.sqlite.prepare(sql).pluck().get(...parameters) ?? 0);

/**
 * Saldo esperado del turno para un método. La estación lo compara contra lo
 * que cobró; publicar el importe no aportaría evidencia y sí filtraría cifras
 * comerciales a un artefacto versionado.
 */
const shiftBalance = (
  balances: ShiftResponse['expectedBalances'], methodCode: string
): number | undefined => balances
  .find((balance) => balance.paymentMethodCode === methodCode && balance.currencyCode === 'USD')
  ?.minorUnits;

const scenarios: readonly Scenario[] = [
  {
    id: 'catalog-barcode',
    run: async (place, run) => {
      const suffix = productSuffix(run);
      return timed(async () => {
        const response = await place.app.inject({
          method: 'GET', url: '/api/v1/catalog/products/by-barcode/75900000' + suffix,
          headers: { cookie: place.cookie }
        });
        expect200(response.statusCode, 'barcode');
      });
    }
  },
  {
    id: 'catalog-list',
    run: async (place) => timed(async () => {
      const response = await place.app.inject({
        method: 'GET', url: '/api/v1/catalog/products', headers: { cookie: place.cookie }
      });
      expect200(response.statusCode, 'listado');
      expectRows(response.body, productCount(), 'El listado de catálogo');
    })
  },
  {
    /**
     * Reporte de inventario con su filtro y su paginación vigentes. Lee la
     * existencia de todos los artículos, no la historia de uno.
     */
    id: 'report-inventory',
    run: async (place) => timed(async () => {
      const response = await place.app.inject({
        method: 'GET',
        url: '/api/v1/reports/inventory?asOf=' + inventoryAsOf + '&limit=500',
        headers: { cookie: place.cookie }
      });
      expect200(response.statusCode, 'reporte de inventario');
      expectRows(response.body, Math.min(productCount(), 500), 'El reporte de inventario');
    })
  },
  {
    id: 'report-sales',
    run: async (place) => timed(async () => {
      const response = await place.app.inject({
        method: 'GET',
        url: '/api/v1/reports/sales?from=' + reportPeriod.from + '&to=' + reportPeriod.to + '&limit=500',
        headers: { cookie: place.cookie }
      });
      expect200(response.statusCode, 'reporte de ventas');
      expectRows(response.body, 1, 'El reporte de ventas');
      const rows = response.json<readonly SalesReportResponse[]>();
      if (rows[0]?.salesCount !== SEEDED_SALES || rows[0]?.quantitySoldScaled !== SEEDED_SALES
        || rows[0]?.currencyCode !== 'USD' || rows[0]?.quantityScale !== 0) {
        throw new Error('PERF_DATASET_MISMATCH: el reporte no resume las ventas sembradas.');
      }
    })
  },
  {
    id: 'sale-journey',
    run: async (place, run) => journey(place, run),
    /**
     * La jornada sólo está completa si el cobro quedó asentado en el turno, el
     * inventario salió y el documento quedó emitido. Se comprueba una vez, al
     * final de la serie, para no cobrarle a la latencia tres lecturas que la
     * operación real no hace.
     */
    verify: async (place) => {
      const response = await place.app.inject({
        method: 'GET', url: '/api/v1/cash/shifts/' + place.shiftId,
        headers: { cookie: place.cookie }
      });
      expect200(response.statusCode, 'consultar turno');
      const shift = response.json<ShiftResponse>();
      const expected: readonly [string, number][] = [
        ['CASH_USD', OPENING_CASH + place.charged.cashMinorUnits],
        ['TRANSFER_USD', place.charged.transferMinorUnits]
      ];
      for (const [methodCode, minorUnits] of expected) {
        if (shiftBalance(shift.expectedBalances, methodCode) !== minorUnits) {
          throw new Error('PERF_DATASET_MISMATCH: el turno no asentó lo que la jornada cobró.');
        }
      }
      const shiftPostings = shift.movements.filter(({ type }) => type === 'SALE_PAYMENT').length;
      const stockIssues = count(
        place, 'select count(*) from stock_movements where type = ?', 'SALE_ISSUE'
      );
      const issuedDocuments = count(
        place,
        'select count(*) from fiscal_documents where document_type = ? and status = ?',
        'INVOICE', 'ISSUED'
      );
      if (shiftPostings !== place.charged.sales * 2 || stockIssues !== place.charged.sales
        || issuedDocuments !== place.charged.sales) {
        throw new Error('PERF_DATASET_MISMATCH: la jornada no dejó los asientos de sus ventas.');
      }
      return { sales: place.charged.sales, issuedDocuments, shiftPostings, stockIssues };
    }
  },
  {
    /**
     * Apertura de caja. Una caja admite un solo turno abierto, así que cada
     * repetición estrena la suya: la caja se crea antes de medir y lo medido es
     * la apertura, no su preparación.
     */
    id: 'cash-shift-open',
    run: async (place, run) => {
      const suffix = String(run).padStart(4, '0');
      const handle = place.runtime.handle;
      await new SqliteUnitOfWork(handle.sqlite).execute(async () => {
        await new DrizzleCashRegisterRepository(handle).save(CashRegister.create({
          id: 'register-shift-' + suffix, name: 'Caja de medición ' + suffix,
          terminalId: 'terminal-001', originNodeId: 'node-001'
        }));
      });
      return timed(async () => {
        const opened = await place.app.inject({
          method: 'POST', url: '/api/v1/cash/shifts',
          headers: { cookie: place.cookie, 'idempotency-key': 'perf-shift-' + suffix },
          payload: {
            cashRegisterId: 'register-shift-' + suffix,
            openingFunds: [
              { paymentMethodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: OPENING_CASH }
            ]
          }
        });
        expect200(opened.statusCode, 'abrir turno');
        if (opened.json<ShiftResponse>().status !== 'OPEN') {
          throw new Error('PERF_DATASET_MISMATCH: la apertura no dejó el turno abierto.');
        }
      });
    },
    /** Cada repetición dejó su turno abierto; el restante es el de la estación. */
    verify: async (place, runs) => {
      const openShifts = count(place, 'select count(*) from shifts where status = ?', 'OPEN');
      if (openShifts !== runs + 1) {
        throw new Error('PERF_DATASET_MISMATCH: faltan turnos abiertos por las repeticiones.');
      }
      return { openShifts };
    }
  }
];

/**
 * Rehidratar el agregado y leer su kardex con historias de distinto tamaño.
 * Es el riesgo que la auditoría de Fase 11 registró sin benchmark: el
 * repositorio carga todos los movimientos y el agregado los reejecuta. Sólo
 * existen en el perfil de crecimiento, que es el que siembra esa historia.
 */
const historyScenarios: readonly Scenario[] = HISTORY_DEPTHS.flatMap((depth) => {
  const label = depthLabel(depth);
  return [
    {
      id: 'stock-rehydrate-' + label,
      run: async (place) => timed(async () => {
        const item = await new DrizzleStockItemRepository(place.runtime.handle)
          .findByProductId(historyProductId(depth));
        if (item === null) throw new Error('Falta la historia de ' + label);
      })
    },
    {
      /**
       * Traer las filas crudas del movimiento, sin agregado. Separa el costo
       * de la consulta del de reejecutar la historia al rehidratar.
       */
      id: 'stock-rows-' + label,
      run: async (place) => timed(async () => {
        const rows = place.runtime.handle.sqlite.prepare(
          'select * from stock_movements where stock_item_id = ? order by aggregate_version'
        ).all('stock-history-' + label);
        if (rows.length !== depth) throw new Error('Historia incompleta: ' + rows.length);
      })
    },
    {
      id: 'kardex-' + label,
      run: async (place) => timed(async () => {
        const response = await place.app.inject({
          method: 'GET',
          url: '/api/v1/inventory/products/' + historyProductId(depth) + '/kardex',
          headers: { cookie: place.cookie }
        });
        expect200(response.statusCode, 'kardex ' + label);
      })
    }
  ];
});

const DESKTOP_METRICS = [
  'desktop-to-login', 'login-to-shell', 'session-recovery'
] as const;
type DesktopMetric = typeof DESKTOP_METRICS[number];
/** Consumo que la terminal reporta de sí misma al terminar su jornada. */
type DesktopUsage = {
  readonly mainCpuUserMicros: number;
  readonly mainCpuSystemMicros: number;
  readonly workingSetBytes: number;
  readonly processCount: number;
};
type DesktopMeasurement = Readonly<Record<DesktopMetric, number>> & {
  readonly usage: DesktopUsage;
};

/**
 * Recursos de la terminal. El CPU acumulado es el del proceso principal:
 * Chromium sólo expone un porcentaje instantáneo por proceso, que no es
 * consumo acumulado y no se publica como si lo fuera. La memoria sí suma
 * todos los procesos de Electron.
 */
type DesktopResources = {
  readonly electron: {
    readonly sample: number;
    readonly medianMainCpuUserMs: number;
    readonly medianMainCpuSystemMs: number;
    readonly medianWorkingSetBytes: number;
    readonly peakWorkingSetBytes: number;
    readonly processCount: number;
  };
  /** Tráfico entre Chromium y Fastify por loopback: renderer y API juntos. */
  readonly traffic: {
    readonly medianBytesRead: number;
    readonly medianBytesWritten: number;
  };
};

const LAN_METRICS = ['lan-delivery', 'lan-application'] as const;
type LanMetric = typeof LAN_METRICS[number];

/**
 * Recursos del ciclo LAN. Los dos tramos corren dentro del arnés, así que su
 * CPU y su memoria se acumulan como en cualquier escenario en proceso; lo
 * propio de este escenario es el tráfico y las dos bases, una por nodo.
 */
type LanResources = {
  readonly cpu: ScenarioResources['cpu'];
  readonly memory: ScenarioResources['memory'];
  readonly traffic: {
    readonly medianDeliveryBytesRead: number;
    readonly medianDeliveryBytesWritten: number;
  };
  readonly database: {
    readonly coordinatorBytes: number;
    readonly terminalBytes: number;
  };
};

const STARTUP_METRICS = [
  'node-first-install', 'node-existing-start', 'node-hot-health'
] as const;
type StartupMetric = typeof STARTUP_METRICS[number];

/**
 * Recursos del escenario de arranque. Los dos arranques son procesos aparte
 * —cada uno se mide a sí mismo— y la base es la misma antes y después del
 * segundo; `node-hot-health` ocurre dentro del segundo proceso y no tiene un
 * consumo propio separable a esta granularidad.
 */
type StartupResources = {
  readonly 'node-first-install': ProcessResources;
  readonly 'node-existing-start': ProcessResources;
  readonly database: {
    readonly firstInstallBytes: number;
    readonly existingBytes: number;
  };
};

const monotonicEpoch = (): number => performance.timeOrigin + performance.now();

/**
 * Construye los dos artefactos que intervienen y resuelve el Electron del
 * workspace desktop. El build queda fuera de toda observación.
 */
const prepareDesktopArtifacts = (root: string): {
  readonly executable: string;
  readonly app: string;
  readonly hashes: { readonly electronMain: string; readonly rendererHtml: string };
} => {
  const pnpm = process.env.npm_execpath;
  if (!pnpm) throw new Error('PERF_PACKAGE_MANAGER_NOT_FOUND');
  execFileSync(process.execPath, [pnpm, '--filter', '@supermarket/desktop', 'build'], {
    cwd: root, stdio: 'ignore', windowsHide: true, timeout: 120_000
  });
  const executable = execFileSync(
    process.execPath,
    [pnpm, '--filter', '@supermarket/desktop', 'exec', 'node', '-e', "process.stdout.write(require('electron'))"],
    { cwd: root, encoding: 'utf8', windowsHide: true }
  ).trim();
  if (!executable) throw new Error('PERF_DESKTOP_ELECTRON_NOT_FOUND');
  const app = join(root, 'apps', 'desktop');
  const hash = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
  return {
    executable,
    app,
    hashes: {
      electronMain: hash(join(app, 'out', 'main', 'index.js')),
      rendererHtml: hash(join(app, 'out', 'renderer', 'index.html'))
    }
  };
};

const validateDesktopMeasurement = (value: unknown): DesktopMeasurement => {
  if (typeof value !== 'object' || value === null) throw new Error('PERF_DESKTOP_RESULT_INVALID');
  for (const metric of DESKTOP_METRICS) {
    const duration = (value as Record<string, unknown>)[metric];
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
      throw new Error('PERF_DESKTOP_RESULT_INVALID');
    }
  }
  const usage = (value as { readonly usage?: Record<string, unknown> }).usage;
  if (typeof usage !== 'object' || usage === null) throw new Error('PERF_DESKTOP_RESULT_INVALID');
  for (const field of ['mainCpuUserMicros', 'mainCpuSystemMicros', 'workingSetBytes', 'processCount']) {
    const reading = usage[field];
    if (typeof reading !== 'number' || !Number.isFinite(reading) || reading <= 0) {
      throw new Error('PERF_DESKTOP_RESULT_INVALID');
    }
  }
  return value as DesktopMeasurement;
};

/**
 * Una repetición usa un perfil Chromium nuevo. Se elimina siempre porque su
 * cookie de sesión no pertenece a los artefactos de rendimiento.
 */
const runDesktop = (
  artifacts: { readonly executable: string; readonly app: string },
  origin: string,
  directory: string,
  run: number
): Promise<DesktopMeasurement> => {
  const profileDirectory = join(directory, 'electron-profile-' + run);
  const profileChild = relative(directory, profileDirectory);
  if (!profileChild || profileChild === '..' || profileChild.startsWith('..' + sep)
    || isAbsolute(profileChild)) {
    throw new Error('PERF_DESKTOP_PROFILE_PATH_INVALID');
  }
  mkdirSync(profileDirectory, { recursive: true });

  return new Promise((resolveRun, rejectRun) => {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      CULLEN_NODE_URL: origin,
      CULLEN_PERFORMANCE_SCENARIO: 'login-and-shell',
      CULLEN_PERFORMANCE_OPERATOR_CODE: OPERATOR.operatorCode,
      CULLEN_PERFORMANCE_PIN: OPERATOR.pin,
      CULLEN_PERFORMANCE_STARTED_AT: String(monotonicEpoch()),
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    };
    delete environment.ELECTRON_RUN_AS_NODE;
    const child = spawn(artifacts.executable, [
      '--disable-gpu', '--no-first-run', '--user-data-dir=' + profileDirectory, artifacts.app
    ], {
      cwd: artifacts.app,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let settled = false;
    let timedOut = false;
    let hardTimeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (hardTimeout) clearTimeout(hardTimeout);
      try {
        rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        rejectRun(new Error('PERF_DESKTOP_PROFILE_CLEANUP_FAILED'));
        return;
      }
      action();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
      hardTimeout = setTimeout(
        () => finish(() => rejectRun(new Error('PERF_DESKTOP_TIMEOUT'))),
        5_000
      );
    }, 45_000);
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    /** stderr se drena, pero nunca se publica: Chromium puede incluir rutas del perfil. */
    child.stderr?.resume();
    child.once('error', () => finish(() => rejectRun(new Error('PERF_DESKTOP_START_FAILED'))));
    child.once('exit', (code) => finish(() => {
      if (timedOut) return rejectRun(new Error('PERF_DESKTOP_TIMEOUT'));
      const line = /^CULLEN_PERF_RESULT (\{.+\})$/m.exec(stdout);
      if (code !== 0 || !line) return rejectRun(new Error('PERF_DESKTOP_RUN_FAILED'));
      try {
        resolveRun(validateDesktopMeasurement(JSON.parse(line[1]!)));
      } catch {
        rejectRun(new Error('PERF_DESKTOP_RESULT_INVALID'));
      }
    }));
  });
};

const revision = () => {
  const git = (args: readonly string[]): string => execFileSync('git', args, {
    encoding: 'utf8', windowsHide: true
  }).trim();
  const harness = createHash('sha256');
  for (const path of [
    fileURLToPath(import.meta.url),
    resolve(dirname(fileURLToPath(import.meta.url)), 'lan-cycle.ts'),
    resolve(dirname(fileURLToPath(import.meta.url)), 'startup.ts'),
    resolve(dirname(fileURLToPath(import.meta.url)), 'startup-run.ts'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../desktop/src/main/index.ts'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../desktop/src/main/performance-run.ts')
  ]) {
    harness.update(path).update(readFileSync(path));
  }
  return {
    commit: git(['rev-parse', 'HEAD']),
    dirty: git(['status', '--porcelain']).length > 0,
    harnessSha256: harness.digest('hex')
  };
};

const main = async (): Promise<void> => {
  const { sample } = options;
  /** Repeticiones de warm-up realmente consumidas, por escenario. */
  const warmupRuns: Record<string, number> = {};
  const available = profile() === 'crecimiento'
    ? [...scenarios, ...historyScenarios]
    : scenarios.filter(({ id }) => id !== 'report-sales');
  const availableIds = [
    'node-startup',
    'lan-cycle',
    ...(process.platform === 'win32' ? ['login-and-shell'] : []),
    ...available.map(({ id }) => id)
  ];
  const only = options.scenarios.length > 0 ? options.scenarios : availableIds;
  if (only.some((id) => !availableIds.includes(id))) invalidArgument();
  if (only.length > 1) {
    /** Un proceso por escenario; las series nunca compiten entre sí. */
    for (const id of only) {
      execFileSync(process.execPath, [
        ...process.execArgv, fileURLToPath(import.meta.url), '--profile', profile(),
        '--sample', String(sample),
        ...(options.warmup.mode === 'fixed' ? ['--warmup', String(options.warmup.runs)] : []),
        /** El hijo revalida la estación: una serie larga puede ensuciarse a mitad. */
        '--max-load', String(options.maxLoadPercent),
        '--scenario', id,
        ...(profile() === 'crecimiento' ? ['--depths', HISTORY_DEPTHS.join(',')] : [])
      ], { stdio: 'inherit', windowsHide: true });
    }
    return;
  }
  /**
   * El manifiesto exige medir sin nada compitiendo por la estación. Se
   * comprueba antes de sembrar: una serie larga sobre una máquina ocupada mide
   * otro nodo, y descubrirlo comparando medianas a mano ya costó un BEFORE
   * entero el 2026-09-16.
   */
  const beforeBusyPercent = await measureSystemLoad();
  if (beforeBusyPercent > options.maxLoadPercent) {
    throw new Error(
      'PERF_STATION_BUSY: la estación está al ' + beforeBusyPercent + ' % y el límite es ' +
      options.maxLoadPercent + ' %. Cierra lo que compita por CPU antes de medir.'
    );
  }

  const source = revision();
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const root = resolve(process.cwd(), '../..');
  const directory = join(root, '.perf', runId);
  mkdirSync(directory, { recursive: true });

  const observations: Observation[] = [];
  const summaries: Summary[] = [];
  /** Evidencia de lo que cada escenario dejó asentado, por escenario. */
  const checks: Record<string, Record<string, number>> = {};
  /** Recursos consumidos por cada escenario seleccionado, medidos aparte del tiempo. */
  const resources: Record<
    string, ScenarioResources | StartupResources | LanResources | DesktopResources
  > = {};
  const selected = (id: string): boolean => only.length === 0 || only.includes(id);

  let startupArtifactSha256: string | undefined;
  if (selected('node-startup')) {
    const measured = new Map<StartupMetric, number[]>(
      STARTUP_METRICS.map((metric) => [metric, []])
    );
    const artifact = await prepareStartupArtifact();
    startupArtifactSha256 = artifact.sha256;
    const firstInstallUsages: StartupProcessUsage[] = [];
    const existingUsages: StartupProcessUsage[] = [];
    const databaseSizes: { firstInstallBytes: number[]; existingBytes: number[] } = {
      firstInstallBytes: [], existingBytes: []
    };
    let warmed = 0;
    try {
      warmed = await warmUp(async (run) => {
        const result = await measureStartup(directory, artifact.path, run);
        return result.firstInstallMs + result.existingDatabaseMs + result.hotHealthMs;
      });
      for (let index = 0; index < sample; index += 1) {
        const result = await measureStartup(directory, artifact.path, warmed + index);
        firstInstallUsages.push(result.firstInstallUsage);
        existingUsages.push(result.existingDatabaseUsage);
        databaseSizes.firstInstallBytes.push(result.firstInstallDatabaseBytes);
        databaseSizes.existingBytes.push(result.existingDatabaseBytes);
        const values: Readonly<Record<StartupMetric, number>> = {
          'node-first-install': result.firstInstallMs,
          'node-existing-start': result.existingDatabaseMs,
          'node-hot-health': result.hotHealthMs
        };
        for (const metric of STARTUP_METRICS) {
          measured.get(metric)!.push(values[metric]);
          observations.push({ scenario: metric, run: index, ms: values[metric] });
        }
      }
    } finally {
      removeStartupArtifact(artifact);
    }
    warmupRuns['node-startup'] = warmed;
    checks['node-startup'] = {
      firstInstallProcesses: warmed + sample,
      existingDatabaseProcesses: warmed + sample,
      hotHealthChecks: warmed + sample
    };
    /** La base es la misma en toda repetición; su tamaño es el de una instalación. */
    resources['node-startup'] = {
      'node-first-install': summarizeProcessResources(firstInstallUsages),
      'node-existing-start': summarizeProcessResources(existingUsages),
      database: {
        firstInstallBytes: medianBytes(databaseSizes.firstInstallBytes),
        existingBytes: medianBytes(databaseSizes.existingBytes)
      }
    };
    for (const metric of STARTUP_METRICS) summaries.push(summarize(metric, measured.get(metric)!));
  }

  let desktopMeasured = false;
  let desktopArtifactHashes: { readonly electronMain: string; readonly rendererHtml: string } | undefined;
  if (selected('login-and-shell')) {
    desktopMeasured = true;
    const artifacts = prepareDesktopArtifacts(root);
    desktopArtifactHashes = artifacts.hashes;
    const rendererPath = join(artifacts.app, 'out', 'renderer');
    const databasePath = join(directory, 'login-and-shell.sqlite');
    const previousRendererPath = process.env.RENDERER_DIST_PATH;
    let place: Station | undefined;
    const measured = new Map<DesktopMetric, number[]>(
      DESKTOP_METRICS.map((metric) => [metric, []])
    );
    try {
      process.env.RENDERER_DIST_PATH = rendererPath;
      place = await station(databasePath);
      if (previousRendererPath === undefined) delete process.env.RENDERER_DIST_PATH;
      else process.env.RENDERER_DIST_PATH = previousRendererPath;
      /** Renderer y API comparten origen: el contador ve la terminal entera. */
      const traffic = countTraffic(place.app.server);
      const origin = await place.app.listen({ host: '127.0.0.1', port: 0 });
      const usages: DesktopUsage[] = [];
      const bytesRead: number[] = [];
      const bytesWritten: number[] = [];
      const warmed = await warmUp(async (run) => {
        const result = await runDesktop(artifacts, origin, directory, run);
        return DESKTOP_METRICS.reduce((total, metric) => total + result[metric], 0);
      });
      warmupRuns['login-and-shell'] = warmed;
      for (let index = 0; index < sample; index += 1) {
        const before = traffic();
        const result = await runDesktop(artifacts, origin, directory, warmed + index);
        const after = traffic();
        usages.push(result.usage);
        bytesRead.push(after.bytesRead - before.bytesRead);
        bytesWritten.push(after.bytesWritten - before.bytesWritten);
        for (const metric of DESKTOP_METRICS) {
          measured.get(metric)!.push(result[metric]);
          observations.push({ scenario: metric, run: index, ms: result[metric] });
        }
      }
      checks['login-and-shell'] = {
        loginForms: warmed + sample,
        authorizedShells: warmed + sample,
        recoveredSessions: warmed + sample
      };
      resources['login-and-shell'] = {
        electron: {
          sample: usages.length,
          medianMainCpuUserMs: microsToMs(median(usages.map((entry) => entry.mainCpuUserMicros))),
          medianMainCpuSystemMs: microsToMs(median(usages.map((entry) => entry.mainCpuSystemMicros))),
          medianWorkingSetBytes: medianBytes(usages.map((entry) => entry.workingSetBytes)),
          peakWorkingSetBytes: Math.max(...usages.map((entry) => entry.workingSetBytes)),
          processCount: medianBytes(usages.map((entry) => entry.processCount))
        },
        traffic: {
          medianBytesRead: medianBytes(bytesRead),
          medianBytesWritten: medianBytes(bytesWritten)
        }
      };
    } finally {
      if (previousRendererPath === undefined) delete process.env.RENDERER_DIST_PATH;
      else process.env.RENDERER_DIST_PATH = previousRendererPath;
      await place?.close();
      rmSync(databasePath, { force: true });
      rmSync(databasePath + '-shm', { force: true });
      rmSync(databasePath + '-wal', { force: true });
    }
    for (const metric of DESKTOP_METRICS) summaries.push(summarize(metric, measured.get(metric)!));
  }

  let lanMeasured = false;
  if (selected('lan-cycle')) {
    lanMeasured = true;
    const benchmark = new LanCycleBenchmark(directory);
    const measured = new Map<LanMetric, number[]>(LAN_METRICS.map((metric) => [metric, []]));
    const lanChecks = {
      interruptedDeliveries: 0,
      durableReceipts: 0,
      appliedEvents: 0,
      authoritativeMovements: 0
    };
    const deliveryBytesRead: number[] = [];
    const deliveryBytesWritten: number[] = [];
    const coordinatorBytes: number[] = [];
    const terminalBytes: number[] = [];
    const countCycle = (result: Awaited<ReturnType<LanCycleBenchmark['run']>>): void => {
      lanChecks.interruptedDeliveries += result.interruptedDeliveries;
      lanChecks.durableReceipts += result.durableReceipts;
      lanChecks.appliedEvents += result.appliedEvents;
      lanChecks.authoritativeMovements += result.authoritativeMovements;
    };
    const warmed = await warmUp(async (run) => {
      const result = await benchmark.run(run);
      countCycle(result);
      return result.deliveryMs + result.applicationMs;
    });
    warmupRuns['lan-cycle'] = warmed;
    /** La línea base se toma ya caliente: antes del warm-up mediría otro proceso. */
    const usage = recordResources();
    for (let index = 0; index < sample; index += 1) {
      const result = await benchmark.run(warmed + index);
      countCycle(result);
      const memory = process.memoryUsage();
      /** Los dos tramos de una repetición suman: ambos son parte de lo medido. */
      usage.add(result.deliveryCpu, memory);
      usage.add(result.applicationCpu, memory);
      deliveryBytesRead.push(result.deliveryTraffic.bytesRead);
      deliveryBytesWritten.push(result.deliveryTraffic.bytesWritten);
      coordinatorBytes.push(result.coordinatorDatabaseBytes);
      terminalBytes.push(result.terminalDatabaseBytes);
      const values: Readonly<Record<LanMetric, number>> = {
        'lan-delivery': result.deliveryMs,
        'lan-application': result.applicationMs
      };
      const cpu: Readonly<Record<LanMetric, NodeJS.CpuUsage>> = {
        'lan-delivery': result.deliveryCpu,
        'lan-application': result.applicationCpu
      };
      for (const metric of LAN_METRICS) {
        measured.get(metric)!.push(values[metric]);
        observations.push({
          scenario: metric, run: index, ms: values[metric],
          cpuUserMs: microsToMs(cpu[metric].user), cpuSystemMs: microsToMs(cpu[metric].system),
          rssBytes: memory.rss
        });
      }
    }
    checks['lan-cycle'] = lanChecks;
    const consumed = usage.close();
    resources['lan-cycle'] = {
      cpu: consumed.cpu,
      memory: consumed.memory,
      traffic: {
        medianDeliveryBytesRead: medianBytes(deliveryBytesRead),
        medianDeliveryBytesWritten: medianBytes(deliveryBytesWritten)
      },
      /** Bases efímeras: cada repetición estrena las suyas y las borra al salir. */
      database: {
        coordinatorBytes: medianBytes(coordinatorBytes),
        terminalBytes: medianBytes(terminalBytes)
      }
    };
    for (const metric of LAN_METRICS) summaries.push(summarize(metric, measured.get(metric)!));
  }

  const inProcess = available.filter((scenario) => selected(scenario.id));
  if (inProcess.length > 0) {
    for (const scenario of inProcess) {
      /** Base propia y recién migrada por escenario: ninguno hereda el estado del anterior. */
      const path = join(directory, scenario.id + '.sqlite');
      let place: Station | undefined;
      const measured: number[] = [];
      try {
        place = await station(path);
        const warmed = await warmUp((run) => scenario.run(place!, run));
        warmupRuns[scenario.id] = warmed;
        /** La línea base se toma ya caliente, con el warm-up fuera. */
        const usage = recordResources(path);
        for (let index = 0; index < sample; index += 1) {
          const ms = await scenario.run(place, warmed + index);
          const cpu = lastIntervalCpu;
          const memory = process.memoryUsage();
          usage.add(cpu, memory);
          measured.push(ms);
          observations.push({
            scenario: scenario.id, run: index, ms,
            cpuUserMs: microsToMs(cpu.user), cpuSystemMs: microsToMs(cpu.system),
            rssBytes: memory.rss
          });
        }
        if (scenario.verify) checks[scenario.id] = await scenario.verify(place, warmed + sample);
        /** Antes del cierre: después, el WAL ya se consolidó y no se puede leer. */
        resources[scenario.id] = usage.close();
      } finally {
        await place?.close();
        rmSync(path, { force: true });
        rmSync(path + '-shm', { force: true });
        rmSync(path + '-wal', { force: true });
      }
      summaries.push(summarize(scenario.id, measured));
    }
  }

  /**
   * La ocupación al cerrar dice si algo apareció durante la serie. No aborta
   * —la medición ya ocurrió y descartarla perdería evidencia—, pero queda
   * publicada para que nadie lea como línea base una serie que compitió.
   */
  const afterBusyPercent = await measureSystemLoad();

  const environment = {
    commit: source.commit.slice(0, 7),
    revision: source,
    protocolVersion: 2,
    processId: process.pid,
    fiscalMode: 'SIMULATION',
    host: hostname(),
    platform: platform() + ' ' + release(),
    cpu: cpus()[0]?.model.trim() ?? 'desconocido',
    cores: cpus().length,
    ramGiB: Math.round(totalmem() / 1024 / 1024 / 1024),
    node: process.version,
    ...(startupArtifactSha256 ? { startupArtifactSha256 } : {}),
    ...(desktopMeasured ? {
      renderer: 'electron', transport: 'http-loopback', desktopArtifactHashes
    } : {}),
    ...(lanMeasured ? { transport: 'https-mtls', nodes: 2 } : {}),
    /**
     * Las repeticiones de warm-up son parte del protocolo reproducible: en modo
     * automático cada escenario consume las suyas y aquí quedan registradas.
     */
    warmup: options.warmup.mode === 'fixed'
      ? { mode: 'fixed' as const, runs: options.warmup.runs }
      : {
        mode: 'auto' as const,
        runs: only.length === 1 ? warmupRuns[only[0]!] ?? 0 : warmupRuns,
        minRuns: WARMUP_MIN_RUNS,
        maxRuns: WARMUP_MAX_RUNS,
        budgetMs: WARMUP_BUDGET_MS
      },
    sample,
    systemLoad: {
      beforeBusyPercent,
      afterBusyPercent,
      limitPercent: options.maxLoadPercent,
      cores: cpus().length
    },
    profile: profile(),
    products: lanMeasured ? 1 : inProcess.length === 0 && !desktopMeasured ? 0 : productCount(),
    completedSales: (inProcess.length > 0 || desktopMeasured) && profile() === 'crecimiento'
      ? SEEDED_SALES
      : 0,
    reportPeriod,
    inventoryAsOf,
    historyDepths: profile() === 'crecimiento' ? HISTORY_DEPTHS : [],
    checks,
    measuredAt: new Date().toISOString()
  };
  const finalRevision = revision();
  if (finalRevision.commit !== source.commit || finalRevision.harnessSha256 !== source.harnessSha256) {
    throw new Error('PERF_REVISION_CHANGED: el código cambió durante la serie.');
  }
  source.dirty ||= finalRevision.dirty;
  writeFileSync(
    join(directory, 'observations.json'),
    JSON.stringify({ environment, observations, resources }, null, 2)
  );
  writeFileSync(
    join(directory, 'summary.json'),
    JSON.stringify({ environment, summaries, resources }, null, 2)
  );

  process.stdout.write('\nSerie ' + runId + ' sobre ' + environment.commit +
    ' · SIMULACION · perfil ' + environment.profile +
    ' · warm-up ' + (options.warmup.mode === 'fixed'
      ? String(options.warmup.runs)
      : Object.values(warmupRuns).join('/') + ' (auto)') +
    ' · muestra ' + sample +
    (source.dirty ? ' · cambios pendientes (no BEFORE)' : '') + '\n\n');
  process.stdout.write('escenario            mediana      p90      mín      máx   IQR rel.\n');
  for (const summary of summaries) {
    process.stdout.write(
      summary.scenario.padEnd(20) +
      String(summary.medianMs).padStart(8) +
      String(summary.p90Ms ?? '—').padStart(9) +
      String(summary.minMs).padStart(9) +
      String(summary.maxMs).padStart(9) +
      (' ' + (summary.relativeIqr * 100).toFixed(1) + ' %').padStart(11) + '\n'
    );
  }
  const measuredResources = Object.entries(resources);
  if (measuredResources.length > 0) {
    const mib = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1) + ' MiB';
    /**
     * Un escenario en proceso suma la CPU de su serie y deja ver el costo del
     * instrumento; uno fuera de proceso reporta la mediana de cada proceso
     * entero, donde no hay instrumento que descontar.
     */
    process.stdout.write('\nescenario             CPU serie   instrumento   RSS pico   base\n');
    const line = (
      scenario: string, cpu: string, instrument: string, rss: number, database: number | undefined
    ): void => {
      process.stdout.write(
        scenario.padEnd(20) + cpu.padStart(10) + instrument.padStart(14) +
        mib(rss).padStart(11) + (database === undefined ? '—' : mib(database)).padStart(11) + '\n'
      );
    };
    for (const [scenario, usage] of measuredResources) {
      if ('electron' in usage) {
        const { electron } = usage;
        line(
          scenario, (electron.medianMainCpuUserMs + electron.medianMainCpuSystemMs).toFixed(0) + ' ms',
          '—', electron.peakWorkingSetBytes, undefined
        );
        process.stdout.write(
          '  ' + electron.processCount + ' procesos Electron · loopback: ' +
          usage.traffic.medianBytesRead + ' B recibidos, ' +
          usage.traffic.medianBytesWritten + ' B enviados (mediana)\n'
        );
        continue;
      }
      if ('traffic' in usage) {
        const measuredCpu = usage.cpu.measuredUserMs + usage.cpu.measuredSystemMs;
        const instrumentCpu = usage.cpu.processUserMs + usage.cpu.processSystemMs - measuredCpu;
        line(
          scenario, measuredCpu.toFixed(0) + ' ms', instrumentCpu.toFixed(0) + ' ms',
          usage.memory.peakRssBytes,
          usage.database.coordinatorBytes + usage.database.terminalBytes
        );
        process.stdout.write(
          '  entrega: ' + usage.traffic.medianDeliveryBytesRead + ' B recibidos, ' +
          usage.traffic.medianDeliveryBytesWritten + ' B enviados (mediana, cifrado incluido)\n'
        );
        continue;
      }
      if ('cpu' in usage) {
        const measuredCpu = usage.cpu.measuredUserMs + usage.cpu.measuredSystemMs;
        const instrumentCpu = usage.cpu.processUserMs + usage.cpu.processSystemMs - measuredCpu;
        line(
          scenario, measuredCpu.toFixed(0) + ' ms', instrumentCpu.toFixed(0) + ' ms',
          usage.memory.peakRssBytes, usage.database?.finalBytes
        );
        continue;
      }
      for (const metric of ['node-first-install', 'node-existing-start'] as const) {
        const child = usage[metric];
        line(
          metric, (child.medianCpuUserMs + child.medianCpuSystemMs).toFixed(0) + ' ms', '—',
          child.peakRssBytes,
          metric === 'node-first-install'
            ? usage.database.firstInstallBytes
            : usage.database.existingBytes
        );
      }
    }
  }
  process.stdout.write('\nCrudos en ' + directory + '\n');
};

await main();
