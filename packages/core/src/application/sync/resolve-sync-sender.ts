import { ApplicationError, err, ok, type AppError, type Result } from '@supermarket/shared';
import type { Clock, SyncNodeRegistry, SyncSenderContext } from '../ports/index.js';
import type { SyncTransportCredential } from './dtos.js';

/**
 * Traduce la credencial verificada por el transporte a la identidad de emisor
 * que usa el receptor. Falla cerrado: sin registro confiable, con credencial
 * vencida o revocada, con identidad presentada que no coincide con la huella, o
 * fuera de la cohorte del coordinador, no hay contexto de emisor.
 *
 * Conocer un `eventId` no sustituye esta comprobación: se aplica también a
 * reentregas y duplicados.
 */
export class ResolveSyncSender {
  constructor(
    private readonly receiverNodeId: string,
    private readonly registry: SyncNodeRegistry,
    private readonly clock: Clock
  ) {}

  async execute(
    credential: SyncTransportCredential
  ): Promise<Result<SyncSenderContext, AppError>> {
    try {
      return await this.resolve(credential);
    } catch {
      return err(new ApplicationError(
        'SYNC_RECEIVER_UNAVAILABLE', 'The trusted registry is temporarily unavailable.'
      ));
    }
  }

  private async resolve(
    credential: SyncTransportCredential
  ): Promise<Result<SyncSenderContext, AppError>> {
    const node = await this.registry.findByCredentialFingerprint(credential.credentialFingerprint);
    if (!node) {
      return err(new ApplicationError('SYNC_NODE_NOT_TRUSTED', 'The presented credential is not trusted.'));
    }
    if (node.nodeId !== credential.presentedNodeId) {
      return err(new ApplicationError('SYNC_NODE_IDENTITY_MISMATCH', 'The presented identity does not match the credential.'));
    }
    if (node.status !== 'ACTIVE') {
      return err(new ApplicationError('SYNC_NODE_REVOKED', 'The node credential was revoked.'));
    }
    if (node.notAfter.getTime() <= this.clock.now().getTime()) {
      return err(new ApplicationError('SYNC_NODE_CREDENTIAL_EXPIRED', 'The node credential expired.'));
    }

    const receiver = await this.registry.findByNodeId(this.receiverNodeId);
    if (!receiver || receiver.status !== 'ACTIVE' ||
      receiver.notAfter.getTime() <= this.clock.now().getTime()) {
      return err(new ApplicationError('SYNC_RECEIVER_NOT_ACTIVE', 'The receiving node is not active.'));
    }
    const coordinator = await this.registry.coordinatorOf(receiver.storeId);
    if (!coordinator || node.storeId !== receiver.storeId) {
      return err(new ApplicationError('SYNC_NODE_STORE_MISMATCH', 'The node does not belong to this coordinator.'));
    }
    if (coordinator.status !== 'ACTIVE' ||
      coordinator.notAfter.getTime() <= this.clock.now().getTime()) {
      return err(new ApplicationError('SYNC_RECEIVER_NOT_ACTIVE', 'The receiving coordinator is not active.'));
    }
    const allowed = receiver.role === 'COORDINATOR'
      ? receiver.nodeId === coordinator.nodeId && node.role === 'TERMINAL'
      : node.role === 'COORDINATOR' && node.nodeId === coordinator.nodeId;
    if (!allowed) {
      return err(new ApplicationError('SYNC_NODE_ROLE_INVALID', 'The pair of node roles cannot exchange events.'));
    }

    return ok({
      verifiedNodeId: node.nodeId,
      verifiedTerminalId: node.terminalId,
      coordinatorNodeId: coordinator.nodeId
    });
  }
}
