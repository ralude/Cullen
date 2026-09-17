import type { FastifyInstance, FastifySchema } from 'fastify';
import { capabilitiesContract, type CapabilitiesResponse } from '@supermarket/shared';
import { requirePrincipal } from '../http-context.ts';
import type { ServerDependencies } from '../server-dependencies.ts';

export const registerSystemRoutes = (app: FastifyInstance, dependencies: ServerDependencies): void => {
  app.get(capabilitiesContract.path, {
    schema: capabilitiesContract.schema as FastifySchema
  }, async (request, reply) => {
    if (!await requirePrincipal(request, reply, dependencies)) return;
    const response: CapabilitiesResponse = {
      fiscalMode: 'SIMULATION',
      simulatedReportsEnabled: dependencies.simulatedReportsEnabled
    };
    return response;
  });
};

