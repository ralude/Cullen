/**
 * Contexto HTTP de una petición: correlación, principal de sesión y respuesta
 * de error con código estable.
 *
 * Separado del registrador por 12.05.02. Las rutas usan estos tres helpers y no
 * el arranque del servidor; `buildApp` usa además los accesores del estado por
 * petición, que vive aquí porque aquí se escribe.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ExecutionContext, SessionPrincipal } from '@supermarket/core';
import type { ProblemDetails } from '@supermarket/shared';
import type { ServerDependencies } from './server-dependencies.ts';
import { sessionTokenOf } from './session-transport.ts';

const principals = new WeakMap<FastifyRequest, SessionPrincipal>();
const correlations = new WeakMap<FastifyRequest, string>();
const publicErrorCodes = new WeakMap<FastifyRequest, string>();

const correlationId = (request: FastifyRequest): string => correlations.get(request) ?? request.id;

const statusFor = (code: string): number => {
  if (code === 'UNAUTHORIZED' || code === 'AUTHENTICATION_FAILED') return 401;
  if (code === 'FORBIDDEN') return 403;
  if (code.endsWith('_NOT_FOUND') || code === 'RESOURCE_NOT_FOUND') return 404;
  if (code.includes('CONFLICT') || code.includes('ALREADY_') || code.endsWith('_INVALID_STATE')) {
    return 409;
  }
  if (code === 'SUPPLIER_NOT_ACTIVE') return 409;
  /**
   * La identidad rechaza por conflicto de estado, no por entrada inválida: el
   * código ya está tomado, el invariante no admite el cambio, el nodo no es
   * dueño o el ticket de enrolamiento ya no es utilizable.
   */
  if (code === 'IDENTITY_LAST_ADMINISTRATOR' || code === 'IDENTITY_NOT_OWNED_BY_NODE') return 409;
  if (code === 'IDENTITY_ENROLLMENT_EXPIRED' || code === 'IDENTITY_ENROLLMENT_CONSUMED') return 409;
  if (code === 'IDENTITY_ENROLLMENT_NODE_MISMATCH') return 409;
  if (code === 'AUTH_PIN_CHANGE_REQUIRED') return 403;
  if (code.endsWith('_TAKEN') || code.endsWith('_IN_USE')) return 409;
  if (code === 'PURCHASE_RECEIPT_SOURCE_DUPLICATED' || code === 'PURCHASE_RECEIPT_NOT_DRAFT') return 409;
  if (code === 'SHIFT_HAS_OPEN_SALES') return 409;
  if (code === 'POLICY_NOT_CONFIGURED') return 409;
  if (code === 'DATABASE_BUSY' || code === 'NETWORK_UNAVAILABLE') return 503;
  return 400;
};

export const sendProblem = (
  reply: FastifyReply,
  request: FastifyRequest,
  code: string,
  title: string,
  status = statusFor(code)
): FastifyReply => {
  publicErrorCodes.set(request, code);
  const body: ProblemDetails = {
    type: `urn:supermarket:problem:${code.toLowerCase()}`,
    title,
    status,
    code,
    correlationId: correlationId(request)
  };
  return reply.code(status).type('application/problem+json').send(body);
};

/**
 * Resuelve el principal de la sesión y aplica aquí —una sola vez, no ruta por
 * ruta— la restricción de credencial marcada para cambio (ADR-0027 D3). Solo
 * cambiar el PIN y cerrar sesión declaran `allowsPinChangeOnly`.
 */
export const requirePrincipal = async (
  request: FastifyRequest,
  reply: FastifyReply,
  dependencies: ServerDependencies,
  options: { readonly allowsPinChangeOnly?: boolean } = {}
): Promise<SessionPrincipal | null> => {
  const result = await dependencies.verifySession.execute(
    sessionTokenOf(request.headers.cookie)
  );
  if (!result.ok) {
    sendProblem(reply, request, 'UNAUTHORIZED', 'Session is invalid.', 401);
    return null;
  }
  principals.set(request, result.value);
  if (result.value.credentialMustChange && options.allowsPinChangeOnly !== true) {
    sendProblem(
      reply, request, 'AUTH_PIN_CHANGE_REQUIRED', 'The operator must change the PIN first.', 403
    );
    return null;
  }
  return result.value;
};

export const createExecutionContext = (
  request: FastifyRequest,
  principal: SessionPrincipal,
  dependencies: ServerDependencies
): ExecutionContext => {
  const idempotencyKey = request.headers['idempotency-key'];
  return {
    actorId: principal.actorId,
    actorRoleCodes: principal.roleCodes,
    terminalId: dependencies.nodeIdentity.terminalId,
    originNodeId: dependencies.nodeIdentity.originNodeId,
    correlationId: correlationId(request),
    ...(typeof idempotencyKey === 'string' ? { idempotencyKey } : {})
  };
};

/** Lo que el registrador necesita del estado por petición, sin exponerlo. */
export const rememberCorrelation = (request: FastifyRequest, value: string): void => {
  correlations.set(request, value);
};

export const correlationOf = correlationId;

export const principalOf = (request: FastifyRequest): SessionPrincipal | undefined =>
  principals.get(request);

export const publicErrorCodeOf = (request: FastifyRequest): string | undefined =>
  publicErrorCodes.get(request);