import type { ProductSnapshotProvider } from '@supermarket/core';
import type { ProductSnapshot } from '@supermarket/core';
import type { DatabaseHandle } from './connection.js';
import { DrizzleProductRepository } from './catalog-repositories.js';

export class DrizzleProductSnapshotProvider implements ProductSnapshotProvider {
  private readonly products: DrizzleProductRepository;

  constructor(handle: DatabaseHandle) {
    this.products = new DrizzleProductRepository(handle);
  }

  async findSnapshotByBarcode(barcode: string): Promise<ProductSnapshot | null> {
    const product = await this.products.findByActiveBarcode(barcode);
    return product?.createSnapshot() ?? null;
  }
}
