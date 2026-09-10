import {
  ApplicationError,
  DomainError,
  err,
  Money,
  ok,
  type AppError,
  type Result
} from '@supermarket/shared';
import type { ExecutionContext } from '../execution-context.js';
import type { BusinessEventV1, JsonValue } from '../events/index.js';
import { persistBusinessChange } from '../events/index.js';
import type {
  AuditWriter,
  BusinessEventStore,
  IdGenerator,
  OutboxStore,
  PaymentMethodRepository,
  ShiftRepository,
  UnitOfWork
} from '../ports/index.js';
import type { ShiftDto } from './dtos.js';
import { toShiftDto } from './mappers.js';

type SalePaymentPayload = {
  paymentId: string;
  methodCode: string;
  currencyCode: string;
  amountMinorUnits: number;
};

type SaleCompletedPayload = {
  shiftId: string;
  terminalId: string;
  payments: SalePaymentPayload[];
};

const record = (value: JsonValue): Record<string, JsonValue> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : null;

const payloadOf = (event: BusinessEventV1): SaleCompletedPayload | null => {
  const payload = record(event.payload);
  if (!payload || typeof payload.shiftId !== 'string' ||
    typeof payload.terminalId !== 'string' || !Array.isArray(payload.payments)) return null;
  const payments: SalePaymentPayload[] = [];
  for (const entry of payload.payments) {
    const payment = record(entry);
    if (!payment || typeof payment.paymentId !== 'string' ||
      typeof payment.methodCode !== 'string' || typeof payment.currencyCode !== 'string' ||
      typeof payment.amountMinorUnits !== 'number' || !Number.isSafeInteger(payment.amountMinorUnits) ||
      payment.amountMinorUnits <= 0) return null;
    payments.push({
      paymentId: payment.paymentId,
      methodCode: payment.methodCode,
      currencyCode: payment.currencyCode,
      amountMinorUnits: payment.amountMinorUnits
    });
  }
  return payload.shiftId.length > 0 && payload.terminalId.length > 0 && payments.length > 0
    ? { shiftId: payload.shiftId, terminalId: payload.terminalId, payments }
    : null;
};

export class ApplySaleCompletedToShift {
  constructor(
    private readonly shiftRepository: ShiftRepository,
    private readonly paymentMethodRepository: PaymentMethodRepository,
    private readonly eventIdGenerator: IdGenerator,
    private readonly auditIdGenerator: IdGenerator,
    private readonly unitOfWork: UnitOfWork,
    private readonly eventStore: BusinessEventStore,
    private readonly outboxStore: OutboxStore,
    private readonly auditWriter: AuditWriter
  ) {}

  async execute(event: BusinessEventV1): Promise<Result<ShiftDto, AppError>> {
    if (event.eventType !== 'SaleCompleted' || event.aggregateType !== 'Sale') {
      return err(new ApplicationError(
        'CASH_SALE_EVENT_UNSUPPORTED',
        'Cash can only consume SaleCompleted.v1 events.'
      ));
    }
    const payload = payloadOf(event);
    if (payload === null) {
      return err(new ApplicationError('CASH_SALE_EVENT_INVALID', 'SaleCompleted.v1 payload is invalid.'));
    }
    const context: ExecutionContext = {
      actorId: event.actorId,
      actorRoleCodes: [],
      terminalId: payload.terminalId,
      originNodeId: event.originNodeId,
      correlationId: event.correlationId
    };
    try {
      return await this.unitOfWork.execute(async () => {
        const shift = await this.shiftRepository.findById(payload.shiftId);
        if (shift === null) return err(new ApplicationError('SHIFT_NOT_FOUND', 'Shift was not found.'));
        const movementIds = new Set(shift.movements.map((movement) => movement.id));
        const previousEventCount = shift.domainEvents.length;
        const resolvedPayments = [];
        for (const payment of payload.payments) {
          const method = await this.paymentMethodRepository.findByCode(payment.methodCode);
          if (method === null) {
            return err(new ApplicationError('PAYMENT_METHOD_NOT_FOUND', 'Payment method was not found.'));
          }
          resolvedPayments.push({ payment, method });
        }
        for (const { payment, method } of resolvedPayments) {
          shift.registerMovement({
            id: payment.paymentId,
            type: 'SALE_PAYMENT',
            method,
            amount: Money.fromMinorUnits(payment.amountMinorUnits, payment.currencyCode),
            reason: 'Cobro de venta',
            registeredBy: event.actorId,
            terminalId: payload.terminalId,
            originNodeId: event.originNodeId,
            occurredAt: event.occurredAt,
            eventId: this.eventIdGenerator.generate(),
            reference: { sourceId: event.aggregateId, sourceEventId: event.eventId }
          });
        }
        const events = shift.domainEvents.slice(previousEventCount);
        if (events.length === 0) return ok(toShiftDto(shift));
        const movements = shift.movements.filter((movement) => !movementIds.has(movement.id));
        await persistBusinessChange(
          () => this.shiftRepository.save(shift),
          events,
          context,
          undefined,
          this.eventStore,
          this.outboxStore,
          ['CashMovementRegistered'],
          this.auditWriter,
          movements.map((movement) => ({
            auditId: this.auditIdGenerator.generate(),
            actorId: event.actorId,
            actorRoleCodes: [],
            action: 'SALE_PAYMENT_REGISTERED_IN_SHIFT',
            entityType: 'Shift',
            entityId: shift.id,
            before: null,
            after: {
              movementId: movement.id,
              saleId: event.aggregateId,
              sourceEventId: event.eventId,
              paymentMethodCode: movement.method.code,
              currencyCode: movement.amount.currency,
              amountMinorUnits: movement.amount.minorUnits
            },
            reason: 'Cobro de venta completada asentado en el turno.',
            terminalId: payload.terminalId,
            originNodeId: event.originNodeId,
            occurredAt: event.occurredAt,
            correlationId: event.correlationId
          }))
        );
        return ok(toShiftDto(shift));
      });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }
}
