import { ApplicationError, DomainError, err, ok, type AppError, type Result } from '@supermarket/shared';
import { Supplier, createTaxIdentity, type SupplierChanges, type SupplierStatus } from '../../domain/purchasing/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type { JsonValue } from '../events/index.js';
import { executeIdempotentCommand } from '../idempotency/index.js';
import type { AuditWriter, AuthorizationService, Clock, IdGenerator, IdempotencyStore, SupplierRepository, UnitOfWork } from '../ports/index.js';
import type {
  ChangeSupplierStatusInput,
  CorrectSupplierTaxIdentityInput,
  CreateSupplierInput,
  SupplierDto,
  UpdateSupplierInput
} from './dtos.js';
import { SUPPLIER_PERMISSIONS } from './permissions.js';

export const toSupplierDto = (supplier: Supplier): SupplierDto => ({
  id: supplier.id,
  code: supplier.code,
  legalName: supplier.legalName,
  tradeName: supplier.tradeName,
  fiscalAddress: supplier.fiscalAddress,
  taxIdentity: supplier.taxIdentity,
  status: supplier.status,
  createdAt: supplier.createdAt.toISOString(),
  updatedAt: supplier.updatedAt.toISOString(),
  version: supplier.version
});

const audit = async (
  writer: AuditWriter | undefined,
  ids: IdGenerator,
  context: ExecutionContext,
  action: string,
  supplierId: string,
  before: SupplierDto | null,
  after: SupplierDto,
  reason: string,
  occurredAt: Date
): Promise<void> => writer?.append([{
  auditId: ids.generate(), actorId: context.actorId,
  actorRoleCodes: context.actorRoleCodes ?? [], action,
  entityType: 'Supplier', entityId: supplierId,
  before: before as unknown as JsonValue, after: after as unknown as JsonValue,
  reason: reason.trim(), terminalId: context.terminalId,
  originNodeId: context.originNodeId, occurredAt,
  correlationId: context.correlationId
}]);

abstract class SupplierCommand {
  constructor(
    protected readonly repository: SupplierRepository,
    protected readonly authorization: AuthorizationService,
    protected readonly ids: IdGenerator,
    protected readonly clock: Clock,
    protected readonly unitOfWork?: UnitOfWork,
    protected readonly auditWriter?: AuditWriter,
    protected readonly idempotencyStore?: IdempotencyStore
  ) {}

  protected async run<TInput, TOutput>(
    operation: string,
    input: TInput,
    context: ExecutionContext,
    now: Date,
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

  protected async load(supplierId: string): Promise<Result<Supplier, AppError>> {
    const supplier = await this.repository.findById(supplierId);
    return supplier ? ok(supplier) : err(new ApplicationError('SUPPLIER_NOT_FOUND', 'Supplier was not found.'));
  }

  protected async authorize(context: ExecutionContext, permission: string): Promise<boolean> {
    return this.authorization.authorize(context, permission);
  }
}

export class CreateSupplier extends SupplierCommand {
  async execute(input: CreateSupplierInput, context: ExecutionContext): Promise<Result<SupplierDto, AppError>> {
    if (!await this.authorize(context, SUPPLIER_PERMISSIONS.CREATE)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to create suppliers.'));
    }
    const now = this.clock.now();
    return this.run('CreateSupplier', input, context, now, async () => {
      const identity = createTaxIdentity({
        country: input.taxIdentity.country ?? 'VE',
        type: input.taxIdentity.type,
        value: input.taxIdentity.value
      });
      if (await this.repository.findByTaxIdentity(identity.country, identity.type, identity.normalizedValue)) {
        return err(new ApplicationError('SUPPLIER_TAX_IDENTITY_CONFLICT', 'Tax identity is already assigned.'));
      }
      const supplier = Supplier.create({
        id: this.ids.generate(), code: await this.repository.nextCode(),
        legalName: input.legalName, taxIdentity: identity, createdAt: now,
        ...(input.tradeName !== undefined ? { tradeName: input.tradeName } : {}),
        ...(input.fiscalAddress !== undefined ? { fiscalAddress: input.fiscalAddress } : {})
      });
      await this.repository.save(supplier);
      const dto = toSupplierDto(supplier);
      await audit(this.auditWriter, this.ids, context, 'SUPPLIER_CREATED', supplier.id, null, dto, input.reason, now);
      return ok(dto);
    });
  }
}

export class UpdateSupplier extends SupplierCommand {
  async execute(input: UpdateSupplierInput, context: ExecutionContext): Promise<Result<SupplierDto, AppError>> {
    if (!await this.authorize(context, SUPPLIER_PERMISSIONS.UPDATE)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to update suppliers.'));
    }
    const now = this.clock.now();
    return this.run('UpdateSupplier', input, context, now, async () => {
      const loaded = await this.load(input.supplierId);
      if (!loaded.ok) return loaded;
      const before = toSupplierDto(loaded.value);
      const changes: SupplierChanges = {};
      if (input.legalName !== undefined) changes.legalName = input.legalName;
      if (input.tradeName !== undefined) changes.tradeName = input.tradeName;
      if (input.fiscalAddress !== undefined) changes.fiscalAddress = input.fiscalAddress;
      loaded.value.update(changes, now);
      await this.repository.save(loaded.value);
      const dto = toSupplierDto(loaded.value);
      await audit(this.auditWriter, this.ids, context, 'SUPPLIER_UPDATED', loaded.value.id, before, dto, input.reason, now);
      return ok(dto);
    });
  }
}

export class ChangeSupplierStatus extends SupplierCommand {
  async execute(input: ChangeSupplierStatusInput, context: ExecutionContext): Promise<Result<SupplierDto, AppError>> {
    if (!await this.authorize(context, SUPPLIER_PERMISSIONS.UPDATE)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to change supplier status.'));
    }
    const now = this.clock.now();
    return this.run('ChangeSupplierStatus', input, context, now, async () => {
      const loaded = await this.load(input.supplierId);
      if (!loaded.ok) return loaded;
      const before = toSupplierDto(loaded.value);
      loaded.value.changeStatus(input.status, now);
      await this.repository.save(loaded.value);
      const dto = toSupplierDto(loaded.value);
      await audit(this.auditWriter, this.ids, context, 'SUPPLIER_STATUS_CHANGED', loaded.value.id, before, dto, input.reason, now);
      return ok(dto);
    });
  }
}

export class CorrectSupplierTaxIdentity extends SupplierCommand {
  async execute(input: CorrectSupplierTaxIdentityInput, context: ExecutionContext): Promise<Result<SupplierDto, AppError>> {
    if (!await this.authorize(context, SUPPLIER_PERMISSIONS.CORRECT_TAX_IDENTITY)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to correct supplier tax identity.'));
    }
    if (input.reason.trim().length === 0) {
      return err(new ApplicationError('SUPPLIER_CORRECTION_REASON_REQUIRED', 'A correction reason is required.'));
    }
    const now = this.clock.now();
    return this.run('CorrectSupplierTaxIdentity', input, context, now, async () => {
      const loaded = await this.load(input.supplierId);
      if (!loaded.ok) return loaded;
      const identity = createTaxIdentity({
        country: input.taxIdentity.country ?? 'VE',
        type: input.taxIdentity.type,
        value: input.taxIdentity.value
      });
      const conflict = await this.repository.findByTaxIdentity(identity.country, identity.type, identity.normalizedValue);
      if (conflict && conflict.id !== loaded.value.id) {
        return err(new ApplicationError('SUPPLIER_TAX_IDENTITY_CONFLICT', 'Tax identity is already assigned.'));
      }
      const before = toSupplierDto(loaded.value);
      loaded.value.correctTaxIdentity(identity, now);
      await this.repository.save(loaded.value);
      const dto = toSupplierDto(loaded.value);
      await audit(this.auditWriter, this.ids, context, 'SUPPLIER_TAX_IDENTITY_CORRECTED', loaded.value.id, before, dto, input.reason, now);
      return ok(dto);
    });
  }
}

export class GetSupplier {
  constructor(
    private readonly repository: SupplierRepository,
    private readonly authorization: AuthorizationService
  ) {}
  async execute(supplierId: string, context: ExecutionContext): Promise<Result<SupplierDto, AppError>> {
    if (!await this.authorization.authorize(context, SUPPLIER_PERMISSIONS.READ)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to read suppliers.'));
    }
    const supplier = await this.repository.findById(supplierId);
    return supplier ? ok(toSupplierDto(supplier))
      : err(new ApplicationError('SUPPLIER_NOT_FOUND', 'Supplier was not found.'));
  }
}

export class ListSuppliers {
  constructor(
    private readonly repository: SupplierRepository,
    private readonly authorization: AuthorizationService
  ) {}
  async execute(status: SupplierStatus | undefined, context: ExecutionContext): Promise<Result<readonly SupplierDto[], AppError>> {
    if (!await this.authorization.authorize(context, SUPPLIER_PERMISSIONS.READ)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to list suppliers.'));
    }
    return ok((await this.repository.findAll(status)).map(toSupplierDto));
  }
}
