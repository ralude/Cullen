import { Device, type DeviceRepository, type DeviceStatus, type DeviceType } from '@supermarket/core';
import { InfrastructureError } from '@supermarket/shared';
import { and, eq } from 'drizzle-orm';
import type { DatabaseHandle } from './connection.js';
import { devices } from './schema.js';
import { mapDatabaseError, requireTransaction } from './unit-of-work.js';

export class DrizzleDeviceRepository implements DeviceRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(device: Device): Promise<void> {
    requireTransaction(this.handle.sqlite);
    try {
      const existing = this.handle.db.select({ version: devices.version, originNodeId: devices.originNodeId })
        .from(devices).where(eq(devices.id, device.id)).get();
      const values = {
        identifier: device.identifier, branchId: device.branchId, status: device.status,
        updatedAt: device.updatedAt, version: device.version
      };
      if (!existing) {
        this.handle.db.insert(devices).values({
          id: device.id, type: device.type, terminalId: device.terminalId,
          originNodeId: device.originNodeId,
          createdAt: device.createdAt, ...values
        }).run();
        return;
      }
      if (existing.version !== device.version - 1) {
        throw new InfrastructureError('DATABASE_CONCURRENCY_CONFLICT', 'Device version is stale.');
      }
      if (existing.originNodeId !== device.originNodeId) {
        throw new InfrastructureError('AGGREGATE_OWNER_MISMATCH', 'Device owner cannot change.');
      }
      const changed = this.handle.db.update(devices).set(values).where(and(
        eq(devices.id, device.id), eq(devices.version, existing.version)
      )).run();
      if (changed.changes !== 1) {
        throw new InfrastructureError('DATABASE_CONCURRENCY_CONFLICT', 'Device version is stale.');
      }
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findById(deviceId: string): Promise<Device | null> {
    try {
      return this.restore(this.handle.db.select().from(devices).where(eq(devices.id, deviceId)).get());
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findByIdentifier(identifier: string): Promise<Device | null> {
    try {
      const normalized = identifier.trim().toUpperCase();
      const row = this.handle.db.select().from(devices).all()
        .find((candidate) => candidate.identifier.toUpperCase() === normalized);
      return this.restore(row);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findAll(
    filter: { readonly terminalId?: string; readonly status?: DeviceStatus } = {}
  ): Promise<readonly Device[]> {
    try {
      const conditions = [
        ...(filter.terminalId !== undefined ? [eq(devices.terminalId, filter.terminalId)] : []),
        ...(filter.status !== undefined ? [eq(devices.status, filter.status)] : [])
      ];
      const rows = conditions.length === 0
        ? this.handle.db.select().from(devices).all()
        : this.handle.db.select().from(devices).where(and(...conditions)).all();
      return rows.map((row) => this.restore(row)).filter((device): device is Device => device !== null);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  private restore(row: typeof devices.$inferSelect | undefined): Device | null {
    if (row && row.originNodeId === null) {
      throw new InfrastructureError('AGGREGATE_OWNER_UNRESOLVED', 'Device owner is unresolved.');
    }
    return row ? Device.restore({
      id: row.id, type: row.type as DeviceType, identifier: row.identifier, terminalId: row.terminalId,
      originNodeId: row.originNodeId!,
      branchId: row.branchId, status: row.status as DeviceStatus,
      createdAt: row.createdAt, updatedAt: row.updatedAt, version: row.version
    }) : null;
  }
}
