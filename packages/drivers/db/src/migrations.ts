import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { InfrastructureError } from '@supermarket/shared';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { initialBusinessSchemaSql } from './migrations/0001-initial-business-schema.js';
import { businessEventLedgerSql } from './migrations/0002-business-event-ledger.js';
import { outboxSql } from './migrations/0003-outbox.js';
import { auditLogSql } from './migrations/0004-audit-log.js';
import { idempotencySql } from './migrations/0005-idempotency.js';
import { cashOperationalIntegritySql } from './migrations/0006-cash-operational-integrity.js';
import { saleShiftPaymentsSql } from './migrations/0007-sale-shift-payments.js';
import { inventorySql } from './migrations/0008-inventory.js';
import { fiscalSql } from './migrations/0009-fiscal.js';
import { fiscalOperationEvidenceSql } from './migrations/0010-fiscal-operation-evidence.js';
import { fiscalIntegrityGuardsSql } from './migrations/0011-fiscal-integrity-guards.js';
import { fiscalRecoveryIntegritySql } from './migrations/0012-fiscal-recovery-integrity.js';
import { identitySecuritySql } from './migrations/0013-identity-security.js';
import { operationalPoliciesSql } from './migrations/0014-operational-policies.js';
import { suppliersSql } from './migrations/0015-suppliers.js';
import { supplierFiscalAddressSql } from './migrations/0016-supplier-fiscal-address.js';
import { stockCountsSql } from './migrations/0017-stock-counts.js';
import { branchesAndDevicesSql } from './migrations/0018-branches-and-devices.js';
import { purchaseReceiptsAndCostSql } from './migrations/0019-purchase-receipts-and-cost.js';
import { saleRecipientSql } from './migrations/0020-sale-recipient.js';
import { saleReturnsSql } from './migrations/0021-sale-returns.js';
import { stockValuationCurrencySql } from './migrations/0022-stock-valuation-currency.js';
import { purchaseReceiptDraftEvidenceSql } from './migrations/0023-purchase-receipt-draft-evidence.js';
import { deviceIdentifierUniqueSql } from './migrations/0024-device-identifier-unique.js';
import { singleOpenStockCountSql } from './migrations/0025-single-open-stock-count.js';
import { aggregateOriginNodeSql } from './migrations/0026-aggregate-origin-node.js';
import { outboxBlockedContractSql } from './migrations/0027-outbox-blocked-contract.js';
import { syncReceptionSql } from './migrations/0028-sync-reception.js';
import { syncNodeRegistrySql } from './migrations/0029-sync-node-registry.js';
import { syncDiscrepanciesSql } from './migrations/0030-sync-discrepancies.js';
import { syncDeliveryByDestinationSql } from './migrations/0031-sync-delivery-by-destination.js';
import { referenceMasterVersionSql } from './migrations/0032-reference-master-version.js';
import { syncNodeAddressSql } from './migrations/0033-sync-node-address.js';
import { paymentMethodReferenceVersionSql } from './migrations/0034-payment-method-reference-version.js';
import { exchangeRateReferenceVersionSql } from './migrations/0035-exchange-rate-reference-version.js';
import { operatorGrantsAndAvailabilitySql } from './migrations/0036-operator-grants-and-availability.js';
import { saleCostSnapshotSql } from './migrations/0037-sale-cost-snapshot.js';
import { coordinatedOperationsSql } from './migrations/0038-coordinated-operations.js';
import { commercialProjectionSql } from './migrations/0039-commercial-projection.js';
import { stockAvailabilityBatchesSql } from './migrations/0040-stock-availability-batches.js';
import { stockCountAvailabilityVersionSql } from './migrations/0041-stock-count-availability-version.js';
import { saleReturnSaleEventSql } from './migrations/0042-sale-return-sale-event.js';
import { identityAdministrationSql } from './migrations/0043-identity-administration.js';
import { credentialEnrollmentSql } from './migrations/0044-credential-enrollment.js';

export type Migration = {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
};

export const migrations: readonly Migration[] = [{
  version: 1,
  name: 'initial_business_schema',
  sql: initialBusinessSchemaSql
}, {
  version: 2,
  name: 'business_event_ledger',
  sql: businessEventLedgerSql
}, {
  version: 3,
  name: 'outbox',
  sql: outboxSql
}, {
  version: 4,
  name: 'audit_log',
  sql: auditLogSql
}, {
  version: 5,
  name: 'idempotency',
  sql: idempotencySql
}, {
  version: 6,
  name: 'cash_operational_integrity',
  sql: cashOperationalIntegritySql
}, {
  version: 7,
  name: 'sale_shift_payments',
  sql: saleShiftPaymentsSql
}, {
  version: 8,
  name: 'inventory',
  sql: inventorySql
}, {
  version: 9,
  name: 'fiscal',
  sql: fiscalSql
}, {
  version: 10,
  name: 'fiscal_operation_evidence',
  sql: fiscalOperationEvidenceSql
}, {
  version: 11,
  name: 'fiscal_integrity_guards',
  sql: fiscalIntegrityGuardsSql
}, {
  version: 12,
  name: 'fiscal_recovery_integrity',
  sql: fiscalRecoveryIntegritySql
}, {
  version: 13,
  name: 'identity_security',
  sql: identitySecuritySql
}, {
  version: 14,
  name: 'operational_policies',
  sql: operationalPoliciesSql
}, {
  version: 15,
  name: 'suppliers',
  sql: suppliersSql
}, {
  version: 16,
  name: 'supplier_fiscal_address',
  sql: supplierFiscalAddressSql
}, {
  version: 17,
  name: 'stock_counts',
  sql: stockCountsSql
}, {
  version: 18,
  name: 'branches_and_devices',
  sql: branchesAndDevicesSql
}, {
  version: 19,
  name: 'purchase_receipts_and_cost',
  sql: purchaseReceiptsAndCostSql
}, {
  version: 20,
  name: 'sale_recipient',
  sql: saleRecipientSql
}, {
  version: 21,
  name: 'sale_returns',
  sql: saleReturnsSql
}, {
  version: 22,
  name: 'stock_valuation_currency',
  sql: stockValuationCurrencySql
}, {
  version: 23,
  name: 'purchase_receipt_draft_evidence',
  sql: purchaseReceiptDraftEvidenceSql
}, {
  version: 24,
  name: 'device_identifier_unique',
  sql: deviceIdentifierUniqueSql
}, {
  version: 25,
  name: 'single_open_stock_count',
  sql: singleOpenStockCountSql
}, {
  version: 26,
  name: 'aggregate_origin_node',
  sql: aggregateOriginNodeSql
}, {
  version: 27,
  name: 'outbox_blocked_contract',
  sql: outboxBlockedContractSql
}, {
  version: 28,
  name: 'sync_reception',
  sql: syncReceptionSql
}, {
  version: 29,
  name: 'sync_node_registry',
  sql: syncNodeRegistrySql
}, {
  version: 30,
  name: 'sync_discrepancies',
  sql: syncDiscrepanciesSql
}, {
  version: 31,
  name: 'sync_delivery_by_destination',
  sql: syncDeliveryByDestinationSql
}, {
  version: 32,
  name: 'reference_master_version',
  sql: referenceMasterVersionSql
}, {
  version: 33,
  name: 'sync_node_address',
  sql: syncNodeAddressSql
}, {
  version: 34,
  name: 'payment_method_reference_version',
  sql: paymentMethodReferenceVersionSql
}, {
  version: 35,
  name: 'exchange_rate_reference_version',
  sql: exchangeRateReferenceVersionSql
}, {
  version: 36,
  name: 'operator_grants_and_availability',
  sql: operatorGrantsAndAvailabilitySql
}, {
  version: 37,
  name: 'sale_cost_snapshot',
  sql: saleCostSnapshotSql
}, {
  version: 38,
  name: 'coordinated_operations',
  sql: coordinatedOperationsSql
}, {
  version: 39,
  name: 'commercial_projection',
  sql: commercialProjectionSql
}, {
  version: 40,
  name: 'stock_availability_batches',
  sql: stockAvailabilityBatchesSql
}, {
  version: 41,
  name: 'stock_count_availability_version',
  sql: stockCountAvailabilityVersionSql
}, {
  version: 42,
  name: 'sale_return_sale_event',
  sql: saleReturnSaleEventSql
}, {
  version: 43,
  name: 'identity_administration',
  sql: identityAdministrationSql
}, {
  version: 44,
  name: 'credential_enrollment',
  sql: credentialEnrollmentSql
}];

const checksum = (migration: Migration): string => createHash('sha256')
  .update(`${migration.version}:${migration.name}:${migration.sql}`)
  .digest('hex');

const createMigrationTable = (sqlite: Database.Database): void => {
  sqlite.exec(`
    create table if not exists schema_migrations (
      version integer primary key,
      name text not null,
      checksum text not null,
      applied_at integer not null
    );
  `);
};

export const applyMigrations = (
  sqlite: Database.Database,
  migrationList: readonly Migration[] = migrations
): number[] => {
  createMigrationTable(sqlite);
  const ordered = [...migrationList].sort((left, right) => left.version - right.version);
  if (ordered.some((migration, index) =>
    migration.version <= 0 || (index > 0 && ordered[index - 1]?.version === migration.version))) {
    throw new InfrastructureError(
      'DATABASE_MIGRATION_INVALID',
      'Migration versions must be unique positive integers.'
    );
  }

  const existing = new Map<number, { name: string; checksum: string }>(
    (sqlite.prepare('select version, name, checksum from schema_migrations').all() as Array<{
      version: number;
      name: string;
      checksum: string;
    }>).map((row) => [row.version, row])
  );
  const applied: number[] = [];

  for (const migration of ordered) {
    const recorded = existing.get(migration.version);
    const expectedChecksum = checksum(migration);
    if (recorded) {
      if (recorded.name !== migration.name || recorded.checksum !== expectedChecksum) {
        throw new InfrastructureError(
          'DATABASE_MIGRATION_MISMATCH',
          'An applied migration no longer matches its recorded checksum.',
          { details: { version: migration.version } }
        );
      }
      continue;
    }

    try {
      sqlite.exec('begin immediate');
      sqlite.exec(migration.sql);
      sqlite.prepare(
        'insert into schema_migrations (version, name, checksum, applied_at) values (?, ?, ?, ?)'
      ).run(migration.version, migration.name, expectedChecksum, Date.now());
      sqlite.exec('commit');
      applied.push(migration.version);
    } catch (error) {
      if (sqlite.inTransaction) sqlite.exec('rollback');
      throw new InfrastructureError(
        'DATABASE_MIGRATION_FAILED',
        'A database migration could not be applied.',
        { cause: error, details: { version: migration.version, name: migration.name } }
      );
    }
  }

  return applied;
};

const validateDatabase = (sqlite: Database.Database): void => {
  const integrity = sqlite.pragma('integrity_check', { simple: true });
  const foreignKeyFailures = sqlite.pragma('foreign_key_check') as unknown[];
  if (integrity !== 'ok' || foreignKeyFailures.length > 0) {
    throw new Error('SQLite integrity validation failed.');
  }
};

const removeSidecars = (databasePath: string): void => {
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${databasePath}${suffix}`;
    if (existsSync(sidecar)) unlinkSync(sidecar);
  }
};

/**
 * Protección del respaldo antes de publicarlo. La copia que `vacuum into`
 * produce es texto claro y sale de la máquina en un pendrive o una carpeta
 * compartida; el composition root la sella con la clave del nodo
 * ([ADR-0029](../../../../docs/architecture/adr/0029-proteccion-de-datos-en-reposo.md) D7.3).
 * Sin protección declarada el comportamiento es el anterior.
 */
export type BackupProtection = {
  readonly suffix: string;
  seal(sourcePath: string, targetPath: string): void;
  open(sourcePath: string, targetPath: string): void;
};

const createBackup = (
  sqlite: Database.Database,
  databasePath: string,
  backupDirectory: string,
  retention: number,
  protection?: BackupProtection
): string => {
  mkdirSync(backupDirectory, { recursive: true });
  const prefix = `${basename(databasePath)}.backup.`;
  const stamp = `${Date.now()}-${randomUUID()}`;
  /**
   * El intermedio en claro vive junto a la base, dentro del perímetro
   * protegido, y se borra antes de publicar el respaldo —también si el sellado
   * falla—. El borrado es el del sistema de archivos: no se promete un borrado
   * físico que el medio no garantiza.
   */
  const stagingPath = protection
    ? `${databasePath}.backup-${stamp}.staging`
    : join(backupDirectory, `${prefix}${stamp}.sqlite`);
  sqlite.prepare('vacuum into ?').run(stagingPath);

  const backup = openDatabase(stagingPath);
  try {
    validateDatabase(backup.sqlite);
  } finally {
    backup.close();
  }

  let backupPath = stagingPath;
  if (protection) {
    backupPath = join(backupDirectory, `${prefix}${stamp}.sqlite${protection.suffix}`);
    try {
      protection.seal(stagingPath, backupPath);
    } finally {
      removeSidecars(stagingPath);
      if (existsSync(stagingPath)) unlinkSync(stagingPath);
    }
  }

  const backups = readdirSync(backupDirectory)
    .filter((name) => name.startsWith(prefix))
    .map((name) => join(backupDirectory, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  for (const expired of backups.slice(Math.max(1, retention))) unlinkSync(expired);
  return backupPath;
};

export type MigrationOptions = {
  readonly backupDirectory: string;
  readonly backupRetention?: number;
  readonly backupProtection?: BackupProtection;
  readonly migrations?: readonly Migration[];
  readonly validate?: (handle: DatabaseHandle) => void;
};

export type MigrationResult = {
  readonly appliedVersions: readonly number[];
  readonly backupPath?: string;
};

export const migrateDatabase = (
  databasePath: string,
  options: MigrationOptions
): MigrationResult => {
  const resolvedPath = resolve(databasePath);
  const existed = existsSync(resolvedPath) && statSync(resolvedPath).size > 0;
  const handle = openDatabase(resolvedPath);
  let backupPath: string | undefined;

  try {
    if (existed) {
      backupPath = createBackup(
        handle.sqlite,
        resolvedPath,
        resolve(options.backupDirectory),
        options.backupRetention ?? 5,
        options.backupProtection
      );
    }
    const appliedVersions = applyMigrations(handle.sqlite, options.migrations ?? migrations);
    validateDatabase(handle.sqlite);
    options.validate?.(handle);
    return backupPath ? { appliedVersions, backupPath } : { appliedVersions };
  } catch (error) {
    handle.close();
    if (backupPath) {
      removeSidecars(resolvedPath);
      /** Restaurar un respaldo sellado exige abrirlo con la clave que lo cifró. */
      if (options.backupProtection) options.backupProtection.open(backupPath, resolvedPath);
      else copyFileSync(backupPath, resolvedPath);
    }
    if (error instanceof InfrastructureError && error.code !== 'DATABASE_MIGRATION_VALIDATION_FAILED') {
      throw error;
    }
    throw new InfrastructureError(
      'DATABASE_MIGRATION_VALIDATION_FAILED',
      'Database validation failed and the previous backup was restored.',
      { cause: error }
    );
  } finally {
    if (handle.sqlite.open) handle.close();
  }
};
