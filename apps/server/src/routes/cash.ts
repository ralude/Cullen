import type { FastifyInstance, FastifySchema } from 'fastify';
import {
  closeShiftContract,
  getOpenShiftContract,
  getShiftContract,
  listCashRegistersContract,
  openShiftContract,
  registerCashMovementContract,
  type CloseShiftRequest,
  type OpenShiftRequest,
  type RegisterCashMovementRequest
} from '@supermarket/shared';
import {
  createExecutionContext,
  requirePrincipal,
  sendProblem,
  type ServerDependencies
} from '../app.ts';

const shiftResponse = <T extends {
  openedAt: Date; closedAt: Date | null; movements: readonly { registeredAt: Date }[];
}>(shift: T) => ({
  ...shift,
  openedAt: shift.openedAt.toISOString(),
  closedAt: shift.closedAt?.toISOString() ?? null,
  movements: shift.movements.map((movement) => ({
    ...movement, registeredAt: movement.registeredAt.toISOString()
  }))
});

export const registerCashRoutes = (
  app: FastifyInstance,
  dependencies: ServerDependencies
): void => {
  if (dependencies.masterData) {
    app.get(listCashRegistersContract.path, {
      schema: listCashRegistersContract.schema as FastifySchema
    }, async (request, reply) => {
      if (!await requirePrincipal(request, reply, dependencies)) return;
      const result = await dependencies.masterData!.listCashRegisters.execute();
      return result.ok ? reply.send(result.value) : sendProblem(reply, request, result.error.code, result.error.message);
    });
  }

  app.post<{ Body: OpenShiftRequest }>(openShiftContract.path, {
    schema: openShiftContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.cash.openShift.execute({
      cashRegisterId: request.body.cashRegisterId,
      openingFunds: request.body.openingFunds.map((fund) => ({ ...fund }))
    }, createExecutionContext(request, principal, dependencies));
    return result.ok ? reply.code(201).send(shiftResponse(result.value))
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.get<{ Params: { cashRegisterId: string } }>(getOpenShiftContract.path, {
    schema: getOpenShiftContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.cash.getOpenShift.execute(
      request.params.cashRegisterId,
      createExecutionContext(request, principal, dependencies)
    );
    return result.ok ? reply.send(shiftResponse(result.value))
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.get<{ Params: { shiftId: string } }>(getShiftContract.path, {
    schema: getShiftContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.cash.getShift.execute(
      request.params.shiftId,
      createExecutionContext(request, principal, dependencies)
    );
    return result.ok ? reply.send(shiftResponse(result.value))
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.post<{ Params: { shiftId: string }; Body: RegisterCashMovementRequest }>(
    registerCashMovementContract.path,
    { schema: registerCashMovementContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await dependencies.cash.registerCashMovement.execute({
        shiftId: request.params.shiftId, ...request.body
      }, createExecutionContext(request, principal, dependencies));
      return result.ok ? reply.send(shiftResponse(result.value))
        : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.post<{ Params: { shiftId: string }; Body: CloseShiftRequest }>(closeShiftContract.path, {
    schema: closeShiftContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.cash.closeShift.execute({
      shiftId: request.params.shiftId,
      declaredBalances: request.body.declaredBalances.map((balance) => ({ ...balance })),
      ...(request.body.reason === undefined ? {} : { reason: request.body.reason })
    }, createExecutionContext(request, principal, dependencies));
    return result.ok ? reply.send(shiftResponse(result.value))
      : sendProblem(reply, request, result.error.code, result.error.message);
  });
};
