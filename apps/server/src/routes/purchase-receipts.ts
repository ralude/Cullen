import type { FastifyInstance, FastifySchema } from 'fastify';
import {
  completePurchaseReceiptContract,
  getPurchaseReceiptContract,
  reversePurchaseReceiptContract,
  startPurchaseReceiptContract,
  type CompletePurchaseReceiptRequest,
  type ReversePurchaseReceiptRequest,
  type StartPurchaseReceiptRequest
} from '@supermarket/shared';
import {
  createExecutionContext,
  requirePrincipal,
  sendProblem,
  type ServerDependencies
} from '../app.ts';

const sendResult = (
  result: Awaited<ReturnType<ServerDependencies['purchaseReceipts']['start']['execute']>>,
  request: Parameters<typeof sendProblem>[1],
  reply: Parameters<typeof sendProblem>[0],
  successStatus = 200
) => result.ok
  ? reply.code(successStatus).send(result.value)
  : sendProblem(reply, request, result.error.code, result.error.message);

export const registerPurchaseReceiptRoutes = (
  app: FastifyInstance,
  dependencies: ServerDependencies
): void => {
  app.post<{ Body: StartPurchaseReceiptRequest }>(startPurchaseReceiptContract.path, {
    schema: startPurchaseReceiptContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const body = request.body;
    return sendResult(
      await dependencies.purchaseReceipts.start.execute({
        ...(body.replacesReceiptId ? { replacesReceiptId: body.replacesReceiptId } : {}),
        supplierId: body.supplierId,
        sourceDocument: {
          type: body.sourceDocument.type, number: body.sourceDocument.number,
          ...(body.sourceDocument.series ? { series: body.sourceDocument.series } : {}),
          ...(body.sourceDocument.controlNumber ? { controlNumber: body.sourceDocument.controlNumber } : {}),
          ...(body.sourceDocument.issuedAt ? { issuedAt: new Date(body.sourceDocument.issuedAt) } : {})
        },
        effectiveAt: new Date(body.effectiveAt),
        lines: body.lines.map((line) => ({
          productId: line.productId, quantity: line.quantity,
          ...(line.lot ? { lot: {
            lotNumber: line.lot.lotNumber,
            ...(line.lot.expiresAt ? { expiresAt: new Date(line.lot.expiresAt) } : {})
          } } : {}),
          purchaseUnitCostMinorUnits: line.purchaseUnitCostMinorUnits,
          purchaseCurrency: line.purchaseCurrency,
          ...(line.exchangeRateId ? { exchangeRateId: line.exchangeRateId } : {})
        })),
        reason: body.reason
      }, createExecutionContext(request, principal, dependencies)),
      request,
      reply,
      201
    );
  });

  app.put<{ Params: { receiptId: string }; Body: CompletePurchaseReceiptRequest }>(
    completePurchaseReceiptContract.path,
    { schema: completePurchaseReceiptContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      return sendResult(await dependencies.purchaseReceipts.complete.execute({
        receiptId: request.params.receiptId, reason: request.body.reason
      }, createExecutionContext(request, principal, dependencies)), request, reply);
    }
  );

  app.put<{ Params: { receiptId: string }; Body: ReversePurchaseReceiptRequest }>(
    reversePurchaseReceiptContract.path,
    { schema: reversePurchaseReceiptContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      return sendResult(await dependencies.purchaseReceipts.reverse.execute({
        receiptId: request.params.receiptId, reason: request.body.reason
      }, createExecutionContext(request, principal, dependencies)), request, reply);
    }
  );

  app.get<{ Params: { receiptId: string } }>(getPurchaseReceiptContract.path, {
    schema: getPurchaseReceiptContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.purchaseReceipts.get.execute(
      request.params.receiptId, createExecutionContext(request, principal, dependencies)
    );
    return result.ok
      ? reply.send(result.value)
      : sendProblem(reply, request, result.error.code, result.error.message);
  });
};
