import { DomainError, type Money } from '@supermarket/shared';

export type CostSnapshotProps = {
  unitCost: Money;
  /** Versión de la publicación autoritativa de la que procede el costo. */
  version: number;
  /** Nodo que publicó ese costo; es su procedencia, no quien vendió. */
  source: string;
  observedAt: Date;
};

/**
 * Costo unitario conocido al vender, congelado con su procedencia (ADR-0026 D4).
 *
 * Es el costo que la terminal conocía en ese momento, no el promedio que el
 * coordinador tenga al recibir el hecho: una compra posterior no revaloriza la
 * salida. La ausencia de costo se representa con `null` en quien lo contiene,
 * nunca con cero ni con un promedio obtenido después.
 */
export class CostSnapshot {
  private constructor(
    readonly unitCost: Money,
    readonly version: number,
    readonly source: string,
    readonly observedAt: Date
  ) {}

  static create(props: CostSnapshotProps): CostSnapshot {
    if (props.unitCost.minorUnits < 0) {
      throw new DomainError('COST_SNAPSHOT_NEGATIVE', 'Cost snapshot cannot be negative.');
    }
    if (!Number.isInteger(props.version) || props.version < 1) {
      throw new DomainError('COST_SNAPSHOT_VERSION_INVALID', 'Cost snapshot version is invalid.');
    }
    const source = props.source.trim();
    if (source.length === 0) {
      throw new DomainError('COST_SNAPSHOT_SOURCE_REQUIRED', 'Cost snapshot source is required.');
    }
    if (Number.isNaN(props.observedAt.getTime())) {
      throw new DomainError('COST_SNAPSHOT_INSTANT_INVALID', 'Cost snapshot instant is invalid.');
    }
    return new CostSnapshot(props.unitCost, props.version, source, new Date(props.observedAt));
  }
}
