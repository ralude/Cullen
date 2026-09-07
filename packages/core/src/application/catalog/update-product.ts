import {
  ApplicationError,
  DomainError,
  err,
  ok,
  type AppError,
  type Result
} from '@supermarket/shared';
import {
  Barcode,
  type ProductDetailsChanges
} from '../../domain/catalog/index.js';
import type { ExecutionContext } from '../execution-context.js';
import { toBusinessEvents, type JsonValue } from '../events/index.js';
import { executeIdempotentCommand } from '../idempotency/index.js';
import type {
  AuditWriter,
  AuthorizationService,
  Clock,
  CategoryRepository,
  IdGenerator,
  IdempotencyStore,
  OutboxStore,
  ProductRepository,
  UnitOfWork,
  UnitOfMeasureRepository
} from '../ports/index.js';
import type { ProductDto, UpdateProductInput } from './dtos.js';
import { toProductDto } from './mappers.js';
import { toProductPublication } from './reference-publications.js';
import { CATALOG_PERMISSIONS } from './permissions.js';

export class UpdateProduct {
  constructor(
    private readonly repository: ProductRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly unitRepository: UnitOfMeasureRepository,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly authorization: AuthorizationService,
    private readonly unitOfWork?: UnitOfWork,
    private readonly idempotencyStore?: IdempotencyStore,
    private readonly auditWriter?: AuditWriter,
    /** Salida del coordinador: una actualizacion tambien distribuye el catalogo. */
    private readonly outboxStore?: OutboxStore
  ) {}

  async execute(input: UpdateProductInput, context: ExecutionContext): Promise<Result<ProductDto, AppError>> {
    if (!(await this.authorization.authorize(context, CATALOG_PERMISSIONS.UPDATE_PRODUCT))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to update products.'));
    }
    const now = this.clock.now();
    try {
      return await executeIdempotentCommand({
        operation: 'UpdateProduct', input, context, now,
        ...(this.unitOfWork ? { unitOfWork: this.unitOfWork } : {}),
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: async () => {
      const product = await this.repository.findById(input.productId);
      if (product === null) {
        return err(new ApplicationError('PRODUCT_NOT_FOUND', 'Product was not found.'));
      }
      const before = toProductDto(product);

      const categoryId = input.categoryId;
      if (categoryId !== undefined) {
        const category = await this.categoryRepository.findById(categoryId);
        if (category === null) {
          return err(new ApplicationError('CATEGORY_NOT_FOUND', 'Category was not found.'));
        }
        if (!category.isActive) {
          return err(new ApplicationError('CATEGORY_INACTIVE', 'Category is inactive.'));
        }
      }

      let unit = undefined;
      if (input.unitCode !== undefined) {
        unit = await this.unitRepository.findByCode(input.unitCode.trim().toUpperCase());
        if (unit === null) {
          return err(new ApplicationError('UNIT_OF_MEASURE_NOT_FOUND', 'Unit of measure was not found.'));
        }
        if (!unit.isActive) {
          return err(new ApplicationError('UNIT_OF_MEASURE_INACTIVE', 'Unit of measure is inactive.'));
        }
      }

      let barcodes: Barcode[] | undefined;
      if (input.barcodes !== undefined) {
        barcodes = input.barcodes.map((value) =>
          Barcode.create({ id: this.idGenerator.generate(), value })
        );
        for (const barcode of barcodes) {
          const existing = await this.repository.findByActiveBarcode(barcode.value);
          if (existing !== null && existing.id !== product.id) {
            return err(new ApplicationError('BARCODE_CONFLICT', 'Barcode is already assigned to a product.'));
          }
        }
      }

      const changes: ProductDetailsChanges = {};
      if (input.name !== undefined) changes.name = input.name;
      if (input.description !== undefined) changes.description = input.description;
      if (categoryId !== undefined) changes.categoryId = categoryId;
      if (unit !== undefined) changes.unitOfMeasure = unit;
      if (barcodes !== undefined) changes.barcodes = barcodes;
      if (input.isActive !== undefined) changes.isActive = input.isActive;
      product.updateDetails(changes);
      await this.repository.save(product);
      await this.outboxStore?.enqueue(toBusinessEvents([toProductPublication(product, {
        eventId: this.idGenerator.generate(), occurredAt: now
      })], context));
      const dto = toProductDto(product);
      if (this.auditWriter) await this.auditWriter.append([{
        auditId: this.idGenerator.generate(), actorId: context.actorId,
        actorRoleCodes: context.actorRoleCodes ?? [], action: 'CATALOG_PRODUCT_UPDATED',
        entityType: 'Product', entityId: product.id,
        before: JSON.parse(JSON.stringify(before)) as JsonValue,
        after: JSON.parse(JSON.stringify(dto)) as JsonValue, reason: input.reason,
        terminalId: context.terminalId, originNodeId: context.originNodeId,
        occurredAt: now, correlationId: context.correlationId
      }]);
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
