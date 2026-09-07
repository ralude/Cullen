export type ProjectedMoney = {
  readonly minorUnits: number;
  readonly currencyCode: string;
};

export type ProjectedSale = {
  readonly saleId: string;
  readonly originNodeId: string;
  readonly terminalId: string;
  readonly shiftId: string;
  readonly total: ProjectedMoney;
  readonly paidTotal: ProjectedMoney;
  readonly itemCount: number;
  readonly version: number;
  readonly occurredAt: Date;
};

export type ProjectedSaleReturn = {
  readonly saleId: string;
  readonly refund: ProjectedMoney;
  readonly occurredAt: Date;
};

export type ProjectedShiftBalance = {
  readonly paymentMethodCode: string;
  readonly expected: ProjectedMoney | null;
  readonly declared: ProjectedMoney;
  readonly difference: ProjectedMoney | null;
};

export type ProjectedShiftOpening = {
  readonly shiftId: string;
  readonly originNodeId: string;
  readonly terminalId: string;
  readonly cashRegisterId: string;
  readonly openedBy: string;
  readonly version: number;
  readonly openedAt: Date;
  readonly balances: readonly ProjectedShiftBalance[];
};

export type ProjectedShiftClosure = {
  readonly shiftId: string;
  readonly closedBy: string;
  readonly version: number;
  readonly closedAt: Date;
  readonly balances: readonly ProjectedShiftBalance[];
};

export type ProjectedCashMovement = {
  readonly movementId: string;
  readonly shiftId: string;
  readonly originNodeId: string;
  readonly movementType:
    | 'OPENING_FLOAT' | 'INCOME' | 'WITHDRAWAL' | 'SALE_PAYMENT' | 'SALE_REFUND';
  readonly paymentMethodCode: string;
  readonly amount: ProjectedMoney;
  readonly registeredBy: string;
  readonly sourceId: string | null;
  readonly occurredAt: Date;
};

export type ProjectedFiscalEntry = {
  readonly entryId: string;
  readonly originNodeId: string;
  readonly kind: 'DOCUMENT_ISSUED' | 'DOCUMENT_FAILED' | 'X_REPORT' | 'Z_REPORT';
  readonly referenceId: string | null;
  readonly fiscalNumber: string | null;
  readonly errorCode: string | null;
  readonly evidence: {
    readonly dispatchState: string;
    readonly commandEffect: string;
    readonly fiscalCommit: string;
    readonly printDelivery: string;
  } | null;
  readonly version: number;
  readonly occurredAt: Date;
};

/**
 * Consolidación comercial del coordinador: ventas, caja y fiscalidad de sus
 * terminales, **para leer**.
 *
 * No importa los agregados ajenos ni vuelve a ejecutar sus efectos: no invoca
 * `CompleteSale`, `ReturnSale`, apertura o cierre de turno ni la impresora, y no
 * escribe en las tablas operativas del coordinador, porque mezclarlas duplicaría
 * totales. Un hecho remoto nunca emite ni reimprime un documento fiscal.
 *
 * Cada aplicación es idempotente por la identidad del agregado: una reentrega no
 * duplica filas y un hecho atrasado no retrocede la proyección.
 */
export interface CommercialProjection {
  applySale(sale: ProjectedSale): Promise<void>;
  applySaleReturn(entry: ProjectedSaleReturn): Promise<void>;
  applyShiftOpening(shift: ProjectedShiftOpening): Promise<void>;
  /**
   * `MISSING_SHIFT` cuando el cierre llega antes que su apertura: no se aplica
   * ni se descarta, y el consumidor lo deja esperando en lugar de inventar el
   * turno o darlo por proyectado.
   */
  applyShiftClosure(closure: ProjectedShiftClosure): Promise<'APPLIED' | 'STALE' | 'MISSING_SHIFT'>;
  applyCashMovement(movement: ProjectedCashMovement): Promise<void>;
  applyFiscalEntry(entry: ProjectedFiscalEntry): Promise<void>;
}
