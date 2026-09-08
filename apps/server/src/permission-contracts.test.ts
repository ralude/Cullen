import {
  applySaleDiscountContract,
  activateDiscountPolicyContract,
  activateTaxPolicyContract,
  approveStockCountContract,
  closeStockCountContract,
  changeBranchStatusContract,
  changeDeviceStatusContract,
  closeShiftContract,
  getShiftContract,
  getSaleHistoryContract,
  changeSupplierStatusContract,
  completePurchaseReceiptContract,
  correctSupplierTaxIdentityContract,
  createProductContract,
  createCashRegisterContract,
  createSupplierContract,
  createBranchContract,
  declareDeviceContract,
  getBranchContract,
  getPurchaseReceiptContract,
  getStockCountContract,
  getSupplierContract,
  getAuditReportContract,
  getCashClosureReportContract,
  getFiscalOperationsReportContract,
  getKardexContract,
  getMarginReportContract,
  getSalesReportContract,
  getInventoryReportContract,
  issueSaleInvoiceContract,
  issueSimulatedFiscalDocumentContract,
  listBranchesContract,
  listDevicesContract,
  listOperationalMasterDataContract,
  listStockCountsContract,
  getSyncStatusContract,
  listPausedDeliveriesContract,
  listSyncDiscrepanciesContract,
  listSyncNodesContract,
  resolveSyncDiscrepancyContract,
  resumeSyncDeliveryContract,
  retrySyncDiscrepancyContract,
  registerSyncNodeContract,
  revokeSyncNodeContract,
  listSuppliersContract,
  openStockCountContract,
  openShiftContract,
  printSimulatedXReportContract,
  printSimulatedZReportContract,
  listCoordinatedOperationsContract,
  publishCatalogBootstrapContract,
  publishOperatorGrantsContract,
  receivePurchaseContract,
  saveCategoryContract,
  savePaymentMethodContract,
  saveUnitContract,
  recordStockCountLineContract,
  rejectStockCountContract,
  reconcileSimulatedFiscalDocumentContract,
  registerCashMovementContract,
  registerStockAdjustmentContract,
  reversePurchaseReceiptContract,
  returnSaleContract,
  startPurchaseReceiptContract,
  updateExchangeRateContract,
  updateBranchContract,
  updateDeviceContract,
  updatePriceContract,
  updateProductContract,
  updateSupplierContract,
  voidSaleContract,
  type HttpContractV1
} from '@supermarket/shared';
import { application } from '@supermarket/core';
import { describe, expect, it } from 'vitest';

/**
 * Cruza el permiso que cada contrato HTTP declara con la constante que su
 * caso de uso realmente exige. El campo `permission` de un contrato no lo lee
 * ningún transporte: sin esta prueba puede desviarse en silencio de la regla
 * real de autorización y la interfaz ofrecería una acción que el servidor
 * rechazaría, o esconder una que sí está permitida.
 */
const expectedPermission = (contract: HttpContractV1, ...permissions: readonly string[]): void => {
  expect(contract.permission).toBe(permissions.join('|'));
};

describe('el permiso declarado por cada contrato coincide con el que su caso de uso exige', () => {
  it('caja', () => {
    expectedPermission(openShiftContract, application.CASH_PERMISSIONS.OPEN_SHIFT);
    expectedPermission(
      registerCashMovementContract,
      application.CASH_PERMISSIONS.REGISTER_INCOME,
      application.CASH_PERMISSIONS.REGISTER_WITHDRAWAL
    );
    expectedPermission(closeShiftContract, application.CASH_PERMISSIONS.CLOSE_SHIFT);
    expectedPermission(getShiftContract, application.CASH_PERMISSIONS.READ_SHIFT);
  });

  it('catalogo', () => {
    expectedPermission(createProductContract, application.CATALOG_PERMISSIONS.CREATE_PRODUCT);
    expectedPermission(updateProductContract, application.CATALOG_PERMISSIONS.UPDATE_PRODUCT);
    expectedPermission(updatePriceContract, application.CATALOG_PERMISSIONS.UPDATE_PRICE);
  });

  it('moneda', () => {
    expectedPermission(updateExchangeRateContract, application.CURRENCY_PERMISSIONS.UPDATE_RATE);
  });

  it('fiscal', () => {
    expectedPermission(issueSimulatedFiscalDocumentContract, application.FISCAL_PERMISSIONS.ISSUE_DOCUMENT);
    expectedPermission(issueSaleInvoiceContract, application.FISCAL_PERMISSIONS.ISSUE_DOCUMENT);
    expectedPermission(reconcileSimulatedFiscalDocumentContract, application.FISCAL_PERMISSIONS.RECONCILE);
    expectedPermission(printSimulatedXReportContract, application.FISCAL_PERMISSIONS.PRINT_X_REPORT);
    expectedPermission(printSimulatedZReportContract, application.FISCAL_PERMISSIONS.PRINT_Z_REPORT);
  });

  it('inventario', () => {
    expectedPermission(receivePurchaseContract, application.INVENTORY_PERMISSIONS.RECEIVE_PURCHASE);
    expectedPermission(
      registerStockAdjustmentContract,
      application.INVENTORY_PERMISSIONS.REGISTER_WASTE,
      application.INVENTORY_PERMISSIONS.REGISTER_ADJUSTMENT
    );
    expectedPermission(getKardexContract, application.INVENTORY_PERMISSIONS.READ_KARDEX);
  });

  it('conteos', () => {
    expectedPermission(openStockCountContract, application.INVENTORY_PERMISSIONS.PERFORM_COUNT);
    expectedPermission(recordStockCountLineContract, application.INVENTORY_PERMISSIONS.PERFORM_COUNT);
    expectedPermission(closeStockCountContract, application.INVENTORY_PERMISSIONS.PERFORM_COUNT);
    expectedPermission(approveStockCountContract, application.INVENTORY_PERMISSIONS.APPROVE_COUNT);
    expectedPermission(rejectStockCountContract, application.INVENTORY_PERMISSIONS.APPROVE_COUNT);
    expectedPermission(getStockCountContract, application.INVENTORY_PERMISSIONS.READ_COUNT);
    expectedPermission(listStockCountsContract, application.INVENTORY_PERMISSIONS.READ_COUNT);
  });

  it('configuracion', () => {
    for (const contract of [createBranchContract, updateBranchContract, changeBranchStatusContract,
      getBranchContract, listBranchesContract]) {
      expectedPermission(contract, application.CONFIG_PERMISSIONS.MANAGE_BRANCH);
    }
    for (const contract of [declareDeviceContract, updateDeviceContract, changeDeviceStatusContract,
      listDevicesContract]) {
      expectedPermission(contract, application.CONFIG_PERMISSIONS.MANAGE_DEVICE);
    }
    expectedPermission(saveCategoryContract, application.CATALOG_PERMISSIONS.UPDATE_PRODUCT);
    expectedPermission(saveUnitContract, application.CATALOG_PERMISSIONS.UPDATE_PRODUCT);
    expectedPermission(savePaymentMethodContract, application.CONFIG_PERMISSIONS.MANAGE_PAYMENT_METHOD);
    expectedPermission(createCashRegisterContract, application.CONFIG_PERMISSIONS.MANAGE_CASH_REGISTER);
    expectedPermission(activateDiscountPolicyContract, application.CONFIG_PERMISSIONS.MANAGE_TAX);
    expectedPermission(activateTaxPolicyContract, application.CONFIG_PERMISSIONS.MANAGE_TAX);
    expectedPermission(
      listOperationalMasterDataContract,
      application.CATALOG_PERMISSIONS.UPDATE_PRODUCT,
      application.CONFIG_PERMISSIONS.MANAGE_PAYMENT_METHOD
    );
  });

  it('reportes', () => {
    expectedPermission(getCashClosureReportContract, application.REPORT_PERMISSIONS.READ_CASH);
    expectedPermission(getAuditReportContract, application.REPORT_PERMISSIONS.READ_AUDIT);
    expectedPermission(getFiscalOperationsReportContract, application.REPORT_PERMISSIONS.READ_FISCAL);
    expectedPermission(getMarginReportContract, application.REPORT_PERMISSIONS.READ_MARGIN);
    expectedPermission(getSalesReportContract, application.REPORT_PERMISSIONS.READ_SALES);
    expectedPermission(getInventoryReportContract, application.REPORT_PERMISSIONS.READ_INVENTORY);
  });

  it('proveedores', () => {
    expectedPermission(getSupplierContract, application.SUPPLIER_PERMISSIONS.READ);
    expectedPermission(listSuppliersContract, application.SUPPLIER_PERMISSIONS.READ);
    expectedPermission(createSupplierContract, application.SUPPLIER_PERMISSIONS.CREATE);
    expectedPermission(updateSupplierContract, application.SUPPLIER_PERMISSIONS.UPDATE);
    expectedPermission(changeSupplierStatusContract, application.SUPPLIER_PERMISSIONS.UPDATE);
    expectedPermission(
      correctSupplierTaxIdentityContract,
      application.SUPPLIER_PERMISSIONS.CORRECT_TAX_IDENTITY
    );
  });

  it('recepciones de compra', () => {
    expectedPermission(getPurchaseReceiptContract, application.PURCHASE_RECEIPT_PERMISSIONS.READ);
    expectedPermission(startPurchaseReceiptContract, application.PURCHASE_RECEIPT_PERMISSIONS.START);
    expectedPermission(completePurchaseReceiptContract, application.PURCHASE_RECEIPT_PERMISSIONS.COMPLETE);
    expectedPermission(reversePurchaseReceiptContract, application.PURCHASE_RECEIPT_PERMISSIONS.REVERSE);
  });

  it('sincronización', () => {
    expectedPermission(registerSyncNodeContract, application.SYNC_PERMISSIONS.MANAGE_NODE);
    expectedPermission(revokeSyncNodeContract, application.SYNC_PERMISSIONS.MANAGE_NODE);
    expectedPermission(listSyncNodesContract, application.SYNC_PERMISSIONS.MANAGE_NODE);
    expectedPermission(getSyncStatusContract, application.SYNC_PERMISSIONS.REVIEW_RECEPTION);
    expectedPermission(listPausedDeliveriesContract, application.SYNC_PERMISSIONS.REVIEW_RECEPTION);
    expectedPermission(listSyncDiscrepanciesContract, application.SYNC_PERMISSIONS.REVIEW_RECEPTION);
    expectedPermission(resumeSyncDeliveryContract, application.SYNC_PERMISSIONS.RESUME_DELIVERY);
    expectedPermission(retrySyncDiscrepancyContract, application.SYNC_PERMISSIONS.RESOLVE_DISCREPANCY);
    expectedPermission(resolveSyncDiscrepancyContract, application.SYNC_PERMISSIONS.RESOLVE_DISCREPANCY);
    expectedPermission(publishCatalogBootstrapContract, application.SYNC_PERMISSIONS.PUBLISH_REFERENCES);
    expectedPermission(publishOperatorGrantsContract, application.SYNC_PERMISSIONS.PUBLISH_REFERENCES);
    expectedPermission(listCoordinatedOperationsContract, application.SYNC_PERMISSIONS.REVIEW_RECEPTION);
  });

  it('venta', () => {
    expectedPermission(applySaleDiscountContract, application.SALE_PERMISSIONS.APPLY_DISCOUNT);
    expectedPermission(voidSaleContract, application.SALE_PERMISSIONS.VOID);
    expectedPermission(returnSaleContract, application.SALE_PERMISSIONS.RETURN);
    expectedPermission(getSaleHistoryContract, application.SALE_PERMISSIONS.READ_HISTORY);
  });
});
