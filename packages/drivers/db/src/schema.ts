import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const businessEvents = sqliteTable('business_event', {
  eventId: text('event_id').primaryKey(),
  eventType: text('event_type').notNull(),
  contractVersion: integer('contract_version').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateVersion: integer('aggregate_version').notNull(),
  originNodeId: text('origin_node_id').notNull(),
  correlationId: text('correlation_id').notNull(),
  actorId: text('actor_id').notNull(),
  occurredAt: integer('occurred_at').notNull(),
  payload: text('payload').notNull()
});

export const outboxEvents = sqliteTable('outbox_event', {
  eventId: text('event_id').primaryKey(),
  eventType: text('event_type').notNull(),
  contractVersion: integer('contract_version').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateVersion: integer('aggregate_version').notNull(),
  originNodeId: text('origin_node_id').notNull(),
  correlationId: text('correlation_id').notNull(),
  actorId: text('actor_id').notNull(),
  occurredAt: integer('occurred_at').notNull(),
  payload: text('payload').notNull(),
  status: text('status').notNull(),
  attempts: integer('attempts').notNull(),
  nextAttemptAt: integer('next_attempt_at').notNull(),
  leaseUntil: integer('lease_until'),
  lastError: text('last_error'),
  publishedAt: integer('published_at'),
  createdAt: integer('created_at').notNull()
});

export const auditLogs = sqliteTable('audit_log', {
  auditId: text('audit_id').primaryKey(),
  actorId: text('actor_id').notNull(),
  actorRoleCodes: text('actor_role_codes').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  beforeState: text('before_state'),
  afterState: text('after_state'),
  reason: text('reason').notNull(),
  terminalId: text('terminal_id').notNull(),
  originNodeId: text('origin_node_id').notNull(),
  occurredAt: integer('occurred_at').notNull(),
  correlationId: text('correlation_id').notNull()
});

export const idempotencyKeys = sqliteTable('idempotency_key', {
  scope: text('scope').notNull(),
  key: text('key').notNull(),
  requestFingerprint: text('request_fingerprint').notNull(),
  status: text('status').notNull(),
  result: text('result').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull()
}, (table) => [primaryKey({ columns: [table.scope, table.key] })]);

export const identityUsers = sqliteTable('identity_users', {
  id: text('id').primaryKey(),
  operatorCode: text('operator_code').notNull().unique(),
  displayName: text('display_name').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull(),
  authorizationVersion: integer('authorization_version').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const identityRoles = sqliteTable('identity_roles', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull(),
  isAssignable: integer('is_assignable', { mode: 'boolean' }).notNull()
});

export const identityPermissions = sqliteTable('identity_permissions', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull()
});

export const identityUserRoles = sqliteTable('identity_user_roles', {
  userId: text('user_id').notNull().references(() => identityUsers.id),
  roleId: text('role_id').notNull().references(() => identityRoles.id)
}, (table) => [primaryKey({ columns: [table.userId, table.roleId] })]);

export const identityRolePermissions = sqliteTable('identity_role_permissions', {
  roleId: text('role_id').notNull().references(() => identityRoles.id),
  permissionCode: text('permission_code').notNull().references(() => identityPermissions.code)
}, (table) => [primaryKey({ columns: [table.roleId, table.permissionCode] })]);

export const identityCredentials = sqliteTable('identity_credentials', {
  userId: text('user_id').primaryKey().references(() => identityUsers.id),
  pinHash: text('pin_hash').notNull(),
  version: integer('version').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const authLockouts = sqliteTable('auth_lockouts', {
  originNodeId: text('origin_node_id').notNull(),
  userId: text('user_id').notNull().references(() => identityUsers.id),
  windowStartedAt: integer('window_started_at', { mode: 'timestamp_ms' }).notNull(),
  failedCount: integer('failed_count').notNull(),
  lockedUntil: integer('locked_until', { mode: 'timestamp_ms' })
}, (table) => [primaryKey({ columns: [table.originNodeId, table.userId] })]);

export const authSessions = sqliteTable('auth_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => identityUsers.id),
  originNodeId: text('origin_node_id').notNull(),
  terminalId: text('terminal_id').notNull(),
  authorizationVersion: integer('authorization_version').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
  idleExpiresAt: integer('idle_expires_at', { mode: 'timestamp_ms' }).notNull(),
  absoluteExpiresAt: integer('absolute_expires_at', { mode: 'timestamp_ms' }).notNull(),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' })
});

export const operationalPolicyVersions = sqliteTable('operational_policy_versions', {
  id: text('id').primaryKey(),
  policyType: text('policy_type').notNull(),
  version: integer('version').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull(),
  validFrom: integer('valid_from', { mode: 'timestamp_ms' }).notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  reason: text('reason').notNull()
});

export const discountPolicyConfiguration = sqliteTable('discount_policy_configuration', {
  policyId: text('policy_id').primaryKey().references(() => operationalPolicyVersions.id),
  maximumBasisPoints: integer('maximum_basis_points').notNull()
});

export const financialTransactionTaxPolicyConfiguration = sqliteTable(
  'financial_transaction_tax_policy_configuration',
  {
    policyId: text('policy_id').primaryKey().references(() => operationalPolicyVersions.id),
    rateBasisPoints: integer('rate_basis_points').notNull()
  }
);

export const financialTransactionTaxPaymentMethods = sqliteTable(
  'financial_transaction_tax_payment_methods',
  {
    policyId: text('policy_id').notNull().references(() => operationalPolicyVersions.id),
    paymentMethodCode: text('payment_method_code').notNull()
  },
  (table) => [primaryKey({ columns: [table.policyId, table.paymentMethodCode] })]
);

export const financialTransactionTaxCurrencies = sqliteTable(
  'financial_transaction_tax_currencies',
  {
    policyId: text('policy_id').notNull().references(() => operationalPolicyVersions.id),
    currencyCode: text('currency_code').notNull()
  },
  (table) => [primaryKey({ columns: [table.policyId, table.currencyCode] })]
);

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull(),
  version: integer('version').notNull()
});

export const unitsOfMeasure = sqliteTable('units_of_measure', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  quantityScale: integer('quantity_scale').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull(),
  version: integer('version').notNull()
});

export const paymentMethods = sqliteTable('payment_methods', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  currencyCode: text('currency_code').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull(),
  version: integer('version').notNull()
});

export const cashRegisters = sqliteTable('cash_registers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  terminalId: text('terminal_id').notNull(),
  originNodeId: text('origin_node_id').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull()
});

export const exchangeRates = sqliteTable('exchange_rates', {
  id: text('id').primaryKey(),
  baseCurrency: text('base_currency').notNull(),
  quoteCurrency: text('quote_currency').notNull(),
  rateValue: integer('rate_value').notNull(),
  rateScale: integer('rate_scale').notNull(),
  source: text('source').notNull(),
  validFrom: integer('valid_from').notNull(),
  validUntil: integer('valid_until'),
  registeredBy: text('registered_by').notNull(),
  version: integer('version').notNull()
});

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  categoryId: text('category_id').notNull(),
  unitId: text('unit_id').notNull(),
  priceMinorUnits: integer('price_minor_units').notNull(),
  currencyCode: text('currency_code').notNull(),
  taxRateBasisPoints: integer('tax_rate_basis_points').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull(),
  version: integer('version').notNull()
});

export const suppliers = sqliteTable('suppliers', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  legalName: text('legal_name').notNull(),
  tradeName: text('trade_name'),
  fiscalAddressCountry: text('fiscal_address_country'),
  fiscalAddressLine: text('fiscal_address_line'),
  taxCountry: text('tax_country').notNull(),
  taxType: text('tax_type').notNull(),
  taxValue: text('tax_value').notNull(),
  taxNormalizedValue: text('tax_normalized_value').notNull(),
  status: text('status').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  version: integer('version').notNull()
});

export const productBarcodes = sqliteTable('product_barcodes', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull(),
  value: text('value').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull()
});

export const productPriceHistory = sqliteTable('product_price_history', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull(),
  priceMinorUnits: integer('price_minor_units').notNull(),
  currencyCode: text('currency_code').notNull(),
  recordedAt: integer('recorded_at').notNull(),
  recordedBy: text('recorded_by').notNull(),
  reason: text('reason').notNull()
});

export const sales = sqliteTable('sales', {
  id: text('id').primaryKey(),
  shiftId: text('shift_id').notNull(),
  currencyCode: text('currency_code').notNull(),
  terminalId: text('terminal_id').notNull(),
  originNodeId: text('origin_node_id').notNull(),
  startedBy: text('started_by').notNull(),
  startedAt: integer('started_at').notNull(),
  status: text('status').notNull(),
  version: integer('version').notNull(),
  financialTransactionTaxMinorUnits: integer('financial_transaction_tax_minor_units').notNull(),
  completedAt: integer('completed_at'),
  voidedAt: integer('voided_at'),
  voidReason: text('void_reason'),
  voidedBy: text('voided_by'),
  recipientCountry: text('recipient_country'),
  recipientType: text('recipient_type'),
  recipientValue: text('recipient_value'),
  recipientNormalizedValue: text('recipient_normalized_value'),
  recipientName: text('recipient_name'),
  recipientAddress: text('recipient_address')
});

export const saleItems = sqliteTable('sale_items', {
  id: text('id').primaryKey(),
  saleId: text('sale_id').notNull(),
  productId: text('product_id').notNull(),
  description: text('description').notNull(),
  priceMinorUnits: integer('price_minor_units').notNull(),
  currencyCode: text('currency_code').notNull(),
  taxRateBasisPoints: integer('tax_rate_basis_points').notNull(),
  unitCode: text('unit_code').notNull(),
  unitScale: integer('unit_scale').notNull(),
  quantityScaled: integer('quantity_scaled').notNull(),
  quantityScale: integer('quantity_scale').notNull()
});

export const saleDiscounts = sqliteTable('sale_discounts', {
  id: text('id').primaryKey(),
  saleId: text('sale_id').notNull(),
  itemId: text('item_id'),
  percentageBasisPoints: integer('percentage_basis_points').notNull(),
  amountMinorUnits: integer('amount_minor_units').notNull(),
  currencyCode: text('currency_code').notNull(),
  reason: text('reason').notNull(),
  appliedBy: text('applied_by').notNull(),
  appliedAt: integer('applied_at').notNull()
});

export const salePayments = sqliteTable('sale_payments', {
  id: text('id').primaryKey(),
  saleId: text('sale_id').notNull(),
  paymentMethodCode: text('payment_method_code').notNull(),
  paymentMethodName: text('payment_method_name').notNull(),
  paymentMethodKind: text('payment_method_kind').notNull(),
  amountMinorUnits: integer('amount_minor_units').notNull(),
  currencyCode: text('currency_code').notNull(),
  amountInSaleCurrencyMinorUnits: integer('amount_in_sale_currency_minor_units').notNull(),
  saleCurrencyCode: text('sale_currency_code').notNull(),
  exchangeRateId: text('exchange_rate_id'),
  exchangeRateBaseCurrency: text('exchange_rate_base_currency'),
  exchangeRateQuoteCurrency: text('exchange_rate_quote_currency'),
  exchangeRateValue: integer('exchange_rate_value'),
  exchangeRateScale: integer('exchange_rate_scale'),
  exchangeRateSource: text('exchange_rate_source'),
  exchangeRateValidFrom: integer('exchange_rate_valid_from'),
  exchangeRateValidUntil: integer('exchange_rate_valid_until'),
  exchangeRateRegisteredBy: text('exchange_rate_registered_by'),
  registeredBy: text('registered_by').notNull(),
  registeredAt: integer('registered_at').notNull()
});

export const shifts = sqliteTable('shifts', {
  id: text('id').primaryKey(),
  cashRegisterId: text('cash_register_id').notNull(),
  terminalId: text('terminal_id').notNull(),
  originNodeId: text('origin_node_id').notNull(),
  openedBy: text('opened_by').notNull(),
  openedAt: integer('opened_at').notNull(),
  status: text('status').notNull(),
  version: integer('version').notNull(),
  closedAt: integer('closed_at'),
  closedBy: text('closed_by')
});

export const cashMovements = sqliteTable('cash_movements', {
  id: text('id').primaryKey(),
  shiftId: text('shift_id').notNull(),
  type: text('type').notNull(),
  paymentMethodCode: text('payment_method_code').notNull(),
  paymentMethodName: text('payment_method_name').notNull(),
  paymentMethodKind: text('payment_method_kind').notNull(),
  amountMinorUnits: integer('amount_minor_units').notNull(),
  currencyCode: text('currency_code').notNull(),
  reason: text('reason').notNull(),
  registeredBy: text('registered_by').notNull(),
  registeredAt: integer('registered_at').notNull(),
  sourceId: text('source_id'),
  sourceEventId: text('source_event_id')
});

export const shiftClosingBalances = sqliteTable('shift_closing_balances', {
  shiftId: text('shift_id').notNull(),
  paymentMethodCode: text('payment_method_code').notNull(),
  currencyCode: text('currency_code').notNull(),
  expectedMinorUnits: integer('expected_minor_units').notNull(),
  declaredMinorUnits: integer('declared_minor_units').notNull(),
  differenceMinorUnits: integer('difference_minor_units').notNull()
}, (table) => [primaryKey({ columns: [table.shiftId, table.paymentMethodCode, table.currencyCode] })]);

export const stockItems = sqliteTable('stock_items', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull().unique(),
  unitCode: text('unit_code').notNull(),
  quantityScale: integer('quantity_scale').notNull(),
  tracksBatches: integer('tracks_batches', { mode: 'boolean' }).notNull(),
  valuationCurrencyCode: text('valuation_currency_code')
});

export const stockBatches = sqliteTable('stock_batches', {
  id: text('id').primaryKey(),
  stockItemId: text('stock_item_id').notNull().references(() => stockItems.id),
  lotNumber: text('lot_number').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' })
});

export const stockMovements = sqliteTable('stock_movements', {
  id: text('id').primaryKey(),
  stockItemId: text('stock_item_id').notNull().references(() => stockItems.id),
  eventId: text('event_id').notNull().unique(),
  aggregateVersion: integer('aggregate_version').notNull(),
  type: text('type').notNull(),
  direction: text('direction').notNull(),
  quantityScaled: integer('quantity_scaled').notNull(),
  quantityScale: integer('quantity_scale').notNull(),
  batchId: text('batch_id').references(() => stockBatches.id),
  actorId: text('actor_id').notNull(),
  reason: text('reason').notNull(),
  referenceId: text('reference_id').notNull(),
  occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  unitCostMinorUnits: integer('unit_cost_minor_units'),
  costCurrencyCode: text('cost_currency_code')
});

export const stockCounts = sqliteTable('stock_counts', {
  id: text('id').primaryKey(),
  originNodeId: text('origin_node_id'),
  status: text('status').notNull(),
  openedBy: text('opened_by').notNull(),
  openedAt: integer('opened_at', { mode: 'timestamp_ms' }).notNull(),
  closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
  approvedBy: text('approved_by'),
  approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
  rejectedBy: text('rejected_by'),
  rejectedAt: integer('rejected_at', { mode: 'timestamp_ms' }),
  rejectionReason: text('rejection_reason'),
  version: integer('version').notNull()
});

export const stockCountLines = sqliteTable('stock_count_lines', {
  id: text('id').primaryKey(),
  stockCountId: text('stock_count_id').notNull().references(() => stockCounts.id),
  productId: text('product_id').notNull(),
  stockItemId: text('stock_item_id').notNull(),
  batchId: text('batch_id'),
  countedQuantityScaled: integer('counted_quantity_scaled').notNull(),
  countedQuantityScale: integer('counted_quantity_scale').notNull()
});

export const stockCountDifferences = sqliteTable('stock_count_differences', {
  lineId: text('line_id').primaryKey().references(() => stockCountLines.id),
  stockCountId: text('stock_count_id').notNull().references(() => stockCounts.id),
  stockItemId: text('stock_item_id').notNull(),
  batchId: text('batch_id'),
  quantityScale: integer('quantity_scale').notNull(),
  expectedScaled: integer('expected_scaled').notNull(),
  countedScaled: integer('counted_scaled').notNull(),
  differenceScaled: integer('difference_scaled').notNull()
});

export const branches = sqliteTable('branches', {
  id: text('id').primaryKey(),
  originNodeId: text('origin_node_id'),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  version: integer('version').notNull()
});

export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  originNodeId: text('origin_node_id'),
  type: text('type').notNull(),
  identifier: text('identifier').notNull(),
  terminalId: text('terminal_id').notNull(),
  branchId: text('branch_id').references(() => branches.id),
  status: text('status').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  version: integer('version').notNull()
});

export const fiscalDocuments = sqliteTable('fiscal_documents', {
  id: text('id').primaryKey(),
  referenceId: text('reference_id').notNull(),
  documentType: text('document_type').notNull(),
  currencyCode: text('currency_code').notNull(),
  totalMinorUnits: integer('total_minor_units').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestFingerprint: text('request_fingerprint').notNull(),
  terminalId: text('terminal_id').notNull(),
  originNodeId: text('origin_node_id').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  status: text('status').notNull(),
  version: integer('version').notNull(),
  attempts: integer('attempts').notNull(),
  fiscalNumber: text('fiscal_number'),
  lastErrorCode: text('last_error_code'),
  lastDispatchState: text('last_dispatch_state'),
  lastCommandEffect: text('last_command_effect'),
  lastFiscalCommit: text('last_fiscal_commit'),
  lastPrintDelivery: text('last_print_delivery'),
  lastFailureRetryable: integer('last_failure_retryable', { mode: 'boolean' }).notNull(),
  recipientCountry: text('recipient_country'),
  recipientType: text('recipient_type'),
  recipientValue: text('recipient_value'),
  recipientNormalizedValue: text('recipient_normalized_value'),
  recipientName: text('recipient_name'),
  recipientAddress: text('recipient_address')
});

export const fiscalDocumentLines = sqliteTable('fiscal_document_lines', {
  documentId: text('document_id').notNull().references(() => fiscalDocuments.id),
  sequence: integer('sequence').notNull(),
  lineId: text('line_id').notNull(),
  description: text('description').notNull(),
  quantityScaled: integer('quantity_scaled').notNull(),
  quantityScale: integer('quantity_scale').notNull(),
  unitPriceMinorUnits: integer('unit_price_minor_units').notNull(),
  taxRateBasisPoints: integer('tax_rate_basis_points').notNull(),
  totalMinorUnits: integer('total_minor_units').notNull()
}, (table) => [primaryKey({ columns: [table.documentId, table.sequence] })]);

export const fiscalDocumentPayments = sqliteTable('fiscal_document_payments', {
  documentId: text('document_id').notNull().references(() => fiscalDocuments.id),
  sequence: integer('sequence').notNull(),
  methodCode: text('method_code').notNull(),
  amountMinorUnits: integer('amount_minor_units').notNull()
}, (table) => [primaryKey({ columns: [table.documentId, table.sequence] })]);

export const fiscalDocumentTransitions = sqliteTable('fiscal_document_transitions', {
  eventId: text('event_id').primaryKey(),
  documentId: text('document_id').notNull().references(() => fiscalDocuments.id),
  aggregateVersion: integer('aggregate_version').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  actorId: text('actor_id').notNull(),
  occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  errorCode: text('error_code'),
  dispatchState: text('dispatch_state'),
  commandEffect: text('command_effect'),
  fiscalCommit: text('fiscal_commit'),
  printDelivery: text('print_delivery')
});

export const fiscalDays = sqliteTable('fiscal_days', {
  id: text('id').primaryKey(),
  businessDate: text('business_date').notNull(),
  terminalId: text('terminal_id').notNull(),
  originNodeId: text('origin_node_id').notNull(),
  openedBy: text('opened_by').notNull(),
  openedAt: integer('opened_at', { mode: 'timestamp_ms' }).notNull(),
  state: text('state').notNull(),
  version: integer('version').notNull()
});

export const fiscalReports = sqliteTable('fiscal_reports', {
  id: text('id').primaryKey(),
  dayId: text('day_id').notNull().references(() => fiscalDays.id),
  originNodeId: text('origin_node_id').notNull(),
  reportType: text('report_type').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestFingerprint: text('request_fingerprint').notNull(),
  status: text('status').notNull(),
  attempts: integer('attempts').notNull(),
  reportNumber: text('report_number'),
  lastErrorCode: text('last_error_code'),
  lastDispatchState: text('last_dispatch_state'),
  lastCommandEffect: text('last_command_effect'),
  lastFiscalCommit: text('last_fiscal_commit'),
  lastPrintDelivery: text('last_print_delivery'),
  retryable: integer('retryable', { mode: 'boolean' }).notNull(),
  requestedBy: text('requested_by').notNull(),
  requestedAt: integer('requested_at', { mode: 'timestamp_ms' }).notNull()
});

export const fiscalReportTransitions = sqliteTable('fiscal_report_transitions', {
  eventId: text('event_id').primaryKey(),
  dayId: text('day_id').notNull().references(() => fiscalDays.id),
  reportId: text('report_id').notNull().references(() => fiscalReports.id),
  aggregateVersion: integer('aggregate_version').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  actorId: text('actor_id').notNull(),
  occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  errorCode: text('error_code'),
  dispatchState: text('dispatch_state'),
  commandEffect: text('command_effect'),
  fiscalCommit: text('fiscal_commit'),
  printDelivery: text('print_delivery')
});

export const purchaseReceipts = sqliteTable('purchase_receipts', {
  id: text('id').primaryKey(),
  originNodeId: text('origin_node_id'),
  supplierId: text('supplier_id').notNull().references(() => suppliers.id),
  supplierLegalName: text('supplier_legal_name').notNull(),
  supplierTradeName: text('supplier_trade_name'),
  supplierTaxCountry: text('supplier_tax_country').notNull(),
  supplierTaxType: text('supplier_tax_type').notNull(),
  supplierTaxValue: text('supplier_tax_value').notNull(),
  supplierTaxNormalizedValue: text('supplier_tax_normalized_value').notNull(),
  supplierFiscalAddressCountry: text('supplier_fiscal_address_country'),
  supplierFiscalAddressLine: text('supplier_fiscal_address_line'),
  sourceType: text('source_type').notNull(),
  sourceNumber: text('source_number').notNull(),
  sourceSeries: text('source_series'),
  sourceControlNumber: text('source_control_number'),
  sourceIssuedAt: integer('source_issued_at', { mode: 'timestamp_ms' }),
  effectiveAt: integer('effective_at', { mode: 'timestamp_ms' }).notNull(),
  status: text('status').notNull(),
  version: integer('version').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  reversedAt: integer('reversed_at', { mode: 'timestamp_ms' }),
  reversedBy: text('reversed_by'),
  reversalReason: text('reversal_reason'),
  replacesReceiptId: text('replaces_receipt_id')
});

export const purchaseReceiptLines = sqliteTable('purchase_receipt_lines', {
  id: text('id').primaryKey(),
  receiptId: text('receipt_id').notNull().references(() => purchaseReceipts.id),
  productId: text('product_id').notNull(),
  stockItemId: text('stock_item_id').notNull(),
  unitCode: text('unit_code').notNull(),
  tracksBatches: integer('tracks_batches', { mode: 'boolean' }).notNull(),
  quantityScaled: integer('quantity_scaled').notNull(),
  quantityScale: integer('quantity_scale').notNull(),
  batchId: text('batch_id'),
  batchLotNumber: text('batch_lot_number'),
  batchExpiresAt: integer('batch_expires_at', { mode: 'timestamp_ms' }),
  purchaseUnitCostMinorUnits: integer('purchase_unit_cost_minor_units').notNull(),
  purchaseCurrencyCode: text('purchase_currency_code').notNull(),
  valuationUnitCostMinorUnits: integer('valuation_unit_cost_minor_units').notNull(),
  valuationCurrencyCode: text('valuation_currency_code').notNull(),
  exchangeRateId: text('exchange_rate_id'),
  exchangeRateBaseCurrency: text('exchange_rate_base_currency'),
  exchangeRateQuoteCurrency: text('exchange_rate_quote_currency'),
  exchangeRateValue: integer('exchange_rate_value'),
  exchangeRateScale: integer('exchange_rate_scale'),
  exchangeRateSource: text('exchange_rate_source'),
  exchangeRateValidFrom: integer('exchange_rate_valid_from', { mode: 'timestamp_ms' }),
  exchangeRateValidUntil: integer('exchange_rate_valid_until', { mode: 'timestamp_ms' }),
  exchangeRateRegisteredBy: text('exchange_rate_registered_by')
});

export const saleReturns = sqliteTable('sale_returns', {
  id: text('id').primaryKey(),
  saleId: text('sale_id').notNull().references(() => sales.id),
  originalDocumentId: text('original_document_id').notNull().references(() => fiscalDocuments.id),
  creditNoteId: text('credit_note_id').notNull().unique().references(() => fiscalDocuments.id),
  shiftId: text('shift_id').notNull().references(() => shifts.id),
  refundMinorUnits: integer('refund_minor_units').notNull(),
  currencyCode: text('currency_code').notNull(),
  paymentMethodCode: text('payment_method_code').notNull(),
  reason: text('reason').notNull(),
  actorId: text('actor_id').notNull(),
  terminalId: text('terminal_id').notNull(),
  originNodeId: text('origin_node_id').notNull(),
  occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull()
});

export const saleReturnLines = sqliteTable('sale_return_lines', {
  id: text('id').primaryKey(),
  saleReturnId: text('sale_return_id').notNull().references(() => saleReturns.id),
  saleItemId: text('sale_item_id').notNull(),
  productId: text('product_id').notNull(),
  stockItemId: text('stock_item_id').notNull().references(() => stockItems.id),
  batchId: text('batch_id').references(() => stockBatches.id),
  quantityScaled: integer('quantity_scaled').notNull(),
  quantityScale: integer('quantity_scale').notNull(),
  unitCostMinorUnits: integer('unit_cost_minor_units'),
  costCurrencyCode: text('cost_currency_code')
});
