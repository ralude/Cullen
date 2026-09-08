import type { BranchStatus, DeviceStatus, DeviceType } from '../../domain/config/index.js';
import type { PaymentMethodKind } from '../../domain/currency/index.js';

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

export type CategoryConfigDto = { id: string; name: string; isActive: boolean };
export type UnitConfigDto = {
  id: string; code: string; name: string; quantityScale: number; isActive: boolean;
};
export type PaymentMethodConfigDto = {
  code: string; name: string; kind: PaymentMethodKind; currencyCode: string; isActive: boolean;
};
export type OperationalMasterDataDto = {
  categories: readonly CategoryConfigDto[];
  units: readonly UnitConfigDto[];
  paymentMethods: readonly PaymentMethodConfigDto[];
};
export type SaveCategoryInput = {
  id?: string; name: string; isActive: boolean; reason: string;
};
export type SaveUnitInput = {
  code: string; name: string; quantityScale: number; isActive: boolean; reason: string;
};
export type SavePaymentMethodInput = {
  code: string; name: string; kind: PaymentMethodKind; currencyCode: string;
  isActive: boolean; reason: string;
};
export type ActivateDiscountPolicyInput = { maximumBasisPoints: number; reason: string };
export type ActivateTaxPolicyInput = {
  rateBasisPoints: number; eligiblePaymentMethodCodes: readonly string[];
  eligibleCurrencies: readonly string[]; reason: string;
};
export type PolicyActivationDto = { created: boolean; policyId: string; version: number };

/**
 * Alta de la caja de esta terminal. El identificador, el terminal y el nodo no
 * viajan en la entrada: los fija la identidad del proceso que atiende.
 */
export type CreateCashRegisterInput = {
  name: string;
  reason: string;
};

export type CashRegisterConfigDto = {
  id: string;
  name: string;
  terminalId: string;
  originNodeId: string;
  isActive: boolean;
};
