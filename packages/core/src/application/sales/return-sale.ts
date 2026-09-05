import {
  ApplicationError,
  DomainError,
  err,
  Money,
  ok,
  Quantity,
  type AppError,
  type Result
} from '@supermarket/shared';
import { FiscalDocument } from '../../domain/fiscal/index.js';
import type { StockItem, StockMovement } from '../../domain/inventory/index.js';
import { SaleReturn, type Sale, type SaleReturnLine } from '../../domain/sales/index.js';
import type { ExecutionContext } from '../execution-context.js';
import { persistBusinessChange } from '../events/index.js';
import type { JsonValue } from '../events/index.js';
import { executeIdempotentCommand } from '../idempotency/index.js';
import type {
  AuditEntry,
  AuditWriter,
  AuthorizationService,
  BusinessEventStore,
  Clock,
  FiscalDocumentRepository,
  FiscalPrinterPort,
  IdGenerator,
  IdempotencyStore,
  OutboxStore,
  SaleRepository,
  SaleReturnRepository,
  ShiftRepository,
  StockItemRepository,
  UnitOfWork
} from '../ports/index.js';
import type { ReturnSaleInput, SaleReturnDto } from './dtos.js';
import { toSaleReturnDto } from './mappers.js';
import { SALE_PERMISSIONS } from './permissions.js';

/**
 * Reposición planificada de una salida de venta. Cada entrada corresponde a un
 * movimiento `SALE_ISSUE` original y conserva su lote y su costo congelado: la
 * devolución restituye exactamente lo que salió, no un promedio posterior
 * (ADR-0016 y ADR-0017).
 */
type Restoration = {
  readonly item: StockItem;
  readonly saleItemId: string;
  readonly productId: string;
  readonly batchId: string | null;
  readonly quantity: Quantity;
  readonly unitCost: Money | null;
};

export class ReturnSale {
  constructor(
    private readonly saleRepository: SaleRepository,
    private readonly saleReturnRepository: SaleReturnRepository,
    private readonly fiscalDocumentRepository: FiscalDocumentRepository,
    private readonly shiftRepository: ShiftRepository,
    private readonly stockItemRepository: StockItemRepository,
    private readonly printer: FiscalPrinterPort,
    private readonly authorization: AuthorizationService,
    private readonly returnIdGenerator: IdGenerator,
    private readonly movementIdGenerator: IdGenerator,
    private readonly documentIdGenerator: IdGenerator,
    private readonly eventIdGenerator: IdGenerator,
    private readonly auditIdGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
    private readonly eventStore: BusinessEventStore,
    private readonly outboxStore: OutboxStore,
    private readonly auditWriter: AuditWriter,
    private readonly idempotencyStore?: IdempotencyStore
  ) {}

  async execute(
    input: ReturnSaleInput,
    context: ExecutionContext
  ): Promise<Result<SaleReturnDto, AppError>> {
    if (!(await this.authorization.authorize(context, SALE_PERMISSIONS.RETURN))) {
      return err(new ApplicationError('FORBIDDEN', 'Actor is not authorized to return sales.'));
    }
    const reason = input.reason.trim();
    if (!reason) {
      return err(new ApplicationError('SALE_RETURN_REASON_REQUIRED', 'Sale return reason is required.'));
    }
    try {
      /**
       * La intención comercial, la caja, el inventario, el ledger, el outbox,
       * la auditoría y el estado fiscal inicial se confirman juntos. La
       * impresión simulada ocurre después, con las transiciones de evidencia
       * ya definidas, para que un fallo no repita efectos comerciales.
       */
      const registered = await executeIdempotentCommand({
        operation: 'ReturnSale',
        input,
        context,
        now: this.clock.now(),
        unitOfWork: this.unitOfWork,
        ...(this.idempotencyStore ? { idempotencyStore: this.idempotencyStore } : {}),
        execute: () => this.registerReturn(input, reason, context),
        serialize: (output) => JSON.parse(JSON.stringify(output)) as JsonValue,
        restore: (value) => {
          const dto = value as unknown as SaleReturnDto & { occurredAt: string };
          return { ...dto, occurredAt: new Date(dto.occurredAt) };
        }
      });
      if (!registered.ok) return registered;
      return await this.issueCreditNote(registered.value, reason, context);
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
  }

  private async registerReturn(
    input: ReturnSaleInput,
    reason: string,
    context: ExecutionContext
  ): Promise<Result<SaleReturnDto, AppError>> {
    const sale = await this.saleRepository.findById(input.saleId);
    if (sale === null || sale.terminalId !== context.terminalId ||
      sale.originNodeId !== context.originNodeId) {
      return err(new ApplicationError('SALE_NOT_FOUND', 'Sale was not found.'));
    }
    if (sale.status !== 'COMPLETED') {
      return err(new ApplicationError('SALE_INVALID_STATE', 'Only a completed sale can be returned.'));
    }
    if (sale.payments.length !== 1) {
      return err(new ApplicationError(
        'SALE_RETURN_MIXED_PAYMENT_UNSUPPORTED',
        'A sale settled with more than one payment cannot be returned in this release.'
      ));
    }
    if (await this.saleReturnRepository.findBySaleId(sale.id)) {
      return err(new ApplicationError('SALE_ALREADY_RETURNED', 'This sale was already returned.'));
    }
    const original = await this.fiscalDocumentRepository.findByReference(
      context.originNodeId, 'INVOICE', sale.id
    );
    if (original === null || original.status !== 'ISSUED') {
      return err(new ApplicationError(
        'SALE_RETURN_DOCUMENT_NOT_ISSUED',
        'The original fiscal document is not issued.'
      ));
    }
    const saleShift = await this.shiftRepository.findById(sale.shiftId);
    const shift = saleShift === null
      ? null
      : await this.shiftRepository.findOpenByCashRegisterId(saleShift.cashRegisterId);
    if (shift === null || shift.status !== 'OPEN' ||
      shift.terminalId !== context.terminalId || shift.originNodeId !== context.originNodeId) {
      return err(new ApplicationError('SHIFT_NOT_OPEN', 'An open shift is required to refund a sale.'));
    }
    const planned = await this.planRestorations(sale);
    if (!planned.ok) return planned;

    const now = this.clock.now();
    const payment = sale.payments[0]!;
    const saleReturnId = this.returnIdGenerator.generate();
    const creditNoteId = this.documentIdGenerator.generate();
    const lines: SaleReturnLine[] = planned.value.map((restoration, index) => ({
      id: `${saleReturnId}:${index}`,
      saleItemId: restoration.saleItemId,
      productId: restoration.productId,
      stockItemId: restoration.item.id,
      batchId: restoration.batchId,
      quantity: restoration.quantity,
      unitCost: restoration.unitCost
    }));
    const saleReturn = SaleReturn.register({
      id: saleReturnId,
      saleId: sale.id,
      originalDocumentId: original.id,
      creditNoteId,
      shiftId: shift.id,
      refund: payment.amount,
      paymentMethodCode: payment.method.code,
      reason,
      actorId: context.actorId,
      terminalId: context.terminalId,
      originNodeId: context.originNodeId,
      occurredAt: now,
      eventId: this.eventIdGenerator.generate(),
      lines
    });

    const changedItems = new Map<string, StockItem>();
    const stockEvents = [];
    for (const [index, restoration] of planned.value.entries()) {
      const item = restoration.item;
      const beforeEvents = item.domainEvents.length;
      item.registerMovement({
        id: `${saleReturnId}:${index}`,
        /**
         * `stock_movements.type` tiene un `check` que solo admite los cinco
         * tipos originales. Un tipo `SALE_RETURN` obligaría a recrear una
         * tabla append-only, así que la reposición usa `ADJUSTMENT_IN` con la
         * referencia de la devolución, igual que el reverso de 9B.04.
         */
        type: 'ADJUSTMENT_IN',
        quantity: restoration.quantity,
        ...(restoration.batchId ? { batchId: restoration.batchId } : {}),
        actorId: context.actorId,
        reason,
        referenceId: saleReturnId,
        occurredAt: now,
        eventId: this.eventIdGenerator.generate(),
        ...(restoration.unitCost ? { unitCost: restoration.unitCost } : {})
      });
      stockEvents.push(...item.domainEvents.slice(beforeEvents));
      changedItems.set(item.id, item);
    }

    const beforeShiftEvents = shift.domainEvents.length;
    shift.registerMovement({
      id: `${saleReturnId}:refund`,
      type: 'SALE_REFUND',
      method: payment.method,
      amount: payment.amount,
      reason,
      registeredBy: context.actorId,
      terminalId: context.terminalId,
      originNodeId: context.originNodeId,
      occurredAt: now,
      eventId: this.eventIdGenerator.generate(),
      reference: { sourceId: saleReturnId, sourceEventId: saleReturn.domainEvents[0]!.eventId }
    });

    const creditNote = FiscalDocument.create({
      id: creditNoteId,
      content: { ...original.content, type: 'CREDIT_NOTE' },
      idempotencyKey: `sale-return:${saleReturnId}`,
      requestFingerprint: JSON.stringify({ saleId: sale.id, saleReturnId }),
      terminalId: context.terminalId,
      originNodeId: context.originNodeId,
      createdBy: context.actorId,
      createdAt: now,
      eventId: this.eventIdGenerator.generate()
    });

    const audit: AuditEntry = {
      auditId: this.auditIdGenerator.generate(),
      actorId: context.actorId,
      actorRoleCodes: context.actorRoleCodes ?? [],
      action: 'SALE_RETURNED',
      entityType: 'SaleReturn',
      entityId: saleReturnId,
      before: null,
      /**
       * La auditoría explica la operación sin copiar al receptor: su
       * identificación vive en la venta y en el documento (ADR-0018).
       */
      after: {
        saleId: sale.id,
        originalDocumentId: original.id,
        creditNoteId,
        shiftId: shift.id,
        refundMinorUnits: payment.amount.minorUnits,
        currencyCode: payment.amount.currency,
        paymentMethodCode: payment.method.code,
        lineCount: lines.length
      },
      reason,
      terminalId: context.terminalId,
      originNodeId: context.originNodeId,
      occurredAt: now,
      correlationId: context.correlationId
    };

    await persistBusinessChange(
      async () => {
        await this.fiscalDocumentRepository.save(creditNote);
        await this.saleReturnRepository.save(saleReturn);
        for (const item of changedItems.values()) await this.stockItemRepository.save(item);
        await this.shiftRepository.save(shift);
      },
      [
        ...saleReturn.domainEvents,
        ...stockEvents,
        ...shift.domainEvents.slice(beforeShiftEvents),
        ...creditNote.domainEvents
      ],
      context,
      undefined,
      this.eventStore,
      this.outboxStore,
      ['SaleReturned'],
      this.auditWriter,
      [audit]
    );
    return ok(toSaleReturnDto(saleReturn, creditNote));
  }

  /**
   * Reconstruye la salida original a partir de los movimientos persistidos.
   * Falla cerrada si un artículo no existe o si las salidas registradas no
   * explican exactamente la cantidad vendida.
   */
  private async planRestorations(sale: Sale): Promise<Result<Restoration[], AppError>> {
    const restorations: Restoration[] = [];
    const items = new Map<string, StockItem>();
    for (const saleItem of sale.items) {
      const item = items.get(saleItem.snapshot.productId) ??
        await this.stockItemRepository.findByProductId(saleItem.snapshot.productId);
      if (item === null) {
        return err(new ApplicationError('STOCK_ITEM_NOT_FOUND', 'Stock item was not found.'));
      }
      items.set(saleItem.snapshot.productId, item);
      const issues = item.movements.filter((movement: StockMovement) =>
        movement.type === 'SALE_ISSUE' && movement.referenceId.endsWith(`:${saleItem.id}`));
      const issued = issues.reduce((total, movement) => total + movement.quantity.scaledValue, 0);
      if (issues.length === 0 || issued !== saleItem.quantity.scaledValue ||
        issues.some((movement) => movement.quantity.scale !== saleItem.quantity.scale)) {
        return err(new ApplicationError(
          'SALE_RETURN_STOCK_NOT_RESTORABLE',
          'The original stock issue cannot be restored unambiguously.'
        ));
      }
      const grouped = new Map<string, Restoration>();
      for (const issue of issues) {
        const unitCostKey = issue.unitCost
          ? `${issue.unitCost.currency}:${issue.unitCost.minorUnits}` : '';
        const key = `${issue.batchId ?? ''}:${unitCostKey}`;
        const existing = grouped.get(key);
        if (existing) {
          grouped.set(key, { ...existing, quantity: existing.quantity.add(issue.quantity) });
        } else {
          grouped.set(key, {
            item,
            saleItemId: saleItem.id,
            productId: saleItem.snapshot.productId,
            batchId: issue.batchId,
            quantity: Quantity.fromScaled(issue.quantity.scaledValue, issue.quantity.scale),
            unitCost: issue.unitCost
          });
        }
      }
      restorations.push(...grouped.values());
    }
    return ok(restorations);
  }

  /**
   * Conserva las transiciones de evidencia ya definidas para un documento:
   * una nota ya emitida no se reimprime y un estado intermedio exige
   * reconciliación en vez de un segundo intento ciego.
   */
  private async issueCreditNote(
    dto: SaleReturnDto,
    reason: string,
    context: ExecutionContext
  ): Promise<Result<SaleReturnDto, AppError>> {
    const document = await this.fiscalDocumentRepository.findById(dto.creditNoteId);
    if (document === null) {
      return err(new ApplicationError('FISCAL_DOCUMENT_NOT_FOUND', 'Credit note was not found.'));
    }
    if (document.status === 'ISSUED') {
      return ok({ ...dto, creditNoteStatus: document.status, creditNoteFiscalNumber: document.fiscalNumber });
    }
    if (document.status === 'PRINTING' || document.status === 'ERROR') {
      return err(new ApplicationError(
        'FISCAL_RECONCILIATION_REQUIRED',
        'Fiscal document state must be reconciled before another print attempt.'
      ));
    }
    if (document.status === 'FAILED') {
      return err(new ApplicationError('FISCAL_DOCUMENT_FAILED', 'Fiscal document requires intervention.'));
    }

    let cursor = document.domainEvents.length;
    document.startPrinting({
      actorId: context.actorId,
      occurredAt: this.clock.now(),
      eventId: this.eventIdGenerator.generate()
    });
    await this.persistDocument(document, cursor, context);

    const printed = await this.printer.printCreditNote(document.content);
    cursor = document.domainEvents.length;
    if (printed.ok) {
      document.markIssued({
        fiscalNumber: printed.value.fiscalNumber,
        evidence: printed.value.evidence,
        actorId: context.actorId,
        occurredAt: printed.value.confirmedAt,
        eventId: this.eventIdGenerator.generate()
      });
    } else {
      document.recordError({
        ...printed.error,
        actorId: context.actorId,
        occurredAt: this.clock.now(),
        eventId: this.eventIdGenerator.generate()
      });
    }
    await this.persistDocument(
      document,
      cursor,
      context,
      reason,
      printed.ok ? 'SALE_RETURN_CREDIT_NOTE_ISSUED' : 'SALE_RETURN_CREDIT_NOTE_ERROR_RECORDED'
    );
    if (!printed.ok) return err(new ApplicationError(printed.error.code, printed.error.message));
    return ok({
      ...dto,
      creditNoteStatus: document.status,
      creditNoteFiscalNumber: document.fiscalNumber
    });
  }

  private persistDocument(
    document: FiscalDocument,
    cursor: number,
    context: ExecutionContext,
    reason?: string,
    action?: string
  ): Promise<void> {
    return persistBusinessChange(
      () => this.fiscalDocumentRepository.save(document),
      document.domainEvents.slice(cursor),
      context,
      this.unitOfWork,
      this.eventStore,
      this.outboxStore,
      ['FiscalDocumentIssued', 'FiscalDocumentFailed'],
      this.auditWriter,
      action && reason ? [{
        auditId: this.auditIdGenerator.generate(),
        actorId: context.actorId,
        actorRoleCodes: context.actorRoleCodes ?? [],
        action,
        entityType: 'FiscalDocument',
        entityId: document.id,
        before: null,
        after: {
          status: document.status,
          referenceId: document.content.referenceId,
          fiscalNumber: document.fiscalNumber,
          errorCode: document.lastErrorCode
        },
        reason,
        terminalId: context.terminalId,
        originNodeId: context.originNodeId,
        occurredAt: this.clock.now(),
        correlationId: context.correlationId
      }] : []
    );
  }
}
