import type { TLSSocket } from 'node:tls';
import Fastify, {
  LogController,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from 'fastify';
import type { application, SyncSenderContext } from '@supermarket/core';
import {
  SYNC_LIMITS_V1,
  type ProblemDetails,
  type SyncReceiptV1
} from '@supermarket/shared';

export const SYNC_EVENTS_ROUTE = '/sync/v1/events';
export const SYNC_AGGREGATES_ROUTE = '/sync/v1/aggregates';
export const SYNC_DESTINATION_HEADER = 'x-sync-destination-node-id';

export type SyncTransportDependencies = {
  /** Identidad del coordinador que escucha; también el destino esperado. */
  readonly receiverNodeId: string;
  readonly resolveSender: application.ResolveSyncSender;
  readonly receiveSyncEvent: application.ReceiveSyncEvent;
  readonly registerOwnedAggregate: application.RegisterOwnedAggregate;
  readonly https?: {
    readonly key: string;
    readonly cert: string;
    readonly ca: readonly string[];
  };
};

/**
 * Códigos de recepción y su estado HTTP. Un rechazo permanente y una
 * indisponibilidad no comparten estado: el emisor debe poder distinguirlos sin
 * interpretar prosa.
 */
const RECEIPT_STATUS: Readonly<Record<SyncReceiptV1['status'], number>> = {
  ACCEPTED: 200,
  DUPLICATE: 200,
  REJECTED: 422,
  RETRYABLE: 503
};

const correlationOf = (request: FastifyRequest): string => {
  const supplied = request.headers['x-correlation-id'];
  return typeof supplied === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(supplied)
    ? supplied
    : request.id;
};

/**
 * Un problema de transporte nunca lleva identidad de evento: por contrato no
 * puede interpretarse como ACK, ni siquiera con un estado 2xx accidental.
 */
const sendProblem = (
  reply: FastifyReply,
  request: FastifyRequest,
  code: string,
  title: string,
  status: number
): FastifyReply => {
  const body: ProblemDetails = {
    type: `urn:supermarket:problem:${code.toLowerCase()}`,
    title,
    status,
    code,
    correlationId: correlationOf(request)
  };
  return reply.code(status).type('application/problem+json').send(body);
};

type PeerIdentity = {
  readonly credentialFingerprint: string;
  readonly presentedNodeId: string;
};

/**
 * Identidad del par tomada del handshake TLS, nunca del cuerpo ni de una
 * cabecera: el emisor no puede declararse a sí mismo.
 */
const peerIdentity = (request: FastifyRequest): PeerIdentity | null => {
  const socket = request.raw.socket as TLSSocket;
  if (typeof socket.getPeerCertificate !== 'function' || !socket.authorized) return null;
  const certificate = socket.getPeerCertificate();
  const fingerprint = certificate.fingerprint256?.replace(/:/g, '').toLowerCase() ?? '';
  const commonName = certificate.subject?.CN;
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) return null;
  if (typeof commonName !== 'string' || commonName.length === 0) return null;
  return { credentialFingerprint: fingerprint, presentedNodeId: commonName };
};

/**
 * Listener técnico de sincronización. Es el único servicio que se expone en
 * LAN: las rutas de operadores conservan loopback y sus sesiones. Comparte el
 * proceso dueño de SQLite y no abre una segunda conexión a la base.
 */
export const buildSyncApp = (dependencies: SyncTransportDependencies): FastifyInstance => {
  const app = Fastify({
    bodyLimit: SYNC_LIMITS_V1.maxEnvelopeBytes,
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body', 'res.body'],
        censor: '[REDACTED]'
      }
    },
    ...(dependencies.https
      ? {
        https: {
          key: dependencies.https.key,
          cert: dependencies.https.cert,
          ca: [...dependencies.https.ca],
          requestCert: true,
          rejectUnauthorized: true,
          minVersion: 'TLSv1.3' as const
        }
      }
      : {})
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-correlation-id', correlationOf(request));
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.statusCode === 413) {
      sendProblem(reply, request, 'SYNC_ENVELOPE_TOO_LARGE', 'The envelope exceeds the limit.', 413);
      return;
    }
    sendProblem(reply, request, 'SYNC_REQUEST_INVALID', 'The request is malformed.', 400);
  });

  app.setNotFoundHandler((request, reply) => {
    sendProblem(reply, request, 'SYNC_ROUTE_NOT_FOUND', 'The route is not exposed.', 404);
  });

  /**
   * Autentica el par, comprueba la dirección del contrato y resuelve la
   * identidad verificada. Se aplica a cada solicitud, incluidas las reentregas:
   * conocer un `eventId` no autoriza a consultar su resultado.
   */
  const authenticate = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<SyncSenderContext | null> => {
    const identity = peerIdentity(request);
    if (!identity) {
      sendProblem(reply, request, 'SYNC_CLIENT_NOT_AUTHENTICATED',
        'A trusted client certificate is required.', 401);
      return null;
    }
    if (request.headers[SYNC_DESTINATION_HEADER] !== dependencies.receiverNodeId) {
      sendProblem(reply, request, 'SYNC_DESTINATION_MISMATCH',
        'The request is addressed to another node.', 421);
      return null;
    }
    const sender = await dependencies.resolveSender.execute(identity);
    if (!sender.ok) {
      sendProblem(reply, request, sender.error.code,
        'The sender could not be verified.',
        sender.error.code === 'SYNC_RECEIVER_UNAVAILABLE' ? 503 : 403);
      return null;
    }
    return sender.value;
  };

  app.post(SYNC_AGGREGATES_ROUTE, async (request, reply) => {
    const sender = await authenticate(request, reply);
    if (!sender) return reply;

    const result = await dependencies.registerOwnedAggregate.execute(request.body, sender);
    if (!result.ok) {
      return sendProblem(reply, request, result.error.code,
        'The aggregate authority request is invalid.', 400);
    }
    request.log.info({
      service: 'supermarket-server',
      module: 'sync',
      correlationId: correlationOf(request),
      operation: `POST ${SYNC_AGGREGATES_ROUTE}`,
      senderNodeId: sender.verifiedNodeId,
      receiptStatus: result.value.status,
      ...(result.value.code ? { errorCode: result.value.code } : {})
    }, 'Aggregate authority request completed');
    return reply
      .code(result.value.status === 'REJECTED' ? 409 : 200)
      .type('application/json')
      .send(result.value);
  });

  app.post(SYNC_EVENTS_ROUTE, async (request, reply) => {
    const sender = await authenticate(request, reply);
    if (!sender) return reply;

    const receipt = await dependencies.receiveSyncEvent.execute(request.body, sender);
    request.log.info({
      service: 'supermarket-server',
      module: 'sync',
      correlationId: correlationOf(request),
      operation: `POST ${SYNC_EVENTS_ROUTE}`,
      senderNodeId: sender.verifiedNodeId,
      eventId: receipt.eventId,
      receiptStatus: receipt.status,
      ...('code' in receipt ? { errorCode: receipt.code } : {})
    }, 'Sync event reception completed');
    return reply.code(RECEIPT_STATUS[receipt.status]).type('application/json').send(receipt);
  });

  return app;
};
