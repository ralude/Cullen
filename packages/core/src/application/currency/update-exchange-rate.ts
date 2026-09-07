import { ApplicationError, ok, err, type Result, type AppError, DomainError } from '@supermarket/shared';
import { ExchangeRate } from '../../domain/currency/index.js';
import { toExchangeRatePublication } from '../catalog/reference-publications.js';
import type { ExecutionContext } from '../execution-context.js';
import { toBusinessEvents, type JsonValue } from '../events/index.js';
import { executeIdempotentCommand } from '../idempotency/index.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { ExchangeRateRepository } from '../ports/exchange-rate-repository.js';
import type {
  AuditWriter, AuthorizationService, Clock, IdempotencyStore, OutboxStore, UnitOfWork
} from '../ports/index.js';
import type { ExchangeRateDto, UpdateExchangeRateInput } from './dtos.js';
import { CURRENCY_PERMISSIONS } from './permissions.js';

function toDto(rate: ExchangeRate): ExchangeRateDto {
  return {
    id: rate.id,
    baseCurrency: rate.baseCurrency,
    quoteCurrency: rate.quoteCurrency,
    rateValue: rate.rateValue,
    rateScale: rate.rateScale,
    source: rate.source,
    validFrom: rate.validFrom,
    validUntil: rate.validUntil,
    registeredBy: rate.registeredBy
  };
}

/**
 * Caso de uso para registrar una nueva tasa de cambio. No modifica tasas
 * históricas; cada registro crea una nueva entrada con vigencia explícita.
 */
export class UpdateExchangeRate {
  constructor(
    private readonly idGenerator: IdGenerator,
    private readonly repository: ExchangeRateRepository,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly unitOfWork?: UnitOfWork,
    private readonly idempotencyStore?: IdempotencyStore,
    private readonly auditWriter?: AuditWriter,
    private readonly outboxStore?: OutboxStore
  ) {}

  async execute(
    input: UpdateExchangeRateInput,
    context: ExecutionContext
  ): Promise<Result<ExchangeRateDto, AppError>> {
    if (!(await this.authorization.authorize(context, CURRENCY_PERMISSIONS.UPDATE_RATE))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to update exchange rates.'));
    }
    const now = this.clock.now();
    try {
      return await executeIdempotentCommand({
        operation: 'UpdateExchangeRate', input, context, now,
        ...(this.unitOfWork ? { unitOfWork: this.unitOfWork } : {}),
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: async () => {
      const rate = ExchangeRate.create({
        id: this.idGenerator.generate(), ...input, registeredBy: context.actorId
      });
      const version = await this.repository.save(rate);
      await this.outboxStore?.enqueue(toBusinessEvents([toExchangeRatePublication(rate, {
        eventId: this.idGenerator.generate(), occurredAt: now, version
      })], context));
      const dto = toDto(rate);
      if (this.auditWriter) await this.auditWriter.append([{
        auditId: this.idGenerator.generate(), actorId: context.actorId,
        actorRoleCodes: context.actorRoleCodes ?? [], action: 'CURRENCY_RATE_UPDATED',
        entityType: 'ExchangeRate', entityId: rate.id, before: null,
        after: JSON.parse(JSON.stringify(dto)) as JsonValue, reason: input.reason,
        terminalId: context.terminalId, originNodeId: context.originNodeId,
        occurredAt: now, correlationId: context.correlationId
      }]);
      return ok(dto);
        },
        serialize: (output) => JSON.parse(JSON.stringify(output)) as JsonValue,
        restore: (output) => {
          const value = output as unknown as Omit<ExchangeRateDto, 'validFrom' | 'validUntil'> & {
            validFrom: string; validUntil: string | null;
          };
          return {
            ...value,
            validFrom: new Date(value.validFrom),
            validUntil: value.validUntil === null ? null : new Date(value.validUntil)
          };
        }
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return err(error);
      }
      throw error;
    }
  }
}
