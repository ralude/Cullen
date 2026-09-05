import { DomainError } from '@supermarket/shared';

/**
 * La sucursal (9B.11) es dato maestro y etiqueta de pertenencia. No gobierna
 * autoridad de escritura ni participa en sincronización: eso pertenece a
 * Fase 10 y a `docs/architecture/12-sincronizacion-y-ownership.md`.
 */
export type BranchStatus = 'ACTIVE' | 'INACTIVE';

const BRANCH_CODE_PATTERN = /^[A-Z0-9_-]{1,32}$/;
const branchStatuses = new Set<BranchStatus>(['ACTIVE', 'INACTIVE']);

export type BranchProps = {
  id: string;
  code: string;
  name: string;
  originNodeId: string;
  status?: BranchStatus;
  createdAt: Date;
};

export type RestoredBranchProps = Omit<BranchProps, 'status' | 'createdAt'> & {
  status: BranchStatus;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

export type BranchChanges = { name?: string };

const requireText = (value: string, code: string, message: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) throw new DomainError(code, message);
  return normalized;
};

const validStatus = (status: BranchStatus): BranchStatus => {
  if (!branchStatuses.has(status)) {
    throw new DomainError('BRANCH_STATUS_INVALID', 'Branch status is invalid.');
  }
  return status;
};

export class Branch {
  private currentName: string;
  private currentStatus: BranchStatus;
  private currentUpdatedAt: Date;
  private currentVersion: number;

  private constructor(
    readonly id: string,
    readonly code: string,
    readonly originNodeId: string,
    readonly createdAt: Date,
    name: string,
    status: BranchStatus,
    updatedAt: Date,
    version: number
  ) {
    this.currentName = name;
    this.currentStatus = status;
    this.currentUpdatedAt = updatedAt;
    this.currentVersion = version;
  }

  static create(props: BranchProps): Branch {
    const id = requireText(props.id, 'BRANCH_ID_REQUIRED', 'Branch ID is required.');
    const code = props.code.trim().toUpperCase();
    if (!BRANCH_CODE_PATTERN.test(code)) {
      throw new DomainError('BRANCH_CODE_INVALID', 'Branch code is invalid.');
    }
    const name = requireText(props.name, 'BRANCH_NAME_REQUIRED', 'Branch name is required.');
    const originNodeId = requireText(props.originNodeId, 'BRANCH_ORIGIN_NODE_REQUIRED', 'Branch origin node is required.');
    return new Branch(
      id, code, originNodeId, new Date(props.createdAt), name, validStatus(props.status ?? 'ACTIVE'),
      new Date(props.createdAt), 1
    );
  }

  static restore(props: RestoredBranchProps): Branch {
    const branch = Branch.create(props);
    branch.currentStatus = validStatus(props.status);
    branch.currentUpdatedAt = new Date(props.updatedAt);
    branch.currentVersion = props.version;
    return branch;
  }

  get name(): string { return this.currentName; }
  get status(): BranchStatus { return this.currentStatus; }
  get updatedAt(): Date { return new Date(this.currentUpdatedAt); }
  get version(): number { return this.currentVersion; }

  update(changes: BranchChanges, occurredAt: Date): void {
    if (Object.keys(changes).length === 0) {
      throw new DomainError('BRANCH_UPDATE_REQUIRED', 'At least one branch field must change.');
    }
    if (changes.name !== undefined) {
      this.currentName = requireText(changes.name, 'BRANCH_NAME_REQUIRED', 'Branch name is required.');
    }
    this.touch(occurredAt);
  }

  changeStatus(status: BranchStatus, occurredAt: Date): void {
    this.currentStatus = validStatus(status);
    this.touch(occurredAt);
  }

  private touch(occurredAt: Date): void {
    this.currentUpdatedAt = new Date(occurredAt);
    this.currentVersion += 1;
  }
}
