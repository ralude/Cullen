/**
 * Contrato de dependencias del servidor.
 *
 * Lo consumen las rutas para declarar qué capacidades reciben, y el runtime
 * para declarar qué compone. Vive aparte del registrador desde 12.05.02: editar
 * una ruta necesita el contrato, no el arranque de Fastify ni el registro de
 * los assets del renderer.
 */
import type {
  application,
  AuthenticateOperator,
  ExecutionContext,
  FiscalReportDto,
  PrintFiscalReportInput,
  RevokeSession,
  VerifySession
} from '@supermarket/core';
import type { AppError, Result } from '@supermarket/shared';

type FiscalReportUseCase = {
  execute(
    input: PrintFiscalReportInput,
    context: ExecutionContext
  ): Promise<Result<FiscalReportDto, AppError>>;
};

export type ServerDependencies = {
  readonly authenticateOperator: AuthenticateOperator;
  readonly verifySession: VerifySession;
  readonly revokeSession: RevokeSession;
  readonly nodeIdentity: { readonly terminalId: string; readonly originNodeId: string };
  readonly simulatedReportsEnabled: boolean;
  readonly catalog: {
    readonly createProduct: application.CreateProduct;
    readonly updateProduct: application.UpdateProduct;
    readonly updatePrice: application.UpdatePrice;
    readonly findProductByBarcode: application.FindProductByBarcode;
  };
  readonly catalogReads?: {
    readonly listProducts: application.ListProducts;
    readonly getPriceHistory: application.GetPriceHistory;
  };
  readonly masterData?: {
    readonly listCategories: application.ListCategories;
    readonly listUnitsOfMeasure: application.ListUnitsOfMeasure;
    readonly listPaymentMethods: application.ListPaymentMethods;
    readonly listCashRegisters: application.ListCashRegisters;
  };
  readonly currency: {
    readonly updateExchangeRate: application.UpdateExchangeRate;
    readonly getCurrentExchangeRate: application.GetCurrentExchangeRate;
    readonly getExchangeRateHistory: application.GetExchangeRateHistory;
    readonly getSuggestedExchangeRate: application.GetSuggestedExchangeRate;
    readonly calculateMixedPaymentTotals: application.CalculateMixedPaymentTotals;
  };
  readonly sales: {
    readonly startSale: application.StartSale;
    readonly getSale: application.GetSale;
    readonly addItemToSale: application.AddItemToSale;
    readonly removeItemFromSale: application.RemoveItemFromSale;
    readonly applyDiscountToSale: application.ApplyDiscountToSale;
    readonly registerMixedPayment: application.RegisterMixedPayment;
    readonly completeSale: application.CompleteSale;
    readonly voidSale: application.VoidSale;
    readonly returnSale: application.ReturnSale;
    readonly setSaleRecipient: application.SetSaleRecipient;
    readonly getSaleHistory: application.GetSaleHistory;
    readonly issueSaleInvoice: application.IssueSaleInvoice;
  };
  readonly cash: {
    readonly openShift: application.OpenShift;
    readonly getOpenShift: application.GetOpenShift;
    readonly getShift: application.GetShift;
    readonly registerCashMovement: application.RegisterCashMovement;
    readonly closeShift: application.CloseShift;
  };
  readonly inventory: {
    readonly receivePurchase: application.ReceivePurchase;
    readonly registerStockAdjustment: application.RegisterStockAdjustment;
    readonly getKardex: application.GetKardex;
  };
  readonly stockCounts: {
    readonly open: application.OpenStockCount;
    readonly recordLine: application.RecordStockCountLine;
    readonly close: application.CloseStockCount;
    readonly approve: application.ApproveStockCount;
    readonly reject: application.RejectStockCount;
    readonly get: application.GetStockCount;
    readonly list: application.ListStockCounts;
  };
  readonly config: {
    readonly branches: {
      readonly create: application.CreateBranch;
      readonly update: application.UpdateBranch;
      readonly changeStatus: application.ChangeBranchStatus;
      readonly get: application.GetBranch;
      readonly list: application.ListBranches;
    };
    readonly devices: {
      readonly declare: application.DeclareDevice;
      readonly update: application.UpdateDevice;
      readonly changeStatus: application.ChangeDeviceStatus;
      readonly list: application.ListDevices;
    };
    readonly operational: {
      readonly list: application.ListOperationalMasterData;
      readonly saveCategory: application.SaveCategory;
      readonly saveUnit: application.SaveUnit;
      readonly savePaymentMethod: application.SavePaymentMethod;
      readonly createCashRegister: application.CreateCashRegister;
      readonly activateDiscountPolicy: application.ActivateDiscountPolicy;
      readonly activateTaxPolicy: application.ActivateFinancialTransactionTaxPolicy;
    };
  };
  readonly suppliers: {
    readonly create: application.CreateSupplier;
    readonly get: application.GetSupplier;
    readonly list: application.ListSuppliers;
    readonly update: application.UpdateSupplier;
    readonly changeStatus: application.ChangeSupplierStatus;
    readonly correctTaxIdentity: application.CorrectSupplierTaxIdentity;
  };
  readonly purchaseReceipts: {
    readonly start: application.StartPurchaseReceipt;
    readonly complete: application.CompletePurchaseReceipt;
    readonly reverse: application.ReversePurchaseReceipt;
    readonly get: application.GetPurchaseReceipt;
  };
  readonly fiscalDocuments: {
    readonly issue: application.IssueFiscalDocument;
    readonly get: application.GetFiscalDocument;
    readonly reconcile: application.ReconcileFiscalState;
  };
  readonly reports?: {
    readonly getCashClosureReport: application.GetCashClosureReport;
    readonly getAuditReport: application.GetAuditReport;
    readonly getFiscalOperationsReport: application.GetFiscalOperationsReport;
    readonly getMarginReport: application.GetMarginReport;
    readonly getSalesReport: application.GetSalesReport;
    readonly getInventoryReport: application.GetInventoryReport;
  };
  readonly fiscalReports?: {
    readonly printX: FiscalReportUseCase;
    readonly printZ: FiscalReportUseCase;
  };
  readonly sync?: {
    readonly registerNode: application.RegisterSyncNode;
    readonly revokeNode: application.RevokeSyncNode;
    readonly listNodes: application.ListSyncNodes;
    readonly publishCatalogBootstrap: application.PublishCatalogBootstrap;
    readonly publishOperatorGrants: application.PublishOperatorGrants;
    readonly listCoordinatedOperations: application.ListCoordinatedOperations;
    readonly getStatus: application.GetSyncStatus;
    readonly getOperationalDiagnostics: application.GetOperationalDiagnostics;
    readonly listPaused: application.ListPausedDeliveries;
    readonly resumeDelivery: application.ResumeSyncDelivery;
    readonly listDiscrepancies: application.ListSyncDiscrepancies;
    readonly retryDiscrepancy: application.RetrySyncDiscrepancy;
    readonly resolveDiscrepancy: application.ResolveSyncDiscrepancy;
  };
  /**
   * Administración de identidad y credenciales locales. El nodo la compone
   * siempre: los comandos de operadores y roles fallan cerrado en una terminal
   * (ADR-0027 D5) y el enrolamiento es local por definición (ADR-0028).
   */
  readonly identity: {
    readonly directory: application.GetIdentityDirectory;
    readonly createOperator: application.CreateOperator;
    readonly updateOperator: application.UpdateOperator;
    readonly changeOperatorStatus: application.ChangeOperatorStatus;
    readonly assignOperatorRoles: application.AssignOperatorRoles;
    readonly createRole: application.CreateRole;
    readonly updateRolePermissions: application.UpdateRolePermissions;
    readonly changeRoleStatus: application.ChangeRoleStatus;
    readonly expireCredential: application.ExpireOperatorCredential;
    readonly authorizeEnrollment: application.AuthorizeCredentialEnrollment;
    readonly completeEnrollment: application.CompleteCredentialEnrollment;
    readonly changeOwnPin: application.ChangeOwnPin;
  };
  readonly close?: () => void | Promise<void>;
};