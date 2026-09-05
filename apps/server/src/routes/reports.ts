import type { FastifyInstance, FastifySchema } from 'fastify';
import {
  getAuditReportContract,
  getCashClosureReportContract,
  getFiscalOperationsReportContract,
  getMarginReportContract
} from '@supermarket/shared';
import {
  createExecutionContext,
  requirePrincipal,
  sendProblem,
  type ServerDependencies
} from '../app.ts';

type PeriodQuery = { from?: string; to?: string; limit?: number };

const period = (query: PeriodQuery) => ({
  ...(query.from ? { from: new Date(query.from) } : {}),
  ...(query.to ? { to: new Date(query.to) } : {}),
  ...(query.limit === undefined ? {} : { limit: query.limit })
});

export const registerReportRoutes = (
  app: FastifyInstance,
  dependencies: ServerDependencies
): void => {
  const reports = dependencies.reports;
  if (!reports) return;

  app.get<{ Querystring: PeriodQuery & { cashRegisterId?: string } }>(
    getCashClosureReportContract.path,
    { schema: getCashClosureReportContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await reports.getCashClosureReport.execute({
        ...period(request.query),
        ...(request.query.cashRegisterId ? { cashRegisterId: request.query.cashRegisterId } : {})
      }, createExecutionContext(request, principal, dependencies));
      return result.ok
        ? reply.send(result.value.map((entry) => ({
          ...entry,
          openedAt: entry.openedAt.toISOString(),
          closedAt: entry.closedAt?.toISOString() ?? null
        })))
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.get<{
    Querystring: PeriodQuery & { actorId?: string; action?: string; entityType?: string };
  }>(
    getAuditReportContract.path,
    { schema: getAuditReportContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await reports.getAuditReport.execute({
        ...period(request.query),
        ...(request.query.actorId ? { actorId: request.query.actorId } : {}),
        ...(request.query.action ? { action: request.query.action } : {}),
        ...(request.query.entityType ? { entityType: request.query.entityType } : {})
      }, createExecutionContext(request, principal, dependencies));
      return result.ok
        ? reply.send(result.value.map((entry) => ({
          ...entry, occurredAt: entry.occurredAt.toISOString()
        })))
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.get<{ Querystring: PeriodQuery }>(
    getFiscalOperationsReportContract.path,
    { schema: getFiscalOperationsReportContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await reports.getFiscalOperationsReport.execute(
        period(request.query),
        createExecutionContext(request, principal, dependencies)
      );
      return result.ok
        ? reply.send({
          fiscalMode: 'SIMULATION',
          operations: result.value.map((entry) => ({
            ...entry, requestedAt: entry.requestedAt.toISOString()
          }))
        })
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.get<{ Querystring: PeriodQuery & { from: string; to: string; currencyCode?: string } }>(
    getMarginReportContract.path,
    { schema: getMarginReportContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await reports.getMarginReport.execute({
        from: new Date(request.query.from), to: new Date(request.query.to),
        ...(request.query.limit === undefined ? {} : { limit: request.query.limit }),
        ...(request.query.currencyCode ? { currencyCode: request.query.currencyCode } : {})
      }, createExecutionContext(request, principal, dependencies));
      return result.ok
        ? reply.send(result.value)
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );
};
