import {
  ApplicationError,
  err,
  ok,
  type AppError,
  type JsonObject,
  type JsonValue,
  type Result,
  type SyncEnvelopeV1
} from '@supermarket/shared';
import type {
  CommercialProjection,
  ProjectedMoney,
  ProjectedShiftBalance
} from '../ports/index.js';
import type { SyncConsumer } from './process-sync-inbox.js';

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: JsonValue | undefined): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const integer = (value: JsonValue | undefined): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;

const money = (value: JsonValue | undefined): ProjectedMoney | null => {
  if (!isObject(value)) return null;
  const minorUnits = integer(value.minorUnits);
  const currencyCode = text(value.currencyCode);
  return minorUnits === null || currencyCode === null
    ? null
    : { minorUnits, currencyCode };
};

const balances = (
  value: JsonValue | undefined,
  shape: 'OPENING' | 'CLOSING'
): readonly ProjectedShiftBalance[] | null => {
  if (!Array.isArray(value)) return null;
  const parsed: ProjectedShiftBalance[] = [];
  for (const entry of value) {
    if (!isObject(entry)) return null;
    const paymentMethodCode = text(entry.paymentMethodCode);
    if (paymentMethodCode === null) return null;
    if (shape === 'OPENING') {
      const declared = money(entry.amount);
      if (declared === null) return null;
      parsed.push({ paymentMethodCode, expected: null, declared, difference: null });
      continue;
    }
    const expected = money(entry.expected);
    const declared = money(entry.declared);
    const difference = money(entry.difference);
    if (expected === null || declared === null || difference === null) return null;
    parsed.push({ paymentMethodCode, expected, declared, difference });
  }
  return parsed;
};

const evidenceOf = (value: JsonValue | undefined) => {
  if (!isObject(value)) return null;
  const dispatchState = text(value.dispatchState);
  const commandEffect = text(value.commandEffect);
  const fiscalCommit = text(value.fiscalCommit);
  const printDelivery = text(value.printDelivery);
  return dispatchState === null || commandEffect === null ||
    fiscalCommit === null || printDelivery === null
    ? null
    : { dispatchState, commandEffect, fiscalCommit, printDelivery };
};

/**
 * Consolidación comercial del coordinador.
 *
 * Escribe proyecciones de lectura de ventas, caja y fiscalidad de sus
 * terminales. **No** invoca `CompleteSale`, `ReturnSale`, apertura o cierre de
 * turno ni la impresora, y no toca las tablas operativas del coordinador: un
 * hecho remoto no vuelve a ejecutar su efecto ni emite ningún documento.
 *
 * La versión de cada proyección es `aggregateVersion` del sobre, así que una
 * reentrega no duplica y un hecho atrasado no retrocede lo aplicado.
 */
export class CommercialProjectionConsumer implements SyncConsumer {
  constructor(private readonly projection: CommercialProjection) {}

  async apply(envelope: SyncEnvelopeV1): Promise<Result<'APPLIED', AppError>> {
    const payload = envelope.payload;
    const occurredAt = new Date(envelope.occurredAt);
    const version = envelope.aggregateVersion;

    switch (envelope.eventType) {
      case 'SaleCompleted': {
        const shiftId = text(payload.shiftId);
        const terminalId = text(payload.terminalId);
        const total = money(payload.total);
        const paidTotal = money(payload.paidTotal);
        const items = payload.items;
        if (shiftId === null || terminalId === null || total === null ||
          paidTotal === null || !Array.isArray(items)) {
          return this.invalid(envelope);
        }
        await this.projection.applySale({
          saleId: envelope.aggregateId,
          originNodeId: envelope.originNodeId,
          terminalId,
          shiftId,
          total,
          paidTotal,
          itemCount: items.length,
          version,
          occurredAt
        });
        return ok('APPLIED');
      }

      case 'SaleReturned': {
        const saleId = text(payload.saleId);
        const refundMinorUnits = integer(payload.refundMinorUnits);
        const currencyCode = text(payload.currencyCode);
        if (saleId === null || refundMinorUnits === null || currencyCode === null) {
          return this.invalid(envelope);
        }
        /**
         * Marca la devolución sobre la venta proyectada: no borra la venta ni
         * cambia sus totales originales, que siguen siendo el hecho ocurrido.
         */
        await this.projection.applySaleReturn({
          saleId,
          refund: { minorUnits: refundMinorUnits, currencyCode },
          occurredAt
        });
        return ok('APPLIED');
      }

      case 'ShiftOpened': {
        const cashRegisterId = text(payload.cashRegisterId);
        const terminalId = text(payload.terminalId);
        const openedBy = text(payload.openedBy);
        const opening = balances(payload.openingBalances, 'OPENING');
        if (cashRegisterId === null || terminalId === null ||
          openedBy === null || opening === null) {
          return this.invalid(envelope);
        }
        await this.projection.applyShiftOpening({
          shiftId: envelope.aggregateId,
          originNodeId: envelope.originNodeId,
          terminalId,
          cashRegisterId,
          openedBy,
          version,
          openedAt: occurredAt,
          balances: opening
        });
        return ok('APPLIED');
      }

      case 'ShiftClosed': {
        const closedBy = text(payload.closedBy);
        const closing = balances(payload.balances, 'CLOSING');
        if (closedBy === null || closing === null) return this.invalid(envelope);
        const applied = await this.projection.applyShiftClosure({
          shiftId: envelope.aggregateId,
          closedBy,
          version,
          closedAt: occurredAt,
          balances: closing
        });
        /** Sin la apertura proyectada espera: no inventa el turno ni lo descarta. */
        return applied === 'MISSING_SHIFT'
          ? err(new ApplicationError(
            'COMMERCIAL_PROJECTION_SHIFT_NOT_PROJECTED',
            'The shift opening has not been projected yet.'
          ))
          : ok('APPLIED');
      }

      case 'CashMovementRegistered': {
        const movementId = text(payload.movementId);
        const movementType = text(payload.movementType);
        const paymentMethodCode = text(payload.paymentMethodCode);
        const amount = money(payload.amount);
        const registeredBy = text(payload.registeredBy);
        const movementReference = payload.reference ?? null;
        const sourceId = isObject(movementReference) ? text(movementReference.sourceId) : null;
        if (movementId === null || movementType === null || paymentMethodCode === null ||
          amount === null || registeredBy === null) {
          return this.invalid(envelope);
        }
        await this.projection.applyCashMovement({
          movementId,
          shiftId: envelope.aggregateId,
          originNodeId: envelope.originNodeId,
          movementType: movementType as ProjectedMovementType,
          paymentMethodCode,
          amount,
          registeredBy,
          sourceId,
          occurredAt
        });
        return ok('APPLIED');
      }

      case 'FiscalDocumentIssued': {
        const fiscalNumber = text(payload.fiscalNumber);
        const referenceId = text(payload.referenceId);
        const evidence = evidenceOf(payload.evidence);
        if (fiscalNumber === null || referenceId === null || evidence === null) {
          return this.invalid(envelope);
        }
        await this.projection.applyFiscalEntry({
          entryId: envelope.aggregateId,
          originNodeId: envelope.originNodeId,
          kind: 'DOCUMENT_ISSUED',
          referenceId,
          fiscalNumber,
          errorCode: null,
          evidence,
          version,
          occurredAt
        });
        return ok('APPLIED');
      }

      case 'FiscalDocumentFailed': {
        await this.projection.applyFiscalEntry({
          entryId: envelope.aggregateId,
          originNodeId: envelope.originNodeId,
          kind: 'DOCUMENT_FAILED',
          referenceId: null,
          fiscalNumber: null,
          errorCode: payload.errorCode === null ? null : text(payload.errorCode),
          evidence: null,
          version,
          occurredAt
        });
        return ok('APPLIED');
      }

      case 'FiscalXReportIssued':
      case 'FiscalZReportIssued': {
        const reportId = text(payload.reportId);
        const reportNumber = text(payload.reportNumber);
        const evidence = evidenceOf(payload.evidence);
        if (reportId === null || reportNumber === null || evidence === null) {
          return this.invalid(envelope);
        }
        await this.projection.applyFiscalEntry({
          entryId: reportId,
          originNodeId: envelope.originNodeId,
          kind: envelope.eventType === 'FiscalXReportIssued' ? 'X_REPORT' : 'Z_REPORT',
          /** El día fiscal al que pertenece el reporte, no una venta. */
          referenceId: envelope.aggregateId,
          fiscalNumber: reportNumber,
          errorCode: null,
          evidence,
          version,
          occurredAt
        });
        return ok('APPLIED');
      }

      default:
        return err(new ApplicationError(
          'COMMERCIAL_PROJECTION_EVENT_UNSUPPORTED',
          'The commercial projection only consumes sales, cash and fiscal facts.'
        ));
    }
  }

  private invalid(envelope: SyncEnvelopeV1): Result<'APPLIED', AppError> {
    return err(new ApplicationError(
      'COMMERCIAL_PROJECTION_PAYLOAD_INVALID',
      'The commercial fact payload does not match its contract.',
      { details: { eventType: envelope.eventType } }
    ));
  }
}

type ProjectedMovementType =
  'OPENING_FLOAT' | 'INCOME' | 'WITHDRAWAL' | 'SALE_PAYMENT' | 'SALE_REFUND';
