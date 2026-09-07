import {
  ApplicationError,
  DomainError,
  err,
  Money,
  ok,
  type AppError,
  type Result
} from '@supermarket/shared';
import type { CloseShiftProps } from '../../domain/cash/index.js';
import type { ExecutionContext } from '../execution-context.js';
import { persistBusinessChange } from '../events/index.js';
import type {
  AuditWriter,
  AuthorizationService,
  BusinessEventStore,
  Clock,
  IdGenerator,
  IdempotencyStore,
  OpenSalesProbe,
  OutboxStore,
  PaymentMethodRepository,
  ShiftRepository,
  UnitOfWork
} from '../ports/index.js';
import type { CloseShiftInput, ShiftDto } from './dtos.js';
import { toShiftDto } from './mappers.js';
import { resolvePaymentMethod } from './payment-method-validation.js';
import { CASH_PERMISSIONS } from './permissions.js';
import { executeIdempotentCommand } from '../idempotency/index.js';
import { restoreShiftDto, serializeShiftDto } from './shift-idempotency.js';

export class CloseShift {
  constructor(
    private readonly shiftRepository: ShiftRepository,
    private readonly paymentMethodRepository: PaymentMethodRepository,
    private readonly authorization: AuthorizationService,
    private readonly eventIdGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly eventStore: BusinessEventStore,
    private readonly outboxStore: OutboxStore,
    private readonly auditWriter: AuditWriter,
    private readonly auditIdGenerator: IdGenerator,
    private readonly openSales: OpenSalesProbe,
    private readonly idempotencyStore?: IdempotencyStore
  ) {}

  async execute(input: CloseShiftInput, context: ExecutionContext): Promise<Result<ShiftDto, AppError>> {
    if (!(await this.authorization.authorize(context, CASH_PERMISSIONS.CLOSE_SHIFT))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to close shifts.'));
    }
    try {
      const closedAt = this.clock.now();
      return await executeIdempotentCommand({
        operation: 'CloseShift', input, context, now: closedAt,
        unitOfWork: this.unitOfWork,
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: async () => {
        const shift = await this.shiftRepository.findById(input.shiftId);
        if (shift === null) return err(new ApplicationError('SHIFT_NOT_FOUND', 'Shift was not found.'));
        /**
         * Una venta sin cerrar no puede quedar del otro lado del arqueo: su
         * cobro solo entra al turno al completarla y, cerrado el turno, ya no
         * hay dónde asentarlo. El cierre exige cobrarla o anularla antes.
         */
        const openSales = await this.openSales.countOpenByShiftId(shift.id);
        if (openSales > 0) {
          return err(new ApplicationError(
            'SHIFT_HAS_OPEN_SALES',
            `Shift still has ${openSales} open sale(s); complete or void them before closing.`
          ));
        }
        const declaredBalances: CloseShiftProps['declaredBalances'] = [];
        for (const balance of input.declaredBalances) {
          const methodResult = await resolvePaymentMethod(
            this.paymentMethodRepository,
            balance.paymentMethodCode,
            balance.currencyCode
          );
          if (!methodResult.ok) return methodResult;
          declaredBalances.push({
            method: methodResult.value,
            amount: Money.fromMinorUnits(balance.amountMinorUnits, balance.currencyCode)
          });
        }
        const declared = new Map(declaredBalances.map((balance) => [
          `${balance.method.code}:${balance.amount.currency}`,
          balance.amount.minorUnits
        ]));
        const expected = new Map(shift.expectedBalances.map((balance) => [
          `${balance.paymentMethodCode}:${balance.amount.currency}`,
          balance.amount.minorUnits
        ]));
        const hasDifference = [...new Set([...declared.keys(), ...expected.keys()])]
          .some((key) => (declared.get(key) ?? 0) !== (expected.get(key) ?? 0));
        const negativeExpectedMethods = shift.expectedBalances
          .filter((balance) => balance.amount.minorUnits < 0)
          .map((balance) => `${balance.paymentMethodCode}:${balance.amount.currency}`);
        if ((hasDifference || negativeExpectedMethods.length > 0) && !(await this.authorization.authorize(
          context,
          CASH_PERMISSIONS.CLOSE_SHIFT_WITH_DIFFERENCE
        ))) {
          return err(new ApplicationError(
            'FORBIDDEN',
            'Actor is not authorized to close a shift with differences.'
          ));
        }
        const closeReason = input.reason?.trim() ?? '';
        if (negativeExpectedMethods.length > 0 && closeReason.length === 0) {
          return err(new ApplicationError(
            'SHIFT_NEGATIVE_EXPECTED_REASON_REQUIRED',
            'Closing a shift with a negative expected balance requires an explicit reason.'
          ));
        }
        const previousEventCount = shift.domainEvents.length;
        shift.close({
          declaredBalances,
          closedBy: context.actorId,
          terminalId: context.terminalId,
          originNodeId: context.originNodeId,
          closedAt,
          eventId: this.eventIdGenerator.generate()
        });
        await persistBusinessChange(
          () => this.shiftRepository.save(shift),
          shift.domainEvents.slice(previousEventCount),
          context,
          undefined,
          this.eventStore,
          this.outboxStore,
          ['ShiftClosed'],
          this.auditWriter,
          [{
            auditId: this.auditIdGenerator.generate(),
            actorId: context.actorId,
            actorRoleCodes: context.actorRoleCodes ?? [],
            action: 'SHIFT_CLOSED',
            entityType: 'Shift',
            entityId: shift.id,
            before: { status: 'OPEN' },
            after: {
              status: shift.status,
              negativeExpectedMethods,
              balances: shift.closingBalances?.map((balance) => ({
                paymentMethodCode: balance.paymentMethodCode,
                currencyCode: balance.expected.currency,
                expectedMinorUnits: balance.expected.minorUnits,
                declaredMinorUnits: balance.declared.minorUnits,
                differenceMinorUnits: balance.difference.minorUnits
              })) ?? []
            },
            reason: closeReason || 'Shift closed with declared balances.',
            terminalId: context.terminalId,
            originNodeId: context.originNodeId,
            occurredAt: closedAt,
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
