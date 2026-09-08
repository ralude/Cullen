import type { FastifyInstance, FastifySchema } from 'fastify';
import {
  activateDiscountPolicyContract,
  activateTaxPolicyContract,
  changeBranchStatusContract,
  changeDeviceStatusContract,
  createBranchContract,
  declareDeviceContract,
  getBranchContract,
  listBranchesContract,
  listDevicesContract,
  createCashRegisterContract,
  listOperationalMasterDataContract,
  saveCategoryContract,
  savePaymentMethodContract,
  saveUnitContract,
  updateBranchContract,
  updateDeviceContract,
  type BranchStatusResponse,
  type ActivateDiscountPolicyRequest,
  type ActivateTaxPolicyRequest,
  type ChangeBranchStatusRequest,
  type ChangeDeviceStatusRequest,
  type CreateBranchRequest,
  type CreateCashRegisterRequest,
  type DeclareDeviceRequest,
  type DeviceStatusResponse,
  type SaveCategoryRequest,
  type SavePaymentMethodRequest,
  type SaveUnitRequest,
  type UpdateBranchRequest,
  type UpdateDeviceRequest
} from '@supermarket/shared';
import {
  createExecutionContext,
  requirePrincipal,
  sendProblem,
  type ServerDependencies
} from '../app.ts';

const sendResult = (
  result: Awaited<ReturnType<ServerDependencies['config']['branches']['update']['execute']>>,
  request: Parameters<typeof sendProblem>[1],
  reply: Parameters<typeof sendProblem>[0],
  successStatus = 200
) => result.ok
  ? reply.code(successStatus).send(result.value)
  : sendProblem(reply, request, result.error.code, result.error.message);

export const registerConfigRoutes = (
  app: FastifyInstance,
  dependencies: ServerDependencies
): void => {
  app.get(listOperationalMasterDataContract.path, {
    schema: listOperationalMasterDataContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.config.operational.list.execute(
      createExecutionContext(request, principal, dependencies)
    );
    return result.ok ? reply.send(result.value) : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.put<{ Body: SaveCategoryRequest }>(saveCategoryContract.path, {
    schema: saveCategoryContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.config.operational.saveCategory.execute(
      request.body, createExecutionContext(request, principal, dependencies)
    );
    return result.ok ? reply.send(result.value) : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.put<{ Body: SaveUnitRequest }>(saveUnitContract.path, {
    schema: saveUnitContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.config.operational.saveUnit.execute(
      request.body, createExecutionContext(request, principal, dependencies)
    );
    return result.ok ? reply.send(result.value) : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.post<{ Body: CreateCashRegisterRequest }>(createCashRegisterContract.path, {
    schema: createCashRegisterContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.config.operational.createCashRegister.execute(
      request.body, createExecutionContext(request, principal, dependencies)
    );
    return result.ok
      ? reply.code(201).send(result.value)
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.put<{ Body: SavePaymentMethodRequest }>(savePaymentMethodContract.path, {
    schema: savePaymentMethodContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.config.operational.savePaymentMethod.execute(
      request.body, createExecutionContext(request, principal, dependencies)
    );
    return result.ok ? reply.send(result.value) : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.post<{ Body: ActivateDiscountPolicyRequest }>(activateDiscountPolicyContract.path, {
    schema: activateDiscountPolicyContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.config.operational.activateDiscountPolicy.execute(
      request.body, createExecutionContext(request, principal, dependencies)
    );
    return result.ok ? reply.send(result.value) : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.post<{ Body: ActivateTaxPolicyRequest }>(activateTaxPolicyContract.path, {
    schema: activateTaxPolicyContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.config.operational.activateTaxPolicy.execute(
      request.body, createExecutionContext(request, principal, dependencies)
    );
    return result.ok ? reply.send(result.value) : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.post<{ Body: CreateBranchRequest }>(createBranchContract.path, {
    schema: createBranchContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    return sendResult(await dependencies.config.branches.create.execute(
      request.body, createExecutionContext(request, principal, dependencies)
    ), request, reply, 201);
  });

  app.get<{ Querystring: { status?: BranchStatusResponse } }>(listBranchesContract.path, {
    schema: listBranchesContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.config.branches.list.execute(
      request.query.status, createExecutionContext(request, principal, dependencies)
    );
    return result.ok ? reply.send(result.value) : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.get<{ Params: { branchId: string } }>(getBranchContract.path, {
    schema: getBranchContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.config.branches.get.execute(
      request.params.branchId, createExecutionContext(request, principal, dependencies)
    );
    return result.ok ? reply.send(result.value) : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.patch<{ Params: { branchId: string }; Body: UpdateBranchRequest }>(
    updateBranchContract.path, { schema: updateBranchContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      return sendResult(await dependencies.config.branches.update.execute({
        branchId: request.params.branchId, ...request.body
      }, createExecutionContext(request, principal, dependencies)), request, reply);
    }
  );

  app.put<{ Params: { branchId: string }; Body: ChangeBranchStatusRequest }>(
    changeBranchStatusContract.path, { schema: changeBranchStatusContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      return sendResult(await dependencies.config.branches.changeStatus.execute({
        branchId: request.params.branchId, ...request.body
      }, createExecutionContext(request, principal, dependencies)), request, reply);
    }
  );

  app.post<{ Body: DeclareDeviceRequest }>(declareDeviceContract.path, {
    schema: declareDeviceContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.config.devices.declare.execute(
      request.body, createExecutionContext(request, principal, dependencies)
    );
    return result.ok
      ? reply.code(201).send(result.value)
      : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.get<{ Querystring: { terminalId?: string; status?: DeviceStatusResponse } }>(listDevicesContract.path, {
    schema: listDevicesContract.schema as FastifySchema
  }, async (request, reply) => {
    const principal = await requirePrincipal(request, reply, dependencies);
    if (!principal) return;
    const result = await dependencies.config.devices.list.execute({
      ...(request.query.terminalId ? { terminalId: request.query.terminalId } : {}),
      ...(request.query.status ? { status: request.query.status } : {})
    }, createExecutionContext(request, principal, dependencies));
    return result.ok ? reply.send(result.value) : sendProblem(reply, request, result.error.code, result.error.message);
  });

  app.patch<{ Params: { deviceId: string }; Body: UpdateDeviceRequest }>(
    updateDeviceContract.path, { schema: updateDeviceContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await dependencies.config.devices.update.execute({
        deviceId: request.params.deviceId, ...request.body
      }, createExecutionContext(request, principal, dependencies));
      return result.ok ? reply.send(result.value) : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );

  app.put<{ Params: { deviceId: string }; Body: ChangeDeviceStatusRequest }>(
    changeDeviceStatusContract.path, { schema: changeDeviceStatusContract.schema as FastifySchema },
    async (request, reply) => {
      const principal = await requirePrincipal(request, reply, dependencies);
      if (!principal) return;
      const result = await dependencies.config.devices.changeStatus.execute({
        deviceId: request.params.deviceId, ...request.body
      }, createExecutionContext(request, principal, dependencies));
      return result.ok ? reply.send(result.value) : sendProblem(reply, request, result.error.code, result.error.message);
    }
  );
};
