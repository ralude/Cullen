import { ApplicationError, err, ok, type AppError, type Result } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type { JsonValue } from '../events/index.js';
import { SYNC_CONSUMERS } from '../events/sync-contracts.js';
import type {
  AuditWriter,
  AuthorizationService,
  CatalogReferenceProjection,
  Clock,
  IdGenerator,
  OutboxStore,
  ReferenceEntryFreshness,
  ReferenceFreshness,
  SyncInboxWorkStore,
  UnitOfWork
} from '../ports/index.js';
import { SYNC_PERMISSIONS } from './permissions.js';

export type SyncPausedDeliveryDto = {
  readonly eventId: string;
  readonly destinationNodeId: string;
  readonly lastError: string | null;
  readonly pausedAt: string;
};

/**
 * Estado observable de la sincronización de un destino.
 *
 * `ATTENTION_REQUIRED` prevalece en el rótulo general y la conectividad se
 * informa aparte, de modo que una caída no oculte una discrepancia. `SYNCED`
 * exige un ciclo verificado sin trabajo pendiente conocido: una salida vacía o
 * un intento de conexión no bastan.
 */
export type SyncStatusV1 =
  | 'OFFLINE'
  | 'CONNECTING'
  | 'SYNCING'
  | 'SYNCED'
  | 'ATTENTION_REQUIRED';

export type SyncReferenceEntryDto = {
  readonly publishedBy: string | null;
  readonly publishedAt: string | null;
  readonly version: number | null;
  readonly count: number;
  /** Milisegundos desde la emisión; `null` cuando nunca se recibió. */
  readonly ageMilliseconds: number | null;
};

export type SyncReferenceFreshnessDto = {
  readonly catalog: SyncReferenceEntryDto;
  readonly exchangeRate: SyncReferenceEntryDto & {
    readonly validUntil: string | null;
    /** Una tasa vencida no se presenta como vigente por haber reconectado. */
    readonly expired: boolean;
  };
  readonly operatorGrants: SyncReferenceEntryDto & {
    readonly expiresAt: string | null;
    readonly expired: boolean;
  };
  /** Informativa: no reserva existencias ni se suma al saldo del coordinador. */
  readonly stockAvailability: SyncReferenceEntryDto;
};

export type SyncDestinationStatusDto = {
  readonly destinationNodeId: string;
  readonly status: SyncStatusV1;
  /** Conectividad observada, separada del rótulo general. */
  readonly connectivity: 'ONLINE' | 'OFFLINE' | 'CONNECTING' | 'UNKNOWN';
  readonly pendingDeliveries: number;
  readonly pausedDeliveries: number;
  readonly blockedDeliveries: number;
  readonly pendingApplications: number;
  readonly openDiscrepancies: number;
  /**
   * Referencias de catálogo utilizables: sin publicaciones pendientes de
   * aplicar y con al menos una aplicada. Una terminal a la que nunca se le
   * publicó el catálogo no queda `SYNCED` por tener la cola vacía.
   */
  readonly referencesUsable: boolean;
  readonly pendingReferences: number;
  /**
   * Antigüedad de las referencias recibidas. `null` significa nunca recibida:
   * un ping, un reintento fallido o un ACK de otro tipo no la actualizan.
   */
  readonly references: SyncReferenceFreshnessDto;
  /** Última entrega confirmada por este destino; `null` significa nunca. */
  readonly lastPublishedAt: string | null;
  readonly lastError: string | null;
  /** Momento en que se calculó esta lectura, no una promesa de actualidad. */
  readonly observedAt: string;
};

/**
 * Conectividad conocida del destino. La comprueba el worker, no esta lectura:
 * un ping no confirma eventos ni convierte el nodo en `SYNCED`.
 */
export interface SyncConnectivityProbe {
  lastKnownState(destinationNodeId: string): Promise<'ONLINE' | 'OFFLINE' | 'CONNECTING' | 'UNKNOWN'>;
}

/**
 * Lectura de estado de sincronización. Combina evidencia durable de la salida
 * local y del trabajo de aplicación del receptor; no infiere entrega a partir
 * de la conectividad.
 */
export class GetSyncStatus {
  constructor(
    private readonly outbox: OutboxStore,
    private readonly inbox: SyncInboxWorkStore,
    private readonly connectivity: SyncConnectivityProbe,
    private readonly clock: Clock,
    private readonly authorization: AuthorizationService,
    private readonly references?: CatalogReferenceProjection
  ) {}

  async execute(
    destinationNodeId: string,
    context: ExecutionContext
  ): Promise<Result<SyncDestinationStatusDto, AppError>> {
    if (!await this.authorization.authorize(context, SYNC_PERMISSIONS.REVIEW_RECEPTION)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to inspect sync state.'));
    }

    const summary = await this.outbox.summarize(destinationNodeId);
    const pendingApplications = await this.inbox.countPending();
    const openDiscrepancies = (await this.inbox.listDiscrepancies('OPEN')).length;
    const connectivity = await this.connectivity.lastKnownState(destinationNodeId);
    const pendingReferences = await this.inbox.countPendingFor(SYNC_CONSUMERS.catalogReference);
    const appliedReferences = this.references ? await this.references.countApplied() : 0;
    const referencesUsable = pendingReferences === 0 && appliedReferences > 0;
    const observedAt = this.clock.now();
    const freshness = this.references === undefined
      ? emptyFreshness()
      : toFreshnessDto(await this.references.referenceFreshness(), observedAt);

    /**
     * Una concesión vencida exige intervención: sin ella la terminal no puede
     * autenticar ni autorizar, aunque su cola esté vacía (ADR-0026 D5).
     */
    const attention = summary.paused > 0 || summary.blocked > 0 || openDiscrepancies > 0
      || freshness.operatorGrants.expired;
    const working = summary.pending > 0 || pendingApplications > 0 || !referencesUsable;
    const status: SyncStatusV1 = attention
      ? 'ATTENTION_REQUIRED'
      : connectivity === 'OFFLINE'
        ? 'OFFLINE'
        : connectivity === 'CONNECTING' || connectivity === 'UNKNOWN'
          ? 'CONNECTING'
          : working
            ? 'SYNCING'
            : 'SYNCED';

    return ok({
      destinationNodeId,
      status,
      connectivity,
      pendingDeliveries: summary.pending,
      pausedDeliveries: summary.paused,
      blockedDeliveries: summary.blocked,
      pendingApplications,
      openDiscrepancies,
      referencesUsable,
      pendingReferences,
      references: freshness,
      lastPublishedAt: summary.lastPublishedAt === null
        ? null
        : summary.lastPublishedAt.toISOString(),
      lastError: summary.lastError,
      observedAt: observedAt.toISOString()
    });
  }
}

export class ListPausedDeliveries {
  constructor(
    private readonly outbox: OutboxStore,
    private readonly authorization: AuthorizationService
  ) {}

  async execute(
    destinationNodeId: string,
    context: ExecutionContext
  ): Promise<Result<readonly SyncPausedDeliveryDto[], AppError>> {
    if (!await this.authorization.authorize(context, SYNC_PERMISSIONS.REVIEW_RECEPTION)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to inspect deliveries.'));
    }
    const paused = await this.outbox.listPaused(destinationNodeId);
    return ok(paused.map((entry) => ({
      eventId: entry.eventId,
      destinationNodeId,
      lastError: entry.lastError,
      pausedAt: entry.pausedAt.toISOString()
    })));
  }
}

/**
 * Reanudación manual autorizada de una entrega agotada. Conserva el ID, el
 * payload y la historia del hecho: no existe un «descartar y continuar» que
 * pierda el hecho, y un `BLOCKED` contractual no se reintenta por esta vía.
 */
export class ResumeSyncDelivery {
  constructor(
    private readonly outbox: OutboxStore,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly auditWriter?: AuditWriter
  ) {}

  async execute(
    input: {
      readonly eventId: string;
      readonly destinationNodeId: string;
      readonly reason: string;
    },
    context: ExecutionContext
  ): Promise<Result<SyncPausedDeliveryDto, AppError>> {
    if (!await this.authorization.authorize(context, SYNC_PERMISSIONS.RESUME_DELIVERY)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to resume deliveries.'));
    }
    if (input.reason.trim().length === 0) {
      return err(new ApplicationError('SYNC_RESUME_REASON_REQUIRED', 'A resume reason is required.'));
    }

    const paused = (await this.outbox.listPaused(input.destinationNodeId))
      .find((entry) => entry.eventId === input.eventId);
    if (!paused) {
      return err(new ApplicationError(
        'SYNC_DELIVERY_NOT_PAUSED',
        'The delivery is not paused for this destination.'
      ));
    }

    const now = this.clock.now();
    await this.unitOfWork.execute(async () => {
      await this.outbox.resumeDelivery(
        input.eventId, input.destinationNodeId, now, context.actorId
      );
      await this.auditWriter?.append([{
        auditId: this.ids.generate(),
        actorId: context.actorId,
        actorRoleCodes: context.actorRoleCodes ?? [],
        action: 'SYNC_DELIVERY_RESUMED',
        entityType: 'SyncDelivery',
        entityId: `${input.eventId}:${input.destinationNodeId}`,
        before: { status: 'PAUSED', lastError: paused.lastError } as unknown as JsonValue,
        after: { status: 'PENDING' } as unknown as JsonValue,
        reason: input.reason.trim(),
        terminalId: context.terminalId,
        originNodeId: context.originNodeId,
        occurredAt: now,
        correlationId: context.correlationId
      }]);
    });

    return ok({
      eventId: input.eventId,
      destinationNodeId: input.destinationNodeId,
      lastError: paused.lastError,
      pausedAt: paused.pausedAt.toISOString()
    });
  }
}

const EMPTY_ENTRY: SyncReferenceEntryDto = {
  publishedBy: null,
  publishedAt: null,
  version: null,
  count: 0,
  ageMilliseconds: null
};

/** Sin proyección compuesta no hay referencia recibida, no una referencia vacía. */
const emptyFreshness = (): SyncReferenceFreshnessDto => ({
  catalog: EMPTY_ENTRY,
  exchangeRate: { ...EMPTY_ENTRY, validUntil: null, expired: false },
  operatorGrants: { ...EMPTY_ENTRY, expiresAt: null, expired: false },
  stockAvailability: EMPTY_ENTRY
});

const toEntryDto = (
  entry: ReferenceEntryFreshness,
  observedAt: Date
): SyncReferenceEntryDto => ({
  publishedBy: entry.publishedBy,
  publishedAt: entry.publishedAt?.toISOString() ?? null,
  version: entry.version,
  count: entry.count,
  ageMilliseconds: entry.publishedAt === null
    ? null
    : Math.max(0, observedAt.getTime() - entry.publishedAt.getTime())
});

/**
 * Traduce la antigüedad proyectada. Una vigencia terminada se informa como
 * vencida y nunca como vigente: un dato ausente tampoco se presenta como
 * utilizable, para eso está `count: 0` con todo en `null`.
 */
const toFreshnessDto = (
  freshness: ReferenceFreshness,
  observedAt: Date
): SyncReferenceFreshnessDto => ({
  catalog: toEntryDto(freshness.catalog, observedAt),
  exchangeRate: {
    ...toEntryDto(freshness.exchangeRate, observedAt),
    validUntil: freshness.exchangeRate.validUntil?.toISOString() ?? null,
    expired: freshness.exchangeRate.validUntil !== null
      && freshness.exchangeRate.validUntil.getTime() <= observedAt.getTime()
  },
  operatorGrants: {
    ...toEntryDto(freshness.operatorGrants, observedAt),
    expiresAt: freshness.operatorGrants.expiresAt?.toISOString() ?? null,
    expired: freshness.operatorGrants.expiresAt !== null
      && freshness.operatorGrants.expiresAt.getTime() <= observedAt.getTime()
  },
  stockAvailability: toEntryDto(freshness.stockAvailability, observedAt)
});
