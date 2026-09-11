export type PaymentMethodDto = {
  code: string;
  name: string;
  kind: 'CASH' | 'CARD' | 'MOBILE_PAYMENT' | 'BANK_TRANSFER' | 'OTHER';
  currencyCode: string;
  /** Tasa de IGTF que cobra este método; 0 si no está gravado. Ver ADR-0031. */
  financialTransactionTaxBasisPoints: number;
};

export type UpdateExchangeRateInput = {
  baseCurrency: string;
  quoteCurrency: string;
  rateValue: number;
  rateScale: number;
  source: string;
  validFrom: Date;
  validUntil?: Date | null;
  reason: string;
};

export type ExchangeRateDto = {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rateValue: number;
  rateScale: number;
  source: string;
  validFrom: Date;
  validUntil: Date | null;
  registeredBy: string;
};

export type ExchangeRateSuggestionDto = {
  baseCurrency: string;
  quoteCurrency: string;
  rateValue: number;
  rateScale: number;
  source: string;
  observedAt: Date;
  validFrom: Date | null;
  validUntil: Date | null;
};

export type MixedPaymentInput = {
  targetCurrency: string;
  payments: Array<{
    amountMinorUnits: number;
    currencyCode: string;
  }>;
};

export type MixedPaymentOutput = {
  totalMinorUnits: number;
  totalCurrency: string;
};
