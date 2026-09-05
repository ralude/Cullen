import { DomainError } from '@supermarket/shared';

/**
 * Inventario administrativo de dispositivos declarados por una estación
 * (9B.11). Declarar un dispositivo, incluida una impresora fiscal, no
 * habilita ninguna capacidad real: la aplicación sigue exponiendo el modo
 * fiscal vigente por separado, y mientras la Fase 8 esté suspendida ese modo
 * es siempre `SIMULATION` sobre `FiscalPrinterFake`.
 */
export const DEVICE_TYPES = ['FISCAL_PRINTER', 'BARCODE_SCANNER', 'SCALE', 'CASH_DRAWER'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];
export type DeviceStatus = 'ACTIVE' | 'INACTIVE';

const deviceStatuses = new Set<DeviceStatus>(['ACTIVE', 'INACTIVE']);

export type DeviceProps = {
  id: string;
  type: DeviceType;
  identifier: string;
  terminalId: string;
  originNodeId: string;
  branchId?: string;
  status?: DeviceStatus;
  createdAt: Date;
};

export type RestoredDeviceProps = Omit<DeviceProps, 'branchId' | 'status' | 'createdAt'> & {
  branchId: string | null;
  status: DeviceStatus;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

export type DeviceChanges = { identifier?: string; branchId?: string | null };

const requireText = (value: string, code: string, message: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) throw new DomainError(code, message);
  return normalized;
};

const optionalText = (value: string | null | undefined): string | null => {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
};

const validStatus = (status: DeviceStatus): DeviceStatus => {
  if (!deviceStatuses.has(status)) {
    throw new DomainError('DEVICE_STATUS_INVALID', 'Device status is invalid.');
  }
  return status;
};

export class Device {
  private currentIdentifier: string;
  private currentBranchId: string | null;
  private currentStatus: DeviceStatus;
  private currentUpdatedAt: Date;
  private currentVersion: number;

  private constructor(
    readonly id: string,
    readonly type: DeviceType,
    readonly terminalId: string,
    readonly originNodeId: string,
    readonly createdAt: Date,
    identifier: string,
    branchId: string | null,
    status: DeviceStatus,
    updatedAt: Date,
    version: number
  ) {
    this.currentIdentifier = identifier;
    this.currentBranchId = branchId;
    this.currentStatus = status;
    this.currentUpdatedAt = updatedAt;
    this.currentVersion = version;
  }

  static create(props: DeviceProps): Device {
    const id = requireText(props.id, 'DEVICE_ID_REQUIRED', 'Device ID is required.');
    if (!DEVICE_TYPES.includes(props.type)) {
      throw new DomainError('DEVICE_TYPE_INVALID', 'Device type is invalid.');
    }
    const identifier = requireText(
      props.identifier, 'DEVICE_IDENTIFIER_REQUIRED', 'Device identifier is required.'
    );
    const terminalId = requireText(
      props.terminalId, 'DEVICE_TERMINAL_REQUIRED', 'Device terminal is required.'
    );
    const originNodeId = requireText(
      props.originNodeId, 'DEVICE_ORIGIN_NODE_REQUIRED', 'Device origin node is required.'
    );
    const branchId = props.branchId === undefined
      ? null
      : requireText(props.branchId, 'DEVICE_BRANCH_REQUIRED', 'Device branch is required.');
    return new Device(
      id, props.type, terminalId, originNodeId, new Date(props.createdAt), identifier, branchId,
      validStatus(props.status ?? 'ACTIVE'), new Date(props.createdAt), 1
    );
  }

  static restore(props: RestoredDeviceProps): Device {
    const { branchId, status, updatedAt, version, ...rest } = props;
    const device = Device.create({
      ...rest,
      ...(branchId === null ? {} : { branchId })
    });
    device.currentStatus = validStatus(status);
    device.currentUpdatedAt = new Date(updatedAt);
    device.currentVersion = version;
    return device;
  }

  get identifier(): string { return this.currentIdentifier; }
  get branchId(): string | null { return this.currentBranchId; }
  get status(): DeviceStatus { return this.currentStatus; }
  get updatedAt(): Date { return new Date(this.currentUpdatedAt); }
  get version(): number { return this.currentVersion; }

  update(changes: DeviceChanges, occurredAt: Date): void {
    if (Object.keys(changes).length === 0) {
      throw new DomainError('DEVICE_UPDATE_REQUIRED', 'At least one device field must change.');
    }
    if (changes.identifier !== undefined) {
      this.currentIdentifier = requireText(
        changes.identifier, 'DEVICE_IDENTIFIER_REQUIRED', 'Device identifier is required.'
      );
    }
    if (changes.branchId !== undefined) this.currentBranchId = optionalText(changes.branchId);
    this.touch(occurredAt);
  }

  changeStatus(status: DeviceStatus, occurredAt: Date): void {
    this.currentStatus = validStatus(status);
    this.touch(occurredAt);
  }

  private touch(occurredAt: Date): void {
    this.currentUpdatedAt = new Date(occurredAt);
    this.currentVersion += 1;
  }
}
