import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { stdout } from 'node:process';
import { Barcode, Category, Product, UnitOfMeasure } from '@supermarket/core';
import {
  applyMigrations,
  DrizzleCategoryRepository,
  DrizzleProductRepository,
  DrizzleUnitOfMeasureRepository,
  openDatabase,
  SqliteUnitOfWork,
  type DatabaseHandle
} from '@supermarket/driver-db';
import { Money, TaxRate } from '@supermarket/shared';

/**
 * `basic` son los cinco productos de siempre, de los que dependen el
 * quickstart, la demo publicada y el manual. `extended` es un supermercado
 * venezolano: canasta básica exenta, limpieza, cuidado personal y productos
 * por peso.
 */
export type ExampleCatalog = 'basic' | 'extended';

export type ExampleProductSeedOptions = {
  readonly currencyCode: string;
  readonly taxRateBasisPoints: number;
  readonly catalog?: ExampleCatalog;
};

export type ExampleProductSeedResult = {
  readonly categories: number;
  readonly unitsOfMeasure: number;
  readonly products: number;
};

type ProductDefinition = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly categoryId: string;
  readonly barcodeId: string;
  readonly barcode: string;
  readonly priceMinorUnits: number;
  readonly priceHistoryId: string;
  readonly eventId: string;
};

const RECORDED_AT = new Date('2026-09-02T00:00:00.000Z');
const RECORDED_BY = 'seed:example-products';
const UNIT_ID = '0199a0f0-0000-7000-8000-000000000010';

const CATEGORIES = [
  Category.create({
    id: '0199a0f0-0000-7000-8000-000000000001',
    name: 'Alimentos básicos'
  }),
  Category.create({
    id: '0199a0f0-0000-7000-8000-000000000002',
    name: 'Bebidas'
  }),
  Category.create({
    id: '0199a0f0-0000-7000-8000-000000000003',
    name: 'Lácteos'
  })
] as const;

const UNIT = UnitOfMeasure.create({
  id: UNIT_ID,
  code: 'UN',
  name: 'Unidad',
  quantityScale: 0
});

const PRODUCT_DEFINITIONS: readonly ProductDefinition[] = [
  {
    id: '0199a0f0-0000-7000-8000-000000001001',
    name: 'Arroz blanco 1 kg',
    description: 'Paquete de arroz blanco de 1 kilogramo',
    categoryId: CATEGORIES[0].id,
    barcodeId: '0199a0f0-0000-7000-8000-000000002001',
    barcode: 'DEMOARROZ001',
    priceMinorUnits: 180,
    priceHistoryId: '0199a0f0-0000-7000-8000-000000003001',
    eventId: '0199a0f0-0000-7000-8000-000000004001'
  },
  {
    id: '0199a0f0-0000-7000-8000-000000001002',
    name: 'Harina de maíz 1 kg',
    description: 'Paquete de harina de maíz precocida de 1 kilogramo',
    categoryId: CATEGORIES[0].id,
    barcodeId: '0199a0f0-0000-7000-8000-000000002002',
    barcode: 'DEMOHARINA001',
    priceMinorUnits: 140,
    priceHistoryId: '0199a0f0-0000-7000-8000-000000003002',
    eventId: '0199a0f0-0000-7000-8000-000000004002'
  },
  {
    id: '0199a0f0-0000-7000-8000-000000001003',
    name: 'Café molido 250 g',
    description: 'Paquete de café molido de 250 gramos',
    categoryId: CATEGORIES[0].id,
    barcodeId: '0199a0f0-0000-7000-8000-000000002003',
    barcode: 'DEMOCAFE001',
    priceMinorUnits: 450,
    priceHistoryId: '0199a0f0-0000-7000-8000-000000003003',
    eventId: '0199a0f0-0000-7000-8000-000000004003'
  },
  {
    id: '0199a0f0-0000-7000-8000-000000001004',
    name: 'Agua mineral 1 L',
    description: 'Botella de agua mineral de 1 litro',
    categoryId: CATEGORIES[1].id,
    barcodeId: '0199a0f0-0000-7000-8000-000000002004',
    barcode: 'DEMOAGUA001',
    priceMinorUnits: 100,
    priceHistoryId: '0199a0f0-0000-7000-8000-000000003004',
    eventId: '0199a0f0-0000-7000-8000-000000004004'
  },
  {
    id: '0199a0f0-0000-7000-8000-000000001005',
    name: 'Leche UHT 1 L',
    description: 'Envase de leche de larga duración de 1 litro',
    categoryId: CATEGORIES[2].id,
    barcodeId: '0199a0f0-0000-7000-8000-000000002005',
    barcode: 'DEMOLECHE001',
    priceMinorUnits: 250,
    priceHistoryId: '0199a0f0-0000-7000-8000-000000003005',
    eventId: '0199a0f0-0000-7000-8000-000000004005'
  }
];

/** Identificadores fijos del mismo esquema que los cinco productos básicos. */
const seedId = (sequence: number): string =>
  `0199a0f0-0000-7000-8000-${String(sequence).padStart(12, '0')}`;

const EXTENDED_CATEGORIES = [
  Category.create({ id: seedId(4), name: 'Limpieza' }),
  Category.create({ id: seedId(5), name: 'Cuidado personal' }),
  Category.create({ id: seedId(6), name: 'Charcutería' }),
  Category.create({ id: seedId(7), name: 'Frutas y verduras' })
] as const;

const KILOGRAM = UnitOfMeasure.create({
  id: seedId(11),
  code: 'KG',
  name: 'Kilogramo',
  quantityScale: 3
});

/**
 * Canasta básica exenta de IVA en el catálogo ampliado. **Es ilustrativa**:
 * sirve para que la demo tenga líneas exentas y gravadas, no para decidir qué
 * está exento; eso lo confirma un asesor tributario.
 */
const ILLUSTRATIVE_EXEMPT_BARCODES = new Set([
  'DEMOARROZ001', 'DEMOHARINA001', 'DEMOLECHE001', 'DEMOPASTA001', 'DEMOCARAOTAS001',
  'DEMOSAL001', 'DEMOHUEVOS001', 'DEMOQUESO001', 'DEMOTOMATE001', 'DEMOCEBOLLA001',
  'DEMOPAPA001', 'DEMOPLATANO001'
]);

type ExtendedEntry = readonly [
  name: string, description: string, categoryId: string, barcode: string,
  priceMinorUnits: number, byWeight?: boolean
];

/** Precios en unidades menores; en los productos por peso, por kilogramo. */
const EXTENDED_ENTRIES: readonly ExtendedEntry[] = [
  ['Pasta larga 1 kg', 'Paquete de pasta larga de 1 kilogramo', CATEGORIES[0].id, 'DEMOPASTA001', 170],
  ['Azúcar refinada 1 kg', 'Paquete de azúcar refinada de 1 kilogramo', CATEGORIES[0].id, 'DEMOAZUCAR001', 150],
  ['Aceite vegetal 1 L', 'Botella de aceite vegetal de 1 litro', CATEGORIES[0].id, 'DEMOACEITE001', 390],
  ['Caraotas negras 1 kg', 'Paquete de caraotas negras de 1 kilogramo', CATEGORIES[0].id, 'DEMOCARAOTAS001', 260],
  ['Sal fina 1 kg', 'Paquete de sal fina de 1 kilogramo', CATEGORIES[0].id, 'DEMOSAL001', 60],
  ['Avena en hojuelas 400 g', 'Bolsa de avena en hojuelas de 400 gramos', CATEGORIES[0].id, 'DEMOAVENA001', 220],
  ['Atún en aceite 170 g', 'Lata de atún en aceite de 170 gramos', CATEGORIES[0].id, 'DEMOATUN001', 190],
  ['Sardinas en salsa de tomate 170 g', 'Lata de sardinas de 170 gramos', CATEGORIES[0].id, 'DEMOSARDINAS001', 120],
  ['Huevos, cartón de 30', 'Cartón de 30 huevos', CATEGORIES[0].id, 'DEMOHUEVOS001', 650],
  ['Mayonesa 445 g', 'Frasco de mayonesa de 445 gramos', CATEGORIES[0].id, 'DEMOMAYONESA001', 350],
  ['Refresco de cola 2 L', 'Botella de refresco de cola de 2 litros', CATEGORIES[1].id, 'DEMOREFRESCO001', 250],
  ['Jugo de naranja 1 L', 'Envase de jugo de naranja de 1 litro', CATEGORIES[1].id, 'DEMOJUGO001', 280],
  ['Mantequilla 250 g', 'Barra de mantequilla de 250 gramos', CATEGORIES[2].id, 'DEMOMANTEQUILLA001', 320],
  ['Yogur natural 1 kg', 'Envase de yogur natural de 1 kilogramo', CATEGORIES[2].id, 'DEMOYOGUR001', 390],
  ['Detergente en polvo 1 kg', 'Bolsa de detergente en polvo de 1 kilogramo', EXTENDED_CATEGORIES[0].id, 'DEMODETERGENTE001', 420],
  ['Lavaplatos en crema 500 g', 'Envase de lavaplatos en crema de 500 gramos', EXTENDED_CATEGORIES[0].id, 'DEMOLAVAPLATOS001', 210],
  ['Cloro 1 L', 'Botella de cloro de 1 litro', EXTENDED_CATEGORIES[0].id, 'DEMOCLORO001', 150],
  ['Papel higiénico, 4 rollos', 'Paquete de 4 rollos de papel higiénico', EXTENDED_CATEGORIES[0].id, 'DEMOPAPEL001', 280],
  ['Jabón de tocador, 3 unidades', 'Paquete de 3 jabones de tocador', EXTENDED_CATEGORIES[1].id, 'DEMOJABON001', 250],
  ['Crema dental 100 ml', 'Tubo de crema dental de 100 mililitros', EXTENDED_CATEGORIES[1].id, 'DEMOCREMADENTAL001', 230],
  ['Queso blanco duro', 'Queso blanco duro, por kilogramo', EXTENDED_CATEGORIES[2].id, 'DEMOQUESO001', 780, true],
  ['Jamón de pierna', 'Jamón de pierna, por kilogramo', EXTENDED_CATEGORIES[2].id, 'DEMOJAMON001', 1150, true],
  ['Tomate', 'Tomate, por kilogramo', EXTENDED_CATEGORIES[3].id, 'DEMOTOMATE001', 190, true],
  ['Cebolla', 'Cebolla, por kilogramo', EXTENDED_CATEGORIES[3].id, 'DEMOCEBOLLA001', 160, true],
  ['Papa', 'Papa, por kilogramo', EXTENDED_CATEGORIES[3].id, 'DEMOPAPA001', 140, true],
  ['Plátano', 'Plátano, por kilogramo', EXTENDED_CATEGORIES[3].id, 'DEMOPLATANO001', 120, true]
];

type SeedProduct = ProductDefinition & { readonly unit: UnitOfMeasure };

/** Continúa la numeración de los básicos: producto 1006, código 2006, historial 3006, evento 4006. */
const EXTENDED_DEFINITIONS: readonly SeedProduct[] = EXTENDED_ENTRIES.map(
  ([name, description, categoryId, barcode, priceMinorUnits, byWeight], index) => {
    const sequence = PRODUCT_DEFINITIONS.length + 1 + index;
    return {
      id: seedId(1000 + sequence), name, description, categoryId,
      barcodeId: seedId(2000 + sequence), barcode, priceMinorUnits,
      priceHistoryId: seedId(3000 + sequence), eventId: seedId(4000 + sequence),
      unit: byWeight ? KILOGRAM : UNIT
    };
  }
);

export const seedExampleProducts = async (
  handle: DatabaseHandle,
  options: ExampleProductSeedOptions
): Promise<ExampleProductSeedResult> => {
  const extended = options.catalog === 'extended';
  const currencyCode = options.currencyCode.trim().toUpperCase();
  const declaredTaxRate = TaxRate.fromBasisPoints(options.taxRateBasisPoints);
  const exempt = TaxRate.fromBasisPoints(0);
  const categories = extended ? [...CATEGORIES, ...EXTENDED_CATEGORIES] : [...CATEGORIES];
  const units = extended ? [UNIT, KILOGRAM] : [UNIT];
  const definitions: readonly SeedProduct[] = [
    ...PRODUCT_DEFINITIONS.map((definition) => ({ ...definition, unit: UNIT })),
    ...(extended ? EXTENDED_DEFINITIONS : [])
  ];
  const products = definitions.map((definition) => Product.create({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    categoryId: definition.categoryId,
    unitOfMeasure: definition.unit,
    barcodes: [Barcode.create({ id: definition.barcodeId, value: definition.barcode })],
    price: Money.fromMinorUnits(definition.priceMinorUnits, currencyCode),
    /** El catálogo básico aplica el impuesto declarado a todo, como siempre. */
    taxRate: extended && ILLUSTRATIVE_EXEMPT_BARCODES.has(definition.barcode) ? exempt : declaredTaxRate,
    priceHistoryId: definition.priceHistoryId,
    recordedBy: RECORDED_BY,
    occurredAt: RECORDED_AT,
    eventId: definition.eventId
  }));
  const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
  const categoryRepository = new DrizzleCategoryRepository(handle);
  const unitRepository = new DrizzleUnitOfMeasureRepository(handle);
  const productRepository = new DrizzleProductRepository(handle);

  await unitOfWork.execute(async () => {
    for (const category of categories) await categoryRepository.save(category);
    for (const unit of units) await unitRepository.save(unit);
    for (const product of products) await productRepository.save(product);
  });

  return {
    categories: categories.length,
    unitsOfMeasure: units.length,
    products: products.length
  };
};

type CliOptions = ExampleProductSeedOptions & { readonly databasePath: string };

const readRequiredOption = (args: readonly string[], name: string): string => {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Falta la opción requerida ${name}.`);
  return value;
};

const parseCliOptions = (args: readonly string[]): CliOptions => {
  const databasePath = readRequiredOption(args, '--database').trim();
  if (databasePath === ':memory:') {
    throw new Error('El comando requiere una base persistente; :memory: no está permitido.');
  }
  const currencyCode = readRequiredOption(args, '--currency').trim().toUpperCase();
  const taxRateText = readRequiredOption(args, '--tax-rate-basis-points');
  const taxRateBasisPoints = Number(taxRateText);
  if (!Number.isSafeInteger(taxRateBasisPoints) || taxRateBasisPoints < 0) {
    throw new Error('La tasa debe ser un entero no negativo expresado en puntos base.');
  }
  const catalogIndex = args.indexOf('--catalog');
  const catalog = catalogIndex === -1 ? 'basic' : (args[catalogIndex + 1] ?? '').trim().toLowerCase();
  if (catalog !== 'basic' && catalog !== 'extended') {
    throw new Error('--catalog admite basic o extended.');
  }
  return { databasePath, currencyCode, taxRateBasisPoints, catalog };
};

export const runSeedProductsCli = async (args: readonly string[]): Promise<void> => {
  let handle: DatabaseHandle | undefined;
  try {
    const options = parseCliOptions(args);
    handle = openDatabase(resolve(options.databasePath));
    applyMigrations(handle.sqlite);
    const result = await seedExampleProducts(handle, options);
    stdout.write(
      `Seed listo: ${result.products} productos, ${result.categories} categorías y ` +
      `${result.unitsOfMeasure} ${result.unitsOfMeasure === 1 ? 'unidad' : 'unidades'} de medida.\n`
    );
  } catch (error) {
    stdout.write(
      `No se pudo generar el catálogo de ejemplo: ` +
      `${error instanceof Error ? error.message : 'error desconocido'}\n` +
      'Uso: pnpm seed:products -- --database <ruta> --currency <ABC> ' +
      '--tax-rate-basis-points <entero> [--catalog basic|extended]\n'
    );
    process.exitCode = 1;
  } finally {
    handle?.close();
  }
};

const isMainModule = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) await runSeedProductsCli(process.argv.slice(2));
