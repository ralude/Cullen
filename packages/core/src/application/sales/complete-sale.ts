import { ApplicationError, DomainError, err, ok, type AppError, type Result } from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import {
  persistBusinessChange,
  toBusinessEvents,
  type BusinessEventV1,
  type JsonValue
} from '../events/index.js';
import { executeIdempotentCommand } from '../idempotency/index.js';
import type {
  BusinessEventStore,
  Clock,
  IdGenerator,
  IdempotencyStore,
  OutboxStore,
  SaleRepository,
  UnitOfWork
} from '../ports/index.js';
import type { CompleteSaleInput, SaleDto } from './dtos.js';
import { toSaleDto } from './mappers.js';

/**
 * Aplicación del hecho de venta al turno dueño de la caja. El `Shift` pertenece
 * a la terminal de origen (`docs/architecture/12-sincronizacion-y-ownership.md`),
 * así que su movimiento es una escritura local del mismo nodo y no una entrega:
 * se confirma en la transacción que completa la venta, nunca cuando un worker
 * la alcanza. `ApplySaleCompletedToShift` satisface este contrato.
 */
export type SaleCompletedCashApplication = {
  execute(event: BusinessEventV1): Promise<Result<unknown, AppError>>;
};

export class CompleteSale {
  constructor(
    private readonly repository: SaleRepository,
    private readonly eventIdGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly cashApplication: SaleCompletedCashApplication,
    private readonly unitOfWork?: UnitOfWork,
    private readonly eventStore?: BusinessEventStore,
    private readonly outboxStore?: OutboxStore,
    private readonly idempotencyStore?: IdempotencyStore
  ) {}

  async execute(input: CompleteSaleInput, context: ExecutionContext): Promise<Result<SaleDto, AppError>> {
    const failure: { error: AppError | null } = { error: null };
    try {
      return await executeIdempotentCommand({
        operation: 'CompleteSale', input, context, now: this.clock.now(),
        ...(this.unitOfWork ? { unitOfWork: this.unitOfWork } : {}),
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: async () => {
          const sale = await this.repository.findById(input.saleId);
          if (sale === null || sale.terminalId !== context.terminalId ||
            sale.originNodeId !== context.originNodeId) {
            return err(new ApplicationError('SALE_NOT_FOUND', 'Sale was not found.'));
          }
          sale.complete({
            completedAt: this.clock.now(), eventId: this.eventIdGenerator.generate()
          });
          await persistBusinessChange(
            () => this.repository.save(sale), sale.domainEvents, context,
            undefined, this.eventStore, this.outboxStore, ['SaleCompleted']
          );
          /**
           * El mismo sobre que se anexó al ledger y se encoló para consolidar.
           * La caja consume el hecho y no lee las tablas de ventas.
           */
          const completed = toBusinessEvents(sale.domainEvents, context)
            .find((event) => event.eventType === 'SaleCompleted');
          if (completed === undefined) {
            return err(new ApplicationError(
              'SALE_COMPLETION_EVENT_MISSING',
              'Sale completion did not produce its business event.'
            ));
          }
          /**
           * Se lanza el propio error para revertir la transacción: un `Result`
           * en error confirmaría la venta sin su asiento. La unidad de trabajo
           * conserva los `AppError`, así que la identidad lo devuelve intacto.
           */
          const applied = await this.cashApplication.execute(completed);
          if (!applied.ok) {
            failure.error = applied.error;
            throw applied.error;
          }
          return ok(toSaleDto(sale));
        },
        serialize: (output) => JSON.parse(JSON.stringify(output)) as JsonValue,
        restore: (value) => this.restoreResult(value)
      });
    } catch (error) {
      /**
       * Un turno cerrado, ajeno o inexistente revierte la venta completa: el
       * cobro no puede quedar fuera del arqueo que lo custodia.
       */
      if (failure.error !== null && error === failure.error) return err(failure.error);
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }

  private restoreResult(value: JsonValue): SaleDto {
    const dto = value as unknown as SaleDto & { completedAt: string | null; voidedAt: string | null };
    return {
      ...dto,
      completedAt: dto.completedAt === null ? null : new Date(dto.completedAt),
      voidedAt: dto.voidedAt === null ? null : new Date(dto.voidedAt)
    };
  }
}
