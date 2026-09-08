import { ApplicationError, err, type AppError, type Result } from '@supermarket/shared';
import type { FiscalDocumentContent } from '../../domain/fiscal/index.js';
import type { Sale } from '../../domain/sales/index.js';
import type { ExecutionContext } from '../execution-context.js';
import type { FiscalDocumentDto, IssueFiscalDocumentInput } from '../fiscal/index.js';
import type { AuthorizationService, SaleRepository } from '../ports/index.js';
import { FISCAL_PERMISSIONS } from '../fiscal/index.js';
import type { IssueSaleInvoiceInput } from './dtos.js';

/**
 * Emisor del documento. La venta no habla con la impresora ni con el
 * repositorio fiscal: delega en el caso de uso dueño de esa responsabilidad,
 * que conserva la evidencia recuperable en sus cuatro ejes y exige el permiso
 * `fiscal.document.issue`.
 */
export type FiscalDocumentIssuer = {
  execute(
    input: IssueFiscalDocumentInput,
    context: ExecutionContext
  ): Promise<Result<FiscalDocumentDto, AppError>>;
};

/**
 * Traduce la venta completada al contenido del documento. El precio unitario y
 * la tasa provienen del snapshot congelado en la línea, no del catálogo
 * vigente: cambiar un precio después no reescribe una factura ya emitida.
 */
const toInvoiceContent = (sale: Sale): FiscalDocumentContent => ({
  referenceId: sale.id,
  type: 'INVOICE',
  currencyCode: sale.currencyCode,
  lines: sale.items.map((item) => ({
    id: item.id,
    description: item.snapshot.description,
    quantityScaled: item.quantity.scaledValue,
    quantityScale: item.quantity.scale,
    unitPriceMinorUnits: item.snapshot.price.minorUnits,
    taxRateBasisPoints: item.snapshot.taxRate.basisPoints,
    totalMinorUnits: item.total.minorUnits
  })),
  payments: sale.payments.map((payment) => ({
    methodCode: payment.method.code,
    amountMinorUnits: payment.amount.minorUnits
  })),
  totalMinorUnits: sale.total.minorUnits,
  recipient: sale.recipient
});

/**
 * Emite la factura de una venta ya completada. Es un comando propio y no un
 * paso de `CompleteSale`: un timeout de la impresora no puede revertir un cobro
 * que ya está asentado en el turno, y el documento conserva su reintento
 * explícito. La devolución depende de que exista este documento emitido, porque
 * la nota de crédito se deriva de su contenido.
 */
export class IssueSaleInvoice {
  constructor(
    private readonly repository: SaleRepository,
    private readonly issuer: FiscalDocumentIssuer,
    private readonly authorization: AuthorizationService
  ) {}

  async execute(
    input: IssueSaleInvoiceInput,
    context: ExecutionContext
  ): Promise<Result<FiscalDocumentDto, AppError>> {
    /**
     * El permiso se exige antes de leer la venta, aunque el emisor vuelva a
     * exigirlo: consultarlo después convertía la falta de autorización en un
     * `SALE_NOT_FOUND` que revelaba si la venta existe y no dejaba la evidencia
     * auditable de la denegación.
     */
    if (!(await this.authorization.authorize(context, FISCAL_PERMISSIONS.ISSUE_DOCUMENT))) {
      return err(new ApplicationError(
        'FORBIDDEN', 'Actor is not authorized to issue fiscal documents.'
      ));
    }
    const sale = await this.repository.findById(input.saleId);
    if (sale === null || sale.terminalId !== context.terminalId ||
      sale.originNodeId !== context.originNodeId) {
      return err(new ApplicationError('SALE_NOT_FOUND', 'Sale was not found.'));
    }
    if (sale.status !== 'COMPLETED') {
      return err(new ApplicationError(
        'SALE_INVALID_STATE', 'Only a completed sale can be invoiced.'
      ));
    }
    return this.issuer.execute(
      { content: toInvoiceContent(sale), reason: input.reason }, context
    );
  }
}
