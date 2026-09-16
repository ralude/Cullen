import type { CatalogReadRepository, Product } from '@supermarket/core';
import type { DatabaseHandle } from './connection.js';
import { DrizzleProductRepository } from './repositories.js';

export class DrizzleCatalogReadRepository implements CatalogReadRepository {
  private readonly productsRepository: DrizzleProductRepository;

  constructor(handle: DatabaseHandle) {
    this.productsRepository = new DrizzleProductRepository(handle);
  }

  findAll(): Promise<readonly Product[]> {
    return this.productsRepository.findAllProducts();
  }

  findById(productId: string): Promise<Product | null> {
    return this.productsRepository.findById(productId);
  }
}
