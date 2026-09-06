import type { FastifyInstance, FastifySchema } from 'fastify';
import {
  getKardexContract,
  receivePurchaseContract,
  registerStockAdjustmentContract,
  type ReceivePurchaseRequest,
  type RegisterStockAdjustmentRequest
} from '@supermarket/shared';
import {
  createExecutionContext,
  requirePrincipal,
  sendProblem,
  type ServerDependencies
} from '../app.ts';

const stockResponse = <T extends { movements: readonly { occurredAt: Date }[]; batches?: readonly { expiresAt: Date | null }[] }>(value: T) => ({
  ...value,
  ...(Array.isArray(value.batches) ? {
    batches: value.batches.map((batch) => ({
      ...batch, expiresAt: batch.expiresAt?.toISOString() ?? null
    }))
  } : {}),
  movements: value.movements.map((movement) => ({
    ...movement, occurredAt: movement.occurredAt.toISOString()
  }))
});

export const registerInventoryRoutes = (
  app: FastifyInstance,
  dependencies: ServerDependencies
): void => {
  app.post<{ Body: ReceivePurchaseRequest }>(receivePurchaseContract.path, {
    schema: receivePurchaseContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const { lot, ...body } = request.body;
    const result = await dependencies.inventory.receivePurchase.execute({
      ...body,
      ...(lot ? {
        lot: {
          lotNumber: lot.lotNumber,
          ...(lot.expiresAt ? { expiresAt: new Date(lot.expiresAt) } : {})
        }
      } : {})
    }, createExecutionContext(request, principal, dependencies));
    return result.ok ? reply.code(201).send(stockResponse(result.value))
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.post<{ Params: { stockItemId: string }; Body: RegisterStockAdjustmentRequest }>(
    registerStockAdjustmentContract.path,
    { schema: registerStockAdjustmentContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await dependencies.inventory.registerStockAdjustment.execute({
        stockItemId: request.params.stockItemId, ...request.body
      }, createExecutionContext(request, principal, dependencies));
      return result.ok ? reply.send(stockResponse(result.value))
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.get<{
    Params: { productId: string };
    Querystring: { batchId?: string; from?: string; to?: string; reason?: string; limit?: number };
  }>(getKardexContract.path, {
    schema: getKardexContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.inventory.getKardex.execute({
      productId: request.params.productId,
      ...(request.query.batchId ? { batchId: request.query.batchId } : {}),
      ...(request.query.from ? { from: new Date(request.query.from) } : {}),
      ...(request.query.to ? { to: new Date(request.query.to) } : {}),
      ...(request.query.reason ? { reason: request.query.reason } : {}),
      ...(request.query.limit ? { limit: request.query.limit } : {})
    }, createExecutionContext(request, principal, dependencies));
    return result.ok ? reply.send(stockResponse(result.value))
      : sendProblem(reply, request, result.error.code, result.error.message);
  });
};
