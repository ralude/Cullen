import type { SyncEnvelopeV1 } from '@supermarket/shared';

/**
 * Entrega el sobre de integración a la salida durable configurada y devuelve la
 * confirmación cruda del destino. El relay la valida antes de considerarla
 * entrega: un éxito de transporte no es un ACK.
 */
export interface EventPublisher {
  publish(envelope: SyncEnvelopeV1): Promise<unknown>;
}
