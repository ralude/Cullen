import {
  ApplicationError,
  type AppError,
  type JsonValue,
  type Result,
  type SyncEnvelopeV1
} from '@supermarket/shared';
import { findSyncContract } from '../events/sync-contracts.js';
import type {
  Clock,
  IdGenerator,
  SyncInboxWorkItem,
  SyncInboxWorkStore,
  UnitOfWork
} from '../ports/index.js';

/**
 * Consumidor del receptor. Se ejecuta dentro de la transacción que abre el
 * procesador, de modo que su efecto y la marca de progreso se confirman juntos.
 * Un `Result` en error revierte esa transacción: nunca queda media aplicación.
 */
export interface SyncConsumer {
  apply(envelope: SyncEnvelopeV1): Promise<Result<unknown, AppError>>;
}

/**
 * Causas que no desaparecen reintentando: exigen revisión humana con permiso y
 * motivo. Una falta de stock no se reintenta esperando que se resuelva sola.
 */
const DISCREPANCY_CODES: readonly string[] = [
  'STOCK_INSUFFICIENT',
  'STOCK_ITEM_NOT_FOUND',
  'STOCK_SALE_ISSUE_CONFLICT',
  'STOCK_QUANTITY_SCALE_MISMATCH',
  'INVENTORY_SALE_EVENT_INVALID',
  'INVENTORY_SALE_EVENT_UNSUPPORTED',
  'CATALOG_REFERENCE_PAYLOAD_INVALID',
  'CATALOG_REFERENCE_EVENT_UNSUPPORTED'
];

const MAX_BATCH_SIZE = 100;
const RETRY_BASE_MILLISECONDS = 1_000;
const RETRY_CAP_MILLISECONDS = 60_000;
const DEFAULT_LEASE_MILLISECONDS = 30_000;

/** Señal interna para revertir el efecto sin confundirla con un fallo real. */
const CONSUMER_FAILED = Symbol('sync consumer failed');

type Failure = { readonly code: string; readonly detail: JsonValue };

export type ProcessSyncInboxOptions = {
  readonly leaseMilliseconds?: number;
};

/**
 * Procesa el trabajo durable que la recepción dejó pendiente. Es un ciclo
 * acotado y recuperable: reiniciar retoma las tareas reclamadas por lease sin
 * duplicar efectos, y una dependencia recibida pero no aplicada espera en lugar
 * de aplicarse a medias.
 */
export class ProcessSyncInbox {
  private readonly leaseMilliseconds: number;

  constructor(
    private readonly store: SyncInboxWorkStore,
    private readonly consumers: ReadonlyMap<string, SyncConsumer>,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    options: ProcessSyncInboxOptions = {}
  ) {
    this.leaseMilliseconds = options.leaseMilliseconds ?? DEFAULT_LEASE_MILLISECONDS;
  }

  async runBatch(limit = 20): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
      throw new ApplicationError(
        'SYNC_INBOX_BATCH_LIMIT_INVALID',
        `Sync inbox batch limit must be between 1 and ${MAX_BATCH_SIZE}.`
      );
    }

    const claimedAt = this.clock.now();
    const items = await this.unitOfWork.execute(() => this.store.claimPending(
      claimedAt,
      new Date(claimedAt.getTime() + this.leaseMilliseconds),
      limit
    ));

    let processed = 0;
    for (const item of items) {
      if (await this.process(item)) processed += 1;
    }
    return processed;
  }

  private async process(item: SyncInboxWorkItem): Promise<boolean> {
    const consumer = this.consumers.get(item.consumer);
    if (!consumer) {
      return this.reschedule(item, 'SYNC_CONSUMER_NOT_REGISTERED');
    }

    const waiting = await this.pendingDependency(item.envelope);
    if (waiting) return this.reschedule(item, 'SYNC_DEPENDENCY_NOT_APPLIED');

    const outcome: { failure: Failure | null } = { failure: null };
    try {
      await this.unitOfWork.execute(async () => {
        if (!await this.store.isClaimActive(
          item.eventId, item.consumer, item.attempts, this.clock.now()
        )) {
          outcome.failure = { code: 'SYNC_CLAIM_EXPIRED', detail: null };
          throw CONSUMER_FAILED;
        }
        const applied = await consumer.apply(item.envelope);
        if (!applied.ok) {
          outcome.failure = { code: applied.error.code, detail: detailOf(applied.error) };
          throw CONSUMER_FAILED;
        }
        await this.store.markApplied(
          item.eventId, item.consumer, item.attempts, this.clock.now()
        );
      });
    } catch (error) {
      if (outcome.failure === null) {
        return this.reschedule(item, codeOf(error, 'SYNC_CONSUMER_UNAVAILABLE'));
      }
    }

    const cause = outcome.failure;
    if (cause === null) return true;
    if (cause.code === 'SYNC_CLAIM_EXPIRED') return false;
    return DISCREPANCY_CODES.includes(cause.code)
      ? this.openDiscrepancy(item, cause)
      : this.reschedule(item, cause.code);
  }

  /**
   * Una dependencia solo está satisfecha cuando sus consumidores la aplicaron.
   * Haberla recibido no prueba que sus efectos existan.
   */
  private async pendingDependency(envelope: SyncEnvelopeV1): Promise<boolean> {
    const contract = findSyncContract(envelope.eventType);
    if (!contract) return false;
    for (const dependency of contract.dependencies(envelope.payload)) {
      if (!await this.store.isDependencyApplied(
        dependency.aggregateType, dependency.aggregateId
      )) return true;
    }
    return false;
  }

  private async openDiscrepancy(item: SyncInboxWorkItem, failure: Failure): Promise<boolean> {
    return this.unitOfWork.execute(() => this.store.openDiscrepancy({
      discrepancyId: this.ids.generate(),
      eventId: item.eventId,
      consumer: item.consumer,
      reasonCode: failure.code,
      detail: failure.detail,
      occurredAt: this.clock.now()
    }, item.attempts));
  }

  private async reschedule(item: SyncInboxWorkItem, errorCode: string): Promise<boolean> {
    const delay = Math.min(
      RETRY_CAP_MILLISECONDS,
      RETRY_BASE_MILLISECONDS * 2 ** Math.min(item.attempts - 1, 6)
    );
    return this.unitOfWork.execute(() => this.store.markRetryable(
      item.eventId,
      item.consumer,
      item.attempts,
      new Date(this.clock.now().getTime() + delay),
      errorCode
    ));
  }
}

const codeOf = (error: unknown, fallback: string): string =>
  typeof error === 'object' && error !== null && 'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
    ? (error as { code: string }).code
    : fallback;

/**
 * Evidencia acotada de la causa: códigos y referencias declaradas por el
 * error, nunca el payload comercial completo.
 */
const detailOf = (error: AppError): JsonValue => {
  const details = error.details;
  if (details === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(details)) as JsonValue;
  } catch {
    return null;
  }
};
