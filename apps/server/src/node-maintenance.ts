import {
  ApplyIdentityRetention,
  RecordProtectionUse,
  RotateProtectedMaterial,
  type RotateProtectedMaterialInput,
  type SecretVault
} from '@supermarket/core';
import {
  DrizzleAuditWriter,
  openDatabase,
  SqliteIdentityAdministrationStore,
  SqliteUnitOfWork
} from '@supermarket/driver-db';
import { SystemClock, UuidV7Generator, type NodeIdentity } from '@supermarket/driver-security';

const contextFor = (identity: NodeIdentity, correlationId: string) => ({
  actorId: identity.originNodeId,
  actorRoleCodes: [] as string[],
  terminalId: identity.terminalId,
  originNodeId: identity.originNodeId,
  correlationId
});

/** Retención y evidencia de custodia que se ejecutan una vez por arranque. */
export const runNodeStartupMaintenance = async (options: {
  readonly databasePath: string;
  readonly nodeIdentity: NodeIdentity;
  readonly protection: SecretVault['protection'];
}): Promise<void> => {
  const handle = openDatabase(options.databasePath);
  try {
    const clock = new SystemClock();
    const ids = new UuidV7Generator();
    const unitOfWork = new SqliteUnitOfWork(handle.sqlite);
    const audit = new DrizzleAuditWriter(handle);
    const context = contextFor(options.nodeIdentity, ids.generate());
    await new ApplyIdentityRetention(
      new SqliteIdentityAdministrationStore(handle), audit, unitOfWork, ids, clock
    ).execute(context);
    await new RecordProtectionUse(audit, unitOfWork, ids, clock)
      .execute(options.protection, context);
  } finally {
    handle.close();
  }
};

/** Rotación local del nodo; deliberadamente no forma parte del API HTTP. */
export const rotateNodeProtectedMaterial = async (options: {
  readonly databasePath: string;
  readonly nodeIdentity: NodeIdentity;
  readonly vault: SecretVault;
  readonly input: RotateProtectedMaterialInput;
}) => {
  const handle = openDatabase(options.databasePath);
  try {
    const clock = new SystemClock();
    const ids = new UuidV7Generator();
    const result = await new RotateProtectedMaterial(
      options.vault,
      new DrizzleAuditWriter(handle),
      new SqliteUnitOfWork(handle.sqlite),
      ids,
      clock
    ).execute(options.input, contextFor(options.nodeIdentity, ids.generate()));
    if (!result.ok) throw result.error;
    return result.value;
  } finally {
    handle.close();
  }
};
