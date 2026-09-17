import type { FastifyInstance, FastifySchema } from 'fastify';
import {
  calculateMixedPaymentTotalsContract,
  getExchangeRateHistoryContract,
  getCurrentExchangeRateContract,
  getSuggestedExchangeRateContract,
  listPaymentMethodsContract,
  updateExchangeRateContract,
  type MixedPaymentRequest,
  type UpdateExchangeRateRequest
} from '@supermarket/shared';
import { createExecutionContext, requirePrincipal, sendProblem } from '../http-context.ts';
import type { ServerDependencies } from '../server-dependencies.ts';

const rateResponse = (rate: {
  id: string; baseCurrency: string; quoteCurrency: string; rateValue: number;
  rateScale: number; source: string; validFrom: Date; validUntil: Date | null;
  registeredBy: string;
}) => ({
  ...rate,
  validFrom: rate.validFrom.toISOString(),
  validUntil: rate.validUntil?.toISOString() ?? null,
  registeredBy: rate.registeredBy
});

const suggestionResponse = (suggestion: {
  baseCurrency: string; quoteCurrency: string; rateValue: number; rateScale: number;
  source: string; observedAt: Date; validFrom: Date | null; validUntil: Date | null;
}) => ({
  suggestion: {
    ...suggestion,
    observedAt: suggestion.observedAt.toISOString(),
    validFrom: suggestion.validFrom?.toISOString() ?? null,
    validUntil: suggestion.validUntil?.toISOString() ?? null
  }
});

export const registerCurrencyRoutes = (
  app: FastifyInstance,
  dependencies: ServerDependencies
): void => {
  app.get<{ Querystring: { baseCurrency: string; quoteCurrency: string; limit?: number } }>(
    getExchangeRateHistoryContract.path,
    { schema: getExchangeRateHistoryContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await dependencies.currency.getExchangeRateHistory.execute(
        request.query.baseCurrency, request.query.quoteCurrency, request.query.limit
      );
      return result.ok
        ? reply.send(result.value.map(rateResponse))
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.get<{ Querystring: { baseCurrency: string; quoteCurrency: string } }>(
    getSuggestedExchangeRateContract.path,
    { schema: getSuggestedExchangeRateContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await dependencies.currency.getSuggestedExchangeRate.execute(
        request.query.baseCurrency, request.query.quoteCurrency
      );
      return result.ok
        ? reply.send(suggestionResponse(result.value))
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.post<{ Body: UpdateExchangeRateRequest }>(updateExchangeRateContract.path, {
    schema: updateExchangeRateContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.currency.updateExchangeRate.execute({
      ...request.body,
      validFrom: new Date(request.body.validFrom),
      validUntil: request.body.validUntil ? new Date(request.body.validUntil) : null
    }, createExecutionContext(request, principal, dependencies));
    return result.ok
      ? reply.code(201).send(rateResponse(result.value))
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.get<{ Querystring: { baseCurrency: string; quoteCurrency: string } }>(
    getCurrentExchangeRateContract.path,
    { schema: getCurrentExchangeRateContract.schema as FastifySchema },
    async (request, reply) => {
      if (!await requirePrincipal(request, reply, dependencies)) return;
      const result = await dependencies.currency.getCurrentExchangeRate.execute(
        request.query.baseCurrency,
        request.query.quoteCurrency
      );
      return result.ok
        ? reply.send(rateResponse(result.value))
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  if (dependencies.masterData) {
    app.get(listPaymentMethodsContract.path, {
      schema: listPaymentMethodsContract.schema as FastifySchema
    }, async (request, reply) => {
      if (!await requirePrincipal(request, reply, dependencies)) return;
      const result = await dependencies.masterData!.listPaymentMethods.execute();
      return result.ok ? reply.send(result.value) : sendProblem(reply, request, result.error.code, result.error.message);
    });
  }

  app.post<{ Body: MixedPaymentRequest }>(calculateMixedPaymentTotalsContract.path, {
    schema: calculateMixedPaymentTotalsContract.schema as FastifySchema
  }, async (request, reply) => {
    if (!await requirePrincipal(request, reply, dependencies)) return;
    const result = await dependencies.currency.calculateMixedPaymentTotals.execute({
      targetCurrency: request.body.targetCurrency,
      payments: request.body.payments.map((payment) => ({ ...payment }))
    });
    return result.ok
      ? reply.send(result.value)
      : sendProblem(reply, request, result.error.code, result.error.message);
  });
};
