/**
 * Autoridad de escritura conocida para un agregado. La consulta se indexa solo
 * por `(aggregateType, aggregateId)`: incluir el origen declarado permitiría
 * que otro nodo fabricara un grupo nuevo para el mismo agregado.
 */
export type AggregateAuthority =
  | { readonly resolution: 'RESOLVED'; readonly ownerNodeId: string }
  | { readonly resolution: 'UNRESOLVED' };

/**
 * Alta de dueño único. `MANUAL` proviene de una operación de administración;
 * `DELEGATED` del alta técnica que una terminal ya autorizada solicita para un
 * agregado propio creado offline. La evidencia se resume en una huella
 * acotada: no se copian payloads comerciales al registro de autoridad.
 */
export type AggregateAuthorityRegistration = {
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly ownerNodeId: string;
  readonly source: 'MANUAL' | 'DELEGATED';
  readonly evidenceFingerprint: string;
  readonly registeredAt: Date;
  readonly registeredBy: string;
};

/**
 * Un alta reentregada de forma idéntica devuelve el mismo resultado; una
 * contradicción con el dueño o la evidencia registrados nunca reasigna
 * autoridad.
 */
export type AggregateAuthorityRegistrationOutcome =
  | { readonly outcome: 'REGISTERED'; readonly ownerNodeId: string }
  | { readonly outcome: 'ALREADY_REGISTERED'; readonly ownerNodeId: string }
  | { readonly outcome: 'CONFLICT'; readonly ownerNodeId: string };

export interface AggregateAuthorityRegistry {
  authorityFor(aggregateType: string, aggregateId: string): Promise<AggregateAuthority>;
  register(
    registration: AggregateAuthorityRegistration
  ): Promise<AggregateAuthorityRegistrationOutcome>;
}

/**
 * Identidad del emisor verificada por el transporte, nunca leída del payload.
 * `verifiedTerminalId` proviene del registro confiable de nodos, no del sobre:
 * un contrato que declare terminal debe coincidir con ella. `actorId` es
 * evidencia del hecho, no una credencial.
 */
export type SyncSenderContext = {
  readonly verifiedNodeId: string;
  /** Terminal asociada al nodo verificado, o `null` para un coordinador. */
  readonly verifiedTerminalId: string | null;
  /** Identidad verificada del coordinador, o `null` si todavía no se conoce. */
  readonly coordinatorNodeId: string | null;
};
