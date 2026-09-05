import type { FastifyInstance, FastifySchema } from 'fastify';
import {
  approveStockCountContract,
  closeStockCountContract,
  getStockCountContract,
  listStockCountsContract,
  openStockCountContract,
  recordStockCountLineContract,
  rejectStockCountContract,
  type ApproveStockCountRequest,
  type CloseStockCountRequest,
  type OpenStockCountRequest,
  type RecordStockCountLineRequest,
  type RejectStockCountRequest,
  type StockCountStatusResponse
} from '@supermarket/shared';
import {
  createExecutionContext,
  requirePrincipal,
  sendProblem,
  type ServerDependencies
} from '../app.ts';

const stockCountResponse = <T extends {
  openedAt: Date; closedAt: Date | null; approvedAt: Date | null; rejectedAt: Date | null;
}>(value: T) => ({
  ...value,
  openedAt: value.openedAt.toISOString(),
  closedAt: value.closedAt?.toISOString() ?? null,
  approvedAt: value.approvedAt?.toISOString() ?? null,
  rejectedAt: value.rejectedAt?.toISOString() ?? null
});

const sendResult = (
  result: Awaited<ReturnType<ServerDependencies['stockCounts']['open']['execute']>>,
  request: Parameters<typeof sendProblem>[1],
  reply: Parameters<typeof sendProblem>[0],
  successStatus = 200
) => result.ok
  ? reply.code(successStatus).send(stockCountResponse(result.value))
  : sendProblem(reply, request, result.error.code, result.error.message);

export const registerStockCountRoutes = (
  app: FastifyInstance,
  dependencies: ServerDependencies
): void => {
  app.post<{ Body: OpenStockCountRequest }>(openStockCountContract.path, {
    schema: openStockCountContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    return sendResult(
      await dependencies.stockCounts.open.execute(
        request.body, createExecutionContext(request, principal, dependencies)
      ),
      request, reply, 201
    );
  });

  app.post<{ Params: { stockCountId: string }; Body: RecordStockCountLineRequest }>(
    recordStockCountLineContract.path,
    { schema: recordStockCountLineContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      return sendResult(await dependencies.stockCounts.recordLine.execute({
        stockCountId: request.params.stockCountId, ...request.body
      }, createExecutionContext(request, principal, dependencies)), request, reply);
    }
  );

  app.post<{ Params: { stockCountId: string }; Body: CloseStockCountRequest }>(
    closeStockCountContract.path,
    { schema: closeStockCountContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      return sendResult(await dependencies.stockCounts.close.execute({
        stockCountId: request.params.stockCountId, ...request.body
      }, createExecutionContext(request, principal, dependencies)), request, reply);
    }
  );

  app.post<{ Params: { stockCountId: string }; Body: ApproveStockCountRequest }>(
    approveStockCountContract.path,
    { schema: approveStockCountContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      return sendResult(await dependencies.stockCounts.approve.execute({
        stockCountId: request.params.stockCountId, ...request.body
      }, createExecutionContext(request, principal, dependencies)), request, reply);
    }
  );

  app.post<{ Params: { stockCountId: string }; Body: RejectStockCountRequest }>(
    rejectStockCountContract.path,
    { schema: rejectStockCountContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      return sendResult(await dependencies.stockCounts.reject.execute({
        stockCountId: request.params.stockCountId, ...request.body
      }, createExecutionContext(request, principal, dependencies)), request, reply);
    }
  );

  app.get<{ Params: { stockCountId: string } }>(getStockCountContract.path, {
    schema: getStockCountContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.stockCounts.get.execute(
      { stockCountId: request.params.stockCountId },
      createExecutionContext(request, principal, dependencies)
    );
    return result.ok ? reply.send(stockCountResponse(result.value))
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.get<{ Querystring: { status?: StockCountStatusResponse } }>(listStockCountsContract.path, {
    schema: listStockCountsContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.stockCounts.list.execute(
      request.query.status, createExecutionContext(request, principal, dependencies)
    );
    return result.ok
      ? reply.send(result.value.map(stockCountResponse))
      : sendProblem(reply, request, result.error.code, result.error.message);
  });
};
