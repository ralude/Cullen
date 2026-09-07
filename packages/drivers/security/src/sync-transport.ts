import { request, type RequestOptions } from 'node:https';
import { InfrastructureError, SYNC_LIMITS_V1, type SyncEnvelopeV1 } from '@supermarket/shared';
import type {
  AppliedSaleIssueLine,
  EventPublisher,
  RemoteApplicationProbe,
  RemoteApplicationState,
  RemoteSaleIssueProbe,
  SaleIssueEvidence
} from '@supermarket/core';

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

const SYNC_APPLICATIONS_PATH = '/sync/v1/applications';

/**
 * Consulta al coordinador si ya aplicó un hecho, para conciliar una operación
 * distribuida sin repetir efectos (ADR-0026 D3).
 *
 * Es de solo lectura y falla cerrada: un timeout, una respuesta no contractual
 * o un progreso desconocido valen `UNKNOWN`. Nunca devuelve `APPLIED` por no
 * haber podido preguntar, así que la operación sigue pendiente de conciliación
 * en lugar de darse por terminada.
 */
export class HttpsRemoteApplicationProbe implements RemoteApplicationProbe {
  constructor(private readonly configuration: SyncTransportConfiguration) {}

  applicationOf(eventId: string): Promise<RemoteApplicationState> {
    if (!/^[A-Za-z0-9_:.-]{1,128}$/.test(eventId)) return Promise.resolve('UNKNOWN');

    const options: RequestOptions = {
      host: this.configuration.host,
      port: this.configuration.port,
      path: `${SYNC_APPLICATIONS_PATH}/${encodeURIComponent(eventId)}`,
      method: 'GET',
      key: this.configuration.key,
      cert: this.configuration.cert,
      ca: [...this.configuration.ca],
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
      headers: {
        accept: 'application/json',
        [SYNC_DESTINATION_HEADER]: this.configuration.destinationNodeId
      }
    };

    return new Promise<RemoteApplicationState>((resolve) => {
      const call = request(options, (response) => {
        const contentType = response.headers['content-type'] ?? '';
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_ACK_BYTES) {
            response.destroy();
            resolve('UNKNOWN');
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (response.statusCode !== 200 || !contentType.includes('application/json') ||
            contentType.includes('problem+json')) {
            resolve('UNKNOWN');
            return;
          }
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              eventId?: unknown; progress?: unknown;
            };
            /** Un progreso de otro evento no responde por este. */
            if (body.eventId !== eventId) {
              resolve('UNKNOWN');
              return;
            }
            resolve(body.progress === 'APPLIED'
              ? 'APPLIED'
              : body.progress === 'PENDING' || body.progress === 'NONE'
                ? 'PENDING'
                : 'UNKNOWN');
          } catch {
            resolve('UNKNOWN');
          }
        });
      });

      call.setTimeout(
        this.configuration.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS,
        () => { call.destroy(); }
      );
      call.on('error', () => { resolve('UNKNOWN'); });
      call.end();
    });
  }
}

const SYNC_SALE_ISSUES_PATH = '/sync/v1/sale-issues';
/**
 * Cota del cuerpo aceptado para la evidencia de una salida. Es mayor que la de
 * un ACK porque transporta una línea por lote realmente consumido, y la misma
 * que acota el sobre para no aceptar una respuesta que ningún emisor podría
 * haber producido.
 */
const MAX_EVIDENCE_BYTES = SYNC_LIMITS_V1.maxEnvelopeBytes;

const UNAVAILABLE: SaleIssueEvidence = { state: 'UNKNOWN', lines: [] };

const asLine = (value: unknown): AppliedSaleIssueLine | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const line = value as Record<string, unknown>;
  const cost = line.unitCost;
  if (typeof line.saleItemId !== 'string' || typeof line.productId !== 'string' ||
    typeof line.stockItemId !== 'string' ||
    (line.batchId !== null && typeof line.batchId !== 'string') ||
    !Number.isSafeInteger(line.quantityScaled) || (line.quantityScaled as number) <= 0 ||
    !Number.isSafeInteger(line.quantityScale) || (line.quantityScale as number) < 0) {
    return null;
  }
  let unitCost: AppliedSaleIssueLine['unitCost'] = null;
  if (cost !== null && cost !== undefined) {
    if (typeof cost !== 'object' || Array.isArray(cost)) return null;
    const money = cost as Record<string, unknown>;
    if (!Number.isSafeInteger(money.minorUnits) || (money.minorUnits as number) < 0 ||
      typeof money.currencyCode !== 'string' || !/^[A-Z]{3}$/.test(money.currencyCode)) {
      return null;
    }
    unitCost = { minorUnits: money.minorUnits as number, currencyCode: money.currencyCode };
  }
  return {
    saleItemId: line.saleItemId,
    productId: line.productId,
    stockItemId: line.stockItemId,
    batchId: line.batchId as string | null,
    quantityScaled: line.quantityScaled as number,
    quantityScale: line.quantityScale as number,
    unitCost
  };
};

/**
 * Consulta al coordinador la salida que ya aplicó para una venta, de modo que
 * una devolución LAN restituya el lote y el costo originales en vez de
 * inventarlos (ADR-0026 D3).
 *
 * Falla cerrada como la consulta de progreso: un timeout, un cuerpo no
 * contractual, una respuesta de otro evento o una línea inválida valen
 * `UNKNOWN`. Solo `APPLIED` con líneas legibles habilita la restitución.
 */
export class HttpsRemoteSaleIssueProbe implements RemoteSaleIssueProbe {
  constructor(private readonly configuration: SyncTransportConfiguration) {}

  saleIssuesOf(saleEventId: string): Promise<SaleIssueEvidence> {
    if (!/^[A-Za-z0-9_:.-]{1,128}$/.test(saleEventId)) return Promise.resolve(UNAVAILABLE);

    const options: RequestOptions = {
      host: this.configuration.host,
      port: this.configuration.port,
      path: `${SYNC_SALE_ISSUES_PATH}/${encodeURIComponent(saleEventId)}`,
      method: 'GET',
      key: this.configuration.key,
      cert: this.configuration.cert,
      ca: [...this.configuration.ca],
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
      headers: {
        accept: 'application/json',
        [SYNC_DESTINATION_HEADER]: this.configuration.destinationNodeId
      }
    };

    return new Promise<SaleIssueEvidence>((resolve) => {
      const call = request(options, (response) => {
        const contentType = response.headers['content-type'] ?? '';
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_EVIDENCE_BYTES) {
            response.destroy();
            resolve(UNAVAILABLE);
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (response.statusCode !== 200 || !contentType.includes('application/json') ||
            contentType.includes('problem+json')) {
            resolve(UNAVAILABLE);
            return;
          }
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              eventId?: unknown; state?: unknown; lines?: unknown;
            };
            /** La evidencia de otro evento no responde por este. */
            if (body.eventId !== saleEventId) {
              resolve(UNAVAILABLE);
              return;
            }
            if (body.state === 'PENDING' || body.state === 'DISCREPANCY' ||
              body.state === 'NONE') {
              resolve({ state: body.state, lines: [] });
              return;
            }
            if (body.state !== 'APPLIED' || !Array.isArray(body.lines)) {
              resolve(UNAVAILABLE);
              return;
            }
            const lines = body.lines.map(asLine);
            resolve(lines.some((line) => line === null)
              ? UNAVAILABLE
              : { state: 'APPLIED', lines: lines as AppliedSaleIssueLine[] });
          } catch {
            resolve(UNAVAILABLE);
          }
        });
      });

      call.setTimeout(
        this.configuration.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS,
        () => { call.destroy(); }
      );
      call.on('error', () => { resolve(UNAVAILABLE); });
      call.end();
    });
  }
}
