import type { Category, UnitOfMeasure } from '../../domain/catalog/index.js';
import type { PaymentMethod } from '../../domain/currency/index.js';

export interface OperationalMasterDataStore {
  findCategoryById(id: string): Promise<Category | null>;
  listCategories(): Promise<readonly Category[]>;
  /** Devuelve la versión persistida del maestro, que el propio guardado incrementa. */
  saveCategory(category: Category): Promise<number>;
  isCategoryInUse(id: string): Promise<boolean>;
  findUnitByCode(code: string): Promise<UnitOfMeasure | null>;
  listUnits(): Promise<readonly UnitOfMeasure[]>;
  saveUnit(unit: UnitOfMeasure): Promise<number>;
  isUnitInUse(id: string): Promise<boolean>;
  hasUnitHistory(id: string): Promise<boolean>;
  findPaymentMethodByCode(code: string): Promise<PaymentMethod | null>;
  listPaymentMethods(): Promise<readonly PaymentMethod[]>;
  savePaymentMethod(method: PaymentMethod): Promise<number>;
  isPaymentMethodInUse(code: string): Promise<boolean>;
}
