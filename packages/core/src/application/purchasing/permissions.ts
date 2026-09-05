export const SUPPLIER_PERMISSIONS = {
  READ: 'supplier.read',
  CREATE: 'supplier.create',
  UPDATE: 'supplier.update',
  CORRECT_TAX_IDENTITY: 'supplier.tax_identity.correct'
} as const;

export const PURCHASE_RECEIPT_PERMISSIONS = {
  READ: 'purchase_receipt.read',
  START: 'purchase_receipt.start',
  COMPLETE: 'purchase_receipt.complete',
  REVERSE: 'purchase_receipt.reverse'
} as const;
