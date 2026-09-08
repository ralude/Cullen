export type DeliveryDiagnosticRecord = {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly destinationNodeId: string;
  readonly status: 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'BLOCKED' | 'PAUSED';
  readonly attempts: number;
  readonly cycleAttempts: number;
  readonly nextAttemptAt: Date;
  readonly leaseUntil: Date | null;
  readonly publishedAt: Date | null;
  readonly lastError: string | null;
  readonly occurredAt: Date;
};

export type SaleEffectRecord = {
  readonly saleId: string;
  readonly eventId: string;
  readonly correlationId: string;
  readonly originNodeId: string;
  readonly terminalId: string;
  readonly occurredAt: Date;
  readonly kind: 'LOCAL_REJECTION' | 'OUTGOING' | 'INCOMING';
  readonly state: string;
  readonly errorCode: string | null;
};

export type OutboxDiagnosticRecord = {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly status: 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'BLOCKED';
  readonly attempts: number;
  readonly nextAttemptAt: Date;
  readonly leaseUntil: Date | null;
  readonly publishedAt: Date | null;
  readonly lastError: string | null;
  readonly occurredAt: Date;
};

export type OperationalTraceRecord = {
  readonly events: readonly {
    readonly eventId: string;
    readonly eventType: string;
    readonly aggregateId: string;
    readonly aggregateType: string;
    readonly occurredAt: Date;
  }[];
  readonly outbox: readonly OutboxDiagnosticRecord[];
  readonly deliveries: readonly DeliveryDiagnosticRecord[];
  readonly audits: readonly {
    readonly auditId: string;
    readonly action: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly occurredAt: Date;
    readonly costEvidence: {
      readonly unitCostMinorUnits: number | null;
      readonly currencyCode: string | null;
      readonly source: string | null;
    } | null;
  }[];
};

/** Lectura allowlist: nunca devuelve payloads, pagos, bodies ni estados arbitrarios de auditoría. */
export interface OperationalDiagnosticsReader {
  listDeliveries(destinationNodeId: string, limit: number): Promise<readonly DeliveryDiagnosticRecord[]>;
  listSaleEffects(destinationNodeId: string, limit: number): Promise<readonly SaleEffectRecord[]>;
  trace(correlationId: string, limit: number): Promise<OperationalTraceRecord>;
}
