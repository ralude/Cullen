import {
  addSaleItemContract,
  applySaleDiscountContract,
  capabilitiesContract,
  closeShiftContract,
  completeSaleContract,
  returnSaleContract,
  currentSessionContract,
  findProductByBarcodeContract,
  getAuditReportContract,
  getCashClosureReportContract,
  getCurrentExchangeRateContract,
  getExchangeRateHistoryContract,
  getFiscalOperationsReportContract,
  getInventoryReportContract,
  getMarginReportContract,
  getSalesReportContract,
  getShiftContract,
  getSaleHistoryContract,
  issueSaleInvoiceContract,
  startPurchaseReceiptContract,
  completePurchaseReceiptContract,
  reversePurchaseReceiptContract,
  getKardexContract,
  getOpenShiftContract,
  getSaleContract,
  getSuggestedExchangeRateContract,
  openShiftContract,
  printSimulatedXReportContract,
  printSimulatedZReportContract,
  receivePurchaseContract,
  registerCashMovementContract,
  registerSalePaymentsContract,
  registerStockAdjustmentContract,
  removeSaleItemContract,
  setSaleRecipientContract,
  listCashRegistersContract,
  getSyncStatusContract,
  getOperationalDiagnosticsContract,
  listSyncNodesContract,
  listCoordinatedOperationsContract,
  listCategoriesContract,
  listPaymentMethodsContract,
  listUnitsOfMeasureContract,
  loginContract,
  listProductsContract,
  listSuppliersContract,
  createSupplierContract,
  updateSupplierContract,
  changeSupplierStatusContract,
  correctSupplierTaxIdentityContract,
  openStockCountContract,
  recordStockCountLineContract,
  closeStockCountContract,
  approveStockCountContract,
  rejectStockCountContract,
  getStockCountContract,
  listStockCountsContract,
  createBranchContract,
  createCashRegisterContract,
  updateBranchContract,
  changeBranchStatusContract,
  getBranchContract,
  listBranchesContract,
  declareDeviceContract,
  updateDeviceContract,
  changeDeviceStatusContract,
  listDevicesContract,
  listOperationalMasterDataContract,
  saveCategoryContract,
  saveUnitContract,
  savePaymentMethodContract,
  activateDiscountPolicyContract,
  activateTaxPolicyContract,
  getIdentityDirectoryContract,
  createOperatorContract,
  updateOperatorContract,
  changeOperatorStatusContract,
  assignOperatorRolesContract,
  expireOperatorCredentialContract,
  createRoleContract,
  updateRolePermissionsContract,
  changeRoleStatusContract,
  authorizeCredentialEnrollmentContract,
  changeOwnPinContract,
  completeCredentialEnrollmentContract,
  logoutContract,
  startSaleContract,
  createProductContract,
  updateExchangeRateContract,
  updatePriceContract,
  getPriceHistoryContract,
  voidSaleContract,
  type CapabilitiesResponse,
  type CloseShiftRequest,
  type ExchangeRateResponse,
  type ExchangeRateSuggestionResponse,
  type OpenShiftRequest,
  type RegisterCashMovementRequest,
  type RegisterSalePaymentsRequest,
  type SetSaleRecipientRequest,
  type RegisterStockAdjustmentRequest,
  type ReceivePurchaseRequest,
  type CreateProductRequest,
  type SaleResponse,
  type ShiftResponse,
  type KardexDto,
  type AuditReportResponse,
  type CashClosureReportResponse,
  type FiscalOperationsReportResponse,
  type InventoryReportResponse,
  type MarginReportResponse,
  type SalesReportResponse,
  type SaleHistoryVersionResponse,
  type PurchaseReceiptResponse,
  type StartPurchaseReceiptRequest,
  type CompletePurchaseReceiptRequest,
  type ReversePurchaseReceiptRequest,
  type ProductResponse,
  type PriceHistoryResponse,
  type StartSaleRequest,
  type AddSaleItemRequest,
  type ApplySaleDiscountRequest,
  type UpdateExchangeRateRequest,
  type VoidSaleRequest,
  type ReturnSaleRequest,
  type SaleReturnResponse,
  type SimulatedFiscalDocumentResponse,
  type SimulatedFiscalReportRequest,
  type SimulatedFiscalReportResponse,
  type LoginRequest,
  type ProblemDetails,
  type SessionResponse,
  type SupplierResponse,
  type SupplierStatusResponse,
  type CreateSupplierRequest,
  type UpdateSupplierRequest,
  type ChangeSupplierStatusRequest,
  type CorrectSupplierTaxIdentityRequest,
  type OpenStockCountRequest,
  type RecordStockCountLineRequest,
  type CloseStockCountRequest,
  type ApproveStockCountRequest,
  type RejectStockCountRequest,
  type StockCountResponse,
  type StockCountStatusResponse,
  type CreateBranchRequest,
  type CreateCashRegisterRequest,
  type CashRegisterConfigResponse,
  type UpdateBranchRequest,
  type ChangeBranchStatusRequest,
  type BranchResponse,
  type BranchStatusResponse,
  type DeclareDeviceRequest,
  type UpdateDeviceRequest,
  type ChangeDeviceStatusRequest,
  type DeviceResponse,
  type DeviceStatusResponse,
  type OperationalMasterDataResponse,
  type SaveCategoryRequest,
  type SaveUnitRequest,
  type SavePaymentMethodRequest,
  type ActivateDiscountPolicyRequest,
  type ActivateTaxPolicyRequest,
  type PolicyActivationResponse,
  type CashRegisterResponse,
  type CoordinatedOperationResponse,
  type SyncDestinationStatusResponse,
  type OperationalDiagnosticsResponse,
  type SyncNodeResponse,
  type CategoryResponse,
  type PaymentMethodResponse,
  type UnitOfMeasureResponse,
  type IdentityDirectoryResponse,
  type IdentityOperatorResponse,
  type IdentityRoleResponse,
  type CreateOperatorRequest,
  type UpdateOperatorRequest,
  type ChangeOperatorStatusRequest,
  type AssignOperatorRolesRequest,
  type ExpireOperatorCredentialRequest,
  type CreateRoleRequest,
  type UpdateRolePermissionsRequest,
  type ChangeRoleStatusRequest,
  type AuthorizeCredentialEnrollmentRequest,
  type CredentialEnrollmentResponse,
  type ChangeOwnPinRequest,
  type CompleteCredentialEnrollmentRequest
} from '@supermarket/shared';

export class ApiProblemError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.title);
    this.name = 'ApiProblemError';
  }
}

const requestJson = async <T>(
  fetcher: typeof fetch,
  path: string,
  init: RequestInit
): Promise<T> => {
  const response = await fetcher(path, {
    ...init,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.headers ?? {})
    }
  });
  if (response.status === 204) return undefined as T;

  const body = await response.json() as T | ProblemDetails;
  if (!response.ok) throw new ApiProblemError(body as ProblemDetails);
  return body as T;
};

const withIdempotency = (key: string): HeadersInit => ({ 'idempotency-key': key });

export const createIdempotencyKey = (): string => {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  return cryptoApi?.randomUUID?.() ?? `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const parseMinorUnits = (value: string, scale: number): number => {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error('MONEY_INPUT_INVALID');
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > scale) throw new Error('MONEY_INPUT_SCALE');
  const padded = fraction.padEnd(scale, '0');
  const result = Number(`${whole}${padded}`);
  if (!Number.isSafeInteger(result)) throw new Error('MONEY_INPUT_INVALID');
  return result;
};

export type ReportQuery = {
  readonly from?: string; readonly to?: string; readonly limit?: number;
  readonly cashRegisterId?: string; readonly actorId?: string;
  readonly action?: string; readonly entityType?: string;
  readonly currencyCode?: string;
};

export type ExchangeRateHistoryQuery = {
  readonly baseCurrency: string; readonly quoteCurrency: string; readonly limit?: number;
};

export type ExchangeRatePairQuery = { readonly baseCurrency: string; readonly quoteCurrency: string };

const search = (query: Readonly<Record<string, string | number | undefined>>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? '?' + serialized : '';
};

/**
 * Convierte un texto decimal a un entero escalado sin `float`, infiriendo la
 * escala de los dígitos escritos. No admite más de 8 decimales: el dominio de
 * `ExchangeRate` rechaza una escala mayor.
 */
export const parseScaledDecimal = (value: string): { readonly value: number; readonly scale: number } => {
  const normalized = value.trim().replace(',', '.');
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(normalized);
  if (!match) throw new Error('RATE_INPUT_INVALID');
  const fraction = match[2] ?? '';
  const parsed = Number(`${match[1]}${fraction}`);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('RATE_INPUT_INVALID');
  return { value: parsed, scale: fraction.length };
};

/** Formatea un entero escalado como texto decimal sin perder precisión. */
export const formatScaledDecimal = (value: number, scale: number): string =>
  (() => {
    if (!Number.isSafeInteger(value) || !Number.isInteger(scale) || scale < 0) {
      throw new Error('SCALED_DECIMAL_INVALID');
    }
    const sign = value < 0 ? '-' : '';
    const digits = Math.abs(value).toString().padStart(scale + 1, '0');
    if (scale === 0) return sign + digits;
    return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  })();

const path = (template: string, ...parts: string[]): string =>
  parts.reduce((value, part) => value.replace(/:[A-Za-z]+/, encodeURIComponent(part)), template);

export const createDesktopApi = (fetcher: typeof fetch = globalThis.fetch) => ({
  currentSession: (): Promise<SessionResponse> => requestJson(
    fetcher, currentSessionContract.path, { method: currentSessionContract.method }
  ),
  login: (input: LoginRequest): Promise<SessionResponse> => requestJson(
    fetcher,
    loginContract.path,
    { method: loginContract.method, body: JSON.stringify(input) }
  ),
  logout: (): Promise<void> => requestJson(
    fetcher, logoutContract.path, { method: logoutContract.method }
  ),
  capabilities: (): Promise<CapabilitiesResponse> => requestJson(
    fetcher, capabilitiesContract.path, { method: capabilitiesContract.method }
  ),
  getSale: (saleId: string): Promise<SaleResponse> => requestJson(
    fetcher, path(getSaleContract.path, saleId), { method: getSaleContract.method }
  ),
  startSale: (input: StartSaleRequest, idempotencyKey: string): Promise<SaleResponse> => requestJson(
    fetcher, startSaleContract.path,
    { method: startSaleContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  addSaleItem: (saleId: string, input: AddSaleItemRequest, idempotencyKey: string): Promise<SaleResponse> => requestJson(
    fetcher, path(addSaleItemContract.path, saleId),
    { method: addSaleItemContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  removeSaleItem: (saleId: string, itemId: string, idempotencyKey: string): Promise<SaleResponse> => requestJson(
    fetcher, path(removeSaleItemContract.path, saleId, itemId),
    { method: removeSaleItemContract.method, headers: withIdempotency(idempotencyKey) }
  ),
  applySaleDiscount: (saleId: string, input: ApplySaleDiscountRequest, idempotencyKey: string): Promise<SaleResponse> => requestJson(
    fetcher, path(applySaleDiscountContract.path, saleId),
    { method: applySaleDiscountContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  registerSalePayments: (saleId: string, input: RegisterSalePaymentsRequest, idempotencyKey: string): Promise<SaleResponse> => requestJson(
    fetcher, path(registerSalePaymentsContract.path, saleId),
    { method: registerSalePaymentsContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  completeSale: (saleId: string, idempotencyKey: string): Promise<SaleResponse> => requestJson(
    fetcher, path(completeSaleContract.path, saleId),
    { method: completeSaleContract.method, headers: withIdempotency(idempotencyKey) }
  ),
  issueSaleInvoice: (saleId: string, reason: string, idempotencyKey: string): Promise<SimulatedFiscalDocumentResponse> => requestJson(
    fetcher, path(issueSaleInvoiceContract.path, saleId),
    {
      method: issueSaleInvoiceContract.method, headers: withIdempotency(idempotencyKey),
      body: JSON.stringify({ reason })
    }
  ),
  returnSale: (saleId: string, input: ReturnSaleRequest, idempotencyKey: string): Promise<SaleReturnResponse> => requestJson(
    fetcher, path(returnSaleContract.path, saleId),
    { method: returnSaleContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  setSaleRecipient: (saleId: string, input: SetSaleRecipientRequest, idempotencyKey: string): Promise<SaleResponse> => requestJson(
    fetcher, path(setSaleRecipientContract.path, saleId),
    { method: setSaleRecipientContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  voidSale: (saleId: string, input: VoidSaleRequest, idempotencyKey: string): Promise<SaleResponse> => requestJson(
    fetcher, path(voidSaleContract.path, saleId),
    { method: voidSaleContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  getOpenShift: (cashRegisterId: string): Promise<ShiftResponse> => requestJson(
    fetcher, path(getOpenShiftContract.path, cashRegisterId), { method: getOpenShiftContract.method }
  ),
  openShift: (input: OpenShiftRequest, idempotencyKey: string): Promise<ShiftResponse> => requestJson(
    fetcher, openShiftContract.path,
    { method: openShiftContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  registerCashMovement: (shiftId: string, input: RegisterCashMovementRequest, idempotencyKey: string): Promise<ShiftResponse> => requestJson(
    fetcher, path(registerCashMovementContract.path, shiftId),
    { method: registerCashMovementContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  closeShift: (shiftId: string, input: CloseShiftRequest, idempotencyKey: string): Promise<ShiftResponse> => requestJson(
    fetcher, path(closeShiftContract.path, shiftId),
    { method: closeShiftContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  findProductByBarcode: (barcode: string): Promise<{ product: ProductResponse; snapshot: ProductResponse['snapshot'] }> => requestJson(
    fetcher, path(findProductByBarcodeContract.path, barcode), { method: findProductByBarcodeContract.method }
  ),
  updatePrice: (productId: string, input: { priceMinorUnits: number; currencyCode: string; reason: string }, idempotencyKey: string): Promise<ProductResponse> => requestJson(
    fetcher, path(updatePriceContract.path, productId),
    { method: updatePriceContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  listProducts: (query = ''): Promise<readonly ProductResponse[]> => requestJson(
    fetcher, listProductsContract.path + (query ? '?query=' + encodeURIComponent(query) : ''),
    { method: listProductsContract.method }
  ),
  listSuppliers: (status?: SupplierStatusResponse): Promise<readonly SupplierResponse[]> => requestJson(
    fetcher, listSuppliersContract.path + search({ status }),
    { method: listSuppliersContract.method }
  ),
  createSupplier: (input: CreateSupplierRequest, idempotencyKey: string): Promise<SupplierResponse> => requestJson(
    fetcher, createSupplierContract.path,
    { method: createSupplierContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  updateSupplier: (supplierId: string, input: UpdateSupplierRequest, idempotencyKey: string): Promise<SupplierResponse> => requestJson(
    fetcher, path(updateSupplierContract.path, supplierId),
    { method: updateSupplierContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  changeSupplierStatus: (supplierId: string, input: ChangeSupplierStatusRequest, idempotencyKey: string): Promise<SupplierResponse> => requestJson(
    fetcher, path(changeSupplierStatusContract.path, supplierId),
    { method: changeSupplierStatusContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  correctSupplierTaxIdentity: (supplierId: string, input: CorrectSupplierTaxIdentityRequest, idempotencyKey: string): Promise<SupplierResponse> => requestJson(
    fetcher, path(correctSupplierTaxIdentityContract.path, supplierId),
    { method: correctSupplierTaxIdentityContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  openStockCount: (input: OpenStockCountRequest, idempotencyKey: string): Promise<StockCountResponse> => requestJson(
    fetcher, openStockCountContract.path,
    { method: openStockCountContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  recordStockCountLine: (stockCountId: string, input: RecordStockCountLineRequest, idempotencyKey: string): Promise<StockCountResponse> => requestJson(
    fetcher, path(recordStockCountLineContract.path, stockCountId),
    { method: recordStockCountLineContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  closeStockCount: (stockCountId: string, input: CloseStockCountRequest, idempotencyKey: string): Promise<StockCountResponse> => requestJson(
    fetcher, path(closeStockCountContract.path, stockCountId),
    { method: closeStockCountContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  approveStockCount: (stockCountId: string, input: ApproveStockCountRequest, idempotencyKey: string): Promise<StockCountResponse> => requestJson(
    fetcher, path(approveStockCountContract.path, stockCountId),
    { method: approveStockCountContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  rejectStockCount: (stockCountId: string, input: RejectStockCountRequest, idempotencyKey: string): Promise<StockCountResponse> => requestJson(
    fetcher, path(rejectStockCountContract.path, stockCountId),
    { method: rejectStockCountContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  getStockCount: (stockCountId: string): Promise<StockCountResponse> => requestJson(
    fetcher, path(getStockCountContract.path, stockCountId), { method: getStockCountContract.method }
  ),
  listStockCounts: (status?: StockCountStatusResponse): Promise<readonly StockCountResponse[]> => requestJson(
    fetcher, listStockCountsContract.path + search({ status }),
    { method: listStockCountsContract.method }
  ),
  createBranch: (input: CreateBranchRequest, idempotencyKey: string): Promise<BranchResponse> => requestJson(
    fetcher, createBranchContract.path,
    { method: createBranchContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  updateBranch: (branchId: string, input: UpdateBranchRequest, idempotencyKey: string): Promise<BranchResponse> => requestJson(
    fetcher, path(updateBranchContract.path, branchId),
    { method: updateBranchContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  changeBranchStatus: (branchId: string, input: ChangeBranchStatusRequest, idempotencyKey: string): Promise<BranchResponse> => requestJson(
    fetcher, path(changeBranchStatusContract.path, branchId),
    { method: changeBranchStatusContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  getBranch: (branchId: string): Promise<BranchResponse> => requestJson(
    fetcher, path(getBranchContract.path, branchId), { method: getBranchContract.method }
  ),
  listBranches: (status?: BranchStatusResponse): Promise<readonly BranchResponse[]> => requestJson(
    fetcher, listBranchesContract.path + search({ status }), { method: listBranchesContract.method }
  ),
  declareDevice: (input: DeclareDeviceRequest, idempotencyKey: string): Promise<DeviceResponse> => requestJson(
    fetcher, declareDeviceContract.path,
    { method: declareDeviceContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  updateDevice: (deviceId: string, input: UpdateDeviceRequest, idempotencyKey: string): Promise<DeviceResponse> => requestJson(
    fetcher, path(updateDeviceContract.path, deviceId),
    { method: updateDeviceContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  changeDeviceStatus: (deviceId: string, input: ChangeDeviceStatusRequest, idempotencyKey: string): Promise<DeviceResponse> => requestJson(
    fetcher, path(changeDeviceStatusContract.path, deviceId),
    { method: changeDeviceStatusContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  listDevices: (query: { terminalId?: string; status?: DeviceStatusResponse } = {}): Promise<readonly DeviceResponse[]> => requestJson(
    fetcher, listDevicesContract.path + search(query), { method: listDevicesContract.method }
  ),
  listOperationalMasterData: (): Promise<OperationalMasterDataResponse> => requestJson(
    fetcher, listOperationalMasterDataContract.path, { method: listOperationalMasterDataContract.method }
  ),
  saveCategory: (input: SaveCategoryRequest, idempotencyKey: string): Promise<OperationalMasterDataResponse['categories'][number]> => requestJson(
    fetcher, saveCategoryContract.path,
    { method: saveCategoryContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  saveUnit: (input: SaveUnitRequest, idempotencyKey: string): Promise<OperationalMasterDataResponse['units'][number]> => requestJson(
    fetcher, saveUnitContract.path,
    { method: saveUnitContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  savePaymentMethod: (input: SavePaymentMethodRequest, idempotencyKey: string): Promise<OperationalMasterDataResponse['paymentMethods'][number]> => requestJson(
    fetcher, savePaymentMethodContract.path,
    { method: savePaymentMethodContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  createCashRegister: (input: CreateCashRegisterRequest, idempotencyKey: string): Promise<CashRegisterConfigResponse> => requestJson(
    fetcher, createCashRegisterContract.path,
    { method: createCashRegisterContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  activateDiscountPolicy: (input: ActivateDiscountPolicyRequest, idempotencyKey: string): Promise<PolicyActivationResponse> => requestJson(
    fetcher, activateDiscountPolicyContract.path,
    { method: activateDiscountPolicyContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  activateTaxPolicy: (input: ActivateTaxPolicyRequest, idempotencyKey: string): Promise<PolicyActivationResponse> => requestJson(
    fetcher, activateTaxPolicyContract.path,
    { method: activateTaxPolicyContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  getPriceHistory: (productId: string): Promise<readonly PriceHistoryResponse[]> => requestJson(
    fetcher, path(getPriceHistoryContract.path, productId), { method: getPriceHistoryContract.method }
  ),
  createProduct: (input: CreateProductRequest, idempotencyKey: string): Promise<ProductResponse> => requestJson(
    fetcher, createProductContract.path,
    { method: createProductContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  getKardex: (productId: string, query: {
    readonly batchId?: string; readonly from?: string; readonly to?: string;
    readonly reason?: string; readonly limit?: number;
  } = {}): Promise<KardexDto> => requestJson(
    fetcher, path(getKardexContract.path, productId) + search(query), { method: getKardexContract.method }
  ),
  receivePurchase: (input: ReceivePurchaseRequest, idempotencyKey: string): Promise<KardexDto> => requestJson(
    fetcher, receivePurchaseContract.path,
    { method: receivePurchaseContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  registerStockAdjustment: (stockItemId: string, input: RegisterStockAdjustmentRequest, idempotencyKey: string): Promise<KardexDto> => requestJson(
    fetcher, path(registerStockAdjustmentContract.path, stockItemId),
    { method: registerStockAdjustmentContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  getCashClosureReport: (query: ReportQuery = {}): Promise<readonly CashClosureReportResponse[]> => requestJson(
    fetcher, getCashClosureReportContract.path + search(query),
    { method: getCashClosureReportContract.method }
  ),
  getAuditReport: (query: ReportQuery = {}): Promise<readonly AuditReportResponse[]> => requestJson(
    fetcher, getAuditReportContract.path + search(query),
    { method: getAuditReportContract.method }
  ),
  getFiscalOperationsReport: (query: ReportQuery = {}): Promise<FiscalOperationsReportResponse> => requestJson(
    fetcher, getFiscalOperationsReportContract.path + search(query),
    { method: getFiscalOperationsReportContract.method }
  ),
  getMarginReport: (query: ReportQuery = {}): Promise<readonly MarginReportResponse[]> => requestJson(
    fetcher, getMarginReportContract.path + search(query),
    { method: getMarginReportContract.method }
  ),
  getSalesReport: (query: ReportQuery = {}): Promise<readonly SalesReportResponse[]> => requestJson(
    fetcher, getSalesReportContract.path + search(query),
    { method: getSalesReportContract.method }
  ),
  getInventoryReport: (
    query: { readonly asOf: string; readonly expiringWithinDays?: number; readonly limit?: number }
  ): Promise<readonly InventoryReportResponse[]> => requestJson(
    fetcher, getInventoryReportContract.path + search(query),
    { method: getInventoryReportContract.method }
  ),
  getShift: (shiftId: string): Promise<ShiftResponse> => requestJson(
    fetcher, path(getShiftContract.path, shiftId), { method: getShiftContract.method }
  ),
  getSaleHistory: (
    saleId: string, query: { readonly limit?: number } = {}
  ): Promise<readonly SaleHistoryVersionResponse[]> => requestJson(
    fetcher, path(getSaleHistoryContract.path, saleId) + search(query),
    { method: getSaleHistoryContract.method }
  ),
  startPurchaseReceipt: (input: StartPurchaseReceiptRequest, idempotencyKey: string): Promise<PurchaseReceiptResponse> => requestJson(
    fetcher, startPurchaseReceiptContract.path,
    {
      method: startPurchaseReceiptContract.method,
      headers: withIdempotency(idempotencyKey), body: JSON.stringify(input)
    }
  ),
  completePurchaseReceipt: (receiptId: string, input: CompletePurchaseReceiptRequest, idempotencyKey: string): Promise<PurchaseReceiptResponse> => requestJson(
    fetcher, path(completePurchaseReceiptContract.path, receiptId),
    {
      method: completePurchaseReceiptContract.method,
      headers: withIdempotency(idempotencyKey), body: JSON.stringify(input)
    }
  ),
  reversePurchaseReceipt: (receiptId: string, input: ReversePurchaseReceiptRequest, idempotencyKey: string): Promise<PurchaseReceiptResponse> => requestJson(
    fetcher, path(reversePurchaseReceiptContract.path, receiptId),
    {
      method: reversePurchaseReceiptContract.method,
      headers: withIdempotency(idempotencyKey), body: JSON.stringify(input)
    }
  ),
  getCurrentExchangeRate: (query: ExchangeRatePairQuery): Promise<ExchangeRateResponse> => requestJson(
    fetcher, getCurrentExchangeRateContract.path + search(query),
    { method: getCurrentExchangeRateContract.method }
  ),
  getExchangeRateHistory: (query: ExchangeRateHistoryQuery): Promise<readonly ExchangeRateResponse[]> => requestJson(
    fetcher, getExchangeRateHistoryContract.path + search(query),
    { method: getExchangeRateHistoryContract.method }
  ),
  getSuggestedExchangeRate: (query: ExchangeRatePairQuery): Promise<{ suggestion: ExchangeRateSuggestionResponse }> => requestJson(
    fetcher, getSuggestedExchangeRateContract.path + search(query),
    { method: getSuggestedExchangeRateContract.method }
  ),
  updateExchangeRate: (input: UpdateExchangeRateRequest, idempotencyKey: string): Promise<ExchangeRateResponse> => requestJson(
    fetcher, updateExchangeRateContract.path,
    { method: updateExchangeRateContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  printXReport: (input: SimulatedFiscalReportRequest, idempotencyKey: string): Promise<SimulatedFiscalReportResponse> => requestJson(
    fetcher, printSimulatedXReportContract.path,
    { method: printSimulatedXReportContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  printZReport: (input: SimulatedFiscalReportRequest, idempotencyKey: string): Promise<SimulatedFiscalReportResponse> => requestJson(
    fetcher, printSimulatedZReportContract.path,
    { method: printSimulatedZReportContract.method, headers: withIdempotency(idempotencyKey), body: JSON.stringify(input) }
  ),
  /**
   * Administración de identidad. Ninguna de estas llamadas transporta un PIN
   * ajeno: el enrolamiento devuelve un ticket de un solo uso que el operador
   * canjea por su propio PIN en la terminal donde va a trabajar (ADR-0028).
   */
  getIdentityDirectory: (): Promise<IdentityDirectoryResponse> => requestJson(
    fetcher, getIdentityDirectoryContract.path, { method: getIdentityDirectoryContract.method }
  ),
  createOperator: (input: CreateOperatorRequest): Promise<IdentityOperatorResponse> => requestJson(
    fetcher, createOperatorContract.path,
    { method: createOperatorContract.method, body: JSON.stringify(input) }
  ),
  updateOperator: (
    userId: string, input: UpdateOperatorRequest
  ): Promise<IdentityOperatorResponse> => requestJson(
    fetcher, path(updateOperatorContract.path, userId),
    { method: updateOperatorContract.method, body: JSON.stringify(input) }
  ),
  changeOperatorStatus: (
    userId: string, input: ChangeOperatorStatusRequest
  ): Promise<IdentityOperatorResponse> => requestJson(
    fetcher, path(changeOperatorStatusContract.path, userId),
    { method: changeOperatorStatusContract.method, body: JSON.stringify(input) }
  ),
  assignOperatorRoles: (
    userId: string, input: AssignOperatorRolesRequest
  ): Promise<IdentityOperatorResponse> => requestJson(
    fetcher, path(assignOperatorRolesContract.path, userId),
    { method: assignOperatorRolesContract.method, body: JSON.stringify(input) }
  ),
  expireOperatorCredential: (
    userId: string, input: ExpireOperatorCredentialRequest
  ): Promise<void> => requestJson(
    fetcher, path(expireOperatorCredentialContract.path, userId),
    { method: expireOperatorCredentialContract.method, body: JSON.stringify(input) }
  ),
  createRole: (input: CreateRoleRequest): Promise<IdentityRoleResponse> => requestJson(
    fetcher, createRoleContract.path,
    { method: createRoleContract.method, body: JSON.stringify(input) }
  ),
  updateRolePermissions: (
    roleId: string, input: UpdateRolePermissionsRequest
  ): Promise<IdentityRoleResponse> => requestJson(
    fetcher, path(updateRolePermissionsContract.path, roleId),
    { method: updateRolePermissionsContract.method, body: JSON.stringify(input) }
  ),
  changeRoleStatus: (
    roleId: string, input: ChangeRoleStatusRequest
  ): Promise<IdentityRoleResponse> => requestJson(
    fetcher, path(changeRoleStatusContract.path, roleId),
    { method: changeRoleStatusContract.method, body: JSON.stringify(input) }
  ),
  authorizeCredentialEnrollment: (
    input: AuthorizeCredentialEnrollmentRequest
  ): Promise<CredentialEnrollmentResponse> => requestJson(
    fetcher, authorizeCredentialEnrollmentContract.path,
    { method: authorizeCredentialEnrollmentContract.method, body: JSON.stringify(input) }
  ),
  changeOwnPin: (input: ChangeOwnPinRequest): Promise<void> => requestJson(
    fetcher, changeOwnPinContract.path,
    { method: changeOwnPinContract.method, body: JSON.stringify(input) }
  ),
  completeCredentialEnrollment: (
    input: CompleteCredentialEnrollmentRequest
  ): Promise<{ readonly operatorCode: string }> => requestJson(
    fetcher, completeCredentialEnrollmentContract.path,
    { method: completeCredentialEnrollmentContract.method, body: JSON.stringify(input) }
  ),
  listCategories: (): Promise<readonly CategoryResponse[]> => requestJson(
    fetcher, listCategoriesContract.path, { method: listCategoriesContract.method }
  ),
  listUnitsOfMeasure: (): Promise<readonly UnitOfMeasureResponse[]> => requestJson(
    fetcher, listUnitsOfMeasureContract.path, { method: listUnitsOfMeasureContract.method }
  ),
  listPaymentMethods: (): Promise<readonly PaymentMethodResponse[]> => requestJson(
    fetcher, listPaymentMethodsContract.path, { method: listPaymentMethodsContract.method }
  ),
  listCashRegisters: (): Promise<readonly CashRegisterResponse[]> => requestJson(
    fetcher, listCashRegistersContract.path, { method: listCashRegistersContract.method }
  ),
  /**
   * Estado de sincronización de un destino y antigüedad de sus referencias. Es
   * una lectura: consultarla no confirma ninguna entrega.
   */
  getSyncStatus: (destinationNodeId: string): Promise<SyncDestinationStatusResponse> => requestJson(
    fetcher,
    path(getSyncStatusContract.path, destinationNodeId),
    { method: getSyncStatusContract.method }
  ),
  getOperationalDiagnostics: (
    destinationNodeId: string, correlationId?: string
  ): Promise<OperationalDiagnosticsResponse> => requestJson(
    fetcher,
    `${path(getOperationalDiagnosticsContract.path, destinationNodeId)}${
      correlationId ? `?correlationId=${encodeURIComponent(correlationId)}` : ''
    }`,
    { method: getOperationalDiagnosticsContract.method }
  ),
  listSyncNodes: (): Promise<readonly SyncNodeResponse[]> => requestJson(
    fetcher, listSyncNodesContract.path, { method: listSyncNodesContract.method }
  ),
  listCoordinatedOperations: (
    status: 'PENDING_RECONCILIATION' | 'COMPLETED' | 'NEEDS_REVIEW'
  ): Promise<readonly CoordinatedOperationResponse[]> => requestJson(
    fetcher,
    path(listCoordinatedOperationsContract.path, status),
    { method: listCoordinatedOperationsContract.method }
  )
});

type FullDesktopApi = ReturnType<typeof createDesktopApi>;

/**
 * Superficie del ciclo de vida de la sesión: siempre presente porque el shell
 * la necesita antes de conocer ningún permiso. Cambiar el PIN propio y canjear
 * un enrolamiento entran aquí y no en las pantallas: la primera es lo único que
 * una sesión con credencial caducada puede hacer y la segunda ocurre cuando
 * todavía no hay sesión (ADR-0028).
 */
type SessionApiKeys = 'currentSession' | 'login' | 'logout' | 'capabilities'
  | 'changeOwnPin' | 'completeCredentialEnrollment';
export type DesktopApi = Pick<FullDesktopApi, SessionApiKeys> &
  Partial<Omit<FullDesktopApi, SessionApiKeys>>;
export type OperationApi = Required<Omit<DesktopApi, SessionApiKeys>>;
