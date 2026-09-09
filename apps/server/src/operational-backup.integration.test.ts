import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Barcode, Category, Product, UnitOfMeasure } from '@supermarket/core';
import {
  DrizzleCategoryRepository,
  DrizzleProductRepository,
  DrizzleUnitOfMeasureRepository,
  SqliteUnitOfWork,
  openDatabase,
  removeSidecars
} from '@supermarket/driver-db';
import { Money, TaxRate } from '@supermarket/shared';
import { loadFileProtection, openSecretVault } from '@supermarket/driver-security';
import { ADMIN_PERMISSIONS, createSecurityRuntime } from './runtime.ts';
import { readNodeStorage, type NodeStorage } from './node-storage.ts';
import {
  DEFAULT_OPERATIONAL_BACKUP_POLICY,
  dailyBackupPrefix,
  millisecondsUntilNextRun,
  operationalBackupDirectory,
  readOperationalBackupPolicy,
  runOperationalBackup,
  weeklyBackupPrefix
} from './operational-backup.ts';

/**
 * Ensayo de respaldo y restauración con datos representativos (ADR-0030 D7 y
 * el ítem del gate de piloto que lo exige).
 *
 * No basta con producir un archivo: lo que hay que demostrar es que ese
 * archivo **devuelve el nodo a operar**. Por eso el ensayo destruye la base y
 * restaura desde el respaldo sellado, y comprueba integridad, integridad
 * referencial y que la evidencia de negocio sigue ahí. Comprueba además que el
 * artefacto que sale de la máquina no lleva credenciales legibles.
 */
const DEVELOPMENT = { CULLEN_SECRET_VAULT: 'UNPROTECTED_DEVELOPMENT' };
const IDENTITY = {
  terminalId: '01991992-a860-7000-8000-000000000201',
  originNodeId: '01991992-a860-7000-8000-000000000202'
};
const OPERATOR = { operatorCode: 'OP001', pin: '739154' };
const BARCODE = '759000000077';
const PRODUCT_ID = '01991992-a860-7000-8000-000000000301';
const DAY_MS = 24 * 60 * 60 * 1000;

type Seeded = {
  readonly storage: NodeStorage;
  readonly sqlite: ReturnType<typeof openDatabase>['sqlite'];
  readonly close: () => void;
  readonly counts: Readonly<Record<string, number>>;
};

describe('respaldo operativo y su ensayo de restauración', () => {
  const directories: string[] = [];
  const open: Array<() => void> = [];

  afterEach(() => {
    for (const close of open.splice(0)) close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  const storageIn = (root: string): NodeStorage => readNodeStorage({
    DATABASE_PATH: join(root, 'data', 'node.sqlite'),
    DATABASE_BACKUP_PATH: join(root, 'data', 'backups'),
    NODE_KEYSTORE_PATH: join(root, 'keys')
  });

  const protectionFor = (keystoreDirectory: string) => loadFileProtection({
    vault: openSecretVault(keystoreDirectory, DEVELOPMENT),
    nodeId: IDENTITY.originNodeId,
    now: new Date('2026-09-09T12:00:00.000Z')
  });

  const rowCounts = (
    sqlite: Seeded['sqlite'], tables: readonly string[]
  ): Record<string, number> => Object.fromEntries(tables.map((table) => [
    table, sqlite.prepare(`select count(*) from ${table}`).pluck().get() as number
  ]));

  const TABLES = ['identity_users', 'identity_credentials', 'products', 'audit_log'];

  /** Un nodo con operador, credencial, datos maestros, catálogo y auditoría. */
  const seed = async (): Promise<Seeded> => {
    const root = mkdtempSync(join(tmpdir(), 'cullen-backup-'));
    directories.push(root);
    const storage = storageIn(root);
    /**
     * El perímetro lo prepara `prepareNodeStorage` en el arranque real; aquí
     * bastan los directorios, porque lo que se ensaya es el respaldo y no la
     * verificación de ACL, que tiene su propia cobertura.
     */
    for (const directory of [
      dirname(storage.databasePath), storage.backupDirectory, storage.keystoreDirectory
    ]) mkdirSync(directory, { recursive: true });

    const runtime = createSecurityRuntime(storage.databasePath, IDENTITY);
    const provisioned = await runtime.provisionInitialAdmin.execute({
      ...OPERATOR, displayName: 'Administradora', permissions: ADMIN_PERMISSIONS
    });
    expect(provisioned.ok).toBe(true);

    const category = Category.create({ id: 'category-grocery', name: 'Víveres' });
    const unit = UnitOfMeasure.create({
      id: 'unit-each', code: 'UNIT', name: 'Unidad', quantityScale: 0
    });
    const product = Product.create({
      id: PRODUCT_ID, name: 'Harina de maíz', description: 'Producto del ensayo',
      categoryId: category.id, unitOfMeasure: unit, barcodes: [],
      price: Money.fromMinorUnits(1990, 'USD'),
      taxRate: TaxRate.fromBasisPoints(1600), priceHistoryId: 'price-flour-001',
      recordedBy: 'seed-user', occurredAt: new Date('2026-09-09T12:00:00.000Z'),
      eventId: 'product-event-001'
    });
    product.updateDetails({
      barcodes: [Barcode.create({ id: 'barcode-flour', value: BARCODE })]
    });

    await new SqliteUnitOfWork(runtime.handle.sqlite).execute(async () => {
      await new DrizzleCategoryRepository(runtime.handle).save(category);
      await new DrizzleUnitOfMeasureRepository(runtime.handle).save(unit);
      await new DrizzleProductRepository(runtime.handle).save(product);
    });

    const close = (): void => {
      if (runtime.handle.sqlite.open) runtime.handle.close();
    };
    open.push(close);
    return {
      storage,
      sqlite: runtime.handle.sqlite,
      close,
      counts: rowCounts(runtime.handle.sqlite, TABLES)
    };
  };

  it('restaura una base destruida desde el respaldo sellado y conserva la evidencia', async () => {
    const seeded = await seed();
    const protection = await protectionFor(seeded.storage.keystoreDirectory);

    const { dailyPath } = runOperationalBackup({
      sqlite: seeded.sqlite,
      storage: seeded.storage,
      policy: DEFAULT_OPERATIONAL_BACKUP_POLICY,
      protection
    });

    /** El respaldo sale de la máquina: no debe llevar credenciales legibles. */
    const artefact = readFileSync(dailyPath);
    expect(artefact.includes(Buffer.from(OPERATOR.operatorCode))).toBe(false);
    expect(artefact.includes(Buffer.from('scrypt$'))).toBe(false);
    expect(artefact.includes(Buffer.from('Harina de maíz'))).toBe(false);

    /** Pérdida total del archivo operativo, no una corrupción cosmética. */
    seeded.close();
    removeSidecars(seeded.storage.databasePath);
    unlinkSync(seeded.storage.databasePath);

    protection.open(dailyPath, seeded.storage.databasePath);

    const restored = openDatabase(seeded.storage.databasePath);
    try {
      expect(restored.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(restored.sqlite.pragma('foreign_key_check')).toEqual([]);
      expect(rowCounts(restored.sqlite, TABLES)).toEqual(seeded.counts);
      expect(restored.sqlite.prepare(
        'select name from products where id = ?'
      ).pluck().get(PRODUCT_ID)).toBe('Harina de maíz');
      expect(restored.sqlite.prepare(
        'select count(*) from identity_credentials'
      ).pluck().get()).toBe(1);
    } finally {
      restored.close();
    }
  });

  it('aplica su propia retención sin tocar los respaldos de migración', async () => {
    const seeded = await seed();
    const protection = await protectionFor(seeded.storage.keystoreDirectory);
    const policy = { ...DEFAULT_OPERATIONAL_BACKUP_POLICY, dailyRetention: 3, weeklyRetention: 2 };

    /** Una copia de migración vive en el directorio de al lado y debe sobrevivir. */
    const migrationBackup = join(
      seeded.storage.backupDirectory, 'node.sqlite.backup.1700000000000-antigua.sqlite.sealed'
    );
    writeFileSync(migrationBackup, 'respaldo de migración');

    const directory = operationalBackupDirectory(seeded.storage);
    const daily = dailyBackupPrefix(seeded.storage.databasePath);
    const weekly = weeklyBackupPrefix(seeded.storage.databasePath);

    const start = Date.now();
    for (let day = 0; day < 6; day += 1) {
      runOperationalBackup({
        sqlite: seeded.sqlite,
        storage: seeded.storage,
        policy,
        protection,
        now: new Date(start + day * DAY_MS)
      });
    }

    const names = readdirSync(directory);
    expect(names.filter((name) => name.startsWith(daily))).toHaveLength(3);
    /** La primera corrida publica una semanal; la siguiente espera siete días. */
    expect(names.filter((name) => name.startsWith(weekly))).toHaveLength(1);
    expect(readFileSync(migrationBackup, 'utf8')).toBe('respaldo de migración');
  });

  it('publica una copia semanal nueva cuando la vigente cumple siete días', async () => {
    const seeded = await seed();
    const protection = await protectionFor(seeded.storage.keystoreDirectory);
    const directory = operationalBackupDirectory(seeded.storage);
    const weekly = weeklyBackupPrefix(seeded.storage.databasePath);
    const now = Date.now();

    const first = runOperationalBackup({
      sqlite: seeded.sqlite, storage: seeded.storage,
      policy: DEFAULT_OPERATIONAL_BACKUP_POLICY, protection, now: new Date(now)
    });
    expect(first.weeklyPath).toBeDefined();

    const tooSoon = runOperationalBackup({
      sqlite: seeded.sqlite, storage: seeded.storage,
      policy: DEFAULT_OPERATIONAL_BACKUP_POLICY, protection,
      now: new Date(now + 6 * DAY_MS)
    });
    expect(tooSoon.weeklyPath).toBeUndefined();

    const due = runOperationalBackup({
      sqlite: seeded.sqlite, storage: seeded.storage,
      policy: DEFAULT_OPERATIONAL_BACKUP_POLICY, protection,
      now: new Date(now + 8 * DAY_MS)
    });
    expect(due.weeklyPath).toBeDefined();
    expect(readdirSync(directory).filter((name) => name.startsWith(weekly))).toHaveLength(2);
  });

  it('copia el respaldo al destino externo declarado, sellado', async () => {
    const seeded = await seed();
    const protection = await protectionFor(seeded.storage.keystoreDirectory);
    const external = join(directories[directories.length - 1]!, 'pendrive');

    const result = runOperationalBackup({
      sqlite: seeded.sqlite,
      storage: seeded.storage,
      policy: { ...DEFAULT_OPERATIONAL_BACKUP_POLICY, externalPath: external },
      protection
    });

    expect(result.externalPath).toBeDefined();
    expect(readFileSync(result.externalPath!)).toEqual(readFileSync(result.dailyPath));
    expect(readFileSync(result.externalPath!).includes(Buffer.from('scrypt$'))).toBe(false);
  });

  it('rechaza una política de respaldo inválida en vez de degradarla', () => {
    expect(() => readOperationalBackupPolicy({ OPERATIONAL_BACKUP_HOUR: '24' }))
      .toThrowError(expect.objectContaining({ code: 'OPERATIONAL_BACKUP_HOUR_INVALID' }));
    expect(() => readOperationalBackupPolicy({ OPERATIONAL_BACKUP_DAILY_RETENTION: '0' }))
      .toThrowError(expect.objectContaining({ code: 'OPERATIONAL_BACKUP_DAILY_RETENTION_INVALID' }));
    expect(readOperationalBackupPolicy({})).toEqual(DEFAULT_OPERATIONAL_BACKUP_POLICY);
  });

  it('agenda la copia en la próxima hora local declarada', () => {
    const policy = { ...DEFAULT_OPERATIONAL_BACKUP_POLICY, hour: 3 };
    const beforeHour = new Date(2026, 8, 9, 1, 30, 0, 0);
    expect(millisecondsUntilNextRun(policy, beforeHour)).toBe(90 * 60 * 1000);

    const afterHour = new Date(2026, 8, 9, 4, 0, 0, 0);
    expect(millisecondsUntilNextRun(policy, afterHour)).toBe(23 * 60 * 60 * 1000);
  });
});
