export * from './domain/currency/index.js';
export * from './domain/catalog/index.js';
export * from './domain/cash/index.js';
export * from './domain/identity/index.js';
export * from './domain/inventory/index.js';
export * from './domain/purchasing/index.js';
export * from './domain/config/index.js';
export * from './domain/fiscal/index.js';
export * from './domain/sales/index.js';
export * as application from './application/index.js';
export { toBusinessEvents } from './application/events/index.js';
export type { BusinessEventV1, DomainEventLike, JsonValue } from './application/events/index.js';
export type { ExecutionContext } from './application/execution-context.js';
export type {
  AuditReportEntryDto,
  AuditReportInput,
  CashClosureBalanceDto,
  CashClosureReportEntryDto,
  CashClosureReportInput,
  FiscalOperationReportEntryDto,
  FiscalOperationsReportInput,
  InventoryReportEntryDto,
  InventoryReportInput,
  MarginReportEntryDto,
  MarginReportInput,
  SalesReportEntryDto,
  SalesReportInput,
  ResolvedReportQuery
} from './application/reporting/index.js';
export type {
  ExchangeRateDto,
  ExchangeRateSuggestionDto
} from './application/currency/index.js';
export type {
  FiscalDocumentDto,
  FiscalReportDto,
  PrintFiscalReportInput
} from './application/fiscal/index.js';
export {
  AUTH_POLICY,
  AuthenticateOperator,
  ProvisionInitialAdmin,
  RevokeSession,
  VerifySession
} from './application/identity/index.js';
export type {
  AuthenticationCompletion,
  AuthenticationRecord,
  AuthenticationStore,
  OperatorGrantState,
  PinHasher,
  SessionPrincipal,
  SessionTokenService
} from './application/identity/index.js';
export type {
  AggregateAuthority,
  AggregateAuthorityRegistration,
  AggregateAuthorityRegistrationOutcome,
  AggregateAuthorityRegistry,
  AuthorizationService,
  AuditEntry,
  AuditWriter,
  BusinessEventStore,
  CashRegisterRepository,
  CatalogReadRepository,
  CatalogReferenceProjection,
  CatalogReferenceSource,
  OperationalPolicyReference,
  OperatorGrantReference,
  OperatorGrantSource,
  StockAvailabilityReference,
  VersionedMaster,
  CategoryReference,
  ExchangeRateReference,
  PaymentMethodReference,
  ProjectedOperationalPolicyReference,
  ProjectedOperatorGrantReference,
  ProjectedStockAvailabilityReference,
  ProductReference,
  ReferenceApplication,
  ReferenceEntryFreshness,
  ReferenceFreshness,
  UnitOfMeasureReference,
  CategoryRepository,
  Clock,
  EventPublisher,
  DiscountPolicy,
  DiscountPolicyProvider,
  ExchangeRateRepository,
  ExchangeRateHistoryRepository,
  ExchangeRateProvider,
  FinancialTransactionTaxPolicy,
  FinancialTransactionTaxPolicyProvider,
  FiscalDocumentLinePayload,
  FiscalDocumentPaymentPayload,
  FiscalDocumentPayload,
  FiscalDocumentPrintConfirmation,
  FiscalPrinterErrorCode,
  FiscalPrinterFailure,
  FiscalPrinterPort,
  FiscalPrinterResult,
  FiscalPrinterStatus,
  FiscalReportPrintConfirmation,
  FiscalDocumentRepository,
  FiscalDayRepository,
  IdGenerator,
  IdempotencyRecord,
  IdempotencyStore,
  OutboxDestinationSummary,
  OutboxEvent,
  OutboxStore,
  PaymentMethodRepository,
  ProductSnapshotProvider,
  SaleCostSnapshotProvider,
  ProductRepository,
  SaleRepository,
  SaleReturnRepository,
  ShiftRepository,
  StockItemRepository,
  StockCountRepository,
  BranchRepository,
  DeviceRepository,
  SupplierRepository,
  PurchaseReceiptRepository,
  DiscountPolicyInput,
  FinancialTransactionTaxPolicyInput,
  OperationalPolicyMetadata,
  OperationalPolicyWriter,
  OperationalMasterDataStore,
  PolicyActivation,
  UnitOfWork,
  UnitOfMeasureRepository,
  AuditReportRepository,
  CashClosureReportRepository,
  FiscalOperationsReportRepository,
  InventoryReportRepository,
  MarginReportRepository,
  SalesReportRepository,
  ReceivedSyncEvent,
  RegisteredSyncNode,
  SyncCustodyRecord,
  SyncDiscrepancyInput,
  SyncDiscrepancyRecord,
  SyncInboxWorkItem,
  SyncApplicationProgress,
  SyncInboxWorkStore,
  SyncNodeRegistration,
  SyncNodeRegistry,
  SyncNodeRole,
  SyncQuarantineEntry,
  SyncReceptionStore,
  SyncSenderContext
} from './application/ports/index.js';
export { COORDINATED_OPERATION_KINDS } from './application/ports/index.js';
export type {
  BeginCoordinatedOperationInput,
  CoordinatedOperationKind,
  CoordinatedOperationRecord,
  CoordinatedOperationStatus,
  CoordinatedOperationStore,
  CoordinatedStepName,
  CoordinatedStepRecord,
  CoordinatedStepState,
  CoordinatorLink,
  RemoteApplicationProbe,
  RemoteApplicationState,
  AppliedSaleIssueLine,
  RemoteSaleIssueProbe,
  SaleIssueApplicationState,
  SaleIssueEvidence,
  SaleIssueEvidenceReader
} from './application/ports/index.js';
export type {
  CommercialProjection,
  ProjectedCashMovement,
  ProjectedFiscalEntry,
  ProjectedMoney,
  ProjectedSale,
  ProjectedSaleReturn,
  ProjectedShiftBalance,
  ProjectedShiftClosure,
  ProjectedShiftOpening
} from './application/ports/index.js';
