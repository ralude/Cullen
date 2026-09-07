import {
  ApplicationError,
  DomainError,
  err,
  Money,
  ok,
  TaxRate,
  type AppError,
  type Result
} from '@supermarket/shared';
import { Barcode, Product } from '../../domain/catalog/index.js';
import type { ExecutionContext } from '../execution-context.js';
import { persistBusinessChange, type JsonValue } from '../events/index.js';
import { executeIdempotentCommand } from '../idempotency/index.js';
import type {
  AuditWriter,
  AuthorizationService,
  BusinessEventStore,
  CategoryRepository,
  Clock,
  IdGenerator,
  IdempotencyStore,
  OutboxStore,
  ProductRepository,
  UnitOfWork,
  UnitOfMeasureRepository
} from '../ports/index.js';
import type { CreateProductInput, ProductDto } from './dtos.js';
import { toProductDto } from './mappers.js';
import { toProductPublication } from './reference-publications.js';
import { CATALOG_PERMISSIONS } from './permissions.js';

export class CreateProduct {
  constructor(
    private readonly idGenerator: IdGenerator,
    private readonly repository: ProductRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly unitRepository: UnitOfMeasureRepository,
    private readonly clock: Clock,
    private readonly authorization: AuthorizationService,
    private readonly unitOfWork?: UnitOfWork,
    private readonly eventStore?: BusinessEventStore,
    private readonly outboxStore?: OutboxStore,
    private readonly idempotencyStore?: IdempotencyStore,
    private readonly auditWriter?: AuditWriter
  ) {}

  async execute(
    input: CreateProductInput,
    context: ExecutionContext
  ): Promise<Result<ProductDto, AppError>> {
    if (!(await this.authorization.authorize(context, CATALOG_PERMISSIONS.CREATE_PRODUCT))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to create products.'));
    }
    const now = this.clock.now();
    try {
      return await executeIdempotentCommand({
        operation: 'CreateProduct', input, context, now,
        ...(this.unitOfWork ? { unitOfWork: this.unitOfWork } : {}),
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: async () => {
          const category = await this.categoryRepository.findById(input.categoryId);
          if (category === null) {
            return err(new ApplicationError('CATEGORY_NOT_FOUND', 'Category was not found.'));
          }
          if (!category.isActive) {
            return err(new ApplicationError('CATEGORY_INACTIVE', 'Category is inactive.'));
          }
          const unit = await this.unitRepository.findByCode(input.unitCode.trim().toUpperCase());
          if (unit === null) {
            return err(new ApplicationError('UNIT_OF_MEASURE_NOT_FOUND', 'Unit of measure was not found.'));
          }
          if (!unit.isActive) {
            return err(new ApplicationError('UNIT_OF_MEASURE_INACTIVE', 'Unit of measure is inactive.'));
          }
          const productId = this.idGenerator.generate();
          const barcodes = input.barcodes.map((value) =>
            Barcode.create({ id: this.idGenerator.generate(), value })
          );
          for (const barcode of barcodes) {
            const existing = await this.repository.findByActiveBarcode(barcode.value);
            if (existing !== null) {
              return err(new ApplicationError('BARCODE_CONFLICT', 'Barcode is already assigned to a product.'));
            }
          }
          const product = Product.create({
            id: productId,
            name: input.name,
            description: input.description,
            categoryId: category.id,
            unitOfMeasure: unit,
            barcodes,
            price: Money.fromMinorUnits(input.priceMinorUnits, input.currencyCode),
            taxRate: TaxRate.fromBasisPoints(input.taxRateBasisPoints),
            priceHistoryId: this.idGenerator.generate(),
            recordedBy: context.actorId,
            occurredAt: now,
            eventId: this.idGenerator.generate()
          });
          const dto = toProductDto(product);
          await persistBusinessChange(
            () => this.repository.save(product), product.domainEvents, context,
            undefined, this.eventStore, this.outboxStore, [],
            this.auditWriter, this.auditWriter ? [{
              auditId: this.idGenerator.generate(), actorId: context.actorId,
              actorRoleCodes: context.actorRoleCodes ?? [], action: 'CATALOG_PRODUCT_CREATED',
              entityType: 'Product', entityId: product.id, before: null,
              after: JSON.parse(JSON.stringify(dto)) as JsonValue, reason: input.reason,
              terminalId: context.terminalId, originNodeId: context.originNodeId,
              occurredAt: now, correlationId: context.correlationId
            }] : [],
            [toProductPublication(product, {
              eventId: this.idGenerator.generate(), occurredAt: now
            })]
          );
          return ok(dto);
        },
        serialize: (output) => JSON.parse(JSON.stringify(output)) as JsonValue,
        restore: (output) => output as unknown as ProductDto
      });
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }
}
