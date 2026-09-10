import {
  ApplicationError,
  DomainError,
  err,
  Money,
  ok,
  type AppError,
  type Result
} from '@supermarket/shared';
import { Shift, type OpeningFund } from '../../domain/cash/index.js';
import type { ExecutionContext } from '../execution-context.js';
import { persistBusinessChange } from '../events/index.js';
import type {
  AuditWriter,
  AuthorizationService,
  BusinessEventStore,
  CashRegisterRepository,
  Clock,
  IdGenerator,
  OutboxStore,
  IdempotencyStore,
  PaymentMethodRepository,
  ShiftRepository,
  UnitOfWork
} from '../ports/index.js';
import type { OpenShiftInput, ShiftDto } from './dtos.js';
import { toShiftDto } from './mappers.js';
import { resolveCashPaymentMethod } from './payment-method-validation.js';
import { CASH_PERMISSIONS } from './permissions.js';
import { executeIdempotentCommand } from '../idempotency/index.js';
import { restoreShiftDto, serializeShiftDto } from './shift-idempotency.js';

export class OpenShift {
  constructor(
    private readonly cashRegisterRepository: CashRegisterRepository,
    private readonly shiftRepository: ShiftRepository,
    private readonly paymentMethodRepository: PaymentMethodRepository,
    private readonly authorization: AuthorizationService,
    private readonly shiftIdGenerator: IdGenerator,
    private readonly movementIdGenerator: IdGenerator,
    private readonly eventIdGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly eventStore: BusinessEventStore,
    private readonly outboxStore: OutboxStore,
    private readonly auditWriter: AuditWriter,
    private readonly auditIdGenerator: IdGenerator,
    private readonly idempotencyStore?: IdempotencyStore
  ) {}

  async execute(input: OpenShiftInput, context: ExecutionContext): Promise<Result<ShiftDto, AppError>> {
    if (!(await this.authorization.authorize(context, CASH_PERMISSIONS.OPEN_SHIFT))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to open shifts.'));
    }
    try {
      const openedAt = this.clock.now();
      return await executeIdempotentCommand({
        operation: 'OpenShift', input, context, now: openedAt,
        unitOfWork: this.unitOfWork,
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: async () => {
        const cashRegister = await this.cashRegisterRepository.findById(input.cashRegisterId);
        if (cashRegister === null) {
          return err(new ApplicationError('CASH_REGISTER_NOT_FOUND', 'Cash register was not found.'));
        }
        cashRegister.assertOperationalFor(context.terminalId, context.originNodeId);
        if (await this.shiftRepository.findOpenByCashRegisterId(cashRegister.id)) {
          return err(new ApplicationError('SHIFT_ALREADY_OPEN', 'Cash register already has an open shift.'));
        }

        const openingFunds: OpeningFund[] = [];
        for (const fund of input.openingFunds) {
          const methodResult = await resolveCashPaymentMethod(
            this.paymentMethodRepository,
            fund.paymentMethodCode,
            fund.currencyCode
          );
          if (!methodResult.ok) return methodResult;
          openingFunds.push({
            id: this.movementIdGenerator.generate(),
            method: methodResult.value,
            amount: Money.fromMinorUnits(fund.amountMinorUnits, fund.currencyCode)
          });
        }

        const shift = Shift.open({
          id: this.shiftIdGenerator.generate(),
          cashRegister,
          openingFunds,
          openedBy: context.actorId,
          openedAt,
          eventId: this.eventIdGenerator.generate()
        });
        await persistBusinessChange(
          () => this.shiftRepository.save(shift),
          shift.domainEvents,
          context,
          undefined,
          this.eventStore,
          this.outboxStore,
          ['ShiftOpened'],
          this.auditWriter,
          [{
            auditId: this.auditIdGenerator.generate(),
            actorId: context.actorId,
            actorRoleCodes: context.actorRoleCodes ?? [],
            action: 'SHIFT_OPENED',
            entityType: 'Shift',
            entityId: shift.id,
            before: null,
            after: {
              status: shift.status,
              cashRegisterId: shift.cashRegisterId,
              openingBalances: shift.expectedBalances.map((balance) => ({
                paymentMethodCode: balance.paymentMethodCode,
                currencyCode: balance.amount.currency,
                minorUnits: balance.amount.minorUnits
              }))
            },
            reason: 'Turno abierto.',
            terminalId: context.terminalId,
            originNodeId: context.originNodeId,
            occurredAt: openedAt,
            correlationId: context.correlationId
          }]
        );
          return ok(toShiftDto(shift));
        },
        serialize: serializeShiftDto,
        restore: restoreShiftDto
      });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }
}
