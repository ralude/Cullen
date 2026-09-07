import type { FastifyInstance, FastifySchema } from 'fastify';
import {
  getSyncStatusContract,
  listPausedDeliveriesContract,
  listSyncDiscrepanciesContract,
  listSyncNodesContract,
  listCoordinatedOperationsContract,
  publishCatalogBootstrapContract,
  publishOperatorGrantsContract,
  registerSyncNodeContract,
  resolveSyncDiscrepancyContract,
  resumeSyncDeliveryContract,
  retrySyncDiscrepancyContract,
  revokeSyncNodeContract,
  type RegisterSyncNodeRequest,
  type ResumeSyncDeliveryRequest,
  type RevokeSyncNodeRequest,
  type PublishCatalogBootstrapRequest,
  type PublishOperatorGrantsRequest,
  type SyncDiscrepancyActionRequest
} from '@supermarket/shared';
import {
  createExecutionContext,
  requirePrincipal,
  sendProblem,
  type ServerDependencies
} from '../app.ts';

/**
 * Administración y revisión de la sincronización sobre la API de operadores,
 * que conserva loopback y las sesiones de ADR-0011. El listener técnico de LAN
 * no expone ninguna de estas rutas, y la identidad de máquina del transporte no
 * concede ninguno de sus permisos.
 */
export const registerSyncRoutes = (
  app: FastifyInstance,
  dependencies: ServerDependencies
): void => {
  const sync = dependencies.sync;
  if (!sync) return;

  app.post<{ Body: RegisterSyncNodeRequest }>(registerSyncNodeContract.path, {
    schema: registerSyncNodeContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await sync.registerNode.execute(
      request.body,
      createExecutionContext(request, principal, dependencies)
    );
    return result.ok
      ? reply.code(201).send(result.value)
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.post<{ Params: { nodeId: string }; Body: RevokeSyncNodeRequest }>(
    revokeSyncNodeContract.path,
    { schema: revokeSyncNodeContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await sync.revokeNode.execute(
        { nodeId: request.params.nodeId, reason: request.body.reason },
        createExecutionContext(request, principal, dependencies)
      );
      return result.ok
        ? reply.send(result.value)
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.get(listSyncNodesContract.path, {
    schema: listSyncNodesContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await sync.listNodes.execute(
      createExecutionContext(request, principal, dependencies)
    );
    return result.ok
      ? reply.send(result.value)
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.post<{ Body: PublishCatalogBootstrapRequest }>(publishCatalogBootstrapContract.path, {
    schema: publishCatalogBootstrapContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await sync.publishCatalogBootstrap.execute(
      request.body,
      createExecutionContext(request, principal, dependencies)
    );
    return result.ok
      ? reply.send(result.value)
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.post<{ Body: PublishOperatorGrantsRequest }>(publishOperatorGrantsContract.path, {
    schema: publishOperatorGrantsContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await sync.publishOperatorGrants.execute(
      request.body,
      createExecutionContext(request, principal, dependencies)
    );
    return result.ok
      ? reply.send(result.value)
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.get<{ Params: { status: 'PENDING_RECONCILIATION' | 'COMPLETED' | 'NEEDS_REVIEW' } }>(
    listCoordinatedOperationsContract.path, {
      schema: listCoordinatedOperationsContract.schema as FastifySchema
    }, async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await sync.listCoordinatedOperations.execute(
        request.params.status,
        createExecutionContext(request, principal, dependencies)
      );
      return result.ok
        ? reply.send(result.value)
        : sendProblem(reply, request, result.error.code, result.error.message);
    });

  app.get<{ Params: { destinationNodeId: string } }>(getSyncStatusContract.path, {
    schema: getSyncStatusContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await sync.getStatus.execute(
      request.params.destinationNodeId,
      createExecutionContext(request, principal, dependencies)
    );
    return result.ok
      ? reply.send(result.value)
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.get<{ Params: { destinationNodeId: string } }>(listPausedDeliveriesContract.path, {
    schema: listPausedDeliveriesContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await sync.listPaused.execute(
      request.params.destinationNodeId,
      createExecutionContext(request, principal, dependencies)
    );
    return result.ok
      ? reply.send(result.value)
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.post<{
    Params: { destinationNodeId: string; eventId: string };
    Body: ResumeSyncDeliveryRequest;
  }>(resumeSyncDeliveryContract.path, {
    schema: resumeSyncDeliveryContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await sync.resumeDelivery.execute({
      eventId: request.params.eventId,
      destinationNodeId: request.params.destinationNodeId,
      reason: request.body.reason
    }, createExecutionContext(request, principal, dependencies));
    return result.ok
      ? reply.send(result.value)
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.get<{ Querystring: { status?: 'OPEN' | 'RESOLVED' } }>(
    listSyncDiscrepanciesContract.path,
    { schema: listSyncDiscrepanciesContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await sync.listDiscrepancies.execute(
        request.query.status ?? 'OPEN',
        createExecutionContext(request, principal, dependencies)
      );
      return result.ok
        ? reply.send(result.value)
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.post<{ Params: { discrepancyId: string }; Body: SyncDiscrepancyActionRequest }>(
    retrySyncDiscrepancyContract.path,
    { schema: retrySyncDiscrepancyContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await sync.retryDiscrepancy.execute(
        { discrepancyId: request.params.discrepancyId, reason: request.body.reason },
        createExecutionContext(request, principal, dependencies)
      );
      return result.ok
        ? reply.send(result.value)
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.post<{ Params: { discrepancyId: string }; Body: SyncDiscrepancyActionRequest }>(
    resolveSyncDiscrepancyContract.path,
    { schema: resolveSyncDiscrepancyContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await sync.resolveDiscrepancy.execute(
        { discrepancyId: request.params.discrepancyId, reason: request.body.reason },
        createExecutionContext(request, principal, dependencies)
      );
      return result.ok
        ? reply.send(result.value)
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );
};
