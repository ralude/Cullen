/**
 * Custodia de las claves con las que el nodo protege lo que puede salir de la
 * máquina —respaldos y secretos de configuración—
 * ([ADR-0029](../../../../../docs/architecture/adr/0029-proteccion-de-datos-en-reposo.md) D7.3).
 *
 * El núcleo no conoce DPAPI, llaveros ni archivos: conoce claves con
 * identificador y estado. La clave nunca vive junto al material que protege, y
 * una clave retirada se conserva mientras exista un respaldo cifrado con ella:
 * una rotación que inutiliza los respaldos anteriores es pérdida de datos.
 */
export type ProtectionKeyState = 'ACTIVE' | 'RETIRED';

export type ProtectionKey = {
  readonly keyId: string;
  readonly state: ProtectionKeyState;
  readonly createdAt: Date;
  /** Material simétrico de 256 bits, solo en memoria. */
  readonly material: Uint8Array;
};

export type ProtectionKeySummary = {
  readonly keyId: string;
  readonly state: ProtectionKeyState;
  readonly createdAt: Date;
  readonly retiredAt: Date | null;
};

export type SecretVaultProtection = 'OS_KEYSTORE' | 'UNPROTECTED_DEVELOPMENT';

export type SecretVault = {
  /** Cómo se custodia la clave. Una custodia degradada es evidencia, no un detalle. */
  readonly protection: SecretVaultProtection;
  /** Clave con la que se cifra material nuevo; se crea la primera si no existe. */
  activeKey(now: Date): Promise<ProtectionKey>;
  keyById(keyId: string): Promise<ProtectionKey | null>;
  list(): Promise<readonly ProtectionKeySummary[]>;
  /** Genera una clave activa nueva y retira la anterior sin borrarla. */
  rotate(now: Date): Promise<{ readonly keyId: string; readonly retiredKeyId: string | null }>;
  /** Olvida una clave retirada. Devuelve `false` si no existe o sigue activa. */
  forget(keyId: string): Promise<boolean>;
};
