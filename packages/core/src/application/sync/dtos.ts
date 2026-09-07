import type { SyncNodeRole } from '../ports/index.js';

export type RegisterSyncNodeInput = {
  readonly nodeId: string;
  readonly storeId: string;
  readonly role: SyncNodeRole;
  readonly terminalId?: string;
  /** Huella SHA-256 del certificado provisionado, en minúsculas y sin separadores. */
  readonly credentialFingerprint: string;
  /** Donde escucha el nodo si va a recibir entregas; host y puerto van juntos. */
  readonly addressHost?: string;
  readonly addressPort?: number;
  readonly notAfter: string;
  readonly reason: string;
};

export type RevokeSyncNodeInput = {
  readonly nodeId: string;
  readonly reason: string;
};

export type SyncNodeDto = {
  readonly nodeId: string;
  readonly storeId: string;
  readonly role: SyncNodeRole;
  readonly terminalId: string | null;
  readonly credentialFingerprint: string;
  readonly addressHost: string | null;
  readonly addressPort: number | null;
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly notAfter: string;
  readonly registeredAt: string;
  readonly revokedAt: string | null;
};

/**
 * Credencial verificada por el transporte antes de llegar a la aplicación. La
 * huella proviene del certificado presentado en el handshake, nunca del cuerpo
 * de la solicitud.
 */
export type SyncTransportCredential = {
  readonly credentialFingerprint: string;
  readonly presentedNodeId: string;
};
