import { ApplicationError, err, ok, type AppError, type Result } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type {
  AuthorizationService,
  Clock,
  DeliveryDiagnosticRecord,
  OutboxDiagnosticRecord,
  OperationalDiagnosticsReader,
  OperationalTraceRecord,
  RemoteApplicationProbe,
  SaleEffectRecord
} from '../ports/index.js';
import { SYNC_PERMISSIONS } from './permissions.js';

const LIMIT = 50;

export type DeliveryDiagnosticDto = Omit<DeliveryDiagnosticRecord,
  'nextAttemptAt' | 'leaseUntil' | 'publishedAt' | 'occurredAt'> & {
  readonly nextAttemptAt: string;
  readonly leaseUntil: string | null;
  readonly publishedAt: string | null;
  readonly occurredAt: string;
  readonly ageMilliseconds: number;
};

export type SaleAttentionState =
  | 'LOCAL_REJECTED'
  | 'DELIVERY_PENDING'
  | 'DELIVERY_BLOCKED'
  | 'APPLICATION_PENDING'
  | 'APPLICATION_UNKNOWN'
  | 'DISCREPANCY';

export type SaleAttentionDto = Omit<SaleEffectRecord, 'occurredAt' | 'kind' | 'state'> & {
  readonly state: SaleAttentionState;
  readonly evidenceState: string;
  readonly occurredAt: string;
  readonly ageMilliseconds: number;
};

export type OperationalTraceDto = {
  readonly events: readonly (Omit<OperationalTraceRecord['events'][number], 'occurredAt'> & {
    readonly occurredAt: string;
  })[];
  readonly outbox: readonly (Omit<OutboxDiagnosticRecord,
    'nextAttemptAt' | 'leaseUntil' | 'publishedAt' | 'occurredAt'> & {
    readonly nextAttemptAt: string;
    readonly leaseUntil: string | null;
    readonly publishedAt: string | null;
    readonly occurredAt: string;
  })[];
  readonly deliveries: readonly DeliveryDiagnosticDto[];
  readonly audits: readonly (Omit<OperationalTraceRecord['audits'][number], 'occurredAt'> & {
    readonly occurredAt: string;
  })[];
};

export type OperationalDiagnosticsDto = {
  readonly observedAt: string;
  readonly deliveries: readonly DeliveryDiagnosticDto[];
  readonly salesAttention: readonly SaleAttentionDto[];
  readonly trace: OperationalTraceDto | null;
};

const deliveryDto = (record: DeliveryDiagnosticRecord, now: Date): DeliveryDiagnosticDto => ({
  ...record,
  nextAttemptAt: record.nextAttemptAt.toISOString(),
  leaseUntil: record.leaseUntil?.toISOString() ?? null,
  publishedAt: record.publishedAt?.toISOString() ?? null,
  occurredAt: record.occurredAt.toISOString(),
  ageMilliseconds: Math.max(0, now.getTime() - record.occurredAt.getTime())
});

const localState = (record: SaleEffectRecord): SaleAttentionState | null => {
  if (record.kind === 'LOCAL_REJECTION') return 'LOCAL_REJECTED';
  if (record.kind === 'INCOMING') {
    if (record.state === 'DISCREPANCY') return 'DISCREPANCY';
    if (record.state === 'APPLIED') return null;
    return 'APPLICATION_PENDING';
  }
  if (record.state === 'PUBLISHED') return null;
  return record.state === 'BLOCKED' || record.state === 'PAUSED'
    ? 'DELIVERY_BLOCKED'
    : 'DELIVERY_PENDING';
};

export class GetOperationalDiagnostics {
  constructor(
    private readonly reader: OperationalDiagnosticsReader,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly remoteApplication?: RemoteApplicationProbe
  ) {}

  async execute(
    input: { readonly destinationNodeId: string; readonly correlationId?: string },
    context: ExecutionContext
  ): Promise<Result<OperationalDiagnosticsDto, AppError>> {
    if (!await this.authorization.authorize(context, SYNC_PERMISSIONS.REVIEW_RECEPTION)) {
      return err(new ApplicationError(
        'FORBIDDEN', 'Actor is not authorized to inspect operational diagnostics.'
      ));
    }
    const destinationNodeId = input.destinationNodeId.trim();
    if (destinationNodeId.length === 0 || destinationNodeId.length > 128) {
      return err(new ApplicationError(
        'SYNC_DESTINATION_INVALID', 'The synchronization destination is invalid.'
      ));
    }
    const correlationId = input.correlationId?.trim();
    if (correlationId !== undefined && (correlationId.length < 8 || correlationId.length > 128)) {
      return err(new ApplicationError(
        'CORRELATION_ID_INVALID', 'The correlation identifier is invalid.'
      ));
    }

    const now = this.clock.now();
    const deliveries = await this.reader.listDeliveries(destinationNodeId, LIMIT);
    const effects = await this.reader.listSaleEffects(destinationNodeId, LIMIT);
    const attention: SaleAttentionDto[] = [];
    for (const effect of effects) {
      let state = localState(effect);
      if (effect.kind === 'OUTGOING' && effect.state === 'PUBLISHED') {
        const remote = this.remoteApplication === undefined
          ? 'UNKNOWN'
          : await this.remoteApplication.applicationOf(effect.eventId);
        state = remote === 'APPLIED'
          ? null
          : remote === 'DISCREPANCY'
            ? 'DISCREPANCY'
            : remote === 'PENDING'
              ? 'APPLICATION_PENDING'
              : 'APPLICATION_UNKNOWN';
      }
      if (state === null) continue;
      attention.push({
        saleId: effect.saleId,
        eventId: effect.eventId,
        correlationId: effect.correlationId,
        originNodeId: effect.originNodeId,
        terminalId: effect.terminalId,
        errorCode: effect.errorCode,
        state,
        evidenceState: effect.state,
        occurredAt: effect.occurredAt.toISOString(),
        ageMilliseconds: Math.max(0, now.getTime() - effect.occurredAt.getTime())
      });
    }

    const traced = correlationId === undefined ? null : await this.reader.trace(correlationId, LIMIT);
    return ok({
      observedAt: now.toISOString(),
      deliveries: deliveries.map((entry) => deliveryDto(entry, now)),
      salesAttention: attention,
      trace: traced === null ? null : {
        events: traced.events.map((entry) => ({
          ...entry, occurredAt: entry.occurredAt.toISOString()
        })),
        outbox: traced.outbox.map((entry) => ({
          ...entry,
          nextAttemptAt: entry.nextAttemptAt.toISOString(),
          leaseUntil: entry.leaseUntil?.toISOString() ?? null,
          publishedAt: entry.publishedAt?.toISOString() ?? null,
          occurredAt: entry.occurredAt.toISOString()
        })),
        deliveries: traced.deliveries.map((entry) => deliveryDto(entry, now)),
        audits: traced.audits.map((entry) => ({
          ...entry, occurredAt: entry.occurredAt.toISOString()
        }))
      }
    });
  }
}
