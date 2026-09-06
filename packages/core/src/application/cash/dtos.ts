export type CashRegisterDto = {
  id: string;
  name: string;
};

export type CashBalanceInput = {
  paymentMethodCode: string;
  currencyCode: string;
  amountMinorUnits: number;
};

export type OpenShiftInput = {
  cashRegisterId: string;
  openingFunds: CashBalanceInput[];
};

export type RegisterCashMovementInput = {
  shiftId: string;
  type: 'INCOME' | 'WITHDRAWAL';
  paymentMethodCode: string;
  currencyCode: string;
  amountMinorUnits: number;
  reason: string;
};

export type CloseShiftInput = {
  shiftId: string;
  declaredBalances: CashBalanceInput[];
  /**
   * Motivo del cierre. Obligatorio cuando algún saldo esperado es negativo
   * (reintegro de una venta que este turno no cobró, ADR-0017 punto 8): el
   * cierre exige reconocimiento explícito y autorización de supervisor.
   */
  reason?: string;
};

export type CashMovementDto = {
  id: string;
  type: string;
  paymentMethodCode: string;
  currencyCode: string;
  amountMinorUnits: number;
  reason: string;
  registeredBy: string;
  registeredAt: Date;
};

export type CashBalanceDto = {
  paymentMethodCode: string;
  currencyCode: string;
  minorUnits: number;
};

export type ShiftClosingBalanceDto = {
  paymentMethodCode: string;
  currencyCode: string;
  expectedMinorUnits: number;
  declaredMinorUnits: number;
  differenceMinorUnits: number;
};

export type ShiftDto = {
  id: string;
  cashRegisterId: string;
  terminalId: string;
  originNodeId: string;
  status: string;
  version: number;
  openedBy: string;
  openedAt: Date;
  closedBy: string | null;
  closedAt: Date | null;
  movements: CashMovementDto[];
  expectedBalances: CashBalanceDto[];
  closingBalances: ShiftClosingBalanceDto[] | null;
};
