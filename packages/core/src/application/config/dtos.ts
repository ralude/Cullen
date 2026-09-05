import type { BranchStatus, DeviceStatus, DeviceType } from '../../domain/config/index.js';

export type BranchDto = {
  id: string;
  code: string;
  originNodeId: string;
  name: string;
  status: BranchStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CreateBranchInput = { code: string; name: string; reason: string };
export type UpdateBranchInput = { branchId: string; name?: string; reason: string };
export type ChangeBranchStatusInput = { branchId: string; status: BranchStatus; reason: string };

export type DeviceDto = {
  id: string;
  type: DeviceType;
  originNodeId: string;
  identifier: string;
  terminalId: string;
  branchId: string | null;
  status: DeviceStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type DeclareDeviceInput = {
  type: DeviceType;
  identifier: string;
  terminalId: string;
  branchId?: string;
  reason: string;
};
export type UpdateDeviceInput = {
  deviceId: string;
  identifier?: string;
  branchId?: string | null;
  reason: string;
};
export type ChangeDeviceStatusInput = { deviceId: string; status: DeviceStatus; reason: string };
