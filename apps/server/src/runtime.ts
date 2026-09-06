import {
  application,
  AuthenticateOperator,
  ProvisionInitialAdmin,
  RevokeSession,
  VerifySession
} from '@supermarket/core';
import {
  applyMigrations,
  DrizzleAuditWriter,
  DrizzleBusinessEventStore,
  DrizzleCashRegisterRepository,
  DrizzleCategoryRepository,
  DrizzleExchangeRateRepository,
  DrizzleFiscalDayRepository,
  DrizzleFiscalDocumentRepository,
  DrizzleIdempotencyStore,
  DrizzleOutboxStore,
  DrizzlePaymentMethodRepository,
  DrizzleProductRepository,
  DrizzleCatalogReadRepository,
  DrizzleAuditReportRepository,
  DrizzleCashClosureReportRepository,
  DrizzleFiscalOperationsReportRepository,
  DrizzleInventoryReportRepository,
  DrizzleMarginReportRepository,
  DrizzleSalesReportRepository,
  DrizzleProductSnapshotProvider,
  DrizzleSaleRepository,
  DrizzleShiftRepository,
  DrizzleStockItemRepository,
  DrizzleStockCountRepository,
  DrizzleBranchRepository,
  DrizzleDeviceRepository,
  DrizzleSupplierRepository,
  DrizzlePurchaseReceiptRepository,
  DrizzleSaleReturnRepository,
  DrizzleUnitOfMeasureRepository,
  openDatabase,
  SqliteAuthenticationStore,
  SqliteAuthorizationService,
  SqliteDiscountPolicyProvider,
  SqliteFinancialTransactionTaxPolicyProvider,
  SqliteOperationalMasterDataStore,
  SqliteOperationalPolicyWriter,
  SqliteUnitOfWork,
  type DatabaseHandle
} from '@supermarket/driver-db';
import { FiscalPrinterFake } from '@supermarket/driver-fiscal';
import { HttpExchangeRateProvider, UnavailableExchangeRateProvider } from '@supermarket/driver-exchange-rate';
import {
  CryptoSessionTokenService,
  ScryptPinHasher,
  SystemClock,
  UuidV7Generator,
  type NodeIdentity
} from '@supermarket/driver-security';
import type { ServerDependencies } from './app.ts';

export const ADMIN_PERMISSIONS = Object.freeze([
  ...Object.values(application.SALE_PERMISSIONS),
  ...Object.values(application.CASH_PERMISSIONS),
  ...Object.values(application.INVENTORY_PERMISSIONS),
  ...Object.values(application.FISCAL_PERMISSIONS),
  ...Object.values(application.CATALOG_PERMISSIONS),
  ...Object.values(application.CURRENCY_PERMISSIONS),
  ...Object.values(application.REPORT_PERMISSIONS),
  ...Object.values(application.SUPPLIER_PERMISSIONS),
  ...Object.values(application.PURCHASE_RECEIPT_PERMISSIONS),
  ...Object.values(application.CONFIG_PERMISSIONS)
]) as readonly string[];

export type SecurityRuntime = {
  readonly handle: DatabaseHandle;
  readonly dependencies: ServerDependencies;
  readonly provisionInitialAdmin: ProvisionInitialAdmin;
  readonly fiscalPrinter: FiscalPrinterFake;
};

export const createSecurityRuntime = (
  databasePath: string,
  nodeIdentity: NodeIdentity,
  fiscalConfiguration: {
    readonly executionTarget?: string;
    readonly reportConsent?: string;
  } = {}
): SecurityRuntime => {
  const handle = openDatabase(databasePath);
  applyMigrations(handle.sqlite);
  const store = new SqliteAuthenticationStore(handle);
  const pinHasher = new ScryptPinHasher();
  const tokens = new CryptoSessionTokenService();
  const clock = new SystemClock();
  const ids = new UuidV7Generator();
  const simulatedReportsEnabled = fiscalConfiguration.executionTarget === 'SIMULATOR'
    && fiscalConfiguration.reportConsent === 'ALLOW_SIMULATED_X_AND_Z';
  const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
  const fiscalDayRepository = new DrizzleFiscalDayRepository(handle);
  const authorization = new SqliteAuthorizationService(store);
  const eventStore = new DrizzleBusinessEventStore(handle);
  const outboxStore = new DrizzleOutboxStore(handle);
  const auditWriter = new DrizzleAuditWriter(handle);
  const idempotencyStore = new DrizzleIdempotencyStore(handle);
  const productRepository = new DrizzleProductRepository(handle);
  const catalogReadRepository = new DrizzleCatalogReadRepository(handle);
  const categoryRepository = new DrizzleCategoryRepository(handle);
  const unitRepository = new DrizzleUnitOfMeasureRepository(handle);
  const exchangeRateRepository = new DrizzleExchangeRateRepository(handle);
  const exchangeRateProvider = process.env.EXCHANGE_RATE_PROVIDER_URL
    ? new HttpExchangeRateProvider({
      endpoint: process.env.EXCHANGE_RATE_PROVIDER_URL,
      source: process.env.EXCHANGE_RATE_PROVIDER_SOURCE ?? 'Proveedor externo configurado',
      timeoutMs: Number(process.env.EXCHANGE_RATE_PROVIDER_TIMEOUT_MS) || 5000
    })
    : new UnavailableExchangeRateProvider();
  const saleRepository = new DrizzleSaleRepository(handle);
  const shiftRepository = new DrizzleShiftRepository(handle);
  const productSnapshotProvider = new DrizzleProductSnapshotProvider(handle);
  const paymentMethodRepository = new DrizzlePaymentMethodRepository(handle);
  const cashRegisterRepository = new DrizzleCashRegisterRepository(handle);
  const discountPolicyProvider = new SqliteDiscountPolicyProvider(handle);
  const taxPolicyProvider = new SqliteFinancialTransactionTaxPolicyProvider(handle);
  const operationalMasterDataStore = new SqliteOperationalMasterDataStore(handle);
  const operationalPolicyWriter = new SqliteOperationalPolicyWriter(handle);
  const stockItemRepository = new DrizzleStockItemRepository(handle);
  const stockCountRepository = new DrizzleStockCountRepository(handle);
  const branchRepository = new DrizzleBranchRepository(handle);
  const deviceRepository = new DrizzleDeviceRepository(handle);
  const supplierRepository = new DrizzleSupplierRepository(handle);
  const purchaseReceiptRepository = new DrizzlePurchaseReceiptRepository(handle);
  const saleReturnRepository = new DrizzleSaleReturnRepository(handle);
  const fiscalPrinter = new FiscalPrinterFake();
  const fiscalDocumentRepository = new DrizzleFiscalDocumentRepository(handle);
  const fiscalArguments = [
    fiscalDayRepository,
    fiscalPrinter,
    authorization,
    ids,
    ids,
    ids,
    clock,
    unitOfWork,
    eventStore,
    outboxStore,
    auditWriter
  ] as const;
  return {
    handle,
    fiscalPrinter,
    dependencies: {
      authenticateOperator: new AuthenticateOperator(store, pinHasher, tokens, clock),
      verifySession: new VerifySession(store, tokens, clock),
      revokeSession: new RevokeSession(store, tokens, clock),
      nodeIdentity,
      simulatedReportsEnabled,
      catalog: {
        createProduct: new application.CreateProduct(
          ids, productRepository, categoryRepository, unitRepository, clock,
          authorization, unitOfWork, eventStore, outboxStore, idempotencyStore, auditWriter
        ),
        updateProduct: new application.UpdateProduct(
          productRepository, categoryRepository, unitRepository, ids, clock,
          authorization, unitOfWork, idempotencyStore, auditWriter
        ),
        updatePrice: new application.UpdatePrice(
          productRepository, ids, ids, clock, authorization, unitOfWork,
          eventStore, outboxStore, idempotencyStore, auditWriter
        ),
        findProductByBarcode: new application.FindProductByBarcode(productRepository)
      },
      catalogReads: {
        listProducts: new application.ListProducts(catalogReadRepository),
        getPriceHistory: new application.GetPriceHistory(catalogReadRepository)
      },
      masterData: {
        listCategories: new application.ListCategories(categoryRepository),
        listUnitsOfMeasure: new application.ListUnitsOfMeasure(unitRepository),
        listPaymentMethods: new application.ListPaymentMethods(paymentMethodRepository),
        listCashRegisters: new application.ListCashRegisters(cashRegisterRepository)
      },
      currency: {
        updateExchangeRate: new application.UpdateExchangeRate(
          ids, exchangeRateRepository, authorization, clock,
          unitOfWork, idempotencyStore, auditWriter
        ),
        getCurrentExchangeRate: new application.GetCurrentExchangeRate(clock, exchangeRateRepository),
        getExchangeRateHistory: new application.GetExchangeRateHistory(exchangeRateRepository),
        getSuggestedExchangeRate: new application.GetSuggestedExchangeRate(exchangeRateProvider),
        calculateMixedPaymentTotals: new application.CalculateMixedPaymentTotals(
          clock, exchangeRateRepository
        )
      },
      sales: {
        startSale: new application.StartSale(
          ids, ids, saleRepository, clock, shiftRepository,
          unitOfWork, eventStore, idempotencyStore
        ),
        getSale: new application.GetSale(saleRepository),
        addItemToSale: new application.AddItemToSale(
          saleRepository, productSnapshotProvider, ids, ids, clock,
          unitOfWork, eventStore, idempotencyStore
        ),
        removeItemFromSale: new application.RemoveItemFromSale(
          saleRepository, ids, clock, unitOfWork, eventStore, idempotencyStore
        ),
        applyDiscountToSale: new application.ApplyDiscountToSale(
          saleRepository, ids, ids, clock, discountPolicyProvider, authorization,
          unitOfWork, eventStore, auditWriter, idempotencyStore
        ),
        registerMixedPayment: new application.RegisterMixedPayment(
          saleRepository, paymentMethodRepository, exchangeRateRepository,
          taxPolicyProvider, ids, ids, clock, unitOfWork, eventStore, idempotencyStore
        ),
        completeSale: new application.CompleteSale(
          saleRepository, ids, clock, unitOfWork, eventStore, outboxStore, idempotencyStore
        ),
        voidSale: new application.VoidSale(
          saleRepository, authorization, ids, clock, unitOfWork,
          eventStore, auditWriter, idempotencyStore
        ),
        returnSale: new application.ReturnSale(
          saleRepository, saleReturnRepository, fiscalDocumentRepository, shiftRepository,
          stockItemRepository, fiscalPrinter, authorization, ids, ids, ids, ids, ids, clock,
          unitOfWork, eventStore, outboxStore, auditWriter, idempotencyStore
        ),
        setSaleRecipient: new application.SetSaleRecipient(
          saleRepository, ids, clock, unitOfWork, eventStore, idempotencyStore
        ),
        getSaleHistory: new application.GetSaleHistory(
          eventStore, saleReturnRepository, authorization
        )
      },
      cash: {
        openShift: new application.OpenShift(
          cashRegisterRepository, shiftRepository,
          paymentMethodRepository, authorization, ids, ids, ids, clock,
          unitOfWork, eventStore, outboxStore, auditWriter, ids, idempotencyStore
        ),
        getOpenShift: new application.GetOpenShift(shiftRepository),
        getShift: new application.GetShift(shiftRepository, authorization),
        registerCashMovement: new application.RegisterCashMovement(
          shiftRepository, paymentMethodRepository, authorization, ids, ids, clock,
          unitOfWork, eventStore, outboxStore, auditWriter, ids, idempotencyStore
        ),
        closeShift: new application.CloseShift(
          shiftRepository, paymentMethodRepository, authorization, ids, clock,
          unitOfWork, eventStore, outboxStore, auditWriter, ids, idempotencyStore
        )
      },
      inventory: {
        receivePurchase: new application.ReceivePurchase(
          stockItemRepository, supplierRepository, productRepository, authorization,
          ids, ids, ids, ids, ids, clock, unitOfWork, eventStore, auditWriter, idempotencyStore
        ),
        registerStockAdjustment: new application.RegisterStockAdjustment(
          stockItemRepository, authorization, ids, ids, ids, clock,
          unitOfWork, eventStore, auditWriter, idempotencyStore
        ),
        getKardex: new application.GetKardex(stockItemRepository, authorization)
      },
      stockCounts: {
        open: new application.OpenStockCount(
          stockCountRepository, authorization, ids, ids, clock, unitOfWork, auditWriter, idempotencyStore
        ),
        recordLine: new application.RecordStockCountLine(
          stockCountRepository, stockItemRepository, authorization, ids, ids,
          clock, unitOfWork, auditWriter, idempotencyStore
        ),
        close: new application.CloseStockCount(
          stockCountRepository, stockItemRepository, authorization, ids,
          clock, unitOfWork, auditWriter, idempotencyStore
        ),
        approve: new application.ApproveStockCount(
          stockCountRepository, stockItemRepository, authorization, ids, ids, ids,
          clock, unitOfWork, eventStore, auditWriter, idempotencyStore
        ),
        reject: new application.RejectStockCount(
          stockCountRepository, authorization, ids, clock, unitOfWork, auditWriter, idempotencyStore
        ),
        get: new application.GetStockCount(stockCountRepository, authorization),
        list: new application.ListStockCounts(stockCountRepository, authorization)
      },
      config: {
        branches: {
          create: new application.CreateBranch(
            branchRepository, authorization, ids, clock, unitOfWork, auditWriter, idempotencyStore
          ),
          update: new application.UpdateBranch(
            branchRepository, authorization, ids, clock, unitOfWork, auditWriter, idempotencyStore
          ),
          changeStatus: new application.ChangeBranchStatus(
            branchRepository, authorization, ids, clock, unitOfWork, auditWriter, idempotencyStore
          ),
          get: new application.GetBranch(branchRepository, authorization),
          list: new application.ListBranches(branchRepository, authorization)
        },
        devices: {
          declare: new application.DeclareDevice(
            deviceRepository, authorization, ids, clock, unitOfWork, auditWriter, idempotencyStore
          ),
          update: new application.UpdateDevice(
            deviceRepository, authorization, ids, clock, unitOfWork, auditWriter, idempotencyStore
          ),
          changeStatus: new application.ChangeDeviceStatus(
            deviceRepository, authorization, ids, clock, unitOfWork, auditWriter, idempotencyStore
          ),
          list: new application.ListDevices(deviceRepository, authorization)
        },
        operational: {
          list: new application.ListOperationalMasterData(operationalMasterDataStore, authorization),
          saveCategory: new application.SaveCategory(
            operationalMasterDataStore, authorization, ids, clock, unitOfWork, auditWriter, idempotencyStore
          ),
          saveUnit: new application.SaveUnit(
            operationalMasterDataStore, authorization, ids, clock, unitOfWork, auditWriter, idempotencyStore
          ),
          savePaymentMethod: new application.SavePaymentMethod(
            operationalMasterDataStore, authorization, ids, clock, unitOfWork, auditWriter, idempotencyStore
          ),
          activateDiscountPolicy: new application.ActivateDiscountPolicy(
            operationalPolicyWriter, authorization, ids, clock, unitOfWork, auditWriter, idempotencyStore
          ),
          activateTaxPolicy: new application.ActivateFinancialTransactionTaxPolicy(
            operationalPolicyWriter, authorization, ids, clock, unitOfWork, auditWriter, idempotencyStore
          )
        }
      },
      suppliers: {
        create: new application.CreateSupplier(
          supplierRepository, authorization, ids, clock, unitOfWork, auditWriter, idempotencyStore
        ),
        get: new application.GetSupplier(supplierRepository, authorization),
        list: new application.ListSuppliers(supplierRepository, authorization),
        update: new application.UpdateSupplier(
          supplierRepository, authorization, ids, clock, unitOfWork, auditWriter, idempotencyStore
        ),
        changeStatus: new application.ChangeSupplierStatus(
          supplierRepository, authorization, ids, clock, unitOfWork, auditWriter, idempotencyStore
        ),
        correctTaxIdentity: new application.CorrectSupplierTaxIdentity(
          supplierRepository, authorization, ids, clock, unitOfWork, auditWriter, idempotencyStore
        )
      },
      purchaseReceipts: {
        start: new application.StartPurchaseReceipt(
          purchaseReceiptRepository, supplierRepository, productRepository, stockItemRepository,
          exchangeRateRepository, authorization, ids, ids, ids, ids, ids, clock, unitOfWork,
          auditWriter, idempotencyStore
        ),
        complete: new application.CompletePurchaseReceipt(
          purchaseReceiptRepository, supplierRepository, stockItemRepository, authorization,
          ids, ids, ids, clock, unitOfWork, eventStore, auditWriter, idempotencyStore
        ),
        reverse: new application.ReversePurchaseReceipt(
          purchaseReceiptRepository, stockItemRepository, authorization,
          ids, ids, ids, clock, unitOfWork, eventStore, auditWriter, idempotencyStore
        ),
        get: new application.GetPurchaseReceipt(purchaseReceiptRepository, authorization)
      },
      fiscalDocuments: {
        issue: new application.IssueFiscalDocument(
          fiscalDocumentRepository, fiscalPrinter, authorization, ids, ids, ids,
          clock, unitOfWork, eventStore, outboxStore, auditWriter
        ),
        get: new application.GetFiscalDocument(fiscalDocumentRepository),
        reconcile: new application.ReconcileFiscalState(
          fiscalDocumentRepository, fiscalPrinter, authorization, ids, ids,
          clock, unitOfWork, eventStore, outboxStore, auditWriter
        )
      },
      reports: {
        getCashClosureReport: new application.GetCashClosureReport(
          new DrizzleCashClosureReportRepository(handle), authorization
        ),
        getAuditReport: new application.GetAuditReport(
          new DrizzleAuditReportRepository(handle), authorization
        ),
        getFiscalOperationsReport: new application.GetFiscalOperationsReport(
          new DrizzleFiscalOperationsReportRepository(handle), authorization
        ),
        getMarginReport: new application.GetMarginReport(
          new DrizzleMarginReportRepository(handle), authorization
        ),
        getSalesReport: new application.GetSalesReport(
          new DrizzleSalesReportRepository(handle), authorization
        ),
        getInventoryReport: new application.GetInventoryReport(
          new DrizzleInventoryReportRepository(handle), authorization
        )
      },
      ...(simulatedReportsEnabled ? {
        fiscalReports: {
          printX: new application.PrintXReport(...fiscalArguments),
          printZ: new application.PrintZReport(...fiscalArguments)
        }
      } : {}),
      close: () => handle.close()
    },
    provisionInitialAdmin: new ProvisionInitialAdmin(store, pinHasher, ids, clock)
  };
};
