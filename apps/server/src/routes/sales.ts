import type { FastifyInstance, FastifySchema } from 'fastify';
import {
  addSaleItemContract,
  applySaleDiscountContract,
  completeSaleContract,
  getSaleContract,
  getSaleHistoryContract,
  registerSalePaymentsContract,
  returnSaleContract,
  removeSaleItemContract,
  setSaleRecipientContract,
  startSaleContract,
  voidSaleContract,
  type AddSaleItemRequest,
  type ApplySaleDiscountRequest,
  type RegisterSalePaymentsRequest,
  type SetSaleRecipientRequest,
  type StartSaleRequest,
  type VoidSaleRequest,
  type ReturnSaleRequest
} from '@supermarket/shared';
import {
  createExecutionContext,
  requirePrincipal,
  sendProblem,
  type ServerDependencies
} from '../app.ts';

const saleResponse = <T extends { completedAt: Date | null; voidedAt: Date | null }>(sale: T) => ({
  ...sale,
  completedAt: sale.completedAt?.toISOString() ?? null,
  voidedAt: sale.voidedAt?.toISOString() ?? null
});

export const registerSalesRoutes = (
  app: FastifyInstance,
  dependencies: ServerDependencies
): void => {
  app.post<{ Body: StartSaleRequest }>(startSaleContract.path, {
    schema: startSaleContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.sales.startSale.execute(
      request.body,
      createExecutionContext(request, principal, dependencies)
    );
    return result.ok
      ? reply.code(201).send(saleResponse(result.value))
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.get<{ Params: { saleId: string } }>(getSaleContract.path, {
    schema: getSaleContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.sales.getSale.execute(
      request.params.saleId,
      createExecutionContext(request, principal, dependencies)
    );
    return result.ok
      ? reply.send(saleResponse(result.value))
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.get<{ Params: { saleId: string }; Querystring: { limit?: number } }>(
    getSaleHistoryContract.path,
    { schema: getSaleHistoryContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await dependencies.sales.getSaleHistory.execute({
        saleId: request.params.saleId,
        ...(request.query.limit === undefined ? {} : { limit: request.query.limit })
      }, createExecutionContext(request, principal, dependencies));
      return result.ok
        ? reply.send(result.value.map((version) => ({
          ...version, occurredAt: version.occurredAt.toISOString()
        })))
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.post<{ Params: { saleId: string }; Body: AddSaleItemRequest }>(addSaleItemContract.path, {
    schema: addSaleItemContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.sales.addItemToSale.execute({
      saleId: request.params.saleId,
      ...request.body
    }, createExecutionContext(request, principal, dependencies));
    return result.ok
      ? reply.send(saleResponse(result.value))
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.delete<{ Params: { saleId: string; itemId: string } }>(removeSaleItemContract.path, {
    schema: removeSaleItemContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.sales.removeItemFromSale.execute(
      request.params,
      createExecutionContext(request, principal, dependencies)
    );
    return result.ok ? reply.send(saleResponse(result.value))
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.post<{ Params: { saleId: string }; Body: ApplySaleDiscountRequest }>(
    applySaleDiscountContract.path,
    { schema: applySaleDiscountContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await dependencies.sales.applyDiscountToSale.execute({
        saleId: request.params.saleId, ...request.body
      }, createExecutionContext(request, principal, dependencies));
      return result.ok ? reply.send(saleResponse(result.value))
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.post<{ Params: { saleId: string }; Body: RegisterSalePaymentsRequest }>(
    registerSalePaymentsContract.path,
    { schema: registerSalePaymentsContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await dependencies.sales.registerMixedPayment.execute({
        saleId: request.params.saleId,
        payments: request.body.payments.map((payment) => ({ ...payment }))
      }, createExecutionContext(request, principal, dependencies));
      return result.ok ? reply.send(saleResponse(result.value))
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.post<{ Params: { saleId: string } }>(completeSaleContract.path, {
    schema: completeSaleContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.sales.completeSale.execute(
      request.params,
      createExecutionContext(request, principal, dependencies)
    );
    return result.ok ? reply.send(saleResponse(result.value))
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.put<{ Params: { saleId: string }; Body: SetSaleRecipientRequest }>(
    setSaleRecipientContract.path,
    { schema: setSaleRecipientContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await dependencies.sales.setSaleRecipient.execute({
        saleId: request.params.saleId,
        recipient: request.body.recipient === null ? null : { ...request.body.recipient }
      }, createExecutionContext(request, principal, dependencies));
      return result.ok ? reply.send(saleResponse(result.value))
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.post<{ Params: { saleId: string }; Body: VoidSaleRequest }>(voidSaleContract.path, {
    schema: voidSaleContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.sales.voidSale.execute({
      saleId: request.params.saleId, ...request.body
    }, createExecutionContext(request, principal, dependencies));
    return result.ok ? reply.send(saleResponse(result.value))
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.post<{ Params: { saleId: string }; Body: ReturnSaleRequest }>(returnSaleContract.path, {
    schema: returnSaleContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.sales.returnSale.execute({
      saleId: request.params.saleId,
      reason: request.body.reason
    }, createExecutionContext(request, principal, dependencies));
    if (!result.ok) return sendProblem(reply, request, result.error.code, result.error.message);
    return reply.code(201).send({
      ...result.value,
      occurredAt: result.value.occurredAt.toISOString()
    });
  });
};
