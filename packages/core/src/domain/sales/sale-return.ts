import { DomainError, type Money, type Quantity } from '@supermarket/shared';

/**
 * Evidencia separada de una devolución total (ADR-0017). No modifica la venta
 * ni el documento fiscal originales: ambos siguen siendo inmutables y esta
 * raíz solo referencia sus identificadores y los snapshots que hacen falta
 * para reponer inventario con el lote y el costo que realmente salieron.
 */
export type SaleReturnLine = {
  readonly id: string;
  readonly saleItemId: string;
  readonly productId: string;
  readonly stockItemId: string;
  readonly batchId: string | null;
  readonly quantity: Quantity;
  readonly unitCost: Money | null;
};

export type SaleReturnEvent = {
  readonly type: 'SaleReturned';
  readonly eventId: string;
  readonly aggregateId: string;
  readonly aggregateType: 'SaleReturn';
  readonly aggregateVersion: number;
  readonly occurredAt: Date;
  readonly payload: Record<string, unknown>;
};

export type RegisterSaleReturnProps = {
  readonly id: string;
  readonly saleId: string;
  /**
   * `eventId` de la `SaleCompleted` que produjo la salida. Es la identidad con
   * la que el coordinador reconoce qué salió realmente y valida la restitución
   * contra sus propios movimientos (ADR-0026 D3).
   */
  readonly saleEventId: string;
  readonly originalDocumentId: string;
  readonly creditNoteId: string;
  readonly shiftId: string;
  readonly refund: Money;
  readonly paymentMethodCode: string;
  readonly reason: string;
  readonly actorId: string;
  readonly terminalId: string;
  readonly originNodeId: string;
  readonly occurredAt: Date;
  readonly eventId: string;
  readonly lines: readonly SaleReturnLine[];
};

export type RestoreSaleReturnProps = Omit<RegisterSaleReturnProps, 'eventId'>;

const required = (value: string, code: string, message: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new DomainError(code, message);
  return normalized;
};

const cloneLine = (line: SaleReturnLine): SaleReturnLine => ({ ...line });

export class SaleReturn {
  private readonly events: SaleReturnEvent[] = [];

  private constructor(
    readonly id: string,
    readonly saleId: string,
    readonly saleEventId: string,
    readonly originalDocumentId: string,
    readonly creditNoteId: string,
    readonly shiftId: string,
    readonly refund: Money,
    readonly paymentMethodCode: string,
    readonly reason: string,
    readonly actorId: string,
    readonly terminalId: string,
    readonly originNodeId: string,
    readonly occurredAt: Date,
    readonly lines: readonly SaleReturnLine[]
  ) {}

  private static build(props: RestoreSaleReturnProps): SaleReturn {
    if (props.lines.length === 0) {
      throw new DomainError('SALE_RETURN_LINES_REQUIRED', 'A sale return needs at least one line.');
    }
    if (props.refund.minorUnits <= 0) {
      throw new DomainError('SALE_RETURN_REFUND_INVALID', 'A sale return refund must be positive.');
    }
    if (Number.isNaN(props.occurredAt.getTime())) {
      throw new DomainError('SALE_RETURN_TIMESTAMP_INVALID', 'Sale return timestamp is invalid.');
    }
    const lineKeys = new Set<string>();
    const lines = props.lines.map((line) => {
      const saleItemId = required(
        line.saleItemId, 'SALE_RETURN_SALE_ITEM_REQUIRED', 'Sale return line needs its sale item.'
      );
      // Una venta puede haber salido de varios lotes por FEFO. En ese caso
      // conserva una línea por lote/costo; solo se rechaza duplicar la misma
      // evidencia de salida.
      const lineKey = `${saleItemId}:${line.batchId ?? ''}:${line.unitCost?.minorUnits ?? ''}:${line.unitCost?.currency ?? ''}`;
      if (lineKeys.has(lineKey)) {
        throw new DomainError('SALE_RETURN_LINE_DUPLICATED', 'Sale return line is duplicated.');
      }
      lineKeys.add(lineKey);
      if (line.quantity.scaledValue <= 0) {
        throw new DomainError('SALE_RETURN_QUANTITY_INVALID', 'Sale return quantity must be positive.');
      }
      return cloneLine({ ...line, saleItemId });
    });
    return new SaleReturn(
      required(props.id, 'SALE_RETURN_ID_REQUIRED', 'Sale return ID is required.'),
      required(props.saleId, 'SALE_RETURN_SALE_REQUIRED', 'Sale return needs its sale.'),
      props.saleEventId.trim(),
      required(props.originalDocumentId, 'SALE_RETURN_DOCUMENT_REQUIRED', 'Sale return needs its original document.'),
      required(props.creditNoteId, 'SALE_RETURN_CREDIT_NOTE_REQUIRED', 'Sale return needs its credit note.'),
      required(props.shiftId, 'SALE_RETURN_SHIFT_REQUIRED', 'Sale return needs the shift that refunds it.'),
      props.refund,
      required(props.paymentMethodCode, 'SALE_RETURN_PAYMENT_METHOD_REQUIRED', 'Sale return needs its payment method.'),
      required(props.reason, 'SALE_RETURN_REASON_REQUIRED', 'Sale return reason is required.'),
      required(props.actorId, 'SALE_RETURN_ACTOR_REQUIRED', 'Sale return actor is required.'),
      required(props.terminalId, 'SALE_RETURN_TERMINAL_REQUIRED', 'Sale return terminal is required.'),
      required(props.originNodeId, 'SALE_RETURN_NODE_REQUIRED', 'Sale return origin node is required.'),
      new Date(props.occurredAt),
      lines
    );
  }

  static register(props: RegisterSaleReturnProps): SaleReturn {
    /**
     * Una devolución nueva no se registra sin la salida que restituye. Las
     * anteriores a este contrato se restauran con la cadena vacía: conservan
     * su historia sin que se les invente una salida.
     */
    required(
      props.saleEventId,
      'SALE_RETURN_SALE_EVENT_REQUIRED',
      'Sale return needs the sale issue it restores.'
    );
    const saleReturn = SaleReturn.build(props);
    saleReturn.events.push({
      type: 'SaleReturned',
      eventId: required(props.eventId, 'SALE_RETURN_EVENT_ID_REQUIRED', 'Sale return event ID is required.'),
      aggregateId: saleReturn.id,
      aggregateType: 'SaleReturn',
      aggregateVersion: 1,
      occurredAt: saleReturn.occurredAt,
      /**
       * El ledger explica el hecho comercial sin copiar el receptor: la
       * identificación fiscal vive solo en la venta y en el documento
       * (ADR-0018), que son la fuente de verdad operativa.
       *
       * Las líneas transportan la restitución tomada de la salida original
       * —lote y costo incluidos, con `null` explícito cuando el costo era
       * desconocido— para que el coordinador reponga exactamente lo que salió
       * en vez de un promedio posterior (ADR-0026 D3 y D4).
       */
      payload: {
        saleId: saleReturn.saleId,
        saleEventId: saleReturn.saleEventId,
        originalDocumentId: saleReturn.originalDocumentId,
        creditNoteId: saleReturn.creditNoteId,
        shiftId: saleReturn.shiftId,
        terminalId: saleReturn.terminalId,
        refundMinorUnits: saleReturn.refund.minorUnits,
        currencyCode: saleReturn.refund.currency,
        paymentMethodCode: saleReturn.paymentMethodCode,
        reason: saleReturn.reason,
        lineCount: saleReturn.lines.length,
        lines: saleReturn.lines.map((line) => ({
          lineId: line.id,
          saleItemId: line.saleItemId,
          productId: line.productId,
          stockItemId: line.stockItemId,
          batchId: line.batchId,
          quantityScaled: line.quantity.scaledValue,
          quantityScale: line.quantity.scale,
          unitCost: line.unitCost === null
            ? null
            : { minorUnits: line.unitCost.minorUnits, currencyCode: line.unitCost.currency }
        }))
      }
    });
    return saleReturn;
  }

  static restore(props: RestoreSaleReturnProps): SaleReturn {
    return SaleReturn.build(props);
  }

  get domainEvents(): readonly SaleReturnEvent[] {
    return [...this.events];
  }
}
