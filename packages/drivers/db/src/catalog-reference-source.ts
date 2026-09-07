import {
  Category,
  ExchangeRate,
  PaymentMethod,
  UnitOfMeasure,
  type CatalogReferenceSource,
  type OperationalPolicyReference,
  type OperatorGrantReference,
  type OperatorGrantSource,
  type Product,
  type StockAvailabilityReference,
  type VersionedMaster
} from '@supermarket/core';
import type { DatabaseHandle } from './connection.js';
import { DrizzleProductRepository } from './repositories.js';
import type { PaymentMethodKind } from '@supermarket/core';
import { mapDatabaseError, requireTransaction } from './unit-of-work.js';

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

  /**
   * Saldo observado por ítem de stock. La versión es el número de movimientos
   * más uno, la misma que asigna el productor tras registrar un movimiento, de
   * modo que el corte inicial y los cambios posteriores se ordenan entre sí.
   */
  async listStockAvailability(): Promise<readonly StockAvailabilityReference[]> {
    try {
      const rows = this.handle.sqlite.prepare(`
        select i.id as stockItemId, i.product_id as productId, i.unit_code as unitCode,
          i.quantity_scale as quantityScale, i.tracks_batches as tracksBatches,
          coalesce(sum(case when m.direction = 'IN' then m.quantity_scaled
            else -m.quantity_scaled end), 0) as quantityScaled,
          count(m.id) + 1 as version,
          i.valuation_currency_code as currencyCode,
          sum(case when m.unit_cost_minor_units is null then null
            when m.direction = 'IN' then m.unit_cost_minor_units * m.quantity_scaled
            else -m.unit_cost_minor_units * m.quantity_scaled end) as valueScaled
        from stock_items i
        left join stock_movements m on m.stock_item_id = i.id
        group by i.id
        order by i.product_id
      `).all() as {
        stockItemId: string; productId: string; unitCode: string; quantityScale: number;
        tracksBatches: number; quantityScaled: number; version: number;
        currencyCode: string | null; valueScaled: number | null;
      }[];
      return rows.map((row) => {
        const balance = Math.max(0, row.quantityScaled);
        /**
         * Promedio ponderado vigente, la misma cuenta que hace el agregado. Sin
         * saldo, sin moneda de valuación o sin costos históricos el resultado es
         * costo **desconocido**, que viaja como `null` y no como cero.
         */
        const unitCost = row.currencyCode === null || row.valueScaled === null || balance === 0
          ? null
          : {
            minorUnits: Math.round(row.valueScaled / balance),
            currencyCode: row.currencyCode
          };
        const batches = this.handle.sqlite.prepare(`
          select b.id as batchId, b.lot_number as lotNumber, b.expires_at as expiresAt,
            coalesce(sum(case when m.direction = 'IN' then m.quantity_scaled
              else -m.quantity_scaled end), 0) as quantityScaled
          from stock_batches b
          left join stock_movements m on m.batch_id = b.id
          where b.stock_item_id = ?
          group by b.id
          order by b.lot_number, b.id
        `).all(row.stockItemId) as {
          batchId: string; lotNumber: string; expiresAt: number | null; quantityScaled: number;
        }[];
        return {
          stockItemId: row.stockItemId,
          productId: row.productId,
          unitCode: row.unitCode,
          quantityScaled: balance,
          quantityScale: row.quantityScale,
          tracksBatches: row.tracksBatches === 1,
          batches: batches.map((batch) => ({
            batchId: batch.batchId,
            lotNumber: batch.lotNumber,
            expiresAt: batch.expiresAt === null ? null : new Date(batch.expiresAt),
            quantityScaled: Math.max(0, batch.quantityScaled)
          })),
          unitCost,
          version: row.version
        };
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}

/**
 * Operadores del coordinador y versión monotónica de sus concesiones.
 *
 * Enumera también los inactivos: sin conocer al operador desactivado, una
 * terminal no podría aplicar su revocación. Nunca devuelve credenciales.
 */
export class SqliteOperatorGrantSource implements OperatorGrantSource {
  constructor(private readonly handle: DatabaseHandle) {}

  async listOperators(): Promise<readonly Omit<OperatorGrantReference, 'version'>[]> {
    try {
      const rows = this.handle.sqlite.prepare(`
        select id as userId, operator_code as operatorCode,
          display_name as displayName, is_active as isActive
        from identity_users order by operator_code
      `).all() as {
        userId: string; operatorCode: string; displayName: string; isActive: number;
      }[];
      const roles = this.handle.sqlite.prepare(`
        select r.code from identity_user_roles ur
        join identity_roles r on r.id = ur.role_id
        where ur.user_id = ? and r.is_active = 1 order by r.code
      `);
      const permissions = this.handle.sqlite.prepare(`
        select distinct p.code from identity_user_roles ur
        join identity_roles r on r.id = ur.role_id
        join identity_role_permissions rp on rp.role_id = r.id
        join identity_permissions p on p.code = rp.permission_code
        where ur.user_id = ? and r.is_active = 1 and p.is_active = 1 order by p.code
      `);
      return rows.map((row) => ({
        userId: row.userId,
        operatorCode: row.operatorCode.toUpperCase(),
        displayName: row.displayName,
        roleCodes: roles.pluck().all(row.userId) as string[],
        permissionCodes: permissions.pluck().all(row.userId) as string[],
        isActive: row.isActive === 1
      }));
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async nextGrantVersion(
    userId: string,
    issuedAt: Date,
    expiresAt: Date
  ): Promise<number> {
    requireTransaction(this.handle.sqlite);
    try {
      return this.handle.sqlite.prepare(`
        insert into identity_operator_grant_version (user_id, version, issued_at, expires_at)
        values (?, 1, ?, ?)
        on conflict(user_id) do update set
          version = identity_operator_grant_version.version + 1,
          issued_at = excluded.issued_at,
          expires_at = excluded.expires_at
        returning version
      `).pluck().get(userId, issuedAt.getTime(), expiresAt.getTime()) as number;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async earliestGrantExpiry(): Promise<Date | null> {
    try {
      const operators = this.handle.sqlite
        .prepare('select count(*) from identity_users').pluck().get() as number;
      if (operators === 0) return null;
      const issued = this.handle.sqlite
        .prepare('select count(*) from identity_operator_grant_version').pluck().get() as number;
      /** Un operador sin concesión emitida cuenta como vencido, no como vigente. */
      if (issued < operators) return null;
      const expiry = this.handle.sqlite
        .prepare('select min(expires_at) from identity_operator_grant_version')
        .pluck().get() as number | null;
      return expiry === null ? null : new Date(expiry);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
