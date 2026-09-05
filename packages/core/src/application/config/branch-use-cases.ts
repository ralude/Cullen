import { ApplicationError, DomainError, err, ok, type AppError, type Result } from '@supermarket/shared';
import { Branch, type BranchChanges, type BranchStatus } from '../../domain/config/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type { JsonValue } from '../events/index.js';
import { executeIdempotentCommand } from '../idempotency/index.js';
import type {
  AuditWriter, AuthorizationService, BranchRepository, Clock, IdGenerator, IdempotencyStore, UnitOfWork
} from '../ports/index.js';
import type {
  BranchDto, ChangeBranchStatusInput, CreateBranchInput, UpdateBranchInput
} from './dtos.js';
import { CONFIG_PERMISSIONS } from './permissions.js';

export const toBranchDto = (branch: Branch): BranchDto => ({
  id: branch.id,
  code: branch.code,
  originNodeId: branch.originNodeId,
  name: branch.name,
  status: branch.status,
  createdAt: branch.createdAt.toISOString(),
  updatedAt: branch.updatedAt.toISOString(),
  version: branch.version
});

const audit = async (
  writer: AuditWriter | undefined,
  ids: IdGenerator,
  context: ExecutionContext,
  action: string,
  branchId: string,
  before: BranchDto | null,
  after: BranchDto,
  reason: string,
  occurredAt: Date
): Promise<void> => writer?.append([{
  auditId: ids.generate(), actorId: context.actorId,
  actorRoleCodes: context.actorRoleCodes ?? [], action,
  entityType: 'Branch', entityId: branchId,
  before: before as unknown as JsonValue, after: after as unknown as JsonValue,
  reason: reason.trim(), terminalId: context.terminalId,
  originNodeId: context.originNodeId, occurredAt,
  correlationId: context.correlationId
}]);

abstract class BranchCommand {
  constructor(
    protected readonly repository: BranchRepository,
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

  protected async load(branchId: string): Promise<Result<Branch, AppError>> {
    const branch = await this.repository.findById(branchId);
    return branch ? ok(branch) : err(new ApplicationError('BRANCH_NOT_FOUND', 'Branch was not found.'));
  }

  protected async authorize(context: ExecutionContext): Promise<boolean> {
    return this.authorization.authorize(context, CONFIG_PERMISSIONS.MANAGE_BRANCH);
  }
}

export class CreateBranch extends BranchCommand {
  async execute(input: CreateBranchInput, context: ExecutionContext): Promise<Result<BranchDto, AppError>> {
    if (!await this.authorize(context)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to create branches.'));
    }
    const now = this.clock.now();
    return this.run('CreateBranch', input, context, now, async () => {
      const branch = Branch.create({
        id: this.ids.generate(), code: input.code, name: input.name,
        originNodeId: context.originNodeId, createdAt: now
      });
      if (await this.repository.findByCode(branch.code)) {
        return err(new ApplicationError('BRANCH_CODE_CONFLICT', 'Branch code is already assigned.'));
      }
      await this.repository.save(branch);
      const dto = toBranchDto(branch);
      await audit(this.auditWriter, this.ids, context, 'BRANCH_CREATED', branch.id, null, dto, input.reason, now);
      return ok(dto);
    });
  }
}

export class UpdateBranch extends BranchCommand {
  async execute(input: UpdateBranchInput, context: ExecutionContext): Promise<Result<BranchDto, AppError>> {
    if (!await this.authorize(context)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to update branches.'));
    }
    const now = this.clock.now();
    return this.run('UpdateBranch', input, context, now, async () => {
      const loaded = await this.load(input.branchId);
      if (!loaded.ok) return loaded;
      if (loaded.value.originNodeId !== context.originNodeId) {
        return err(new ApplicationError('AGGREGATE_OWNER_MISMATCH', 'Branch belongs to another node.'));
      }
      const before = toBranchDto(loaded.value);
      const changes: BranchChanges = {};
      if (input.name !== undefined) changes.name = input.name;
      loaded.value.update(changes, now);
      await this.repository.save(loaded.value);
      const dto = toBranchDto(loaded.value);
      await audit(this.auditWriter, this.ids, context, 'BRANCH_UPDATED', loaded.value.id, before, dto, input.reason, now);
      return ok(dto);
    });
  }
}

export class ChangeBranchStatus extends BranchCommand {
  async execute(input: ChangeBranchStatusInput, context: ExecutionContext): Promise<Result<BranchDto, AppError>> {
    if (!await this.authorize(context)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to change branch status.'));
    }
    const now = this.clock.now();
    return this.run('ChangeBranchStatus', input, context, now, async () => {
      const loaded = await this.load(input.branchId);
      if (!loaded.ok) return loaded;
      if (loaded.value.originNodeId !== context.originNodeId) {
        return err(new ApplicationError('AGGREGATE_OWNER_MISMATCH', 'Branch belongs to another node.'));
      }
      const before = toBranchDto(loaded.value);
      loaded.value.changeStatus(input.status, now);
      await this.repository.save(loaded.value);
      const dto = toBranchDto(loaded.value);
      await audit(this.auditWriter, this.ids, context, 'BRANCH_STATUS_CHANGED', loaded.value.id, before, dto, input.reason, now);
      return ok(dto);
    });
  }
}

export class GetBranch {
  constructor(
    private readonly repository: BranchRepository,
    private readonly authorization: AuthorizationService
  ) {}
  async execute(branchId: string, context: ExecutionContext): Promise<Result<BranchDto, AppError>> {
    if (!await this.authorization.authorize(context, CONFIG_PERMISSIONS.MANAGE_BRANCH)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to read branches.'));
    }
    const branch = await this.repository.findById(branchId);
    return branch ? ok(toBranchDto(branch)) : err(new ApplicationError('BRANCH_NOT_FOUND', 'Branch was not found.'));
  }
}

export class ListBranches {
  constructor(
    private readonly repository: BranchRepository,
    private readonly authorization: AuthorizationService
  ) {}
  async execute(status: BranchStatus | undefined, context: ExecutionContext): Promise<Result<readonly BranchDto[], AppError>> {
    if (!await this.authorization.authorize(context, CONFIG_PERMISSIONS.MANAGE_BRANCH)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to list branches.'));
    }
    return ok((await this.repository.findAll(status)).map(toBranchDto));
  }
}
