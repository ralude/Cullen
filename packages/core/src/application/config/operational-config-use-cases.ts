import {
  ApplicationError, DomainError, Percentage, TaxRate, err, ok, type AppError, type Result
} from '@supermarket/shared';
import { CashRegister } from '../../domain/cash/index.js';
import { Category, UnitOfMeasure } from '../../domain/catalog/index.js';
import { PaymentMethod } from '../../domain/currency/index.js';
import { CATALOG_PERMISSIONS } from '../catalog/permissions.js';
import {
  toPaymentMethodPublication,
  toOperationalPolicyPublication,
  toCategoryPublication,
  toUnitOfMeasurePublication
} from '../catalog/reference-publications.js';
import type { ExecutionContext } from '../execution-context.js';
import { toBusinessEvents, type DomainEventLike, type JsonValue } from '../events/index.js';
import { executeIdempotentCommand } from '../idempotency/index.js';
import type {
  AuditWriter, AuthorizationService, CashRegisterRepository, Clock, IdGenerator, IdempotencyStore,
  OperationalMasterDataStore, OperationalPolicyWriter, OutboxStore, UnitOfWork
} from '../ports/index.js';
import type {
  ActivateDiscountPolicyInput, ActivateTaxPolicyInput, CashRegisterConfigDto, CategoryConfigDto,
  CreateCashRegisterInput, OperationalMasterDataDto, PaymentMethodConfigDto, PolicyActivationDto,
  SaveCategoryInput, SavePaymentMethodInput, SaveUnitInput, UnitConfigDto
} from './dtos.js';
import { CONFIG_PERMISSIONS } from './permissions.js';

const categoryDto = (value: Category): CategoryConfigDto => ({
  id: value.id, name: value.name, isActive: value.isActive
});
const unitDto = (value: UnitOfMeasure): UnitConfigDto => ({
  id: value.id, code: value.code, name: value.name,
  quantityScale: value.quantityScale, isActive: value.isActive
});
const cashRegisterDto = (value: CashRegister): CashRegisterConfigDto => ({
  id: value.id, name: value.name, terminalId: value.terminalId,
  originNodeId: value.originNodeId, isActive: value.isActive
});
const paymentDto = (value: PaymentMethod): PaymentMethodConfigDto => ({
  code: value.code, name: value.name, kind: value.kind,
  currencyCode: value.currencyCode, isActive: value.isActive
});

abstract class ConfigCommand {
  constructor(
    protected readonly authorization: AuthorizationService,
    protected readonly ids: IdGenerator,
    protected readonly clock: Clock,
    protected readonly unitOfWork: UnitOfWork,
    protected readonly auditWriter?: AuditWriter,
    protected readonly idempotencyStore?: IdempotencyStore,
    /** Salida del coordinador; ausente en un nodo que no distribuye referencias. */
    protected readonly outboxStore?: OutboxStore
  ) {}

  /**
   * Encola la publicación de la referencia dentro de la transacción del
   * comando: el cambio autoritativo y su distribución se confirman juntos.
   */
  protected async publish(
    publication: DomainEventLike,
    context: ExecutionContext
  ): Promise<void> {
    await this.outboxStore?.enqueue(toBusinessEvents([publication], context));
  }

  protected async run<TInput, TOutput>(
    operation: string, input: TInput, context: ExecutionContext, permission: string,
    execute: (now: Date) => Promise<Result<TOutput, AppError>>
  ): Promise<Result<TOutput, AppError>> {
    if (!await this.authorization.authorize(context, permission)) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to manage this configuration.'));
    }
    const now = this.clock.now();
    try {
      return await executeIdempotentCommand({
        operation, input, context, now, unitOfWork: this.unitOfWork,
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: () => execute(now),
        serialize: (output) => JSON.parse(JSON.stringify(output)) as JsonValue,
        restore: (output) => output as unknown as TOutput
      });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }

  protected async audit(
    context: ExecutionContext, action: string, entityType: string, entityId: string,
    before: JsonValue | null, after: JsonValue, reason: string, now: Date
  ): Promise<void> {
    await this.auditWriter?.append([{
      auditId: this.ids.generate(), actorId: context.actorId,
      actorRoleCodes: context.actorRoleCodes ?? [], action, entityType, entityId,
      before, after, reason: reason.trim(), terminalId: context.terminalId,
      originNodeId: context.originNodeId, occurredAt: now, correlationId: context.correlationId
    }]);
  }
}

export class ListOperationalMasterData {
  constructor(
    private readonly store: OperationalMasterDataStore,
    private readonly authorization: AuthorizationService
  ) {}
  async execute(context: ExecutionContext): Promise<Result<OperationalMasterDataDto, AppError>> {
    const canCatalog = await this.authorization.authorize(context, CATALOG_PERMISSIONS.UPDATE_PRODUCT);
    const canPayments = await this.authorization.authorize(context, CONFIG_PERMISSIONS.MANAGE_PAYMENT_METHOD);
    if (!canCatalog && !canPayments) return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to read operational master data.'));
    const [categories, units, paymentMethods] = await Promise.all([
      canCatalog ? this.store.listCategories() : Promise.resolve([]),
      canCatalog ? this.store.listUnits() : Promise.resolve([]),
      canPayments ? this.store.listPaymentMethods() : Promise.resolve([])
    ]);
    return ok({ categories: categories.map(categoryDto), units: units.map(unitDto), paymentMethods: paymentMethods.map(paymentDto) });
  }
}

export class SaveCategory extends ConfigCommand {
  constructor(private readonly store: OperationalMasterDataStore, ...args: ConstructorParameters<typeof ConfigCommand>) { super(...args); }
  execute(input: SaveCategoryInput, context: ExecutionContext): Promise<Result<CategoryConfigDto, AppError>> {
    return this.run('SaveCategory', input, context, CATALOG_PERMISSIONS.UPDATE_PRODUCT, async (now) => {
      const existing = input.id ? await this.store.findCategoryById(input.id) : null;
      if (input.id && !existing) return err(new ApplicationError('CATEGORY_NOT_FOUND', 'Category was not found.'));
      if (existing?.isActive && !input.isActive && await this.store.isCategoryInUse(existing.id)) {
        return err(new ApplicationError('CATEGORY_IN_USE', 'Category is used by an active product.'));
      }
      const value = Category.create({ id: existing?.id ?? this.ids.generate(), name: input.name, isActive: input.isActive });
      const version = await this.store.saveCategory(value);
      await this.publish(toCategoryPublication(value, {
        eventId: this.ids.generate(), occurredAt: now, version
      }), context);
      const dto = categoryDto(value);
      await this.audit(context, existing ? 'CATEGORY_UPDATED' : 'CATEGORY_CREATED', 'Category', value.id,
        existing ? categoryDto(existing) as unknown as JsonValue : null, dto as unknown as JsonValue, input.reason, now);
      return ok(dto);
    });
  }
}

export class SaveUnit extends ConfigCommand {
  constructor(private readonly store: OperationalMasterDataStore, ...args: ConstructorParameters<typeof ConfigCommand>) { super(...args); }
  execute(input: SaveUnitInput, context: ExecutionContext): Promise<Result<UnitConfigDto, AppError>> {
    return this.run('SaveUnit', input, context, CATALOG_PERMISSIONS.UPDATE_PRODUCT, async (now) => {
      const code = input.code.trim().toUpperCase();
      const existing = await this.store.findUnitByCode(code);
      const used = existing ? await this.store.isUnitInUse(existing.id) : false;
      const hasHistory = existing ? await this.store.hasUnitHistory(existing.id) : false;
      if (hasHistory && existing?.quantityScale !== input.quantityScale) {
        return err(new ApplicationError('UNIT_OF_MEASURE_SCALE_IN_USE', 'Quantity scale cannot change after first use.'));
      }
      if (used && existing?.isActive && !input.isActive) {
        return err(new ApplicationError('UNIT_OF_MEASURE_IN_USE', 'Unit is used by an active product.'));
      }
      const value = UnitOfMeasure.create({ id: existing?.id ?? this.ids.generate(), code, name: input.name,
        quantityScale: input.quantityScale, isActive: input.isActive });
      const version = await this.store.saveUnit(value);
      await this.publish(toUnitOfMeasurePublication(value, {
        eventId: this.ids.generate(), occurredAt: now, version
      }), context);
      const dto = unitDto(value);
      await this.audit(context, existing ? 'UNIT_OF_MEASURE_UPDATED' : 'UNIT_OF_MEASURE_CREATED', 'UnitOfMeasure', value.id,
        existing ? unitDto(existing) as unknown as JsonValue : null, dto as unknown as JsonValue, input.reason, now);
      return ok(dto);
    });
  }
}

export class SavePaymentMethod extends ConfigCommand {
  constructor(private readonly store: OperationalMasterDataStore, ...args: ConstructorParameters<typeof ConfigCommand>) { super(...args); }
  execute(input: SavePaymentMethodInput, context: ExecutionContext): Promise<Result<PaymentMethodConfigDto, AppError>> {
    return this.run('SavePaymentMethod', input, context, CONFIG_PERMISSIONS.MANAGE_PAYMENT_METHOD, async (now) => {
      const code = input.code.trim().toUpperCase();
      const existing = await this.store.findPaymentMethodByCode(code);
      if (existing?.isActive && !input.isActive && await this.store.isPaymentMethodInUse(code)) {
        return err(new ApplicationError('PAYMENT_METHOD_IN_USE', 'Payment method is used by an open aggregate.'));
      }
      const value = PaymentMethod.create({ ...input, code, currencyCode: input.currencyCode.trim().toUpperCase() });
      const version = await this.store.savePaymentMethod(value);
      await this.publish(toPaymentMethodPublication(value, {
        eventId: this.ids.generate(), occurredAt: now, version
      }), context);
      const dto = paymentDto(value);
      await this.audit(context, existing ? 'PAYMENT_METHOD_UPDATED' : 'PAYMENT_METHOD_CREATED', 'PaymentMethod', code,
        existing ? paymentDto(existing) as unknown as JsonValue : null, dto as unknown as JsonValue, input.reason, now);
      return ok(dto);
    });
  }
}

export class ActivateDiscountPolicy extends ConfigCommand {
  constructor(private readonly writer: OperationalPolicyWriter, ...args: ConstructorParameters<typeof ConfigCommand>) { super(...args); }
  execute(input: ActivateDiscountPolicyInput, context: ExecutionContext): Promise<Result<PolicyActivationDto, AppError>> {
    return this.run('ActivateDiscountPolicy', input, context, CONFIG_PERMISSIONS.MANAGE_TAX, async (now) => {
      const maximumBasisPoints = Percentage.fromBasisPoints(input.maximumBasisPoints).basisPoints;
      const value = this.writer.activateDiscountPolicy({ maximumBasisPoints },
        { policyId: this.ids.generate(), createdBy: context.actorId, reason: input.reason.trim(), now });
      if (value.created) {
        await this.publish(toOperationalPolicyPublication({
          policyType: 'DISCOUNT', policyId: value.policyId,
          version: value.version, maximumBasisPoints
        }, { eventId: this.ids.generate(), occurredAt: now }), context);
        await this.audit(context, 'DISCOUNT_POLICY_ACTIVATED', 'OperationalPolicy', value.policyId,
          null, { ...value, maximumBasisPoints: input.maximumBasisPoints }, input.reason, now);
      }
      return ok(value);
    });
  }
}

export class ActivateFinancialTransactionTaxPolicy extends ConfigCommand {
  constructor(private readonly writer: OperationalPolicyWriter, ...args: ConstructorParameters<typeof ConfigCommand>) { super(...args); }
  execute(input: ActivateTaxPolicyInput, context: ExecutionContext): Promise<Result<PolicyActivationDto, AppError>> {
    return this.run('ActivateFinancialTransactionTaxPolicy', input, context, CONFIG_PERMISSIONS.MANAGE_TAX, async (now) => {
      const rateBasisPoints = TaxRate.fromBasisPoints(input.rateBasisPoints).basisPoints;
      const value = this.writer.activateFinancialTransactionTaxPolicy({ ...input, rateBasisPoints },
        { policyId: this.ids.generate(), createdBy: context.actorId, reason: input.reason.trim(), now });
      if (value.created) {
        await this.publish(toOperationalPolicyPublication({
          policyType: 'FINANCIAL_TRANSACTION_TAX',
          policyId: value.policyId,
          version: value.version,
          rateBasisPoints,
          eligiblePaymentMethodCodes: [...new Set(input.eligiblePaymentMethodCodes
            .map((code) => code.trim().toUpperCase()).filter(Boolean))].sort(),
          eligibleCurrencies: [...new Set(input.eligibleCurrencies
            .map((code) => code.trim().toUpperCase()).filter(Boolean))].sort()
        }, { eventId: this.ids.generate(), occurredAt: now }), context);
        await this.audit(context, 'FINANCIAL_TRANSACTION_TAX_POLICY_ACTIVATED', 'OperationalPolicy', value.policyId,
          null, { ...value, rateBasisPoints: input.rateBasisPoints }, input.reason, now);
      }
      return ok(value);
    });
  }
}

/**
 * Alta de la caja de esta terminal. Hasta ahora las cajas solo existían por
 * `bootstrap-operations`, así que un nodo recién instalado no podía abrir turno
 * desde la aplicación.
 *
 * El identificador, el terminal y el nodo los fija el proceso que atiende, no
 * la petición: una caja pertenece a la terminal que la declara y ese dueño es
 * inmutable (`docs/architecture/12-sincronizacion-y-ownership.md`). Por eso
 * tampoco se publica como referencia distribuida.
 */
export class CreateCashRegister extends ConfigCommand {
  constructor(
    private readonly repository: CashRegisterRepository,
    ...args: ConstructorParameters<typeof ConfigCommand>
  ) { super(...args); }

  execute(
    input: CreateCashRegisterInput, context: ExecutionContext
  ): Promise<Result<CashRegisterConfigDto, AppError>> {
    return this.run(
      'CreateCashRegister', input, context, CONFIG_PERMISSIONS.MANAGE_CASH_REGISTER,
      async (now) => {
        const name = input.name.trim();
        const existing = await this.repository.findAll();
        const duplicated = existing.some((register) =>
          register.terminalId === context.terminalId
          && register.originNodeId === context.originNodeId
          && register.name.localeCompare(name, 'es', { sensitivity: 'base' }) === 0);
        if (duplicated) {
          return err(new ApplicationError(
            'CASH_REGISTER_NAME_CONFLICT', 'This terminal already has a cash register with that name.'
          ));
        }
        const register = CashRegister.create({
          id: this.ids.generate(), name,
          terminalId: context.terminalId, originNodeId: context.originNodeId
        });
        await this.repository.save(register);
        const dto = cashRegisterDto(register);
        await this.audit(
          context, 'CASH_REGISTER_CREATED', 'CashRegister', register.id,
          null, dto as unknown as JsonValue, input.reason, now
        );
        return ok(dto);
      }
    );
  }
}
