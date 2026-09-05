import type { FiscalAddress, SupplierStatus } from '../../domain/purchasing/index.js';

export type SupplierDto = {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  fiscalAddress: FiscalAddress | null;
  taxIdentity: {
    country: string;
    type: string;
    value: string;
    normalizedValue: string;
  };
  status: SupplierStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CreateSupplierInput = {
  legalName: string;
  tradeName?: string;
  fiscalAddress?: FiscalAddress;
  taxIdentity: { country?: string; type: string; value: string };
  reason: string;
};

export type UpdateSupplierInput = {
  supplierId: string;
  legalName?: string;
  tradeName?: string | null;
  fiscalAddress?: FiscalAddress | null;
  reason: string;
};

export type ChangeSupplierStatusInput = {
  supplierId: string;
  status: SupplierStatus;
  reason: string;
};

export type CorrectSupplierTaxIdentityInput = {
  supplierId: string;
  taxIdentity: { country?: string; type: string; value: string };
  reason: string;
};

/**
 * Línea de una recepción en borrador. El artículo de inventario y su lote se
 * resuelven o crean al iniciar el borrador, igual que en la recepción rápida
 * existente: la aplicación deriva unidad y escala del producto o del artículo
 * ya existente, nunca del cliente.
 */
export type StartPurchaseReceiptLineInput = {
  productId: string;
  quantity: string;
  lot?: { lotNumber: string; expiresAt?: Date };
  purchaseUnitCostMinorUnits: number;
  purchaseCurrency: string;
  /**
   * Obligatorio solo cuando la moneda de compra de la línea difiere de la
   * moneda de valoración ya establecida para ese artículo (la de su primera
   * recepción con costo). La aplicación nunca busca una tasa implícita.
   */
  exchangeRateId?: string;
};

export type StartPurchaseReceiptInput = {
  /**
   * ID de un borrador previo que este borrador corrige. Las líneas son
   * inmutables desde su creación (protegidas por trigger), así que corregir
   * un borrador crea uno nuevo que reemplaza al anterior en vez de editarlo
   * en el sitio; el borrador reemplazado no se completa ni afecta inventario.
   * Solo se acepta si el borrador referido sigue en estado DRAFT.
   */
  replacesReceiptId?: string;
  supplierId: string;
  sourceDocument: {
    type: 'INVOICE' | 'DELIVERY_NOTE';
    number: string;
    series?: string;
    controlNumber?: string;
    issuedAt?: Date;
  };
  effectiveAt: Date;
  lines: StartPurchaseReceiptLineInput[];
  reason: string;
};

export type CompletePurchaseReceiptInput = { receiptId: string; reason: string };
export type ReversePurchaseReceiptInput = { receiptId: string; reason: string };
export type GetPurchaseReceiptInput = { receiptId: string };

export type PurchaseReceiptLineDto = {
  id: string;
  productId: string;
  stockItemId: string;
  quantityScaled: number;
  quantityScale: number;
  batchId: string | null;
  purchaseUnitCostMinorUnits: number;
  purchaseCurrency: string;
  valuationUnitCostMinorUnits: number;
  valuationCurrency: string;
  exchangeRateId: string | null;
};

export type PurchaseReceiptDto = {
  id: string;
  originNodeId: string;
  supplierId: string;
  status: string;
  sourceDocument: {
    type: string;
    number: string;
    series: string | null;
    controlNumber: string | null;
    issuedAt: string | null;
  };
  effectiveAt: string;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
  reversedAt: string | null;
  reversedBy: string | null;
  reversalReason: string | null;
  lines: PurchaseReceiptLineDto[];
  version: number;
};
