import type { Category, UnitOfMeasure } from '../../domain/catalog/index.js';
import type { PaymentMethod } from '../../domain/currency/index.js';

export interface OperationalMasterDataStore {
  findCategoryById(id: string): Promise<Category | null>;
  listCategories(): Promise<readonly Category[]>;
  saveCategory(category: Category): Promise<void>;
  isCategoryInUse(id: string): Promise<boolean>;
  findUnitByCode(code: string): Promise<UnitOfMeasure | null>;
  listUnits(): Promise<readonly UnitOfMeasure[]>;
  saveUnit(unit: UnitOfMeasure): Promise<void>;
  isUnitInUse(id: string): Promise<boolean>;
  hasUnitHistory(id: string): Promise<boolean>;
  findPaymentMethodByCode(code: string): Promise<PaymentMethod | null>;
  listPaymentMethods(): Promise<readonly PaymentMethod[]>;
  savePaymentMethod(method: PaymentMethod): Promise<void>;
  isPaymentMethodInUse(code: string): Promise<boolean>;
}
