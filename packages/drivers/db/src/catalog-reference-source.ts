import {
  Category,
  ExchangeRate,
  PaymentMethod,
  UnitOfMeasure,
  type CatalogReferenceSource,
  type OperationalPolicyReference,
  type Product,
  type VersionedMaster
} from '@supermarket/core';
import type { DatabaseHandle } from './connection.js';
import { DrizzleProductRepository } from './repositories.js';
import type { PaymentMethodKind } from '@supermarket/core';
import { mapDatabaseError } from './unit-of-work.js';

type CategoryRow = {
  readonly id: string;
  readonly name: string;
  readonly is_active: number;
  readonly version: number;
};

type UnitRow = CategoryRow & {
  readonly code: string;
  readonly quantity_scale: number;
};

type PaymentMethodRow = {
  readonly code: string;
  readonly name: string;
  readonly kind: PaymentMethodKind;
  readonly currency_code: string;
  readonly is_active: number;
  readonly version: number;
};

type PolicyRow = {
  readonly id: string;
  readonly policy_type: 'DISCOUNT' | 'FINANCIAL_TRANSACTION_TAX';
  readonly version: number;
};

type ExchangeRateRow = {
  readonly id: string;
  readonly base_currency: string;
  readonly quote_currency: string;
  readonly rate_value: number;
  readonly rate_scale: number;
  readonly source: string;
  readonly valid_from: number;
  readonly valid_until: number | null;
  readonly registered_by: string;
  readonly version: number;
};

/**
 * Lee el catálogo vigente del coordinador para publicarlo como referencia.
 *
 * El caso de uso envuelve las tres lecturas en su transacción, así que el corte
 * es consistente. Los productos se rehidratan por el repositorio para reutilizar
 * su reconstrucción de unidad, códigos de barras y precio, en lugar de duplicar
 * ese mapeo aquí.
 */
export class SqliteCatalogReferenceSource implements CatalogReferenceSource {
  private readonly products: DrizzleProductRepository;

  constructor(private readonly handle: DatabaseHandle) {
    this.products = new DrizzleProductRepository(handle);
  }

  async listCategories(): Promise<readonly VersionedMaster<Category>[]> {
    try {
      const rows = this.handle.sqlite
        .prepare('select id, name, is_active, version from categories order by id')
        .all() as CategoryRow[];
      return rows.map((row) => ({
        value: Category.create({ id: row.id, name: row.name, isActive: row.is_active === 1 }),
        version: row.version
      }));
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async listUnitsOfMeasure(): Promise<readonly VersionedMaster<UnitOfMeasure>[]> {
    try {
      const rows = this.handle.sqlite.prepare(
        'select id, code, name, quantity_scale, is_active, version from units_of_measure order by id'
      ).all() as UnitRow[];
      return rows.map((row) => ({
        value: UnitOfMeasure.create({
          id: row.id,
          code: row.code,
          name: row.name,
          quantityScale: row.quantity_scale,
          isActive: row.is_active === 1
        }),
        version: row.version
      }));
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async listProducts(): Promise<readonly Product[]> {
    try {
      const ids = this.handle.sqlite.prepare('select id from products order by id')
        .pluck().all() as string[];
      const products: Product[] = [];
      for (const id of ids) {
        const product = await this.products.findById(id);
        if (product) products.push(product);
      }
      return products;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async listPaymentMethods(): Promise<readonly VersionedMaster<PaymentMethod>[]> {
    try {
      const rows = this.handle.sqlite.prepare(`
        select code, name, kind, currency_code, is_active, version
        from payment_methods order by code
      `).all() as PaymentMethodRow[];
      return rows.map((row) => ({
        value: PaymentMethod.create({
          code: row.code,
          name: row.name,
          kind: row.kind,
          currencyCode: row.currency_code,
          isActive: row.is_active === 1
        }),
        version: row.version
      }));
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async listOperationalPolicies(): Promise<readonly OperationalPolicyReference[]> {
    try {
      const rows = this.handle.sqlite.prepare(`
        select id, policy_type, version from operational_policy_versions
        where is_active = 1 order by policy_type
      `).all() as PolicyRow[];
      return rows.map((row): OperationalPolicyReference => {
        if (row.policy_type === 'DISCOUNT') {
          const configuration = this.handle.sqlite.prepare(`
            select maximum_basis_points from discount_policy_configuration where policy_id = ?
          `).get(row.id) as { maximum_basis_points: number };
          return {
            policyType: 'DISCOUNT',
            policyId: row.id,
            version: row.version,
            maximumBasisPoints: configuration.maximum_basis_points
          };
        }
        const configuration = this.handle.sqlite.prepare(`
          select rate_basis_points from financial_transaction_tax_policy_configuration
          where policy_id = ?
        `).get(row.id) as { rate_basis_points: number };
        return {
          policyType: 'FINANCIAL_TRANSACTION_TAX',
          policyId: row.id,
          version: row.version,
          rateBasisPoints: configuration.rate_basis_points,
          eligiblePaymentMethodCodes: this.handle.sqlite.prepare(`
            select payment_method_code from financial_transaction_tax_payment_methods
            where policy_id = ? order by payment_method_code
          `).pluck().all(row.id) as string[],
          eligibleCurrencies: this.handle.sqlite.prepare(`
            select currency_code from financial_transaction_tax_currencies
            where policy_id = ? order by currency_code
          `).pluck().all(row.id) as string[]
        };
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async listExchangeRates(at: Date): Promise<readonly VersionedMaster<ExchangeRate>[]> {
    try {
      const rows = this.handle.sqlite.prepare(`
        select id, base_currency, quote_currency, rate_value, rate_scale, source,
          valid_from, valid_until, registered_by, version
        from exchange_rates
        where valid_until is null or valid_until > ?
        order by base_currency, quote_currency, version
      `).all(at.getTime()) as ExchangeRateRow[];
      return rows.map((row) => ({
        value: ExchangeRate.create({
          id: row.id,
          baseCurrency: row.base_currency,
          quoteCurrency: row.quote_currency,
          rateValue: row.rate_value,
          rateScale: row.rate_scale,
          source: row.source,
          validFrom: new Date(row.valid_from),
          validUntil: row.valid_until === null ? null : new Date(row.valid_until),
          registeredBy: row.registered_by
        }),
        version: row.version
      }));
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
