import type { SyncApplicationStateV1, SyncEnvelopeV1 } from '@supermarket/shared';

export type ReceivedSyncEvent = {
  readonly envelope: SyncEnvelopeV1;
  readonly application: SyncApplicationStateV1;
  readonly receivedAt: Date;
};

/**
 * Custodia y trabajo de aplicación pendiente que se confirman juntos. El
 * receptor no publica un ACK antes del commit; un rollback no puede dejar
 * trabajo huérfano ni custodia sin consumidores.
 */
export type SyncCustodyRecord = ReceivedSyncEvent & {
  /** Nodo autenticado por el transporte, no el origen declarado en el sobre. */
  readonly senderNodeId: string;
  readonly consumers: readonly string[];
};

/**
 * Entrada autenticada incompatible. Conserva identidad propia para no
 * sobrescribir un evento legítimo con el mismo `eventId`, y solo códigos y
 * longitudes: nunca el body recibido, secretos ni datos del hecho.
 */
export type SyncQuarantineEntry = {
  readonly quarantineId: string;
  readonly declaredEventId: string | null;
  readonly senderNodeId: string;
  readonly reasonCode: string;
  readonly payloadBytes: number;
  readonly receivedAt: Date;
};

/**
 * Estado durable del receptor. La deduplicación es por `eventId` y no usa el
 * TTL del IdempotencyStore de comandos: la identidad de un hecho se conserva
 * mientras sea posible una reentrega.
 */
export interface SyncReceptionStore {
  findByEventId(eventId: string): Promise<ReceivedSyncEvent | undefined>;
  /**
   * Mayor versión ya recibida del agregado, o `undefined` si el agregado es
   * desconocido para el receptor. No exige versiones consecutivas.
   */
  highestReceivedVersion(
    aggregateType: string,
    aggregateId: string
  ): Promise<number | undefined>;
  /**
   * Inserta custodia y trabajo pendiente. Devuelve `DUPLICATE` cuando la clave
   * única ya arbitró una entrega concurrente: quien la recibe relee y compara,
   * no declara duplicado a ciegas.
   */
  record(entry: SyncCustodyRecord): Promise<'RECORDED' | 'DUPLICATE'>;
  quarantine(entry: SyncQuarantineEntry): Promise<void>;
}
