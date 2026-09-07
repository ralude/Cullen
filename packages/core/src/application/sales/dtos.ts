export type SaleItemDto = {
  id: string;
  productId: string;
  description: string;
  quantityScaled: number;
  quantityScale: number;
  unitCode: string;
  grossMinorUnits: number;
  discountMinorUnits: number;
  taxableMinorUnits: number;
  taxMinorUnits: number;
  totalMinorUnits: number;
  discountBasisPoints: number | null;
};

export type SalePaymentDto = {
  id: string;
  methodCode: string;
  methodKind: string;
  currencyCode: string;
  amountMinorUnits: number;
  amountInSaleCurrencyMinorUnits: number;
  exchangeRateId: string | null;
};

export type SaleRecipientDto = {
  country: string;
  type: string;
  value: string;
  normalizedValue: string;
  name: string | null;
  address: string | null;
};

export type SaleDto = {
  id: string;
  shiftId: string;
  currencyCode: string;
  terminalId: string;
  originNodeId: string;
  status: string;
  version: number;
  items: SaleItemDto[];
  payments: SalePaymentDto[];
  subtotalMinorUnits: number;
  discountTotalMinorUnits: number;
  taxableBaseMinorUnits: number;
  taxTotalMinorUnits: number;
  financialTransactionTaxMinorUnits: number;
  totalMinorUnits: number;
  paidTotalMinorUnits: number;
  balanceMinorUnits: number;
  completedAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  recipient: SaleRecipientDto | null;
};

export type StartSaleInput = {
  currencyCode: string;
  shiftId: string;
};

export type AddItemToSaleInput = {
  saleId: string;
  barcode: string;
  quantityScaled: number;
  quantityScale: number;
};

export type RemoveItemFromSaleInput = {
  saleId: string;
  itemId: string;
};

export type ApplyDiscountToSaleInput = {
  saleId: string;
  itemId: string;
  basisPoints: number;
  reason: string;
};

export type RegisterMixedPaymentInput = {
  saleId: string;
  payments: Array<{
    methodCode: string;
    amountMinorUnits: number;
    currencyCode: string;
    exchangeRateId?: string;
  }>;
};

export type CompleteSaleInput = {
  saleId: string;
};

export type VoidSaleInput = {
  saleId: string;
  reason: string;
};

/** Emisión del documento fiscal de una venta ya completada. */
export type IssueSaleInvoiceInput = {
  saleId: string;
  reason: string;
};

/**
 * Devolución total (ADR-0017). El monto y la moneda no viajan en la entrada:
 * se toman del pago original para que el cliente no pueda elegirlos.
 */
export type ReturnSaleInput = {
  saleId: string;
  reason: string;
};

export type SaleReturnLineDto = {
  id: string;
  saleItemId: string;
  productId: string;
  stockItemId: string;
  batchId: string | null;
  quantityScaled: number;
  quantityScale: number;
  unitCostMinorUnits: number | null;
  costCurrencyCode: string | null;
};

export type SaleReturnDto = {
  id: string;
  saleId: string;
  originalDocumentId: string;
  creditNoteId: string;
  creditNoteStatus: string;
  creditNoteFiscalNumber: string | null;
  shiftId: string;
  refundMinorUnits: number;
  currencyCode: string;
  paymentMethodCode: string;
  reason: string;
  occurredAt: Date;
  lines: SaleReturnLineDto[];
};

/**
 * `recipient: null` retira el snapshot. La venta anónima sigue siendo válida,
 * así que retirar no es un error (ADR-0018).
 */
export type SetSaleRecipientInput = {
  saleId: string;
  recipient: {
    country: string;
    type?: string | null;
    value: string;
    name?: string | null;
    address?: string | null;
  } | null;
};
