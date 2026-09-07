import type { ExecutionContext } from '../execution-context.js';
import type {
  AuditEntry,
  AuditWriter,
  BusinessEventStore,
  OutboxStore,
  UnitOfWork
} from '../ports/index.js';
import type { DomainEventLike } from './business-event.js';
import { toBusinessEvents } from './business-event.js';

/**
 * `publications` son hechos de integración derivados del estado del agregado
 * después de la mutación, no eventos de dominio: distribuyen una referencia y
 * no forman parte de la historia del agregado, así que se encolan en la salida
 * y **no** se anexan al ledger. Se confirman en la misma transacción que el
 * cambio autoritativo que las origina.
 */
export const persistBusinessChange = async (
  save: () => Promise<void>,
  events: readonly DomainEventLike[],
  context: ExecutionContext,
  unitOfWork?: UnitOfWork,
  eventStore?: BusinessEventStore,
  outboxStore?: OutboxStore,
  integrationEventTypes: readonly string[] = [],
  auditWriter?: AuditWriter,
  auditEntries: readonly AuditEntry[] = [],
  publications: readonly DomainEventLike[] = []
): Promise<void> => {
  const persist = async (): Promise<void> => {
    await save();
    const businessEvents = toBusinessEvents(events, context);
    if (eventStore) await eventStore.append(businessEvents);
    if (outboxStore) {
      await outboxStore.enqueue([
        ...businessEvents.filter((event) => integrationEventTypes.includes(event.eventType)),
        ...toBusinessEvents(publications, context)
      ]);
    }
    if (auditWriter) await auditWriter.append(auditEntries);
  };
  if (unitOfWork) await unitOfWork.execute(persist);
  else await persist();
};
