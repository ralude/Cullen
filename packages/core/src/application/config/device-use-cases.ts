import { ApplicationError, DomainError, err, ok, type AppError, type Result } from '@supermarket/shared';
import { Device, type DeviceChanges, type DeviceStatus } from '../../domain/config/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type { JsonValue } from '../events/index.js';
import { executeIdempotentCommand } from '../idempotency/index.js';
import type {
  AuditWriter, AuthorizationService, Clock, DeviceRepository, IdGenerator, IdempotencyStore, UnitOfWork
} from '../ports/index.js';
import type {
  ChangeDeviceStatusInput, DeclareDeviceInput, DeviceDto, UpdateDeviceInput
} from './dtos.js';
import { CONFIG_PERMISSIONS } from './permissions.js';

export const toDeviceDto = (device: Device): DeviceDto => ({
  id: device.id,
  type: device.type,
  originNodeId: device.originNodeId,
  identifier: device.identifier,
  terminalId: device.terminalId,
  branchId: device.branchId,
  status: device.status,
  createdAt: device.createdAt.toISOString(),
  updatedAt: device.updatedAt.toISOString(),
  version: device.version
});

const audit = async (
  writer: AuditWriter | undefined,
  ids: IdGenerator,
  context: ExecutionContext,
  action: string,
  deviceId: string,
  before: DeviceDto | null,
  after: DeviceDto,
  reason: string,
  occurredAt: Date
): Promise<void> => writer?.append([{
  auditId: ids.generate(), actorId: context.actorId,
  actorRoleCodes: context.actorRoleCodes ?? [], action,
  entityType: 'Device', entityId: deviceId,
  before: before as unknown as JsonValue, after: after as unknown as JsonValue,
  reason: reason.trim(), terminalId: context.terminalId,
  originNodeId: context.originNodeId, occurredAt,
  correlationId: context.correlationId
}]);

abstract class DeviceCommand {
  constructor(
    protected readonly repository: DeviceRepository,
    protected readonly authorization: AuthorizationService,
    protected readonly ids: IdGenerator,
    protected readonly clock: Clock,
    protected readonly unitOfWork?: UnitOfWork,
    protected readonly auditWriter?: AuditWriter,
    protected readonly idempotencyStore?: IdempotencyStore
  ) {}

  protected async run<TInput, TOutput>(
    operation: string, input: TInput, context: ExecutionContext, now: Date,
    execute: () => Promise<Result<TOutput, AppError>>
  ): Promise<Result<TOutput, AppError>> {
    try {
      return await executeIdempotentCommand({
        operation, input, context, now, execute,
        ...(this.unitOfWork ? { unitOfWork: this.unitOfWork } : {}),
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        serialize: (output) => JSON.parse(JSON.stringify(output)) as JsonValue,
        restore: (output) => output as unknown as TOutput
      });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }

  protected async load(deviceId: string): Promise<Result<Device, AppError>> {
    const device = await this.repository.findById(deviceId);
    return device ? ok(device) : err(new ApplicationError('DEVICE_NOT_FOUND', 'Device was not found.'));
  }

  protected async authorize(context: ExecutionContext): Promise<boolean> {
    return this.authorization.authorize(context, CONFIG_PERMISSIONS.MANAGE_DEVICE);
  }
}

/**
 * Declarar un dispositivo, incluida una impresora fiscal, es inventario
 * administrativo: no habilita ninguna capacidad real. El modo fiscal vigente
 * lo sigue exponiendo `capabilities`, ajeno a esta declaración.
 */
export class DeclareDevice extends DeviceCommand {
  async execute(input: DeclareDeviceInput, context: ExecutionContext): Promise<Result<DeviceDto, AppError>> {
    if (!await this.authorize(context)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to declare devices.'));
    }
    const now = this.clock.now();
    return this.run('DeclareDevice', input, context, now, async () => {
      const device = Device.create({
        id: this.ids.generate(), type: input.type, identifier: input.identifier,
        terminalId: input.terminalId, originNodeId: context.originNodeId, createdAt: now,
        ...(input.branchId ? { branchId: input.branchId } : {})
      });
      if (await this.repository.findByIdentifier(device.identifier)) {
        return err(new ApplicationError('DEVICE_IDENTIFIER_CONFLICT', 'Device identifier is already assigned.'));
      }
      await this.repository.save(device);
      const dto = toDeviceDto(device);
      await audit(this.auditWriter, this.ids, context, 'DEVICE_DECLARED', device.id, null, dto, input.reason, now);
      return ok(dto);
    });
  }
}

export class UpdateDevice extends DeviceCommand {
  async execute(input: UpdateDeviceInput, context: ExecutionContext): Promise<Result<DeviceDto, AppError>> {
    if (!await this.authorize(context)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to update devices.'));
    }
    const now = this.clock.now();
    return this.run('UpdateDevice', input, context, now, async () => {
      const loaded = await this.load(input.deviceId);
      if (!loaded.ok) return loaded;
      if (loaded.value.originNodeId !== context.originNodeId) {
        return err(new ApplicationError('AGGREGATE_OWNER_MISMATCH', 'Device belongs to another node.'));
      }
      const before = toDeviceDto(loaded.value);
      const changes: DeviceChanges = {};
      if (input.identifier !== undefined) changes.identifier = input.identifier;
      if (input.branchId !== undefined) changes.branchId = input.branchId;
      loaded.value.update(changes, now);
      const duplicate = await this.repository.findByIdentifier(loaded.value.identifier);
      if (duplicate && duplicate.id !== loaded.value.id) {
        return err(new ApplicationError('DEVICE_IDENTIFIER_CONFLICT', 'Device identifier is already assigned.'));
      }
      await this.repository.save(loaded.value);
      const dto = toDeviceDto(loaded.value);
      await audit(this.auditWriter, this.ids, context, 'DEVICE_UPDATED', loaded.value.id, before, dto, input.reason, now);
      return ok(dto);
    });
  }
}

export class ChangeDeviceStatus extends DeviceCommand {
  async execute(input: ChangeDeviceStatusInput, context: ExecutionContext): Promise<Result<DeviceDto, AppError>> {
    if (!await this.authorize(context)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to change device status.'));
    }
    const now = this.clock.now();
    return this.run('ChangeDeviceStatus', input, context, now, async () => {
      const loaded = await this.load(input.deviceId);
      if (!loaded.ok) return loaded;
      if (loaded.value.originNodeId !== context.originNodeId) {
        return err(new ApplicationError('AGGREGATE_OWNER_MISMATCH', 'Device belongs to another node.'));
      }
      const before = toDeviceDto(loaded.value);
      loaded.value.changeStatus(input.status, now);
      await this.repository.save(loaded.value);
      const dto = toDeviceDto(loaded.value);
      await audit(this.auditWriter, this.ids, context, 'DEVICE_STATUS_CHANGED', loaded.value.id, before, dto, input.reason, now);
      return ok(dto);
    });
  }
}

export class ListDevices {
  constructor(
    private readonly repository: DeviceRepository,
    private readonly authorization: AuthorizationService
  ) {}
  async execute(
    filter: { readonly terminalId?: string; readonly status?: DeviceStatus },
    context: ExecutionContext
  ): Promise<Result<readonly DeviceDto[], AppError>> {
    if (!await this.authorization.authorize(context, CONFIG_PERMISSIONS.MANAGE_DEVICE)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to list devices.'));
    }
    return ok((await this.repository.findAll(filter)).map(toDeviceDto));
  }
}
