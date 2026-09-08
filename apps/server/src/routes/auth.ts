import type { FastifyInstance, FastifySchema } from 'fastify';
import {
  changeOwnPinContract,
  completeCredentialEnrollmentContract,
  currentSessionContract,
  loginContract,
  logoutContract,
  type ChangeOwnPinRequest,
  type CompleteCredentialEnrollmentRequest,
  type LoginRequest,
  type SessionResponse
} from '@supermarket/shared';
import { expiredSessionCookie, sessionCookie, sessionTokenOf } from '../session-transport.ts';
import {
  createExecutionContext,
  requirePrincipal,
  sendProblem,
  type ServerDependencies
} from '../app.ts';

const responseFrom = (principal: {
  actorId: string; displayName: string; roleCodes: readonly string[];
  permissionCodes: readonly string[];
  idleExpiresAt: Date; absoluteExpiresAt: Date;
  credentialMustChange: boolean;
}): SessionResponse => ({
  actorId: principal.actorId,
  displayName: principal.displayName,
  roleCodes: principal.roleCodes,
  permissionCodes: principal.permissionCodes,
  idleExpiresAt: principal.idleExpiresAt.toISOString(),
  absoluteExpiresAt: principal.absoluteExpiresAt.toISOString(),
  credentialMustChange: principal.credentialMustChange
});

export const registerAuthRoutes = (app: FastifyInstance, dependencies: ServerDependencies): void => {
  app.post<{ Body: LoginRequest }>(loginContract.path, {
    schema: loginContract.schema as FastifySchema
  }, async (request, reply) => {
    const result = await dependencies.authenticateOperator.execute({
      ...request.body,
      terminalId: dependencies.nodeIdentity.terminalId,
      originNodeId: dependencies.nodeIdentity.originNodeId
    });
    if (!result.ok) {
      return sendProblem(reply, request, 'AUTHENTICATION_FAILED', 'Authentication failed.', 401);
    }
    reply.header('set-cookie', sessionCookie(result.value.token));
    return responseFrom(result.value.principal);
  });

  app.get(currentSessionContract.path, {
    schema: currentSessionContract.schema as FastifySchema
  }, async (request, reply) => {
    /**
     * La sesión se puede consultar aunque esté restringida: es lo que permite
     * al renderer llevar al operador a cambiar su PIN en vez de dejarlo fuera.
     */
    const principal = await requirePrincipal(
      request, reply, dependencies, { allowsPinChangeOnly: true }
    );
    return principal ? responseFrom(principal) : undefined;
  });

  app.put<{ Body: ChangeOwnPinRequest }>(changeOwnPinContract.path, {
    schema: changeOwnPinContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(
      request, reply, dependencies, { allowsPinChangeOnly: true }
    );
    if (!principal) return;
    const result = await dependencies.identity.changeOwnPin.execute(
      request.body, createExecutionContext(request, principal, dependencies)
    );
    return result.ok
      ? reply.code(204).send()
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  /**
   * Consumo del ticket de enrolamiento (ADR-0028). Es la segunda ruta sin
   * sesión, junto al ingreso: el operador todavía no puede tener una.
   */
  app.post<{ Body: CompleteCredentialEnrollmentRequest }>(
    completeCredentialEnrollmentContract.path,
    { schema: completeCredentialEnrollmentContract.schema as FastifySchema },
    async (request, reply) => {
      const result = await dependencies.identity.completeEnrollment.execute(request.body, {
        terminalId: dependencies.nodeIdentity.terminalId,
        originNodeId: dependencies.nodeIdentity.originNodeId,
        correlationId: String(reply.getHeader('x-correlation-id') ?? request.id)
      });
      return result.ok
        ? reply.send(result.value)
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.delete(logoutContract.path, {
    schema: logoutContract.schema as FastifySchema
  }, async (request, reply) => {
    /** Cerrar sesión es la otra operación que una sesión restringida conserva. */
    const principal = await requirePrincipal(
      request, reply, dependencies, { allowsPinChangeOnly: true }
    );
    if (!principal) return;
    await dependencies.revokeSession.execute(sessionTokenOf(request.headers.cookie));
    reply.header('set-cookie', expiredSessionCookie());
    return reply.code(204).send();
  });
};

