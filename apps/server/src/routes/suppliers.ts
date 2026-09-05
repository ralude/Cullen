import type { FastifyInstance, FastifySchema } from 'fastify';
import {
  changeSupplierStatusContract,
  correctSupplierTaxIdentityContract,
  createSupplierContract,
  getSupplierContract,
  listSuppliersContract,
  updateSupplierContract,
  type ChangeSupplierStatusRequest,
  type CorrectSupplierTaxIdentityRequest,
  type CreateSupplierRequest,
  type SupplierStatusResponse,
  type UpdateSupplierRequest
} from '@supermarket/shared';
import {
  createExecutionContext,
  requirePrincipal,
  sendProblem,
  type ServerDependencies
} from '../app.ts';

const sendResult = (
  result: Awaited<ReturnType<ServerDependencies['suppliers']['update']['execute']>>,
  request: Parameters<typeof sendProblem>[1],
  reply: Parameters<typeof sendProblem>[0],
  successStatus = 200
) => result.ok
  ? reply.code(successStatus).send(result.value)
  : sendProblem(reply, request, result.error.code, result.error.message);

export const registerSupplierRoutes = (
  app: FastifyInstance,
  dependencies: ServerDependencies
): void => {
  app.post<{ Body: CreateSupplierRequest }>(createSupplierContract.path, {
    schema: createSupplierContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    return sendResult(
      await dependencies.suppliers.create.execute(
        request.body,
        createExecutionContext(request, principal, dependencies)
      ),
      request,
      reply,
      201
    );
  });

  app.get<{ Querystring: { status?: SupplierStatusResponse } }>(listSuppliersContract.path, {
    schema: listSuppliersContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.suppliers.list.execute(
      request.query.status, createExecutionContext(request, principal, dependencies)
    );
    return result.ok
      ? reply.send(result.value)
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.get<{ Params: { supplierId: string } }>(getSupplierContract.path, {
    schema: getSupplierContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.suppliers.get.execute(
      request.params.supplierId, createExecutionContext(request, principal, dependencies)
    );
    return result.ok
      ? reply.send(result.value)
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.patch<{ Params: { supplierId: string }; Body: UpdateSupplierRequest }>(
    updateSupplierContract.path,
    { schema: updateSupplierContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      return sendResult(await dependencies.suppliers.update.execute({
        supplierId: request.params.supplierId,
        ...request.body
      }, createExecutionContext(request, principal, dependencies)), request, reply);
    }
  );

  app.put<{ Params: { supplierId: string }; Body: ChangeSupplierStatusRequest }>(
    changeSupplierStatusContract.path,
    { schema: changeSupplierStatusContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      return sendResult(await dependencies.suppliers.changeStatus.execute({
        supplierId: request.params.supplierId,
        ...request.body
      }, createExecutionContext(request, principal, dependencies)), request, reply);
    }
  );

  app.put<{ Params: { supplierId: string }; Body: CorrectSupplierTaxIdentityRequest }>(
    correctSupplierTaxIdentityContract.path,
    { schema: correctSupplierTaxIdentityContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      return sendResult(await dependencies.suppliers.correctTaxIdentity.execute({
        supplierId: request.params.supplierId,
        ...request.body
      }, createExecutionContext(request, principal, dependencies)), request, reply);
    }
  );
};
