import type {
  CatalogReferenceProjection,
  CategoryReference,
  ExchangeRateReference,
  PaymentMethodReference,
  ProjectedOperationalPolicyReference,
  ProjectedOperatorGrantReference,
  ProjectedStockAvailabilityReference,
  ProductReference,
  ReferenceApplication,
  ReferenceFreshness,
  UnitOfMeasureReference
} from '@supermarket/core';
import type { DatabaseHandle } from './connection.js';
import { mapDatabaseError, requireTransaction } from './unit-of-work.js';

const instant = (value: number | null): Date | null =>
  value === null ? null : new Date(value);

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

  async findStockAvailability(
    productId: string
  ): Promise<ProjectedStockAvailabilityReference | null> {
    try {
      const row = this.handle.sqlite.prepare(`
        select product_id as productId, stock_item_id as stockItemId, unit_code as unitCode,
          quantity_scaled as quantityScaled, quantity_scale as quantityScale,
          tracks_batches as tracksBatches, version,
          cost_unit_minor_units as costMinorUnits, cost_currency_code as costCurrencyCode,
          published_by as publishedBy, published_at as publishedAt
        from stock_availability_reference where product_id = ?
      `).get(productId) as {
        productId: string; stockItemId: string | null; unitCode: string | null;
        quantityScaled: number; quantityScale: number; tracksBatches: number | null;
        version: number; costMinorUnits: number | null; costCurrencyCode: string | null;
        publishedBy: string; publishedAt: number;
      } | undefined;
      if (!row) return null;
      const hasMetadata = row.stockItemId !== null && row.unitCode !== null && row.tracksBatches !== null;
      const batches = hasMetadata ? this.handle.sqlite.prepare(`
        select batch_id as batchId, lot_number as lotNumber, expires_at as expiresAt,
          quantity_scaled as quantityScaled
        from stock_batch_availability_reference where product_id = ?
        order by lot_number, batch_id
      `).all(productId).map((value) => {
        const batch = value as {
          batchId: string; lotNumber: string; expiresAt: number | null; quantityScaled: number;
        };
        return {
          ...batch,
          expiresAt: batch.expiresAt === null ? null : new Date(batch.expiresAt)
        };
      }) : null;
      return {
        productId: row.productId,
        stockItemId: row.stockItemId,
        unitCode: row.unitCode,
        quantityScaled: row.quantityScaled,
        quantityScale: row.quantityScale,
        tracksBatches: row.tracksBatches === null ? null : row.tracksBatches === 1,
        batches,
        unitCost: row.costMinorUnits === null || row.costCurrencyCode === null
          ? null
          : { minorUnits: row.costMinorUnits, currencyCode: row.costCurrencyCode },
        version: row.version,
        publishedBy: row.publishedBy,
        publishedAt: new Date(row.publishedAt)
      };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

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

  /**
   * Antigüedad real de cada referencia. Lee la evidencia proyectada, no una
   * marca que se refresque con un ping o un ACK de otro tipo: sin filas, cada
   * campo es `null` y significa **nunca recibida**.
   */
  async referenceFreshness(): Promise<ReferenceFreshness> {
    try {
      const catalog = this.handle.sqlite.prepare(`
        select recorded_by as publishedBy, max(recorded_at) as publishedAt
        from product_price_history where id like '%:published'
      `).get() as { publishedBy: string | null; publishedAt: number | null };
      const catalogCount = this.handle.sqlite
        .prepare('select count(*) from products').pluck().get() as number;
      const catalogVersion = this.handle.sqlite
        .prepare('select max(version) from products').pluck().get() as number | null;

      const rate = this.handle.sqlite.prepare(`
        select registered_by as publishedBy, valid_from as publishedAt,
          valid_until as validUntil, version
        from exchange_rates order by version desc limit 1
      `).get() as {
        publishedBy: string; publishedAt: number; validUntil: number | null; version: number;
      } | undefined;
      const rateCount = this.handle.sqlite
        .prepare('select count(*) from exchange_rates').pluck().get() as number;

      const grant = this.handle.sqlite.prepare(`
        select published_by as publishedBy, max(published_at) as publishedAt,
          max(version) as version, min(expires_at) as expiresAt
        from identity_operator_grant
      `).get() as {
        publishedBy: string | null; publishedAt: number | null;
        version: number | null; expiresAt: number | null;
      };
      const grantCount = this.handle.sqlite
        .prepare('select count(*) from identity_operator_grant').pluck().get() as number;

      const availability = this.handle.sqlite.prepare(`
        select published_by as publishedBy, max(published_at) as publishedAt,
          max(version) as version
        from stock_availability_reference
      `).get() as {
        publishedBy: string | null; publishedAt: number | null; version: number | null;
      };
      const availabilityCount = this.handle.sqlite
        .prepare('select count(*) from stock_availability_reference').pluck().get() as number;

      return {
        catalog: {
          publishedBy: catalogCount === 0 ? null : catalog.publishedBy,
          publishedAt: instant(catalogCount === 0 ? null : catalog.publishedAt),
          version: catalogCount === 0 ? null : catalogVersion,
          count: catalogCount
        },
        exchangeRate: {
          publishedBy: rate?.publishedBy ?? null,
          publishedAt: instant(rate?.publishedAt ?? null),
          version: rate?.version ?? null,
          validUntil: instant(rate?.validUntil ?? null),
          count: rateCount
        },
        operatorGrants: {
          publishedBy: grantCount === 0 ? null : grant.publishedBy,
          publishedAt: instant(grantCount === 0 ? null : grant.publishedAt),
          version: grantCount === 0 ? null : grant.version,
          expiresAt: instant(grantCount === 0 ? null : grant.expiresAt),
          count: grantCount
        },
        stockAvailability: {
          publishedBy: availabilityCount === 0 ? null : availability.publishedBy,
          publishedAt: instant(availabilityCount === 0 ? null : availability.publishedAt),
          version: availabilityCount === 0 ? null : availability.version,
          count: availabilityCount
        }
      };
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

  /**
   * Concesión de autorización. Se guarda en su propia tabla, separada de
   * `identity_users`: la terminal no adopta el usuario del coordinador ni sus
   * credenciales, solo conserva lo que ese operador puede hacer y hasta cuándo.
   */
  async applyOperatorGrant(
    reference: ProjectedOperatorGrantReference
  ): Promise<ReferenceApplication> {
    requireTransaction(this.handle.sqlite);
    try {
      const changes = this.handle.sqlite.prepare(`
        insert into identity_operator_grant (
          user_id, operator_code, display_name, role_codes, permission_codes,
          is_active, version, expires_at, published_by, published_at, applied_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(user_id) do update set
          operator_code = excluded.operator_code,
          display_name = excluded.display_name,
          role_codes = excluded.role_codes,
          permission_codes = excluded.permission_codes,
          is_active = excluded.is_active,
          version = excluded.version,
          expires_at = excluded.expires_at,
          published_by = excluded.published_by,
          published_at = excluded.published_at,
          applied_at = excluded.applied_at
          where excluded.version > identity_operator_grant.version
      `).run(
        reference.userId,
        reference.operatorCode,
        reference.displayName,
        JSON.stringify([...reference.roleCodes]),
        JSON.stringify([...reference.permissionCodes]),
        reference.isActive ? 1 : 0,
        reference.version,
        reference.expiresAt.getTime(),
        reference.publishedBy,
        reference.publishedAt.getTime(),
        reference.publishedAt.getTime()
      ).changes;
      return changes === 1 ? 'APPLIED' : 'STALE';
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  /**
   * Disponibilidad informativa. Tabla propia y separada de `stock_items`: no
   * existe la ruta que permitiría sumarla a un saldo local por accidente.
   */
  async applyStockAvailability(
    reference: ProjectedStockAvailabilityReference
  ): Promise<ReferenceApplication> {
    requireTransaction(this.handle.sqlite);
    try {
      const changes = this.handle.sqlite.prepare(`
        insert into stock_availability_reference (
          product_id, quantity_scaled, quantity_scale, version,
          cost_unit_minor_units, cost_currency_code,
          stock_item_id, unit_code, tracks_batches,
          published_by, published_at, applied_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(product_id) do update set
          quantity_scaled = excluded.quantity_scaled,
          quantity_scale = excluded.quantity_scale,
          version = excluded.version,
          cost_unit_minor_units = excluded.cost_unit_minor_units,
          cost_currency_code = excluded.cost_currency_code,
          stock_item_id = coalesce(excluded.stock_item_id, stock_availability_reference.stock_item_id),
          unit_code = coalesce(excluded.unit_code, stock_availability_reference.unit_code),
          tracks_batches = coalesce(excluded.tracks_batches, stock_availability_reference.tracks_batches),
          published_by = excluded.published_by,
          published_at = excluded.published_at,
          applied_at = excluded.applied_at
          where excluded.version > stock_availability_reference.version
      `).run(
        reference.productId,
        reference.quantityScaled,
        reference.quantityScale,
        reference.version,
        reference.unitCost?.minorUnits ?? null,
        reference.unitCost?.currencyCode ?? null,
        reference.stockItemId,
        reference.unitCode,
        reference.tracksBatches === null ? null : reference.tracksBatches ? 1 : 0,
        reference.publishedBy,
        reference.publishedAt.getTime(),
        reference.publishedAt.getTime()
      ).changes;
      if (changes !== 1) return 'STALE';
      if (reference.batches !== null) {
        this.handle.sqlite.prepare(
          'delete from stock_batch_availability_reference where product_id = ?'
        ).run(reference.productId);
        const insert = this.handle.sqlite.prepare(`
          insert into stock_batch_availability_reference (
            product_id, batch_id, lot_number, expires_at, quantity_scaled
          ) values (?, ?, ?, ?, ?)
        `);
        for (const batch of reference.batches) {
          insert.run(
            reference.productId,
            batch.batchId,
            batch.lotNumber,
            batch.expiresAt?.getTime() ?? null,
            batch.quantityScaled
          );
        }
      }
      return 'APPLIED';
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
