import { toStockAvailabilityPublication } from '../catalog/reference-publications.js';
import type { StockItem } from '../../domain/inventory/index.js';
import type { DomainEventLike } from '../events/index.js';
import type { IdGenerator } from '../ports/index.js';

/**
 * Publicaciones de disponibilidad informativa de los ítems que un comando
 * acaba de tocar. Se derivan del estado **después** de la mutación y se
 * confirman en la misma transacción que el cambio autoritativo.
 *
 * Es un dato para informar al operador, no una reserva: la terminal lo proyecta
 * en su propia tabla y nunca lo suma a un saldo local.
 *
 * La versión es el número de movimientos más uno, la misma cuenta que usa el
 * corte inicial, de modo que ambos caminos se ordenan entre sí y una
 * publicación atrasada no retrocede la proyección.
 */
export const toStockAvailabilityPublications = (
  items: Iterable<StockItem>,
  ids: IdGenerator,
  occurredAt: Date
): readonly DomainEventLike[] => [...items].map((item) => toStockAvailabilityPublication({
  productId: item.productId,
  quantityScaled: item.balance.scaledValue,
  quantityScale: item.quantityScale,
  unitCost: item.averageUnitCost === null ? null : {
    minorUnits: item.averageUnitCost.minorUnits,
    currencyCode: item.averageUnitCost.currency
  },
  version: item.movements.length + 1
}, { eventId: ids.generate(), occurredAt }));
