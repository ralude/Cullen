import type { PurchaseReceipt } from '../../domain/purchasing/index.js';

export interface PurchaseReceiptRepository {
  save(receipt: PurchaseReceipt): Promise<void>;
  findById(id: string): Promise<PurchaseReceipt | null>;
  findCompletedBySource(
    supplierId: string,
    type: 'INVOICE' | 'DELIVERY_NOTE',
    series: string | null,
    number: string
  ): Promise<PurchaseReceipt | null>;
  findCompletedByControlNumber(
    supplierId: string,
    controlNumber: string
  ): Promise<PurchaseReceipt | null>;
}
