import { request, type RequestOptions } from 'node:https';
import { InfrastructureError, SYNC_LIMITS_V1, type SyncEnvelopeV1 } from '@supermarket/shared';
import type { EventPublisher } from '@supermarket/core';

export const SYNC_DESTINATION_HEADER = 'x-sync-destination-node-id';
const SYNC_EVENTS_PATH = '/sync/v1/events';
const DEFAULT_TIMEOUT_MILLISECONDS = 10_000;
/** Cota del cuerpo de respuesta aceptado; un ACK contractual es pequeño. */
const MAX_ACK_BYTES = 8_192;

export type SyncTransportConfiguration = {
  readonly host: string;
  readonly port: number;
  /** Identidad esperada del coordinador; viaja en la solicitud y se verifica en el ACK. */
  readonly destinationNodeId: string;
  readonly key: string;
  readonly cert: string;
  /** Autoridades que emiten el certificado del destino. */
  readonly ca: readonly string[];
  readonly timeoutMilliseconds?: number;
};

/**
 * Cliente de entrega entre nodos sobre HTTPS con autenticación mutua.
 *
 * Devuelve el cuerpo crudo de la respuesta para que el relay decida: un éxito
 * de transporte no es un ACK. No sigue redirecciones, de modo que un destino
 * no puede desviar la entrega, y no degrada a HTTP inseguro. Un timeout, un
 * cuerpo truncado o una respuesta que no sea JSON se propagan como fallo, que
 * el relay convierte en reintento sin confirmar entrega.
 */
export class HttpsSyncEventPublisher implements EventPublisher {
  constructor(private readonly configuration: SyncTransportConfiguration) {}

  publish(envelope: SyncEnvelopeV1): Promise<unknown> {
    const body = Buffer.from(JSON.stringify(envelope), 'utf8');
    if (body.length > SYNC_LIMITS_V1.maxEnvelopeBytes) {
      return Promise.reject(new InfrastructureError(
        'SYNC_ENVELOPE_TOO_LARGE',
        'The envelope exceeds the transport limit.'
      ));
    }

    const options: RequestOptions = {
      host: this.configuration.host,
      port: this.configuration.port,
      path: SYNC_EVENTS_PATH,
      method: 'POST',
      key: this.configuration.key,
      cert: this.configuration.cert,
      ca: [...this.configuration.ca],
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        accept: 'application/json',
        [SYNC_DESTINATION_HEADER]: this.configuration.destinationNodeId
      }
    };

    return new Promise<unknown>((resolve, reject) => {
      const call = request(options, (response) => {
        const contentType = response.headers['content-type'] ?? '';
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_ACK_BYTES) {
            response.destroy();
            reject(new InfrastructureError(
              'SYNC_ACK_TOO_LARGE',
              'The destination returned an oversized acknowledgement.'
            ));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          /**
           * `application/problem+json` es un fallo de transporte y nunca lleva
           * identidad de evento: no puede interpretarse como confirmación.
           */
          if (!contentType.includes('application/json') ||
            contentType.includes('problem+json')) {
            reject(new InfrastructureError(
              'SYNC_ACK_NOT_CONTRACTUAL',
              `The destination answered ${response.statusCode ?? 0} without a sync receipt.`
            ));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
          } catch (cause) {
            reject(new InfrastructureError(
              'SYNC_ACK_UNREADABLE',
              'The destination acknowledgement could not be parsed.',
              { cause }
            ));
          }
        });
      });

      call.setTimeout(
        this.configuration.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS,
        () => {
          call.destroy(new InfrastructureError(
            'SYNC_DELIVERY_TIMEOUT',
            'The destination did not answer within the configured timeout.'
          ));
        }
      );
      call.on('error', (cause) => reject(cause instanceof InfrastructureError
        ? cause
        : new InfrastructureError(
          'SYNC_DELIVERY_FAILED',
          'The destination could not be reached.',
          { cause }
        )));
      call.end(body);
    });
  }
}

/**
 * Conectividad observada por el worker. Se registra al intentar entregar: no
 * existe un ping que confirme eventos ni que convierta el nodo en `SYNCED`.
 */
export class ObservedSyncConnectivity {
  private readonly states = new Map<string, 'ONLINE' | 'OFFLINE' | 'CONNECTING' | 'UNKNOWN'>();

  record(destinationNodeId: string, state: 'ONLINE' | 'OFFLINE' | 'CONNECTING'): void {
    this.states.set(destinationNodeId, state);
  }

  async lastKnownState(
    destinationNodeId: string
  ): Promise<'ONLINE' | 'OFFLINE' | 'CONNECTING' | 'UNKNOWN'> {
    return this.states.get(destinationNodeId) ?? 'UNKNOWN';
  }
}
