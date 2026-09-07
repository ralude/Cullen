import type { AppError, Result, SyncEnvelopeV1 } from '@supermarket/shared';
import type {
  ApplyPurchaseReceiptCompletedToInventory,
  ApplySaleCompletedToInventory,
  ApplyStockCountApprovedToInventory
} from '../inventory/index.js';
import type { BusinessEventV1, JsonValue } from '../events/index.js';
import type { UnitOfWork } from '../ports/index.js';
import type { SyncConsumer } from './process-sync-inbox.js';

/**
 * `UnitOfWork` que se une a la transacción que ya abrió el procesador. Permite
 * confirmar el efecto comercial y la marca de progreso juntos sin abrir una
 * transacción anidada, que SQLite rechaza.
 *
 * Solo debe componerse dentro de un caso de uso que ya sea dueño de la
 * transacción; no sustituye al `UnitOfWork` real de una ruta.
 */
export const ambientUnitOfWork: UnitOfWork = { execute: (work) => work() };

/**
 * Reconstruye el hecho recibido como evento de negocio para el consumidor
 * autoritativo. Solo traduce la representación: no completa datos ausentes ni
 * reinterpreta la identidad del hecho.
 */
export const toBusinessEventFromEnvelope = (envelope: SyncEnvelopeV1): BusinessEventV1 => ({
  eventId: envelope.eventId,
  eventType: envelope.eventType,
  contractVersion: envelope.contractVersion,
  aggregateId: envelope.aggregateId,
  aggregateType: envelope.aggregateType,
  aggregateVersion: envelope.aggregateVersion,
  originNodeId: envelope.originNodeId,
  correlationId: envelope.correlationId,
  actorId: envelope.actorId,
  occurredAt: new Date(envelope.occurredAt),
  payload: envelope.payload as JsonValue
});

/**
 * Enruta cada hecho recibido al efecto autoritativo de inventario del
 * coordinador. Los casos de uso son idempotentes por evento/línea: una
 * reentrega no duplica movimientos ni auditoría.
 */
export class InventoryAuthorityConsumer implements SyncConsumer {
  constructor(
    private readonly sales: ApplySaleCompletedToInventory,
    private readonly purchases?: ApplyPurchaseReceiptCompletedToInventory,
    private readonly stockCounts?: ApplyStockCountApprovedToInventory
  ) {}

  apply(envelope: SyncEnvelopeV1): Promise<Result<unknown, AppError>> {
    const event = toBusinessEventFromEnvelope(envelope);
    return envelope.eventType === 'PurchaseReceiptCompleted' && this.purchases
      ? this.purchases.execute(event)
      : envelope.eventType === 'StockCountApproved' && this.stockCounts
        ? this.stockCounts.execute(event)
      : this.sales.execute(event);
  }
}
