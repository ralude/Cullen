import type { Device, DeviceStatus } from '../../domain/config/index.js';

export interface DeviceRepository {
  save(device: Device): Promise<void>;
  findById(deviceId: string): Promise<Device | null>;
  findByIdentifier(identifier: string): Promise<Device | null>;
  findAll(filter?: { readonly terminalId?: string; readonly status?: DeviceStatus }): Promise<readonly Device[]>;
}
