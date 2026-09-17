import type { FastifyInstance, FastifySchema } from 'fastify';
import type { FiscalDocumentDto } from '@supermarket/core';
import {
  getSimulatedFiscalDocumentContract,
  issueSimulatedFiscalDocumentContract,
  reconcileSimulatedFiscalDocumentContract,
  type IssueSimulatedFiscalDocumentRequest
} from '@supermarket/shared';
import { createExecutionContext, requirePrincipal, sendProblem } from '../http-context.ts';
import type { ServerDependencies } from '../server-dependencies.ts';

const response = (document: FiscalDocumentDto) => ({
  fiscalMode: 'SIMULATION' as const,
  document
});

export const registerFiscalDocumentRoutes = (
  app: FastifyInstance,
  dependencies: ServerDependencies
): void => {
  app.post<{ Body: IssueSimulatedFiscalDocumentRequest }>(
    issueSimulatedFiscalDocumentContract.path,
    { schema: issueSimulatedFiscalDocumentContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await dependencies.fiscalDocuments.issue.execute({
        content: {
          ...request.body.content,
          lines: request.body.content.lines.map((line) => ({ ...line })),
          payments: request.body.content.payments.map((payment) => ({ ...payment }))
        },
        reason: request.body.reason
      }, createExecutionContext(request, principal, dependencies));
      return result.ok ? reply.code(201).send(response(result.value))
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.get<{ Params: { documentId: string } }>(getSimulatedFiscalDocumentContract.path, {
    schema: getSimulatedFiscalDocumentContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.fiscalDocuments.get.execute(
      request.params.documentId,
      createExecutionContext(request, principal, dependencies)
    );
    return result.ok ? reply.send(response(result.value))
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.post<{ Params: { documentId: string }; Body: { reason: string } }>(
    reconcileSimulatedFiscalDocumentContract.path,
    { schema: reconcileSimulatedFiscalDocumentContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await dependencies.fiscalDocuments.reconcile.execute({
        documentId: request.params.documentId, reason: request.body.reason
      }, createExecutionContext(request, principal, dependencies));
      return result.ok ? reply.send(response(result.value))
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );
};
