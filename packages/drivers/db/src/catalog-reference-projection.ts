import type {
  CatalogReferenceProjection,
  CategoryReference,
  ExchangeRateReference,
  PaymentMethodReference,
  ProjectedOperationalPolicyReference,
  ProductReference,
  ReferenceApplication,
  UnitOfMeasureReference
} from '@supermarket/core';
import type { DatabaseHandle } from './connection.js';
import { mapDatabaseError, requireTransaction } from './unit-of-work.js';

/**
 * Proyección local del catálogo que publica el coordinador.
 *
 * Escribe las mismas tablas que el POS lee para vender, pero por una ruta
 * propia: no invoca los casos de uso de administración, no escribe auditoría de
 * un actor humano y no encola nada en la salida local, de modo que la terminal
 * no reenvía como propio el catálogo recibido.
 *
 * Cada aplicación está condicionada a que la versión publicada sea mayor que la
 * local. Una publicación atrasada devuelve `STALE` y no retrocede la proyección.
 */
export class SqliteCatalogReferenceProjection implements CatalogReferenceProjection {
  constructor(private readonly handle: DatabaseHandle) {}

  async countApplied(): Promise<number> {
    try {
      return this.handle.sqlite.prepare(`
        select (select count(*) from categories) + (select count(*) from units_of_measure)
          + (select count(*) from products) + (select count(*) from payment_methods)
          + (select count(*) from operational_policy_versions where is_active = 1)
          + (select count(*) from exchange_rates)
      `).pluck().get() as number;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async applyCategory(reference: CategoryReference): Promise<ReferenceApplication> {
    requireTransaction(this.handle.sqlite);
    try {
      const changes = this.handle.sqlite.prepare(`
        insert into categories (id, name, is_active, version) values (?, ?, ?, ?)
        on conflict(id) do update
          set name = excluded.name, is_active = excluded.is_active, version = excluded.version
          where excluded.version > categories.version
      `).run(
        reference.categoryId,
        reference.name,
        reference.isActive ? 1 : 0,
        reference.version
      ).changes;
      return changes === 1 ? 'APPLIED' : 'STALE';
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async applyUnitOfMeasure(reference: UnitOfMeasureReference): Promise<ReferenceApplication> {
    requireTransaction(this.handle.sqlite);
    try {
      const changes = this.handle.sqlite.prepare(`
        insert into units_of_measure (id, code, name, quantity_scale, is_active, version)
        values (?, ?, ?, ?, ?, ?)
        on conflict(id) do update
          set code = excluded.code, name = excluded.name,
            quantity_scale = excluded.quantity_scale, is_active = excluded.is_active,
            version = excluded.version
          where excluded.version > units_of_measure.version
      `).run(
        reference.unitId,
        reference.code,
        reference.name,
        reference.quantityScale,
        reference.isActive ? 1 : 0,
        reference.version
      ).changes;
      return changes === 1 ? 'APPLIED' : 'STALE';
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async applyProduct(reference: ProductReference): Promise<ReferenceApplication> {
    requireTransaction(this.handle.sqlite);
    try {
      const changes = this.handle.sqlite.prepare(`
        insert into products (
          id, name, description, category_id, unit_id, price_minor_units,
          currency_code, tax_rate_basis_points, is_active, version
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update
          set name = excluded.name, description = excluded.description,
            category_id = excluded.category_id, unit_id = excluded.unit_id,
            price_minor_units = excluded.price_minor_units,
            currency_code = excluded.currency_code,
            tax_rate_basis_points = excluded.tax_rate_basis_points,
            is_active = excluded.is_active, version = excluded.version
          where excluded.version > products.version
      `).run(
        reference.productId,
        reference.name,
        reference.description,
        reference.categoryId,
        reference.unitId,
        reference.priceMinorUnits,
        reference.currencyCode,
        reference.taxRateBasisPoints,
        reference.isActive ? 1 : 0,
        reference.version
      ).changes;
      if (changes !== 1) return 'STALE';

      /** El conjunto publicado es completo: un código retirado desaparece o llega inactivo. */
      this.handle.sqlite.prepare('delete from product_barcodes where product_id = ?')
        .run(reference.productId);
      const barcode = this.handle.sqlite.prepare(
        'insert into product_barcodes (id, product_id, value, is_active) values (?, ?, ?, ?)'
      );
      for (const entry of reference.barcodes) {
        barcode.run(entry.barcodeId, reference.productId, entry.code, entry.isActive ? 1 : 0);
      }

      /**
       * El histórico de precios pertenece al coordinador y no se distribuye. La
       * terminal conserva una sola fila con el precio publicado para poder
       * rehidratar el producto; no es el histórico autoritativo.
       */
      this.handle.sqlite.prepare('delete from product_price_history where product_id = ?')
        .run(reference.productId);
      this.handle.sqlite.prepare(`
        insert into product_price_history (
          id, product_id, price_minor_units, currency_code, recorded_at, recorded_by, reason
        ) values (?, ?, ?, ?, ?, ?, ?)
      `).run(
        `${reference.productId}:published`,
        reference.productId,
        reference.priceMinorUnits,
        reference.currencyCode,
        reference.publishedAt.getTime(),
        reference.publishedBy,
        'Precio publicado por el coordinador'
      );
      return 'APPLIED';
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async applyPaymentMethod(reference: PaymentMethodReference): Promise<ReferenceApplication> {
    requireTransaction(this.handle.sqlite);
    try {
      const changes = this.handle.sqlite.prepare(`
        insert into payment_methods (
          code, name, kind, currency_code, is_active, version
        ) values (?, ?, ?, ?, ?, ?)
        on conflict(code) do update
          set name = excluded.name, kind = excluded.kind,
            currency_code = excluded.currency_code,
            is_active = excluded.is_active, version = excluded.version
          where excluded.version > payment_methods.version
      `).run(
        reference.code,
        reference.name,
        reference.kind,
        reference.currencyCode,
        reference.isActive ? 1 : 0,
        reference.version
      ).changes;
      return changes === 1 ? 'APPLIED' : 'STALE';
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async applyOperationalPolicy(
    reference: ProjectedOperationalPolicyReference
  ): Promise<ReferenceApplication> {
    requireTransaction(this.handle.sqlite);
    try {
      const maximum = (this.handle.sqlite.prepare(`
        select max(version) from operational_policy_versions where policy_type = ?
      `).pluck().get(reference.policyType) as number | null) ?? 0;
      if (reference.version <= maximum) return 'STALE';

      this.handle.sqlite.prepare(`
        update operational_policy_versions set is_active = 0
        where policy_type = ? and is_active = 1
      `).run(reference.policyType);
      this.handle.sqlite.prepare(`
        insert into operational_policy_versions (
          id, policy_type, version, is_active, valid_from, created_by, created_at, reason
        ) values (?, ?, ?, 1, ?, ?, ?, ?)
      `).run(
        reference.policyId,
        reference.policyType,
        reference.version,
        reference.publishedAt.getTime(),
        reference.publishedBy,
        reference.publishedAt.getTime(),
        'Política publicada por el coordinador'
      );

      if (reference.policyType === 'DISCOUNT') {
        this.handle.sqlite.prepare(`
          insert into discount_policy_configuration (policy_id, maximum_basis_points)
          values (?, ?)
        `).run(reference.policyId, reference.maximumBasisPoints);
      } else {
        this.handle.sqlite.prepare(`
          insert into financial_transaction_tax_policy_configuration
            (policy_id, rate_basis_points) values (?, ?)
        `).run(reference.policyId, reference.rateBasisPoints);
        const insertMethod = this.handle.sqlite.prepare(`
          insert into financial_transaction_tax_payment_methods
            (policy_id, payment_method_code) values (?, ?)
        `);
        for (const code of [...new Set(reference.eligiblePaymentMethodCodes)].sort()) {
          insertMethod.run(reference.policyId, code);
        }
        const insertCurrency = this.handle.sqlite.prepare(`
          insert into financial_transaction_tax_currencies (policy_id, currency_code)
          values (?, ?)
        `);
        for (const code of [...new Set(reference.eligibleCurrencies)].sort()) {
          insertCurrency.run(reference.policyId, code);
        }
      }
      return 'APPLIED';
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async applyExchangeRate(reference: ExchangeRateReference): Promise<ReferenceApplication> {
    requireTransaction(this.handle.sqlite);
    try {
      const maximum = (this.handle.sqlite.prepare(`
        select max(version) from exchange_rates
        where base_currency = ? and quote_currency = ?
      `).pluck().get(reference.baseCurrency, reference.quoteCurrency) as number | null) ?? 0;
      if (reference.version <= maximum) return 'STALE';
      this.handle.sqlite.prepare(`
        insert into exchange_rates (
          id, base_currency, quote_currency, rate_value, rate_scale, source,
          valid_from, valid_until, registered_by, version
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reference.rateId,
        reference.baseCurrency,
        reference.quoteCurrency,
        reference.rateValue,
        reference.rateScale,
        reference.source,
        reference.validFrom.getTime(),
        reference.validUntil?.getTime() ?? null,
        reference.registeredBy,
        reference.version
      );
      return 'APPLIED';
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
