import type { Money, TaxRate } from '@supermarket/shared';
import type { CostSnapshot } from './cost-snapshot.js';

export type ProductSnapshotProps = {
  productId: string;
  description: string;
  price: Money;
  taxRate: TaxRate;
  unitCode: string;
  unitScale: number;
  /**
   * Costo unitario conocido al agregar la línea, con su procedencia. `null` es
   * costo **desconocido** y así se conserva: no se sustituye por cero ni por un
   * promedio obtenido después (ADR-0026 D4).
   */
  costSnapshot?: CostSnapshot | null;
};

export class ProductSnapshot {
  private constructor(
    readonly productId: string,
    readonly description: string,
    readonly price: Money,
    readonly taxRate: TaxRate,
    readonly unitCode: string,
    readonly unitScale: number,
    readonly costSnapshot: CostSnapshot | null
  ) {}

  static create(props: ProductSnapshotProps): ProductSnapshot {
    return new ProductSnapshot(
      props.productId,
      props.description,
      props.price,
      props.taxRate,
      props.unitCode,
      props.unitScale,
      props.costSnapshot ?? null
    );
  }

  /** Congela el costo conocido sobre un snapshot ya construido del producto. */
  withCostSnapshot(costSnapshot: CostSnapshot | null): ProductSnapshot {
    return new ProductSnapshot(
      this.productId,
      this.description,
      this.price,
      this.taxRate,
      this.unitCode,
      this.unitScale,
      costSnapshot
    );
  }
}
