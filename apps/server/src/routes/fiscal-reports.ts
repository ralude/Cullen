import type { FastifyInstance, FastifySchema } from 'fastify';
import {
  printSimulatedXReportContract,
  printSimulatedZReportContract,
  type SimulatedFiscalReportRequest,
  type SimulatedFiscalReportResponse
} from '@supermarket/shared';
import { createExecutionContext, requirePrincipal, sendProblem } from '../http-context.ts';
import type { ServerDependencies } from '../server-dependencies.ts';

export const registerFiscalReportRoutes = (
  app: FastifyInstance,
  dependencies: ServerDependencies
): void => {
  const reports = dependencies.fiscalReports;
  if (!reports) return;

  const register = (
    contract: typeof printSimulatedXReportContract | typeof printSimulatedZReportContract,
    useCase: typeof reports.printX
  ): void => {
    app.post<{ Body: SimulatedFiscalReportRequest }>(contract.path, {
      schema: contract.schema as FastifySchema
    }, async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await useCase.execute(
        {
          dayId: request.body.dayId,
          businessDate: request.body.businessDate,
          reason: request.body.reason
        },
        createExecutionContext(request, principal, dependencies)
      );
      if (!result.ok) return sendProblem(reply, request, result.error.code, result.error.message);
      const response: SimulatedFiscalReportResponse = {
        fiscalMode: 'SIMULATION',
        report: result.value
      };
      return response;
    });
  };

  register(printSimulatedXReportContract, reports.printX);
  register(printSimulatedZReportContract, reports.printZ);
};
