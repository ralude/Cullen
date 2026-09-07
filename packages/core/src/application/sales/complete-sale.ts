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
  AuditWriter,
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

/**
 * Salida de inventario del hecho de venta cuando este nodo es la autoridad de
 * stock: standalone o coordinador. Una terminal con coordinador no compone este
 * relevo, porque su salida la aplica el nodo autoritativo al recibir el hecho
 * (`docs/architecture/12-sincronizacion-y-ownership.md`).
 *
 * A diferencia del turno, un rechazo **no** revierte la venta:
 * [FS-005](../../../../../docs/failure-scenarios/FS-005-venta-concurrente-ultima-unidad.md)
 * declara que esa atomicidad entre agregados no está definida, y una existencia
 * desfasada no puede negarle el cobro a un cliente que ya pagó. El rechazo se
 * audita con su código para resolución humana. `ApplySaleCompletedToInventory`
 * satisface este contrato.
 */
export type SaleCompletedInventoryRelay = {
  readonly application: {
    execute(event: BusinessEventV1): Promise<Result<unknown, AppError>>;
  };
  readonly auditWriter: AuditWriter;
  readonly auditIdGenerator: IdGenerator;
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
    private readonly idempotencyStore?: IdempotencyStore,
    private readonly inventoryRelay?: SaleCompletedInventoryRelay
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
          await this.issueSoldStock(completed, context);
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

  /**
   * Aplica la salida de stock dentro de la transacción que completa la venta,
   * porque el `StockItem` de este nodo es una escritura local y no una entrega.
   * Un rechazo de negocio conserva la venta y deja auditoría; una falla de
   * infraestructura sí propaga y revierte, según FS-004.
   */
  private async issueSoldStock(
    completed: BusinessEventV1, context: ExecutionContext
  ): Promise<void> {
    if (this.inventoryRelay === undefined) return;
    const issued = await this.inventoryRelay.application.execute(completed);
    if (issued.ok) return;
    await this.inventoryRelay.auditWriter.append([{
      auditId: this.inventoryRelay.auditIdGenerator.generate(),
      actorId: context.actorId,
      actorRoleCodes: context.actorRoleCodes ?? [],
      action: 'SALE_STOCK_ISSUE_REJECTED',
      entityType: 'Sale',
      entityId: completed.aggregateId,
      before: null,
      after: { errorCode: issued.error.code },
      reason: 'Completed sale could not be issued from inventory.',
      terminalId: context.terminalId,
      originNodeId: context.originNodeId,
      occurredAt: completed.occurredAt,
      correlationId: context.correlationId
    }]);
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
