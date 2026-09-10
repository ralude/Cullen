import { DomainError, Money, TaxRate } from '@supermarket/shared';
import { Barcode } from './barcode.js';
import { PriceHistory, type PriceHistoryProps } from './price-history.js';
import { ProductSnapshot } from './product-snapshot.js';
import type { ProductDomainEvent } from './product-events.js';
import { UnitOfMeasure } from './unit-of-measure.js';

export type ProductProps = {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  unitOfMeasure: UnitOfMeasure;
  barcodes: Barcode[];
  price: Money;
  taxRate: TaxRate;
  priceHistoryId: string;
  recordedBy: string;
  occurredAt: Date;
  eventId: string;
  isActive?: boolean;
};

export type ProductDetailsChanges = {
  name?: string;
  description?: string;
  categoryId?: string;
  unitOfMeasure?: UnitOfMeasure;
  barcodes?: Barcode[];
  isActive?: boolean;
};

export type ChangePriceProps = {
  price: Money;
  priceHistoryId: string;
  changedBy: string;
  reason: string;
  occurredAt: Date;
  eventId: string;
};

export type RestoredProductProps = {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  unitOfMeasure: UnitOfMeasure;
  barcodes: Barcode[];
  price: Money;
  taxRate: TaxRate;
  priceHistory: PriceHistory[];
  isActive: boolean;
  version: number;
};

export class Product {
  private readonly events: ProductDomainEvent[];
  private readonly histories: PriceHistory[];
  private currentPrice: Money;
  private currentTaxRate: TaxRate;
  private currentName: string;
  private currentDescription: string;
  private currentCategoryId: string;
  private currentUnitOfMeasure: UnitOfMeasure;
  private currentBarcodes: Barcode[];
  private currentIsActive: boolean;
  private currentVersion: number;

  private constructor(
    readonly id: string,
    props: {
      name: string;
      description: string;
      categoryId: string;
      unitOfMeasure: UnitOfMeasure;
      barcodes: Barcode[];
      price: Money;
      taxRate: TaxRate;
      priceHistory: PriceHistory;
      isActive: boolean;
    },
    event: ProductDomainEvent
  ) {
    this.currentName = props.name;
    this.currentDescription = props.description;
    this.currentCategoryId = props.categoryId;
    this.currentUnitOfMeasure = props.unitOfMeasure;
    this.currentBarcodes = [...props.barcodes];
    this.currentPrice = props.price;
    this.currentTaxRate = props.taxRate;
    this.currentIsActive = props.isActive;
    this.histories = [props.priceHistory];
    this.currentVersion = event.aggregateVersion;
    this.events = [event];
  }

  static create(props: ProductProps): Product {
    const name = props.name.trim();
    const description = props.description.trim();
    if (name.length === 0) {
      throw new DomainError('PRODUCT_NAME_REQUIRED', 'Product name is required.');
    }
    if (description.length === 0) {
      throw new DomainError(
        'PRODUCT_DESCRIPTION_REQUIRED',
        'Product description is required.'
      );
    }
    Product.assertNonNegativePrice(props.price);
    Product.assertUniqueActiveBarcodes(props.barcodes);

    const priceHistory = PriceHistory.create({
      id: props.priceHistoryId,
      price: props.price,
      recordedAt: props.occurredAt,
      recordedBy: props.recordedBy,
      reason: 'Initial price'
    });
    const event: ProductDomainEvent = {
      type: 'ProductCreated',
      eventId: props.eventId,
      aggregateId: props.id,
      aggregateType: 'Product',
      aggregateVersion: 1,
      occurredAt: new Date(props.occurredAt),
      payload: {
        name,
        description,
        price: props.price,
        taxRate: props.taxRate
      }
    };

    return new Product(
      props.id,
      {
        name,
        description,
        categoryId: props.categoryId,
        unitOfMeasure: props.unitOfMeasure,
        barcodes: props.barcodes,
        price: props.price,
        taxRate: props.taxRate,
        priceHistory,
        isActive: props.isActive ?? true
      },
      event
    );
  }

  /** Rehydrates persisted state without publishing historical domain events. */
  static restore(props: RestoredProductProps): Product {
    const firstHistory = props.priceHistory[0];
    if (!firstHistory) {
      throw new DomainError('PRODUCT_PRICE_HISTORY_REQUIRED', 'Product price history is required.');
    }
    const product = new Product(props.id, {
      name: props.name,
      description: props.description,
      categoryId: props.categoryId,
      unitOfMeasure: props.unitOfMeasure,
      barcodes: props.barcodes,
      price: props.price,
      taxRate: props.taxRate,
      priceHistory: firstHistory,
      isActive: props.isActive
    }, {
      type: 'ProductCreated',
      eventId: 'restored',
      aggregateId: props.id,
      aggregateType: 'Product',
      aggregateVersion: props.version,
      occurredAt: firstHistory.recordedAt,
      payload: {
        name: props.name,
        description: props.description,
        price: props.price,
        taxRate: props.taxRate
      }
    });
    product.histories.splice(0, product.histories.length, ...props.priceHistory);
    product.events.splice(0);
    product.currentVersion = props.version;
    return product;
  }

  get name(): string {
    return this.currentName;
  }

  get description(): string {
    return this.currentDescription;
  }

  get categoryId(): string {
    return this.currentCategoryId;
  }

  get unitOfMeasure(): UnitOfMeasure {
    return this.currentUnitOfMeasure;
  }

  get barcodes(): readonly Barcode[] {
    return this.currentBarcodes;
  }

  get price(): Money {
    return this.currentPrice;
  }

  get taxRate(): TaxRate {
    return this.currentTaxRate;
  }

  get isActive(): boolean {
    return this.currentIsActive;
  }

  get version(): number {
    return this.currentVersion;
  }

  get priceHistory(): readonly PriceHistory[] {
    return this.histories;
  }

  get domainEvents(): readonly ProductDomainEvent[] {
    return this.events;
  }

  /**
   * Avanza la versión del agregado igual que un cambio de precio. La versión
   * ordena la distribución del catálogo: sin incrementarla, dos
   * actualizaciones consecutivas serían indistinguibles para una terminal y la
   * segunda se descartaría por no ser posterior.
   */
  updateDetails(changes: ProductDetailsChanges): void {
    if (changes.name !== undefined) {
      const name = changes.name.trim();
      if (name.length === 0) {
        throw new DomainError('PRODUCT_NAME_REQUIRED', 'Product name is required.');
      }
      this.currentName = name;
    }
    if (changes.description !== undefined) {
      const description = changes.description.trim();
      if (description.length === 0) {
        throw new DomainError(
          'PRODUCT_DESCRIPTION_REQUIRED',
          'Product description is required.'
        );
      }
      this.currentDescription = description;
    }
    if (changes.categoryId !== undefined) this.currentCategoryId = changes.categoryId;
    if (changes.unitOfMeasure !== undefined) {
      this.currentUnitOfMeasure = changes.unitOfMeasure;
    }
    if (changes.barcodes !== undefined) {
      Product.assertUniqueActiveBarcodes(changes.barcodes);
      this.currentBarcodes = [...changes.barcodes];
    }
    if (changes.isActive !== undefined) this.currentIsActive = changes.isActive;
    this.currentVersion += 1;
  }

  changePrice(props: ChangePriceProps): void {
    Product.assertNonNegativePrice(props.price);
    const previousPrice = this.currentPrice;
    const reason = props.reason.trim();
    if (reason.length === 0) {
      throw new DomainError('PRICE_CHANGE_REASON_REQUIRED', 'Price change reason is required.');
    }

    const priceHistoryProps: PriceHistoryProps = {
      id: props.priceHistoryId,
      price: props.price,
      recordedAt: props.occurredAt,
      recordedBy: props.changedBy,
      reason
    };
    this.histories.push(PriceHistory.create(priceHistoryProps));
    this.currentPrice = props.price;
    this.currentVersion += 1;
    this.events.push({
      type: 'PriceChanged',
      eventId: props.eventId,
      aggregateId: this.id,
      aggregateType: 'Product',
      aggregateVersion: this.currentVersion,
      occurredAt: new Date(props.occurredAt),
      payload: {
        previousPrice,
        price: props.price,
        changedBy: props.changedBy,
        reason
      }
    });
  }

  /**
   * La linea de venta se rotula con el nombre, no con la descripcion. Son campos
   * distintos —«Cafe molido 250 g» frente a «Paquete de cafe molido de 250
   * gramos»— y el ticket mostraba el segundo junto a un catalogo que mostraba el
   * primero, de modo que el mismo producto aparecia dos veces con dos nombres.
   * El nombre es ademas lo que el operador coteja al escanear.
   */
  createSnapshot(): ProductSnapshot {
    return ProductSnapshot.create({
      productId: this.id,
      description: this.currentName,
      price: this.currentPrice,
      taxRate: this.currentTaxRate,
      unitCode: this.currentUnitOfMeasure.code,
      unitScale: this.currentUnitOfMeasure.quantityScale
    });
  }

  private static assertNonNegativePrice(price: Money): void {
    if (price.minorUnits < 0) {
      throw new DomainError('PRODUCT_NEGATIVE_PRICE', 'Product price cannot be negative.');
    }
  }

  private static assertUniqueActiveBarcodes(barcodes: readonly Barcode[]): void {
    const activeValues = barcodes.filter((barcode) => barcode.isActive).map((barcode) => barcode.value);
    if (new Set(activeValues).size !== activeValues.length) {
      throw new DomainError(
        'PRODUCT_DUPLICATE_ACTIVE_BARCODE',
        'Active barcode must be unique within a product.'
      );
    }
  }
}
