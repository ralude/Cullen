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
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, totalmem, cpus, platform, release } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  Barcode, Category, CashRegister, PaymentMethod, Product, StockItem, UnitOfMeasure
} from '@supermarket/core';
import {
  DrizzleCashRegisterRepository, DrizzleCategoryRepository, DrizzlePaymentMethodRepository,
  DrizzleProductRepository, DrizzleStockItemRepository, DrizzleUnitOfMeasureRepository,
  SqliteOperationalPolicyWriter, SqliteUnitOfWork
} from '@supermarket/driver-db';
import { Money, Quantity, TaxRate } from '@supermarket/shared';
import { buildApp } from '../src/app.ts';
import { ADMIN_PERMISSIONS, createSecurityRuntime, type SecurityRuntime } from '../src/runtime.ts';

type Observation = { readonly scenario: string; readonly run: number; readonly ms: number };

type Summary = {
  readonly scenario: string;
  readonly sample: number;
  readonly medianMs: number;
  readonly p90Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly iqrMs: number;
  /** Margen de ruido: un cambio que no lo supere es fluctuación, no mejora. */
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

const DEFAULT_HISTORY_DEPTHS = [100, 1_000, 10_000];

/** `--depths 100,5000` reemplaza las profundidades por omisión. */
const HISTORY_DEPTHS: readonly number[] = ((): readonly number[] => {
  const at = process.argv.indexOf('--depths');
  if (at < 0) return DEFAULT_HISTORY_DEPTHS;
  const parsed = (process.argv[at + 1] ?? '').split(',')
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  return parsed.length > 0 ? parsed : DEFAULT_HISTORY_DEPTHS;
})();

const depthLabel = (depth: number): string =>
  depth >= 1_000 && depth % 1_000 === 0 ? depth / 1_000 + 'k' : String(depth);

const historyProductId = (depth: number): string => 'history-' + depthLabel(depth);
const OPERATOR = { operatorCode: 'PERF01', displayName: 'Medición', pin: '123456' };

const profile = (): 'habitual' | 'crecimiento' => {
  const at = process.argv.indexOf('--profile');
  return process.argv[at + 1] === 'crecimiento' ? 'crecimiento' : 'habitual';
};

const argument = (name: string, fallback: number): number => {
  const at = process.argv.indexOf('--' + name);
  if (at < 0) return fallback;
  const value = Number.parseInt(process.argv[at + 1] ?? '', 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};

const requested = (): readonly string[] => process.argv
  .flatMap((value, at) => value === '--scenario' ? [process.argv[at + 1] ?? ''] : [])
  .filter((value) => value.length > 0);

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
    p90Ms: Number(quantile(sorted, 0.9).toFixed(3)),
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

type Station = {
  readonly runtime: SecurityRuntime;
  readonly app: ReturnType<typeof buildApp>;
  readonly cookie: string;
  readonly shiftId: string;
  close(): Promise<void>;
};

/** Estación lista para operar: base migrada, semilla, sesión y turno abierto. */
const station = async (databasePath: string): Promise<Station> => {
  const runtime = createSecurityRuntime(databasePath, {
    terminalId: 'terminal-001', originNodeId: 'node-001'
  });
  const provisioned = await runtime.provisionInitialAdmin.execute({
    ...OPERATOR, permissions: ADMIN_PERMISSIONS
  });
  if (!provisioned.ok) throw new Error('No se pudo provisionar el administrador de medición.');
  await seed(runtime);
  if (profile() === 'crecimiento') await seedHistory(runtime);
  const app = buildApp(runtime.dependencies, { logDestination: discard });
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
      openingFunds: [{ paymentMethodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: 50_000 }]
    }
  });
  if (opened.statusCode !== 201) throw new Error('Turno rechazado: ' + opened.statusCode + ' ' + opened.body);
  return {
    runtime, app, cookie: session,
    shiftId: (opened.json() as { readonly id: string }).id,
    close: async (): Promise<void> => { await app.close(); runtime.handle.close(); }
  };
};

type Scenario = {
  readonly id: string;
  /** Prepara lo que el escenario necesita y devuelve la medición de una repetición. */
  readonly run: (station: Station, run: number) => Promise<number>;
};

const timed = async (action: () => Promise<void>): Promise<number> => {
  const started = performance.now();
  await action();
  return performance.now() - started;
};

const expect200 = (status: number, what: string): void => {
  if (status !== 200 && status !== 201) throw new Error(what + ' devolvió ' + status);
};

const scenarios: readonly Scenario[] = [
  {
    id: 'catalog-barcode',
    run: async (place, run) => {
      const suffix = String((run % PRODUCTS) + 1).padStart(4, '0');
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
    })
  },
  {
    id: 'sale-journey',
    run: async (place, run) => {
      const suffix = String((run % PRODUCTS) + 1).padStart(4, '0');
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
        /** Cobro mixto: la mitad en efectivo y el resto con el método gravado. */
        const cash = Math.floor(sale.totalMinorUnits / 2);
        const commercial = sale.totalMinorUnits - cash;
        const card = commercial + Math.round(commercial * 300 / 10_000);
        const paid = await place.app.inject({
          method: 'POST', url: '/api/v1/sales/' + saleId + '/payments',
          headers: { cookie: place.cookie, 'idempotency-key': key('pay') },
          payload: {
            payments: [
              { methodCode: 'CASH_USD', currencyCode: 'USD', amountMinorUnits: cash },
              { methodCode: 'CARD_USD', currencyCode: 'USD', amountMinorUnits: card }
            ]
          }
        });
        expect200(paid.statusCode, 'registrar pagos');
        const completed = await place.app.inject({
          method: 'POST', url: '/api/v1/sales/' + saleId + '/complete',
          headers: { cookie: place.cookie, 'idempotency-key': key('complete') }
        });
        expect200(completed.statusCode, 'completar venta');
      });
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

/**
 * Arranque frío del nodo: migrar una base vacía, componer el runtime y dejar la
 * aplicación lista. Se mide aparte porque cada repetición necesita su base.
 */
const coldStart = async (directory: string, run: number): Promise<number> => {
  const path = join(directory, 'cold-' + run + '.sqlite');
  const started = performance.now();
  const runtime = createSecurityRuntime(path, {
    terminalId: 'terminal-001', originNodeId: 'node-001'
  });
  const app = buildApp(runtime.dependencies, { logDestination: discard });
  await app.ready();
  const elapsed = performance.now() - started;
  await app.close();
  runtime.handle.close();
  rmSync(path, { force: true });
  return elapsed;
};

const commit = (): string => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch { return 'desconocido'; }
};

const main = async (): Promise<void> => {
  const warmup = argument('warmup', 5);
  const sample = argument('sample', 30);
  const only = requested();
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const root = resolve(process.cwd(), '../..');
  const directory = join(root, '.perf', runId);
  mkdirSync(directory, { recursive: true });

  const observations: Observation[] = [];
  const summaries: Summary[] = [];
  const selected = (id: string): boolean => only.length === 0 || only.includes(id);

  if (selected('node-cold-start')) {
    const measured: number[] = [];
    for (let run = 0; run < warmup + sample; run += 1) {
      const ms = await coldStart(directory, run);
      if (run < warmup) continue;
      measured.push(ms);
      observations.push({ scenario: 'node-cold-start', run: run - warmup, ms });
    }
    summaries.push(summarize('node-cold-start', measured));
  }

  const available = profile() === 'crecimiento' ? [...scenarios, ...historyScenarios] : scenarios;
  const inProcess = available.filter((scenario) => selected(scenario.id));
  if (inProcess.length > 0) {
    for (const scenario of inProcess) {
      /** Base propia y recién migrada por escenario: ninguno hereda el estado del anterior. */
      const path = join(directory, scenario.id + '.sqlite');
      const place = await station(path);
      const measured: number[] = [];
      try {
        for (let run = 0; run < warmup + sample; run += 1) {
          const ms = await scenario.run(place, run);
          if (run < warmup) continue;
          measured.push(ms);
          observations.push({ scenario: scenario.id, run: run - warmup, ms });
        }
      } finally {
        await place.close();
        rmSync(path, { force: true });
        rmSync(path + '-shm', { force: true });
        rmSync(path + '-wal', { force: true });
      }
      summaries.push(summarize(scenario.id, measured));
    }
  }

  const environment = {
    commit: commit(),
    host: hostname(),
    platform: platform() + ' ' + release(),
    cpu: cpus()[0]?.model.trim() ?? 'desconocido',
    cores: cpus().length,
    ramGiB: Math.round(totalmem() / 1024 / 1024 / 1024),
    node: process.version,
    warmup,
    sample,
    profile: profile(),
    products: PRODUCTS,
    historyDepths: profile() === 'crecimiento' ? HISTORY_DEPTHS : [],
    measuredAt: new Date().toISOString()
  };
  writeFileSync(join(directory, 'observations.json'), JSON.stringify({ environment, observations }, null, 2));
  writeFileSync(join(directory, 'summary.json'), JSON.stringify({ environment, summaries }, null, 2));

  process.stdout.write('\nSerie ' + runId + ' sobre ' + environment.commit +
    ' · perfil ' + environment.profile + ' · warm-up ' + warmup + ' · muestra ' + sample + '\n\n');
  process.stdout.write('escenario            mediana      p90      mín      máx   IQR rel.\n');
  for (const summary of summaries) {
    process.stdout.write(
      summary.scenario.padEnd(20) +
      String(summary.medianMs).padStart(8) +
      String(summary.p90Ms).padStart(9) +
      String(summary.minMs).padStart(9) +
      String(summary.maxMs).padStart(9) +
      (' ' + (summary.relativeIqr * 100).toFixed(1) + ' %').padStart(11) + '\n'
    );
  }
  process.stdout.write('\nCrudos en ' + directory + '\n');
};

await main();
