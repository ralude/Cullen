import type { FastifyInstance, FastifySchema } from 'fastify';
import {
  assignOperatorRolesContract,
  authorizeCredentialEnrollmentContract,
  changeOperatorStatusContract,
  changeRoleStatusContract,
  createOperatorContract,
  createRoleContract,
  expireOperatorCredentialContract,
  getIdentityDirectoryContract,
  updateOperatorContract,
  updateRolePermissionsContract,
  type AssignOperatorRolesRequest,
  type AuthorizeCredentialEnrollmentRequest,
  type ChangeOperatorStatusRequest,
  type ChangeRoleStatusRequest,
  type CreateOperatorRequest,
  type CreateRoleRequest,
  type CredentialEnrollmentResponse,
  type ExpireOperatorCredentialRequest,
  type UpdateOperatorRequest,
  type UpdateRolePermissionsRequest
} from '@supermarket/shared';
import type { AppError, Result } from '@supermarket/shared';
import {
  createExecutionContext,
  requirePrincipal,
  sendProblem,
  type ServerDependencies
} from '../app.ts';

/**
 * Rutas de administración de identidad. Autentican, validan y adaptan; la
 * autorización, el ownership del nodo y el invariante de último administrador
 * los decide el caso de uso, que vuelve a exigirlos en cada intento.
 */
export const registerIdentityRoutes = (
  app: FastifyInstance,
  dependencies: ServerDependencies
): void => {
  const send = <T>(
    result: Result<T, AppError>,
    request: Parameters<typeof sendProblem>[1],
    reply: Parameters<typeof sendProblem>[0],
    successStatus = 200
  ) => result.ok
    ? reply.code(successStatus).send(result.value)
    : sendProblem(reply, request, result.error.code, result.error.message);

  app.get(getIdentityDirectoryContract.path, {
    schema: getIdentityDirectoryContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    return send(
      await dependencies.identity.directory.execute(
        createExecutionContext(request, principal, dependencies)
      ),
      request, reply
    );
  });

  app.post<{ Body: CreateOperatorRequest }>(createOperatorContract.path, {
    schema: createOperatorContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    return send(
      await dependencies.identity.createOperator.execute(
        request.body, createExecutionContext(request, principal, dependencies)
      ),
      request, reply, 201
    );
  });

  app.put<{ Params: { userId: string }; Body: UpdateOperatorRequest }>(
    updateOperatorContract.path, { schema: updateOperatorContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      return send(
        await dependencies.identity.updateOperator.execute(
          { userId: request.params.userId, ...request.body },
          createExecutionContext(request, principal, dependencies)
        ),
        request, reply
      );
    }
  );

  app.put<{ Params: { userId: string }; Body: ChangeOperatorStatusRequest }>(
    changeOperatorStatusContract.path,
    { schema: changeOperatorStatusContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      return send(
        await dependencies.identity.changeOperatorStatus.execute(
          { userId: request.params.userId, ...request.body },
          createExecutionContext(request, principal, dependencies)
        ),
        request, reply
      );
    }
  );

  app.put<{ Params: { userId: string }; Body: AssignOperatorRolesRequest }>(
    assignOperatorRolesContract.path,
    { schema: assignOperatorRolesContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      return send(
        await dependencies.identity.assignOperatorRoles.execute(
          { userId: request.params.userId, ...request.body },
          createExecutionContext(request, principal, dependencies)
        ),
        request, reply
      );
    }
  );

  app.post<{ Params: { userId: string }; Body: ExpireOperatorCredentialRequest }>(
    expireOperatorCredentialContract.path,
    { schema: expireOperatorCredentialContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await dependencies.identity.expireCredential.execute(
        { userId: request.params.userId, reason: request.body.reason },
        createExecutionContext(request, principal, dependencies)
      );
      return result.ok
        ? reply.code(204).send()
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.post<{ Body: CreateRoleRequest }>(createRoleContract.path, {
    schema: createRoleContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    return send(
      await dependencies.identity.createRole.execute(
        request.body, createExecutionContext(request, principal, dependencies)
      ),
      request, reply, 201
    );
  });

  app.put<{ Params: { roleId: string }; Body: UpdateRolePermissionsRequest }>(
    updateRolePermissionsContract.path,
    { schema: updateRolePermissionsContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      return send(
        await dependencies.identity.updateRolePermissions.execute(
          { roleId: request.params.roleId, ...request.body },
          createExecutionContext(request, principal, dependencies)
        ),
        request, reply
      );
    }
  );

  app.put<{ Params: { roleId: string }; Body: ChangeRoleStatusRequest }>(
    changeRoleStatusContract.path, { schema: changeRoleStatusContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      return send(
        await dependencies.identity.changeRoleStatus.execute(
          { roleId: request.params.roleId, ...request.body },
          createExecutionContext(request, principal, dependencies)
        ),
        request, reply
      );
    }
  );

  app.post<{ Body: AuthorizeCredentialEnrollmentRequest }>(
    authorizeCredentialEnrollmentContract.path,
    { schema: authorizeCredentialEnrollmentContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await dependencies.identity.authorizeEnrollment.execute(
        request.body, createExecutionContext(request, principal, dependencies)
      );
      if (!result.ok) {
        return sendProblem(reply, request, result.error.code, result.error.message);
      }
      /** El token en claro viaja una sola vez, en esta respuesta y nunca más. */
      const body: CredentialEnrollmentResponse = {
        ...result.value,
        expiresAt: result.value.expiresAt.toISOString()
      };
      return reply.code(201).send(body);
    }
  );
};
