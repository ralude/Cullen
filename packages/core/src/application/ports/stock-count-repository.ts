import type { StockCount, StockCountStatus } from '../../domain/inventory/index.js';

export interface StockCountRepository {
  save(count: StockCount): Promise<void>;
  findById(id: string): Promise<StockCount | null>;
  findOpen(): Promise<StockCount | null>;
  findAll(status?: StockCountStatus): Promise<readonly StockCount[]>;
}
