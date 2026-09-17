import type { FastifyInstance, FastifySchema } from 'fastify';
import {
  createProductContract,
  findProductByBarcodeContract,
  getPriceHistoryContract,
  listCategoriesContract,
  listProductsContract,
  listUnitsOfMeasureContract,
  updatePriceContract,
  updateProductContract,
  type CreateProductRequest,
  type UpdatePriceRequest,
  type UpdateProductRequest
} from '@supermarket/shared';
import { createExecutionContext, requirePrincipal, sendProblem } from '../http-context.ts';
import type { ServerDependencies } from '../server-dependencies.ts';

const sendResult = (
  result: Awaited<ReturnType<ServerDependencies['catalog']['createProduct']['execute']>>,
  request: Parameters<typeof sendProblem>[1],
  reply: Parameters<typeof sendProblem>[0],
  successStatus = 200
) => result.ok
  ? reply.code(successStatus).send(result.value)
  : sendProblem(reply, request, result.error.code, result.error.message);

export const registerCatalogRoutes = (
  app: FastifyInstance,
  dependencies: ServerDependencies
): void => {
  if (dependencies.catalogReads) {
    app.get<{ Querystring: { query?: string } }>(listProductsContract.path, {
      schema: listProductsContract.schema as FastifySchema
    }, async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await dependencies.catalogReads!.listProducts.execute(request.query.query ?? '');
      return result.ok ? reply.send(result.value) : sendProblem(reply, request, result.error.code, result.error.message);
    });
    app.get<{ Params: { productId: string } }>(getPriceHistoryContract.path, {
      schema: getPriceHistoryContract.schema as FastifySchema
    }, async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await dependencies.catalogReads!.getPriceHistory.execute(request.params.productId);
      return result.ok
        ? reply.send(result.value.map((entry) => ({ ...entry, recordedAt: entry.recordedAt.toISOString() })))
        : sendProblem(reply, request, result.error.code, result.error.message);
    });
  }
  if (dependencies.masterData) {
    app.get(listCategoriesContract.path, {
      schema: listCategoriesContract.schema as FastifySchema
    }, async (request, reply) => {
      if (!await requirePrincipal(request, reply, dependencies)) return;
      const result = await dependencies.masterData!.listCategories.execute();
      return result.ok ? reply.send(result.value) : sendProblem(reply, request, result.error.code, result.error.message);
    });
    app.get(listUnitsOfMeasureContract.path, {
      schema: listUnitsOfMeasureContract.schema as FastifySchema
    }, async (request, reply) => {
      if (!await requirePrincipal(request, reply, dependencies)) return;
      const result = await dependencies.masterData!.listUnitsOfMeasure.execute();
      return result.ok ? reply.send(result.value) : sendProblem(reply, request, result.error.code, result.error.message);
    });
  }
  app.post<{ Body: CreateProductRequest }>(createProductContract.path, {
    schema: createProductContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    return sendResult(
      await dependencies.catalog.createProduct.execute(
        { ...request.body, barcodes: [...request.body.barcodes] },
        createExecutionContext(request, principal, dependencies)
      ),
      request,
      reply,
      201
    );
  });

  app.patch<{ Params: { productId: string }; Body: UpdateProductRequest }>(
    updateProductContract.path,
    { schema: updateProductContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const { barcodes, ...body } = request.body;
      const result = await dependencies.catalog.updateProduct.execute({
        productId: request.params.productId,
        ...body,
        ...(barcodes ? { barcodes: [...barcodes] } : {})
      }, createExecutionContext(request, principal, dependencies));
      return result.ok
        ? reply.send(result.value)
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.put<{ Params: { productId: string }; Body: UpdatePriceRequest }>(
    updatePriceContract.path,
    { schema: updatePriceContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await dependencies.catalog.updatePrice.execute({
        productId: request.params.productId,
        ...request.body
      }, createExecutionContext(request, principal, dependencies));
      return result.ok
        ? reply.send(result.value)
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.get<{ Params: { barcode: string } }>(findProductByBarcodeContract.path, {
    schema: findProductByBarcodeContract.schema as FastifySchema
  }, async (request, reply) => {
    if (!await requirePrincipal(request, reply, dependencies)) return;
    const result = await dependencies.catalog.findProductByBarcode.execute(request.params);
    return result.ok
      ? reply.send(result.value)
      : sendProblem(reply, request, result.error.code, result.error.message);
  });
};
