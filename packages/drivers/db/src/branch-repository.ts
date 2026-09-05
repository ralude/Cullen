import { Branch, type BranchRepository, type BranchStatus } from '@supermarket/core';
import { and, eq } from 'drizzle-orm';
import type { DatabaseHandle } from './connection.js';
import { branches } from './schema.js';
import { mapDatabaseError, requireTransaction } from './unit-of-work.js';
import { InfrastructureError } from '@supermarket/shared';

export class DrizzleBranchRepository implements BranchRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async save(branch: Branch): Promise<void> {
    requireTransaction(this.handle.sqlite);
    try {
      const existing = this.handle.db.select({ version: branches.version, originNodeId: branches.originNodeId })
        .from(branches).where(eq(branches.id, branch.id)).get();
      const values = {
        name: branch.name, status: branch.status, updatedAt: branch.updatedAt, version: branch.version
      };
      if (!existing) {
        this.handle.db.insert(branches).values({
          id: branch.id, code: branch.code, originNodeId: branch.originNodeId,
          createdAt: branch.createdAt, ...values
        }).run();
        return;
      }
      if (existing.version !== branch.version - 1) {
        throw new InfrastructureError('DATABASE_CONCURRENCY_CONFLICT', 'Branch version is stale.');
      }
      if (existing.originNodeId !== branch.originNodeId) {
        throw new InfrastructureError('AGGREGATE_OWNER_MISMATCH', 'Branch owner cannot change.');
      }
      const changed = this.handle.db.update(branches).set(values).where(and(
        eq(branches.id, branch.id), eq(branches.version, existing.version)
      )).run();
      if (changed.changes !== 1) {
        throw new InfrastructureError('DATABASE_CONCURRENCY_CONFLICT', 'Branch version is stale.');
      }
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findById(branchId: string): Promise<Branch | null> {
    try {
      return this.restore(this.handle.db.select().from(branches).where(eq(branches.id, branchId)).get());
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findByCode(code: string): Promise<Branch | null> {
    try {
      return this.restore(this.handle.db.select().from(branches).where(eq(branches.code, code)).get());
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findAll(status?: BranchStatus): Promise<readonly Branch[]> {
    try {
      const rows = status === undefined
        ? this.handle.db.select().from(branches).all()
        : this.handle.db.select().from(branches).where(eq(branches.status, status)).all();
      return rows.map((row) => this.restore(row)).filter((branch): branch is Branch => branch !== null);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  private restore(row: typeof branches.$inferSelect | undefined): Branch | null {
    if (row && row.originNodeId === null) {
      throw new InfrastructureError('AGGREGATE_OWNER_UNRESOLVED', 'Branch owner is unresolved.');
    }
    return row ? Branch.restore({
      id: row.id, code: row.code, name: row.name, status: row.status as BranchStatus,
      originNodeId: row.originNodeId!,
      createdAt: row.createdAt, updatedAt: row.updatedAt, version: row.version
    }) : null;
  }
}
