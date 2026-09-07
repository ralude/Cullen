export type SyncNodeRole = 'COORDINATOR' | 'TERMINAL';

/**
 * Alta manual y auditable de un nodo de la LAN. La huella del certificado es el
 * único material criptográfico que se conserva: claves privadas y secretos de
 * transporte no llegan a la base, a los eventos comerciales ni a los logs.
 */
export type SyncNodeRegistration = {
  readonly nodeId: string;
  readonly storeId: string;
  readonly role: SyncNodeRole;
  /** Terminal asociada; obligatoria para un nodo `TERMINAL`. */
  readonly terminalId: string | null;
  readonly credentialFingerprint: string;
  /**
   * Donde escucha el nodo, cuando es destino de entrega. Host y puerto van
   * juntos o ninguno: un nodo sin direccion no recibe entregas, y retirarla no
   * convierte pendientes en publicados.
   */
  readonly addressHost: string | null;
  readonly addressPort: number | null;
  readonly notAfter: Date;
  readonly registeredAt: Date;
  readonly registeredBy: string;
  readonly registrationReason: string;
};

export type RegisteredSyncNode = SyncNodeRegistration & {
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly revokedAt: Date | null;
};

/**
 * Registro confiable de nodos. La confianza se provisiona antes de escuchar en
 * LAN: no se descubre a partir del primer certificado presentado, y una
 * revocación conserva la fila con su evidencia.
 */
export interface SyncNodeRegistry {
  findByCredentialFingerprint(fingerprint: string): Promise<RegisteredSyncNode | undefined>;
  findByNodeId(nodeId: string): Promise<RegisteredSyncNode | undefined>;
  coordinatorOf(storeId: string): Promise<RegisteredSyncNode | undefined>;
  list(): Promise<readonly RegisteredSyncNode[]>;
  /**
   * Nodos activos de la tienda con direccion y credencial vigentes, distintos
   * del propio receptor. Son los destinos elegibles de entrega.
   */
  deliveryDestinations(storeId: string, now: Date): Promise<readonly RegisteredSyncNode[]>;
  register(registration: SyncNodeRegistration): Promise<void>;
  revoke(
    nodeId: string,
    revokedAt: Date,
    revokedBy: string,
    reason: string
  ): Promise<boolean>;
}
