import { ApplicationError, err, ok, type AppError, type Result } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type { JsonValue } from '../events/index.js';
import type {
  AuditWriter,
  AuthorizationService,
  Clock,
  IdGenerator,
  RegisteredSyncNode,
  SyncNodeRegistry,
  UnitOfWork
} from '../ports/index.js';
import type { RegisterSyncNodeInput, RevokeSyncNodeInput, SyncNodeDto } from './dtos.js';
import { SYNC_PERMISSIONS } from './permissions.js';

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/;

export const toSyncNodeDto = (node: RegisteredSyncNode): SyncNodeDto => ({
  nodeId: node.nodeId,
  storeId: node.storeId,
  role: node.role,
  terminalId: node.terminalId,
  credentialFingerprint: node.credentialFingerprint,
  addressHost: node.addressHost,
  addressPort: node.addressPort,
  status: node.status,
  notAfter: node.notAfter.toISOString(),
  registeredAt: node.registeredAt.toISOString(),
  revokedAt: node.revokedAt === null ? null : node.revokedAt.toISOString()
});

const auditEntry = (
  ids: IdGenerator,
  context: ExecutionContext,
  action: string,
  node: SyncNodeDto,
  before: SyncNodeDto | null,
  reason: string,
  occurredAt: Date
): Parameters<AuditWriter['append']>[0][number] => ({
  auditId: ids.generate(),
  actorId: context.actorId,
  actorRoleCodes: context.actorRoleCodes ?? [],
  action,
  entityType: 'SyncNode',
  entityId: node.nodeId,
  before: before as unknown as JsonValue,
  after: node as unknown as JsonValue,
  reason: reason.trim(),
  terminalId: context.terminalId,
  originNodeId: context.originNodeId,
  occurredAt,
  correlationId: context.correlationId
});

/**
 * Alta manual y auditable de un nodo de la LAN. Registra actor, terminal, UTC y
 * motivo. La huella del certificado es el único material que se conserva; las
 * claves permanecen en el almacén local del nodo.
 */
export class RegisterSyncNode {
  constructor(
    private readonly registry: SyncNodeRegistry,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly auditWriter?: AuditWriter
  ) {}

  async execute(
    input: RegisterSyncNodeInput,
    context: ExecutionContext
  ): Promise<Result<SyncNodeDto, AppError>> {
    if (!await this.authorization.authorize(context, SYNC_PERMISSIONS.MANAGE_NODE)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to register nodes.'));
    }

    const invalid = validateRegistration(input);
    if (invalid) return err(invalid);

    const now = this.clock.now();
    const notAfter = new Date(input.notAfter);
    if (notAfter.getTime() <= now.getTime()) {
      return err(new ApplicationError(
        'SYNC_NODE_CREDENTIAL_EXPIRED',
        'The provisioned credential is already expired.'
      ));
    }

    if (await this.registry.findByNodeId(input.nodeId)) {
      return err(new ApplicationError(
        'SYNC_NODE_ALREADY_REGISTERED',
        'The node is already registered.'
      ));
    }
    if (await this.registry.findByCredentialFingerprint(input.credentialFingerprint)) {
      return err(new ApplicationError(
        'SYNC_NODE_CREDENTIAL_IN_USE',
        'The credential fingerprint is already registered for another node.'
      ));
    }

    const registration = {
      nodeId: input.nodeId,
      storeId: input.storeId,
      role: input.role,
      terminalId: input.role === 'TERMINAL' ? (input.terminalId as string) : null,
      credentialFingerprint: input.credentialFingerprint,
      addressHost: input.addressHost ?? null,
      addressPort: input.addressPort ?? null,
      notAfter,
      registeredAt: now,
      registeredBy: context.actorId,
      registrationReason: input.reason.trim()
    };

    try {
      await this.unitOfWork.execute(async () => {
        await this.registry.register(registration);
        await this.auditWriter?.append([auditEntry(
          this.ids,
          context,
          'SYNC_NODE_REGISTERED',
          toSyncNodeDto({ ...registration, status: 'ACTIVE', revokedAt: null }),
          null,
          input.reason,
          now
        )]);
      });
    } catch (error) {
      if (error instanceof ApplicationError) return err(error);
      return err(new ApplicationError(
        'SYNC_NODE_REGISTRATION_CONFLICT',
        'The node registration conflicts with the trusted registry.',
        { cause: error }
      ));
    }
    return ok(toSyncNodeDto({ ...registration, status: 'ACTIVE', revokedAt: null }));
  }
}

/**
 * Revocación auditable. Conserva la fila y su historia: revocar no borra los
 * hechos que el nodo ya entregó ni reabre entregas confirmadas.
 */
export class RevokeSyncNode {
  constructor(
    private readonly registry: SyncNodeRegistry,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly auditWriter?: AuditWriter
  ) {}

  async execute(
    input: RevokeSyncNodeInput,
    context: ExecutionContext
  ): Promise<Result<SyncNodeDto, AppError>> {
    if (!await this.authorization.authorize(context, SYNC_PERMISSIONS.MANAGE_NODE)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to revoke nodes.'));
    }
    if (input.reason.trim().length === 0) {
      return err(new ApplicationError('SYNC_NODE_REASON_REQUIRED', 'A revocation reason is required.'));
    }

    const node = await this.registry.findByNodeId(input.nodeId);
    if (!node) return err(new ApplicationError('SYNC_NODE_NOT_FOUND', 'The node is not registered.'));
    if (node.status === 'REVOKED') {
      return err(new ApplicationError('SYNC_NODE_ALREADY_REVOKED', 'The node is already revoked.'));
    }

    const now = this.clock.now();
    const revoked = toSyncNodeDto({ ...node, status: 'REVOKED', revokedAt: now });
    await this.unitOfWork.execute(async () => {
      await this.registry.revoke(input.nodeId, now, context.actorId, input.reason.trim());
      await this.auditWriter?.append([auditEntry(
        this.ids,
        context,
        'SYNC_NODE_REVOKED',
        revoked,
        toSyncNodeDto(node),
        input.reason,
        now
      )]);
    });
    return ok(revoked);
  }
}

export class ListSyncNodes {
  constructor(
    private readonly registry: SyncNodeRegistry,
    private readonly authorization: AuthorizationService
  ) {}

  async execute(context: ExecutionContext): Promise<Result<readonly SyncNodeDto[], AppError>> {
    if (!await this.authorization.authorize(context, SYNC_PERMISSIONS.MANAGE_NODE)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to inspect nodes.'));
    }
    return ok((await this.registry.list()).map(toSyncNodeDto));
  }
}

const validateRegistration = (input: RegisterSyncNodeInput): AppError | null => {
  if (!IDENTIFIER_PATTERN.test(input.nodeId) || !IDENTIFIER_PATTERN.test(input.storeId)) {
    return new ApplicationError('SYNC_NODE_IDENTIFIER_INVALID', 'Node and store identifiers are invalid.');
  }
  if (!FINGERPRINT_PATTERN.test(input.credentialFingerprint)) {
    return new ApplicationError(
      'SYNC_NODE_FINGERPRINT_INVALID',
      'The credential fingerprint must be a lowercase SHA-256 hex digest.'
    );
  }
  if (input.role === 'TERMINAL' &&
    (input.terminalId === undefined || !IDENTIFIER_PATTERN.test(input.terminalId))) {
    return new ApplicationError('SYNC_NODE_TERMINAL_REQUIRED', 'A terminal node requires a terminal identifier.');
  }
  if (input.role === 'COORDINATOR' && input.terminalId !== undefined) {
    return new ApplicationError('SYNC_NODE_TERMINAL_UNEXPECTED', 'A coordinator node does not declare a terminal.');
  }
  const declaredAddress = [input.addressHost, input.addressPort]
    .filter((value) => value !== undefined);
  if (declaredAddress.length === 1) {
    return new ApplicationError(
      'SYNC_NODE_ADDRESS_INCOMPLETE',
      'A delivery address requires host and port together.'
    );
  }
  if (input.addressPort !== undefined &&
    (!Number.isInteger(input.addressPort) || input.addressPort < 1 || input.addressPort > 65535)) {
    return new ApplicationError('SYNC_NODE_ADDRESS_INVALID', 'The delivery port is invalid.');
  }
  if (Number.isNaN(new Date(input.notAfter).getTime())) {
    return new ApplicationError('SYNC_NODE_VALIDITY_INVALID', 'The credential validity is invalid.');
  }
  if (input.reason.trim().length === 0) {
    return new ApplicationError('SYNC_NODE_REASON_REQUIRED', 'A registration reason is required.');
  }
  return null;
};
