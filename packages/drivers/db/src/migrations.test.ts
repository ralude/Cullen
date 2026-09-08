import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InfrastructureError } from '@supermarket/shared';
import { openDatabase, type DatabaseHandle } from './connection.js';
import { DrizzleFiscalDayRepository } from './fiscal-day-repository.js';
import { DrizzleFiscalDocumentRepository } from './fiscal-document-repository.js';
import {
  applyMigrations,
  migrateDatabase,
  migrations,
  type Migration
} from './migrations.js';

describe('database migrations', () => {
  const handles: DatabaseHandle[] = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('creates the versioned relational schema and is idempotent', () => {
    const handle = openDatabase(':memory:');
    handles.push(handle);

    expect(applyMigrations(handle.sqlite)).toEqual(migrations.map((migration) => migration.version));
    expect(applyMigrations(handle.sqlite)).toEqual([]);

    const applied = handle.sqlite.prepare(
      'select version, name, checksum from schema_migrations order by version'
    ).all();
    expect(applied).toEqual([
      expect.objectContaining({ version: 1, name: 'initial_business_schema' }),
      expect.objectContaining({ version: 2, name: 'business_event_ledger' }),
      expect.objectContaining({ version: 3, name: 'outbox' }),
      expect.objectContaining({ version: 4, name: 'audit_log' }),
      expect.objectContaining({ version: 5, name: 'idempotency' }),
      expect.objectContaining({ version: 6, name: 'cash_operational_integrity' }),
      expect.objectContaining({ version: 7, name: 'sale_shift_payments' }),
      expect.objectContaining({ version: 8, name: 'inventory' }),
      expect.objectContaining({ version: 9, name: 'fiscal' }),
      expect.objectContaining({ version: 10, name: 'fiscal_operation_evidence' }),
      expect.objectContaining({ version: 11, name: 'fiscal_integrity_guards' }),
      expect.objectContaining({ version: 12, name: 'fiscal_recovery_integrity' }),
      expect.objectContaining({ version: 13, name: 'identity_security' }),
      expect.objectContaining({ version: 14, name: 'operational_policies' }),
      expect.objectContaining({ version: 15, name: 'suppliers' }),
      expect.objectContaining({ version: 16, name: 'supplier_fiscal_address' }),
      expect.objectContaining({ version: 17, name: 'stock_counts' }),
      expect.objectContaining({ version: 18, name: 'branches_and_devices' }),
      expect.objectContaining({ version: 19, name: 'purchase_receipts_and_cost' }),
      expect.objectContaining({ version: 20, name: 'sale_recipient' }),
      expect.objectContaining({ version: 21, name: 'sale_returns' }),
      expect.objectContaining({ version: 22, name: 'stock_valuation_currency' }),
      expect.objectContaining({ version: 23, name: 'purchase_receipt_draft_evidence' }),
      expect.objectContaining({ version: 24, name: 'device_identifier_unique' }),
      expect.objectContaining({ version: 25, name: 'single_open_stock_count' }),
      expect.objectContaining({ version: 26, name: 'aggregate_origin_node' }),
      expect.objectContaining({ version: 27, name: 'outbox_blocked_contract' }),
      expect.objectContaining({ version: 28, name: 'sync_reception' }),
      expect.objectContaining({ version: 29, name: 'sync_node_registry' }),
      expect.objectContaining({ version: 30, name: 'sync_discrepancies' }),
      expect.objectContaining({ version: 31, name: 'sync_delivery_by_destination' }),
      expect.objectContaining({ version: 32, name: 'reference_master_version' }),
      expect.objectContaining({ version: 33, name: 'sync_node_address' }),
      expect.objectContaining({ version: 34, name: 'payment_method_reference_version' }),
      expect.objectContaining({ version: 35, name: 'exchange_rate_reference_version' }),
      expect.objectContaining({ version: 36, name: 'operator_grants_and_availability' }),
      expect.objectContaining({ version: 37, name: 'sale_cost_snapshot' }),
      expect.objectContaining({ version: 38, name: 'coordinated_operations' }),
      expect.objectContaining({ version: 39, name: 'commercial_projection' }),
      expect.objectContaining({ version: 40, name: 'stock_availability_batches' }),
      expect.objectContaining({ version: 41, name: 'stock_count_availability_version' }),
      expect.objectContaining({ version: 42, name: 'sale_return_sale_event' }),
      expect.objectContaining({ version: 43, name: 'identity_administration' }),
      expect.objectContaining({ version: 44, name: 'credential_enrollment' })
    ]);

    const tables = handle.sqlite.prepare(
      "select name from sqlite_master where type = 'table' order by name"
    ).pluck().all();
    expect(tables).toEqual(expect.arrayContaining([
      'business_event',
      'audit_log',
      'cash_movements',
      'exchange_rates',
      'fiscal_document_lines',
      'fiscal_document_payments',
      'fiscal_document_transitions',
      'fiscal_documents',
      'fiscal_days',
      'fiscal_report_transitions',
      'fiscal_reports',
      'idempotency_key',
      'identity_users',
      'identity_roles',
      'identity_permissions',
      'identity_user_roles',
      'identity_role_permissions',
      'identity_credentials',
      'auth_lockouts',
      'auth_sessions',
      'operational_policy_versions',
      'discount_policy_configuration',
      'financial_transaction_tax_policy_configuration',
      'financial_transaction_tax_payment_methods',
      'financial_transaction_tax_currencies',
      'outbox_event',
      'product_barcodes',
      'product_price_history',
      'products',
      'sale_discounts',
      'sale_items',
      'sale_payments',
      'sale_return_lines',
      'sale_returns',
      'sales',
      'schema_migrations',
      'shift_closing_balances',
      'shifts',
      'stock_batches',
      'stock_batch_availability_reference',
      'stock_count_differences',
      'stock_count_lines',
      'stock_counts',
      'branches',
      'devices',
      'stock_items',
      'stock_movements',
      'supplier_code_sequence',
      'suppliers'
    ]));
    expect(handle.sqlite.prepare("pragma table_info('sales')").all())
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'shift_id', notnull: 1 })]));
    expect(handle.sqlite.prepare("pragma table_info('suppliers')").all()
      .map((column) => (column as { name: string }).name))
      .toEqual(expect.arrayContaining(['fiscal_address_country', 'fiscal_address_line']));
    expect(handle.sqlite.prepare("pragma table_info('cash_movements')").all())
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'source_id' }),
        expect.objectContaining({ name: 'source_event_id' })
      ]));
    for (const table of [
      'fiscal_documents',
      'fiscal_document_transitions',
      'fiscal_reports',
      'fiscal_report_transitions'
    ]) {
      const prefix = table.endsWith('transitions') ? '' : 'last_';
      expect(handle.sqlite.prepare(`pragma table_info('${table}')`).all())
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ name: `${prefix}dispatch_state` }),
          expect.objectContaining({ name: `${prefix}command_effect` }),
          expect.objectContaining({ name: `${prefix}fiscal_commit` }),
          expect.objectContaining({ name: `${prefix}print_delivery` })
        ]));
    }
  });

  it('preserves legacy frozen differences with an explicit availability version', () => {
    const handle = openDatabase(':memory:');
    handles.push(handle);
    applyMigrations(handle.sqlite, migrations.filter(({ version }) => version <= 40));
    handle.sqlite.exec(`
      insert into stock_counts (
        id, status, opened_by, origin_node_id, opened_at, closed_at, version
      ) values ('legacy-count', 'COUNTED', 'user-001', 'node-001', 1, 2, 3);
      insert into stock_count_lines (
        id, stock_count_id, product_id, stock_item_id, batch_id,
        counted_quantity_scaled, counted_quantity_scale
      ) values ('legacy-line', 'legacy-count', 'product-001', 'stock-001', null, 8, 0);
      insert into stock_count_differences (
        line_id, stock_count_id, stock_item_id, batch_id, quantity_scale,
        expected_scaled, counted_scaled, difference_scaled
      ) values ('legacy-line', 'legacy-count', 'stock-001', null, 0, 5, 8, 3);
    `);

    expect(applyMigrations(handle.sqlite)).toEqual([41, 42, 43, 44]);
    expect(handle.sqlite.prepare(`
      select stock_availability_version as version
      from stock_count_differences where line_id = 'legacy-line'
    `).get()).toEqual({ version: 1 });
    expect(() => handle.sqlite.prepare(`
      update stock_count_differences set stock_availability_version = 0
      where line_id = 'legacy-line'
    `).run()).toThrowError('CHECK constraint failed');
  });

  it('advances an existing database and rolls back a failed migration', () => {
    const handle = openDatabase(':memory:');
    handles.push(handle);
    applyMigrations(handle.sqlite);
    const next: Migration = {
      version: migrations.length + 1,
      name: 'add_probe',
      sql: 'create table migration_probe (id text primary key);'
    };

    expect(applyMigrations(handle.sqlite, [...migrations, next])).toEqual([next.version]);
    expect(() => applyMigrations(handle.sqlite, [
      ...migrations,
      next,
      { version: next.version + 1, name: 'broken', sql: 'create table' }
    ])).toThrowError(expect.objectContaining({ code: 'DATABASE_MIGRATION_FAILED' }));

    expect(handle.sqlite.prepare(
      'select count(*) from schema_migrations where version = ?'
    ).pluck().get(next.version + 1)).toBe(0);
  });

  it('rolls back DDL, DML and trigger changes from a partially executed migration', () => {
    const handle = openDatabase(':memory:');
    handles.push(handle);
    applyMigrations(handle.sqlite);
    const broken: Migration = {
      version: migrations.length + 1,
      name: 'broken_after_changes',
      sql: `
        create table rollback_probe (id text primary key);
        insert into rollback_probe (id) values ('changed');
        drop trigger fiscal_documents_no_delete;
        insert into missing_table (id) values ('fail');
      `
    };

    expect(() => applyMigrations(handle.sqlite, [...migrations, broken]))
      .toThrowError(expect.objectContaining({ code: 'DATABASE_MIGRATION_FAILED' }));
    expect(handle.sqlite.prepare(
      "select count(*) from sqlite_master where type = 'table' and name = 'rollback_probe'"
    ).pluck().get()).toBe(0);
    expect(handle.sqlite.prepare(
      "select count(*) from sqlite_master where type = 'trigger' and name = 'fiscal_documents_no_delete'"
    ).pluck().get()).toBe(1);
  });

  it('restores a verified backup when post-migration validation fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'supermarket-migration-'));
    directories.push(directory);
    const databasePath = join(directory, 'node.sqlite');
    const backupDirectory = join(directory, 'backups');
    migrateDatabase(databasePath, { backupDirectory });
    const initial = openDatabase(databasePath);
    initial.sqlite.prepare('insert into categories (id, name, is_active) values (?, ?, ?)')
      .run('category-001', 'Food', 1);
    initial.close();

    const next: Migration = {
      version: migrations.length + 1,
      name: 'post_backup_change',
      sql: 'create table post_backup_change (id text primary key);'
    };
    expect(() => migrateDatabase(databasePath, {
      backupDirectory,
      migrations: [...migrations, next],
      validate: () => {
        throw new Error('Injected startup validation failure.');
      }
    })).toThrowError(expect.objectContaining({ code: 'DATABASE_MIGRATION_VALIDATION_FAILED' }));

    const restored = openDatabase(databasePath);
    handles.push(restored);
    expect(restored.sqlite.prepare('select name from categories where id = ?')
      .pluck().get('category-001')).toBe('Food');
    expect(restored.sqlite.prepare(
      "select count(*) from sqlite_master where type = 'table' and name = 'post_backup_change'"
    ).pluck().get()).toBe(0);
    expect(readdirSync(backupDirectory)).toHaveLength(1);
  });

  it('reports migration checksum drift instead of rewriting history', () => {
    const handle = openDatabase(':memory:');
    handles.push(handle);
    applyMigrations(handle.sqlite);

    let caught: unknown;
    try {
      applyMigrations(handle.sqlite, [{ ...migrations[0] as Migration, sql: 'select 1;' }]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InfrastructureError);
    expect((caught as InfrastructureError).code).toBe('DATABASE_MIGRATION_MISMATCH');
  });

  it('aborts 0012 instead of guessing a missing legacy fiscal transition', () => {
    const handle = openDatabase(':memory:');
    handles.push(handle);
    applyMigrations(handle.sqlite, migrations.filter(({ version }) => version <= 10));
    handle.sqlite.exec(`
      insert into fiscal_documents (
        id, reference_id, document_type, currency_code, total_minor_units,
        idempotency_key, request_fingerprint, terminal_id, origin_node_id,
        created_by, created_at, status, version, attempts, fiscal_number,
        last_error_code, last_certainty, last_failure_retryable
      ) values (
        'corrupt-document', 'corrupt-sale', 'INVOICE', 'USD', 100,
        'corrupt-key', 'corrupt-fingerprint', 'terminal-001', 'node-001',
        'user-001', 1, 'PENDING', 2, 0, null, null, null, 0
      );
      insert into fiscal_document_transitions (
        event_id, document_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty,
        dispatch_state, command_effect, fiscal_commit, print_delivery
      ) values (
        'corrupt-event-2', 'corrupt-document', 2, null, 'PENDING',
        'user-001', 2, null, null, null, null, null, null
      );
    `);

    expect(() => applyMigrations(handle.sqlite)).toThrowError(
      expect.objectContaining({ code: 'DATABASE_MIGRATION_FAILED' })
    );
    expect(handle.sqlite.prepare(
      'select count(*) from schema_migrations where version = 12'
    ).pluck().get()).toBe(0);
    expect(handle.sqlite.prepare(
      'select count(*) from schema_migrations where version = 11'
    ).pluck().get()).toBe(1);
    expect(handle.sqlite.prepare(`
      select count(*) from sqlite_master
      where type = 'trigger' and name = 'fiscal_documents_status_insert_valid'
    `).pluck().get()).toBe(0);
  });

  it('aborts 0012 when a legacy snapshot contradicts its last transition', () => {
    const handle = openDatabase(':memory:');
    handles.push(handle);
    applyMigrations(handle.sqlite, migrations.filter(({ version }) => version <= 10));
    handle.sqlite.exec(`
      insert into fiscal_documents (
        id, reference_id, document_type, currency_code, total_minor_units,
        idempotency_key, request_fingerprint, terminal_id, origin_node_id,
        created_by, created_at, status, version, attempts, fiscal_number,
        last_error_code, last_certainty, last_failure_retryable
      ) values (
        'mismatched-document', 'mismatched-sale', 'INVOICE', 'USD', 100,
        'mismatched-key', 'mismatched-fingerprint', 'terminal-001', 'node-001',
        'user-001', 1, 'PENDING', 1, 0, null, null, null, 0
      );
      insert into fiscal_document_transitions (
        event_id, document_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty,
        dispatch_state, command_effect, fiscal_commit, print_delivery
      ) values (
        'mismatched-event', 'mismatched-document', 1, null, 'PRINTING',
        'user-001', 2, null, null, null, null, null, null
      );
    `);

    expect(() => applyMigrations(handle.sqlite)).toThrowError(
      expect.objectContaining({ code: 'DATABASE_MIGRATION_FAILED' })
    );
    expect(handle.sqlite.prepare(
      'select count(*) from schema_migrations where version = 12'
    ).pluck().get()).toBe(0);
  });

  it('aborts 0012 when a legacy report transition belongs to another day', () => {
    const handle = openDatabase(':memory:');
    handles.push(handle);
    applyMigrations(handle.sqlite, migrations.filter(({ version }) => version <= 10));
    handle.sqlite.exec(`
      insert into fiscal_days (
        id, business_date, terminal_id, origin_node_id, opened_by, opened_at,
        state, version
      ) values
        ('report-owner-day', '2026-08-28', 'terminal-a', 'node-001',
          'user-001', 1, 'DAY_OPEN', 2),
        ('transition-day', '2026-08-29', 'terminal-b', 'node-001',
          'user-001', 2, 'DAY_OPEN', 2);
      insert into fiscal_reports (
        id, day_id, origin_node_id, report_type, idempotency_key,
        request_fingerprint, status, attempts, report_number, last_error_code,
        last_certainty, retryable, requested_by, requested_at
      ) values (
        'crossed-report', 'report-owner-day', 'node-001', 'X', 'crossed-key',
        'crossed-fingerprint', 'PENDING', 0, null, null, null, 0,
        'user-001', 3
      );
      insert into fiscal_report_transitions (
        event_id, day_id, report_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty,
        dispatch_state, command_effect, fiscal_commit, print_delivery
      ) values (
        'owner-event', 'report-owner-day', 'crossed-report', 2,
        null, 'PENDING', 'user-001', 3, null, null, null, null, null, null
      );
      insert into fiscal_report_transitions (
        event_id, day_id, report_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty,
        dispatch_state, command_effect, fiscal_commit, print_delivery
      ) values (
        'crossed-event', 'transition-day', 'crossed-report', 2,
        null, 'PENDING', 'user-001', 3, null, null, null, null, null, null
      );
    `);

    expect(() => applyMigrations(handle.sqlite)).toThrowError(
      expect.objectContaining({ code: 'DATABASE_MIGRATION_FAILED' })
    );
    expect(handle.sqlite.prepare(
      'select count(*) from schema_migrations where version = 12'
    ).pluck().get()).toBe(0);
  });

  it('upgrades legacy fiscal certainty without claiming a safe retry', async () => {
    const handle = openDatabase(':memory:');
    handles.push(handle);
    const legacyMigrations = migrations.filter(({ version }) => version <= 9);
    applyMigrations(handle.sqlite, legacyMigrations);
    handle.sqlite.exec(`
      insert into fiscal_documents (
        id, reference_id, document_type, currency_code, total_minor_units,
        idempotency_key, request_fingerprint, terminal_id, origin_node_id,
        created_by, created_at, status, version, attempts, fiscal_number,
        last_error_code, last_certainty, last_failure_retryable
      ) values (
        'legacy-document', 'legacy-sale', 'INVOICE', 'USD', 100,
        'legacy-key', 'legacy-fingerprint', 'terminal-001', 'node-001',
        'user-001', 1, 'ERROR', 2, 1, null,
        'FISCAL_PRINTER_TIMEOUT', 'NOT_SENT', 1
      );
      insert into fiscal_document_lines (
        document_id, sequence, line_id, description, quantity_scaled,
        quantity_scale, unit_price_minor_units, tax_rate_basis_points,
        total_minor_units
      ) values (
        'legacy-document', 0, 'legacy-line', 'Legacy item', 1, 0, 100, 0, 100
      );
      insert into fiscal_document_payments (
        document_id, sequence, method_code, amount_minor_units
      ) values ('legacy-document', 0, 'CASH_USD', 100);
      insert into fiscal_document_transitions (
        event_id, document_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty
      ) values (
        'legacy-document-pending', 'legacy-document', 1, null, 'PENDING',
        'user-001', 1, null, null
      );
      insert into fiscal_document_transitions (
        event_id, document_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty
      ) values (
        'legacy-document-event', 'legacy-document', 2, 'PRINTING', 'ERROR',
        'user-001', 2, 'FISCAL_PRINTER_TIMEOUT', 'NOT_SENT'
      );
      insert into fiscal_documents (
        id, reference_id, document_type, currency_code, total_minor_units,
        idempotency_key, request_fingerprint, terminal_id, origin_node_id,
        created_by, created_at, status, version, attempts, fiscal_number,
        last_error_code, last_certainty, last_failure_retryable
      ) values (
        'legacy-unknown-document', 'legacy-unknown-sale', 'INVOICE', 'USD', 100,
        'legacy-unknown-key', 'legacy-unknown-fingerprint', 'terminal-001', 'node-001',
        'user-001', 3, 'ERROR', 2, 1, null,
        'FISCAL_PRINTER_TIMEOUT', 'UNKNOWN', 1
      );
      insert into fiscal_document_lines (
        document_id, sequence, line_id, description, quantity_scaled,
        quantity_scale, unit_price_minor_units, tax_rate_basis_points,
        total_minor_units
      ) values (
        'legacy-unknown-document', 0, 'legacy-unknown-line',
        'Legacy unknown item', 1, 0, 100, 0, 100
      );
      insert into fiscal_document_payments (
        document_id, sequence, method_code, amount_minor_units
      ) values ('legacy-unknown-document', 0, 'CASH_USD', 100);
      insert into fiscal_document_transitions (
        event_id, document_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty
      ) values
        ('legacy-unknown-document-pending', 'legacy-unknown-document', 1,
          null, 'PENDING', 'user-001', 3, null, null),
        ('legacy-unknown-document-error', 'legacy-unknown-document', 2,
          'PRINTING', 'ERROR', 'user-001', 4,
          'FISCAL_PRINTER_TIMEOUT', 'UNKNOWN');
      insert into fiscal_documents (
        id, reference_id, document_type, currency_code, total_minor_units,
        idempotency_key, request_fingerprint, terminal_id, origin_node_id,
        created_by, created_at, status, version, attempts, fiscal_number,
        last_error_code, last_certainty, last_failure_retryable
      ) values (
        'legacy-issued-document', 'legacy-issued-sale', 'INVOICE', 'USD', 100,
        'legacy-issued-key', 'legacy-issued-fingerprint', 'terminal-001', 'node-001',
        'user-001', 4, 'ISSUED', 2, 1, 'INV-LEGACY',
        null, 'UNKNOWN', 0
      );
      insert into fiscal_document_transitions (
        event_id, document_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty
      ) values (
        'legacy-issued-document-pending', 'legacy-issued-document', 1,
        null, 'PENDING', 'user-001', 4, null, null
      );
      insert into fiscal_document_transitions (
        event_id, document_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty
      ) values (
        'legacy-issued-document-event', 'legacy-issued-document', 2,
        'PRINTING', 'ISSUED', 'user-001', 5, null, 'UNKNOWN'
      );
      insert into fiscal_documents (
        id, reference_id, document_type, currency_code, total_minor_units,
        idempotency_key, request_fingerprint, terminal_id, origin_node_id,
        created_by, created_at, status, version, attempts, fiscal_number,
        last_error_code, last_certainty, last_failure_retryable
      ) values (
        'legacy-failed-document', 'legacy-failed-sale', 'INVOICE', 'USD', 100,
        'legacy-failed-key', 'legacy-failed-fingerprint', 'terminal-001', 'node-001',
        'user-001', 6, 'FAILED', 3, 1, null,
        'FISCAL_PRINTER_TIMEOUT', 'UNKNOWN', 0
      );
      insert into fiscal_document_lines (
        document_id, sequence, line_id, description, quantity_scaled,
        quantity_scale, unit_price_minor_units, tax_rate_basis_points,
        total_minor_units
      ) values (
        'legacy-failed-document', 0, 'legacy-failed-line',
        'Legacy failed item', 1, 0, 100, 0, 100
      );
      insert into fiscal_document_payments (
        document_id, sequence, method_code, amount_minor_units
      ) values ('legacy-failed-document', 0, 'CASH_USD', 100);
      insert into fiscal_document_transitions (
        event_id, document_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty
      ) values
        ('legacy-failed-document-pending', 'legacy-failed-document', 1,
          null, 'PENDING', 'user-001', 6, null, null),
        ('legacy-failed-document-printing', 'legacy-failed-document', 2,
          'PENDING', 'PRINTING', 'user-001', 7, null, null),
        ('legacy-failed-document-failed', 'legacy-failed-document', 3,
          'PRINTING', 'FAILED', 'user-001', 8,
          'FISCAL_PRINTER_TIMEOUT', 'UNKNOWN');
      insert into fiscal_documents (
        id, reference_id, document_type, currency_code, total_minor_units,
        idempotency_key, request_fingerprint, terminal_id, origin_node_id,
        created_by, created_at, status, version, attempts, fiscal_number,
        last_error_code, last_certainty, last_failure_retryable
      ) values (
        'legacy-retrying-document', 'legacy-retrying-sale', 'INVOICE', 'USD', 100,
        'legacy-retrying-key', 'legacy-retrying-fingerprint', 'terminal-001', 'node-001',
        'user-001', 9, 'RETRYING', 4, 1, null,
        'FISCAL_PRINTER_TIMEOUT', 'NOT_SENT', 1
      );
      insert into fiscal_document_lines (
        document_id, sequence, line_id, description, quantity_scaled,
        quantity_scale, unit_price_minor_units, tax_rate_basis_points,
        total_minor_units
      ) values (
        'legacy-retrying-document', 0, 'legacy-retrying-line',
        'Legacy retrying item', 1, 0, 100, 0, 100
      );
      insert into fiscal_document_payments (
        document_id, sequence, method_code, amount_minor_units
      ) values ('legacy-retrying-document', 0, 'CASH_USD', 100);
      insert into fiscal_document_transitions (
        event_id, document_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty
      ) values
        ('legacy-retrying-document-pending', 'legacy-retrying-document', 1,
          null, 'PENDING', 'user-001', 9, null, null),
        ('legacy-retrying-document-printing', 'legacy-retrying-document', 2,
          'PENDING', 'PRINTING', 'user-001', 10, null, null),
        ('legacy-retrying-document-error', 'legacy-retrying-document', 3,
          'PRINTING', 'ERROR', 'user-001', 11,
          'FISCAL_PRINTER_TIMEOUT', 'NOT_SENT'),
        ('legacy-retrying-document-retrying', 'legacy-retrying-document', 4,
          'ERROR', 'RETRYING', 'user-001', 12,
          'FISCAL_PRINTER_TIMEOUT', 'NOT_SENT');
      insert into fiscal_days (
        id, business_date, terminal_id, origin_node_id, opened_by, opened_at,
        state, version
      ) values (
        'legacy-day', '2026-08-29', 'terminal-002', 'node-001', 'user-001', 1,
        'DAY_OPEN', 6
      );
      insert into fiscal_reports (
        id, day_id, origin_node_id, report_type, idempotency_key,
        request_fingerprint, status, attempts, report_number, last_error_code,
        last_certainty, retryable, requested_by, requested_at
      ) values (
        'legacy-report', 'legacy-day', 'node-001', 'X', 'legacy-report-key',
        'legacy-report-fingerprint', 'ERROR', 1, null,
        'FISCAL_PRINTER_NAK', 'REJECTED', 0, 'user-001', 2
      );
      insert into fiscal_report_transitions (
        event_id, day_id, report_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty
      ) values (
        'legacy-report-event', 'legacy-day', 'legacy-report', 2,
        'PRINTING', 'ERROR', 'user-001', 2, 'FISCAL_PRINTER_NAK', 'REJECTED'
      );
      insert into fiscal_reports (
        id, day_id, origin_node_id, report_type, idempotency_key,
        request_fingerprint, status, attempts, report_number, last_error_code,
        last_certainty, retryable, requested_by, requested_at
      ) values (
        'legacy-unknown-report', 'legacy-day', 'node-001', 'X',
        'legacy-unknown-report-key', 'legacy-unknown-report-fingerprint',
        'ERROR', 1, null, 'FISCAL_PRINTER_TIMEOUT', 'UNKNOWN', 1, 'user-001', 3
      );
      insert into fiscal_report_transitions (
        event_id, day_id, report_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty
      ) values (
        'legacy-unknown-report-event', 'legacy-day', 'legacy-unknown-report', 3,
        'PRINTING', 'ERROR', 'user-001', 3, 'FISCAL_PRINTER_TIMEOUT', 'UNKNOWN'
      );
      insert into fiscal_reports (
        id, day_id, origin_node_id, report_type, idempotency_key,
        request_fingerprint, status, attempts, report_number, last_error_code,
        last_certainty, retryable, requested_by, requested_at
      ) values (
        'legacy-issued-report', 'legacy-day', 'node-001', 'X',
        'legacy-issued-report-key', 'legacy-issued-report-fingerprint',
        'ISSUED', 1, 'X-LEGACY', null, 'UNKNOWN', 0, 'user-001', 4
      );
      insert into fiscal_report_transitions (
        event_id, day_id, report_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty
      ) values (
        'legacy-issued-report-event', 'legacy-day', 'legacy-issued-report', 4,
        'PRINTING', 'ISSUED', 'user-001', 4, null, 'UNKNOWN'
      );
      insert into fiscal_reports (
        id, day_id, origin_node_id, report_type, idempotency_key,
        request_fingerprint, status, attempts, report_number, last_error_code,
        last_certainty, retryable, requested_by, requested_at
      ) values (
        'legacy-failed-report', 'legacy-day', 'node-001', 'X',
        'legacy-failed-report-key', 'legacy-failed-report-fingerprint',
        'FAILED', 1, null, 'FISCAL_PRINTER_TIMEOUT', 'UNKNOWN', 0,
        'user-001', 5
      );
      insert into fiscal_report_transitions (
        event_id, day_id, report_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty
      ) values (
        'legacy-failed-report-event', 'legacy-day', 'legacy-failed-report', 5,
        'PRINTING', 'FAILED', 'user-001', 5,
        'FISCAL_PRINTER_TIMEOUT', 'UNKNOWN'
      );
      insert into fiscal_reports (
        id, day_id, origin_node_id, report_type, idempotency_key,
        request_fingerprint, status, attempts, report_number, last_error_code,
        last_certainty, retryable, requested_by, requested_at
      ) values (
        'legacy-retrying-report', 'legacy-day', 'node-001', 'X',
        'legacy-retrying-report-key', 'legacy-retrying-report-fingerprint',
        'RETRYING', 1, null, 'FISCAL_PRINTER_TIMEOUT', 'NOT_SENT', 1,
        'user-001', 6
      );
      insert into fiscal_report_transitions (
        event_id, day_id, report_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty
      ) values (
        'legacy-retrying-report-event', 'legacy-day', 'legacy-retrying-report', 6,
        'ERROR', 'RETRYING', 'user-001', 6,
        'FISCAL_PRINTER_TIMEOUT', 'NOT_SENT'
      );
    `);

    expect(applyMigrations(handle.sqlite)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44]);
    expect(handle.sqlite.prepare(`
      select last_dispatch_state as dispatchState,
        last_command_effect as commandEffect,
        last_fiscal_commit as fiscalCommit,
        last_print_delivery as printDelivery
      from fiscal_documents where id = 'legacy-document'
    `).get()).toEqual({
      dispatchState: 'STARTED', commandEffect: 'UNKNOWN',
      fiscalCommit: 'UNKNOWN', printDelivery: 'UNKNOWN'
    });
    expect(handle.sqlite.prepare(`
      select last_dispatch_state as dispatchState,
        last_command_effect as commandEffect,
        last_fiscal_commit as fiscalCommit,
        last_print_delivery as printDelivery
      from fiscal_documents where id = 'legacy-unknown-document'
    `).get()).toEqual({
      dispatchState: 'STARTED', commandEffect: 'UNKNOWN',
      fiscalCommit: 'UNKNOWN', printDelivery: 'UNKNOWN'
    });
    expect(handle.sqlite.prepare(`
      select last_dispatch_state as dispatchState,
        last_command_effect as commandEffect,
        last_fiscal_commit as fiscalCommit,
        last_print_delivery as printDelivery
      from fiscal_documents where id = 'legacy-issued-document'
    `).get()).toEqual({
      dispatchState: 'RESULT_RECEIVED', commandEffect: 'APPLIED',
      fiscalCommit: 'COMMITTED', printDelivery: 'UNKNOWN'
    });
    expect(handle.sqlite.prepare(`
      select last_dispatch_state as dispatchState,
        last_command_effect as commandEffect,
        last_fiscal_commit as fiscalCommit,
        last_print_delivery as printDelivery
      from fiscal_reports where id = 'legacy-report'
    `).get()).toEqual({
      dispatchState: 'RESULT_RECEIVED', commandEffect: 'REJECTED',
      fiscalCommit: 'UNKNOWN', printDelivery: 'UNKNOWN'
    });
    expect(handle.sqlite.prepare(`
      select last_dispatch_state as dispatchState,
        last_command_effect as commandEffect,
        last_fiscal_commit as fiscalCommit,
        last_print_delivery as printDelivery
      from fiscal_reports where id = 'legacy-unknown-report'
    `).get()).toEqual({
      dispatchState: 'STARTED', commandEffect: 'UNKNOWN',
      fiscalCommit: 'UNKNOWN', printDelivery: 'UNKNOWN'
    });
    expect(handle.sqlite.prepare(`
      select last_dispatch_state as dispatchState,
        last_command_effect as commandEffect,
        last_fiscal_commit as fiscalCommit,
        last_print_delivery as printDelivery
      from fiscal_reports where id = 'legacy-issued-report'
    `).get()).toEqual({
      dispatchState: 'RESULT_RECEIVED', commandEffect: 'APPLIED',
      fiscalCommit: 'COMMITTED', printDelivery: 'UNKNOWN'
    });
    expect(handle.sqlite.prepare(`
      select status, version, last_dispatch_state as dispatchState,
        last_command_effect as commandEffect,
        last_fiscal_commit as fiscalCommit,
        last_print_delivery as printDelivery
      from fiscal_documents where id = 'legacy-failed-document'
    `).get()).toEqual({
      status: 'ERROR', version: 4,
      dispatchState: 'STARTED', commandEffect: 'UNKNOWN',
      fiscalCommit: 'UNKNOWN', printDelivery: 'UNKNOWN'
    });
    expect(handle.sqlite.prepare(`
      select status, version from fiscal_documents
      where id = 'legacy-retrying-document'
    `).get()).toEqual({ status: 'ERROR', version: 5 });
    expect(handle.sqlite.prepare(`
      select aggregate_version as aggregateVersion, from_status as fromStatus,
        to_status as toStatus, actor_id as actorId
      from fiscal_document_transitions
      where document_id = 'legacy-failed-document'
        and actor_id = 'system:migration-0012'
    `).get()).toEqual({
      aggregateVersion: 4, fromStatus: 'FAILED', toStatus: 'ERROR',
      actorId: 'system:migration-0012'
    });
    expect(handle.sqlite.prepare(`
      select status from fiscal_reports
      where id in ('legacy-failed-report', 'legacy-retrying-report')
      order by id
    `).pluck().all()).toEqual(['ERROR', 'ERROR']);
    expect(handle.sqlite.prepare(`
      select version from fiscal_days where id = 'legacy-day'
    `).pluck().get()).toBe(8);
    expect(handle.sqlite.prepare(`
      select aggregate_version as aggregateVersion, from_status as fromStatus,
        to_status as toStatus, actor_id as actorId
      from fiscal_report_transitions
      where report_id = 'legacy-failed-report'
        and actor_id = 'system:migration-0012'
    `).get()).toEqual({
      aggregateVersion: 7, fromStatus: 'FAILED', toStatus: 'ERROR',
      actorId: 'system:migration-0012'
    });
    const correctionEventIds = handle.sqlite.prepare(`
      select event_id from fiscal_document_transitions
      where actor_id = 'system:migration-0012'
      union all
      select event_id from fiscal_report_transitions
      where actor_id = 'system:migration-0012'
    `).pluck().all() as string[];
    expect(correctionEventIds).toHaveLength(4);
    expect(correctionEventIds.every((eventId) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/.test(eventId)
    )).toBe(true);
    expect(handle.sqlite.prepare(`
      select dispatch_state as dispatchState, command_effect as commandEffect,
        fiscal_commit as fiscalCommit, print_delivery as printDelivery
      from fiscal_document_transitions where event_id = 'legacy-document-event'
    `).get()).toEqual({
      dispatchState: 'STARTED', commandEffect: 'UNKNOWN',
      fiscalCommit: 'UNKNOWN', printDelivery: 'UNKNOWN'
    });
    for (const table of [
      'fiscal_documents', 'fiscal_document_transitions',
      'fiscal_reports', 'fiscal_report_transitions'
    ]) {
      const column = table.endsWith('transitions') ? 'certainty' : 'last_certainty';
      expect(handle.sqlite.prepare(
        `select count(*) from ${table} where ${column} is not null`
      ).pluck().get()).toBe(0);
    }
    expect(() => handle.sqlite.prepare(`
      update fiscal_documents set last_dispatch_state = null
      where id = 'legacy-document'
    `).run()).toThrowError('fiscal operation evidence is invalid');
    expect(() => handle.sqlite.prepare(`
      update fiscal_documents set
        last_dispatch_state = 'NOT_STARTED',
        last_command_effect = 'APPLIED',
        last_fiscal_commit = 'COMMITTED',
        last_print_delivery = 'COMPLETE'
      where id = 'legacy-document'
    `).run()).toThrowError('fiscal operation evidence is invalid');
    expect(() => handle.sqlite.prepare(`
      update fiscal_documents set last_certainty = 'UNKNOWN'
      where id = 'legacy-document'
    `).run()).toThrowError('legacy fiscal certainty is read-only');
    expect(() => handle.sqlite.prepare(`
      update fiscal_reports set last_print_delivery = null
      where id = 'legacy-report'
    `).run()).toThrowError('fiscal operation evidence is invalid');
    expect(() => handle.sqlite.prepare(`
      update fiscal_documents set status = 'PENDING'
      where id = 'legacy-document'
    `).run()).toThrowError('fiscal status evidence is invalid');
    expect(() => handle.sqlite.prepare(`
      update fiscal_documents set status = 'ISSUED', fiscal_number = 'INV-INVALID'
      where id = 'legacy-document'
    `).run()).toThrowError('fiscal status evidence is invalid');
    expect(() => handle.sqlite.prepare(`
      update fiscal_reports set status = 'PENDING'
      where id = 'legacy-report'
    `).run()).toThrowError('fiscal status evidence is invalid');
    handle.sqlite.exec(`
      insert into fiscal_documents (
        id, reference_id, document_type, currency_code, total_minor_units,
        idempotency_key, request_fingerprint, terminal_id, origin_node_id,
        created_by, created_at, status, version, attempts, fiscal_number,
        last_error_code, last_certainty, last_failure_retryable
      ) values (
        'sequence-probe', 'sequence-sale', 'INVOICE', 'USD', 100,
        'sequence-key', 'sequence-fingerprint', 'terminal-001', 'node-001',
        'user-001', 7, 'PENDING', 1, 0, null, null, null, 0
      );
      insert into fiscal_document_lines (
        document_id, sequence, line_id, description, quantity_scaled,
        quantity_scale, unit_price_minor_units, tax_rate_basis_points,
        total_minor_units
      ) values (
        'sequence-probe', 0, 'sequence-line', 'Sequence item',
        1, 0, 100, 0, 100
      );
      insert into fiscal_document_payments (
        document_id, sequence, method_code, amount_minor_units
      ) values ('sequence-probe', 0, 'CASH_USD', 100);
      insert into fiscal_document_transitions (
        event_id, document_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty,
        dispatch_state, command_effect, fiscal_commit, print_delivery
      ) values (
        'sequence-event-1', 'sequence-probe', 1, null, 'PENDING',
        'user-001', 7, null, null, null, null, null, null
      );
    `);
    expect(() => handle.sqlite.prepare(`
      insert into fiscal_document_transitions (
        event_id, document_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty,
        dispatch_state, command_effect, fiscal_commit, print_delivery
      ) values (
        'sequence-event-3', 'sequence-probe', 3, 'PENDING', 'PRINTING',
        'user-001', 8, null, null, null, null, null, null
      )
    `).run()).toThrowError('fiscal document transition version is not contiguous');
    handle.sqlite.prepare(`
      insert into fiscal_days (
        id, business_date, terminal_id, origin_node_id, opened_by, opened_at,
        state, version
      ) values (
        'other-day', '2026-08-30', 'terminal-003', 'node-001', 'user-001', 7,
        'DAY_OPEN', 1
      )
    `).run();
    expect(() => handle.sqlite.prepare(`
      insert into fiscal_report_transitions (
        event_id, day_id, report_id, aggregate_version, from_status, to_status,
        actor_id, occurred_at, error_code, certainty,
        dispatch_state, command_effect, fiscal_commit, print_delivery
      ) values (
        'cross-day-event', 'other-day', 'legacy-report', 2, null, 'PENDING',
        'user-001', 8, null, null, null, null, null, null
      )
    `).run()).toThrowError('fiscal report transition day does not match report');
    expect(handle.sqlite.prepare(`
      select dispatch_state as dispatchState, command_effect as commandEffect,
        fiscal_commit as fiscalCommit, print_delivery as printDelivery
      from fiscal_document_transitions where event_id = 'legacy-issued-document-event'
    `).get()).toEqual({
      dispatchState: 'RESULT_RECEIVED', commandEffect: 'APPLIED',
      fiscalCommit: 'COMMITTED', printDelivery: 'UNKNOWN'
    });
    expect(handle.sqlite.prepare(`
      select dispatch_state as dispatchState, command_effect as commandEffect,
        fiscal_commit as fiscalCommit, print_delivery as printDelivery
      from fiscal_report_transitions where event_id = 'legacy-issued-report-event'
    `).get()).toEqual({
      dispatchState: 'RESULT_RECEIVED', commandEffect: 'APPLIED',
      fiscalCommit: 'COMMITTED', printDelivery: 'UNKNOWN'
    });
    expect(handle.sqlite.prepare(`
      select dispatch_state as dispatchState, command_effect as commandEffect,
        fiscal_commit as fiscalCommit, print_delivery as printDelivery
      from fiscal_report_transitions where event_id = 'legacy-report-event'
    `).get()).toEqual({
      dispatchState: 'RESULT_RECEIVED', commandEffect: 'REJECTED',
      fiscalCommit: 'UNKNOWN', printDelivery: 'UNKNOWN'
    });

    const documentRepository = new DrizzleFiscalDocumentRepository(handle);
    expect((await documentRepository.findRecoverable())
      .map(({ id }) => id).filter((id) => id.startsWith('legacy-'))).toEqual([
      'legacy-document', 'legacy-unknown-document',
      'legacy-failed-document', 'legacy-retrying-document'
    ]);
    const legacyDocument = await documentRepository.findById('legacy-document');
    expect(() => legacyDocument?.beginRetry({
      actorId: 'user-001', occurredAt: new Date(6), eventId: 'blocked-document-retry'
    })).toThrowError(expect.objectContaining({ code: 'FISCAL_RETRY_RECONCILIATION_REQUIRED' }));
    const dayRepository = new DrizzleFiscalDayRepository(handle);
    expect((await dayRepository.findRecoverable()).map(({ id }) => id))
      .toEqual(['legacy-day']);
    const legacyDay = await dayRepository.findById('legacy-day');
    expect(legacyDay?.reports.filter(({ id }) =>
      id === 'legacy-failed-report' || id === 'legacy-retrying-report'
    ).map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'legacy-failed-report', status: 'ERROR' },
      { id: 'legacy-retrying-report', status: 'ERROR' }
    ]);
    expect(() => legacyDay?.retryReport({
      reportId: 'legacy-unknown-report', actorId: 'user-001',
      occurredAt: new Date(6), eventId: 'blocked-report-retry'
    })).toThrowError(expect.objectContaining({ code: 'FISCAL_REPORT_RECONCILIATION_REQUIRED' }));
    expect(() => handle.sqlite.prepare(
      "update fiscal_documents set last_error_code = null where id = 'legacy-issued-document'"
    ).run()).toThrowError('issued fiscal documents are immutable');
    expect(() => handle.sqlite.prepare(
      "update fiscal_reports set last_error_code = null where id = 'legacy-issued-report'"
    ).run()).toThrowError('issued fiscal reports are immutable');
    expect(() => handle.sqlite.prepare(`
      update fiscal_document_transitions set error_code = null
      where event_id = 'legacy-document-event'
    `).run()).toThrowError('fiscal document transitions are append-only');
    expect(() => handle.sqlite.prepare(`
      update fiscal_report_transitions set error_code = null
      where event_id = 'legacy-report-event'
    `).run()).toThrowError('fiscal report transitions are append-only');
  });

  it('moves the free-text fiscal address to country and line without losing history', () => {
    const handle = openDatabase(':memory:');
    handles.push(handle);
    applyMigrations(handle.sqlite, migrations.filter(({ version }) => version <= 15));
    handle.sqlite.exec(`
      insert into suppliers (
        id, code, legal_name, trade_name, fiscal_address, tax_country, tax_type,
        tax_value, tax_normalized_value, status, created_at, updated_at, version
      ) values
        ('legacy-with-address', 'SUP-000001', 'Distribuidora Uno', null, ' Av. Bolívar ',
          'VE', 'RIF', 'J-12345678-9', 'J123456789', 'ACTIVE', 1, 1, 1),
        ('legacy-without-address', 'SUP-000002', 'Distribuidora Dos', null, null,
          'CO', 'TAX_ID', '900123456', '900123456', 'INACTIVE', 1, 1, 1);
    `);

    expect(applyMigrations(handle.sqlite, migrations.filter(({ version }) => version <= 16))).toEqual([16]);

    expect(handle.sqlite.prepare(`
      select id, fiscal_address_country as country, fiscal_address_line as line
      from suppliers order by code
    `).all()).toEqual([
      { id: 'legacy-with-address', country: 'VE', line: 'Av. Bolívar' },
      { id: 'legacy-without-address', country: null, line: null }
    ]);
    expect(() => handle.sqlite.prepare(`
      update suppliers set fiscal_address_line = 'Av. Urdaneta'
      where id = 'legacy-without-address'
    `).run()).toThrowError('supplier fiscal address requires country and line');
  });

  it('keeps an existing sale anonymous and rejects a partial recipient snapshot', () => {
    const handle = openDatabase(':memory:');
    handles.push(handle);
    applyMigrations(handle.sqlite, migrations.filter(({ version }) => version <= 19));
    handle.sqlite.exec(`
      insert into sales (
        id, shift_id, currency_code, terminal_id, origin_node_id, started_by, started_at,
        status, version, financial_transaction_tax_minor_units
      ) values ('legacy-sale', 'shift-001', 'USD', 'terminal-001', 'node-001', 'user-001',
        1, 'COMPLETED', 2, 0);
    `);

    expect(applyMigrations(handle.sqlite)).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44]);

    expect(handle.sqlite.prepare(`
      select recipient_country as country, recipient_normalized_value as identification
      from sales where id = 'legacy-sale'
    `).get()).toEqual({ country: null, identification: null });
    expect(() => handle.sqlite.prepare(`
      update sales set recipient_country = 'VE' where id = 'legacy-sale'
    `).run()).toThrowError('sale recipient snapshot must be complete or absent');
    expect(() => handle.sqlite.prepare(`
      update sales set recipient_name = 'Bodega Central' where id = 'legacy-sale'
    `).run()).toThrowError('sale recipient snapshot must be complete or absent');

    handle.sqlite.prepare(`
      update sales set recipient_country = 'VE', recipient_type = 'RIF',
        recipient_value = 'J-12345678-9', recipient_normalized_value = 'J123456789',
        recipient_name = 'Bodega Central'
      where id = 'legacy-sale'
    `).run();
    expect(handle.sqlite.prepare(`
      select recipient_normalized_value as identification from sales where id = 'legacy-sale'
    `).get()).toEqual({ identification: 'J123456789' });
  });

  it('backfills stock valuation currency only from unambiguous cost history', () => {
    const handle = openDatabase(':memory:');
    handles.push(handle);
    applyMigrations(handle.sqlite, migrations.filter(({ version }) => version <= 21));
    handle.sqlite.exec(`
      insert into stock_items (id, product_id, unit_code, quantity_scale, tracks_batches)
      values
        ('stock-usd', 'product-usd', 'UNIT', 0, 0),
        ('stock-mixed', 'product-mixed', 'UNIT', 0, 0),
        ('stock-unknown', 'product-unknown', 'UNIT', 0, 0);
      insert into stock_movements (
        id, stock_item_id, event_id, aggregate_version, type, direction,
        quantity_scaled, quantity_scale, batch_id, actor_id, reason, reference_id,
        occurred_at, unit_cost_minor_units, cost_currency_code
      ) values
        ('usd-1', 'stock-usd', 'usd-event-1', 1, 'PURCHASE_RECEIPT', 'IN',
          1, 0, null, 'user-1', 'Purchase', 'receipt-1', 1, 100, 'USD'),
        ('usd-2', 'stock-usd', 'usd-event-2', 2, 'ADJUSTMENT_IN', 'IN',
          1, 0, null, 'user-1', 'Adjustment', 'adjustment-1', 2, 110, 'USD'),
        ('mixed-1', 'stock-mixed', 'mixed-event-1', 1, 'PURCHASE_RECEIPT', 'IN',
          1, 0, null, 'user-1', 'Purchase', 'receipt-2', 1, 100, 'USD'),
        ('mixed-2', 'stock-mixed', 'mixed-event-2', 2, 'PURCHASE_RECEIPT', 'IN',
          1, 0, null, 'user-1', 'Purchase', 'receipt-3', 2, 100, 'VES');
    `);

    expect(applyMigrations(handle.sqlite, migrations.filter(({ version }) => version <= 22))).toEqual([22]);
    expect(handle.sqlite.prepare(`
      select id, valuation_currency_code as currency from stock_items order by id
    `).all()).toEqual([
      { id: 'stock-mixed', currency: null },
      { id: 'stock-unknown', currency: null },
      { id: 'stock-usd', currency: 'USD' }
    ]);
    expect(() => handle.sqlite.prepare(`
      update stock_items set valuation_currency_code = 'VES' where id = 'stock-usd'
    `).run()).toThrowError('stock item configuration is immutable');
  });

  it('backfills aggregate origin node only from the creation audit entry', () => {
    const handle = openDatabase(':memory:');
    handles.push(handle);
    applyMigrations(handle.sqlite, migrations.filter(({ version }) => version <= 25));
    handle.sqlite.exec(`
      insert into branches (id, code, name, status, created_at, updated_at, version) values
        ('branch-known', 'CCS', 'Sucursal Centro', 'ACTIVE', 1, 1, 1),
        ('branch-orphan', 'MCB', 'Sucursal Maracaibo', 'ACTIVE', 1, 1, 1);
      insert into audit_log (
        audit_id, actor_id, actor_role_codes, action, entity_type, entity_id,
        before_state, after_state, reason, terminal_id, origin_node_id, occurred_at, correlation_id
      ) values
        ('audit-1', 'user-1', '[]', 'BRANCH_CREATED', 'Branch', 'branch-known',
          null, null, 'Alta', 'terminal-1', 'node-alpha', 1, 'corr-1'),
        ('audit-2', 'user-1', '[]', 'BRANCH_UPDATED', 'Branch', 'branch-orphan',
          null, null, 'Cambio', 'terminal-1', 'node-beta', 2, 'corr-2');
    `);

    expect(applyMigrations(handle.sqlite, migrations.filter(({ version }) => version <= 26))).toEqual([26]);
    expect(handle.sqlite.prepare(`
      select id, origin_node_id as node from branches order by id
    `).all()).toEqual([
      { id: 'branch-known', node: 'node-alpha' },
      { id: 'branch-orphan', node: null }
    ]);

    expect(() => handle.sqlite.prepare(`
      insert into branches (id, code, name, status, created_at, updated_at, version)
      values ('branch-null', 'VLN', 'Sucursal Valencia', 'ACTIVE', 1, 1, 1)
    `).run()).toThrowError('branch origin node is required');

    expect(() => handle.sqlite.prepare(`
      update branches set origin_node_id = 'node-gamma' where id = 'branch-known'
    `).run()).toThrowError('branch origin node is immutable');

    expect(handle.sqlite.prepare(`
      update branches set origin_node_id = 'node-recovered' where id = 'branch-orphan'
    `).run().changes).toBe(1);
  });
});
