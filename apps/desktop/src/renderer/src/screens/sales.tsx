import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CashRegisterResponse, PaymentMethodResponse, ProductResponse, SaleResponse, ShiftResponse
} from '@supermarket/shared';
import {
  applySaleDiscountContract, isPermissionGranted, issueSaleInvoiceContract, Money, returnSaleContract,
  TaxRate, voidSaleContract,
  type SaleReturnResponse, type SimulatedFiscalDocumentResponse
} from '@supermarket/shared';
import { ApiProblemError, createIdempotencyKey, formatScaledDecimal, parseMinorUnits } from '../api-client.js';
import {
  ACTIVE_CASH_REGISTER_KEY, ACTIVE_SALE_KEY, ActionButton, EmptyState, Feedback, Modal, ScreenNote,
  clearStorage, money, readStorage, writeStorage, type ScreenProps
} from './shared.js';

/**
 * Motivo por el que la venta todavía no puede completarse, o `null` cuando el
 * nodo aceptaría el cierre. Un botón deshabilitado siempre explica su causa.
 */
export const saleCompletionBlocker = (sale: SaleResponse | null, scale: number): string | null => {
  if (!sale || sale.status !== 'DRAFT') return null;
  if (sale.items.length === 0) return 'Agrega al menos una línea antes de completar la venta.';
  if (sale.balanceMinorUnits > 0) {
    return 'Falta cobrar ' + money(sale.balanceMinorUnits, sale.currencyCode, scale) +
      ' antes de completar la venta.';
  }
  if (sale.balanceMinorUnits < 0) {
    return 'El pago supera el total en ' + money(-sale.balanceMinorUnits, sale.currencyCode, scale) + '.';
  }
  return null;
};

/** Un pago capturado en la barra, todavía sin enviar al nodo. */
export type CapturedTender = {
  readonly methodCode: string;
  readonly methodName: string;
  readonly currencyCode: string;
  readonly amountMinorUnits: number;
  readonly financialTransactionTaxBasisPoints: number;
};

/** Lo que la barra de cobro muestra mientras el cajero arma el lote. */
export type CheckoutProjection = {
  /** IGTF que los pagos capturados ya contienen. */
  readonly taxMinorUnits: number;
  /** Comercial más ese impuesto: el total sube al entrar un pago gravado. */
  readonly totalMinorUnits: number;
  readonly tenderedMinorUnits: number;
  /** Porción comercial que falta cubrir, sin impuesto. */
  readonly remainingMinorUnits: number;
  /** Importe que se precarga para el método elegido. */
  readonly suggestedAmountMinorUnits: number;
};

/**
 * Proyecta el cobro que el cajero está armando: cuánto impuesto contienen los
 * pagos capturados, cuánto falta y qué precargar para el siguiente.
 *
 * **Es una sugerencia, no una autoridad.** El nodo recalcula el impuesto del
 * lote recibido y rechaza lo que no cuadre; ver la enmienda de ADR-0031 del
 * 2026-09-11. De ella salen las dos reglas que esta función respeta:
 *
 * 1. el impuesto se extrae de la **suma** de lo entregado con métodos
 *    gravados, no pago por pago, de modo que en todo el cobro ocurre un solo
 *    redondeo: con dos pagos gravados, redondear cada uno por su cuenta
 *    entrega una unidad menor de más y el nodo rechaza el lote;
 * 2. un método que liquida en otra moneda no recibe sugerencia, porque
 *    convertir exige una tasa explícita que la pantalla todavía no envía
 *    (D-001).
 *
 * Todos los métodos gravados comparten la tasa de la única política activa, así
 * que basta la del primero para reconstruir lo ya capturado.
 */
export const projectCheckout = (
  commercialTotalMinorUnits: number,
  saleCurrencyCode: string,
  tenders: readonly CapturedTender[],
  nextMethod: PaymentMethodResponse | undefined
): CheckoutProjection => {
  const taxed = tenders.filter((tender) => tender.financialTransactionTaxBasisPoints > 0);
  const taxedGross = taxed.reduce((total, tender) => total + tender.amountMinorUnits, 0);
  const tendered = tenders.reduce((total, tender) => total + tender.amountMinorUnits, 0);
  const capturedRate = taxed[0]?.financialTransactionTaxBasisPoints ?? 0;
  const tax = capturedRate > 0 && taxedGross > 0
    ? TaxRate.fromBasisPoints(capturedRate)
      .extractFrom(Money.fromMinorUnits(taxedGross, saleCurrencyCode)).minorUnits
    : 0;
  const taxedBase = taxedGross - tax;
  const remaining = commercialTotalMinorUnits - (tendered - taxedGross) - taxedBase;
  const suggests = nextMethod !== undefined &&
    nextMethod.financialTransactionTaxBasisPoints > 0 &&
    nextMethod.currencyCode === saleCurrencyCode;
  const suggested = remaining <= 0 || !suggests
    ? Math.max(remaining, 0)
    : TaxRate.fromBasisPoints(nextMethod.financialTransactionTaxBasisPoints)
      .includeIn(Money.fromMinorUnits(taxedBase + remaining, saleCurrencyCode)).minorUnits - taxedGross;

  return {
    taxMinorUnits: tax,
    totalMinorUnits: commercialTotalMinorUnits + tax,
    tenderedMinorUnits: tendered,
    remainingMinorUnits: remaining,
    suggestedAmountMinorUnits: suggested
  };
};

/**
 * Importe escrito en la barra, o `0` mientras no sea un número que el nodo
 * aceptaría. La barra no rechaza lo que el cajero teclea: deshabilita la
 * acción hasta que hay un importe.
 */
const typedAmount = (value: string, scale: number): number => {
  try { return parseMinorUnits(value, scale); } catch { return 0; }
};

/**
 * Identidad legible del turno en curso: la caja que lo abrió y la hora en que
 * lo hizo. El cajero reconoce su puesto, no un UUID, y la pantalla ya no
 * presenta el `shiftId` como si fuera un dato que él deba escribir.
 */
export const activeShiftLabel = (
  shift: ShiftResponse | null, registerName: string | null
): string | null => {
  if (!shift || shift.status !== 'OPEN') return null;
  const opened = new Date(shift.openedAt);
  const time = Number.isNaN(opened.getTime())
    ? shift.openedAt
    : opened.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  return (registerName ?? 'Caja') + ' · turno abierto ' + time;
};

export const SalesScreen = ({ api, permissionCodes }: ScreenProps): React.JSX.Element => {
  const [sale, setSale] = useState<SaleResponse | null>(null);
  const [shift, setShift] = useState<ShiftResponse | null>(null);
  const [cashRegister, setCashRegister] = useState<CashRegisterResponse | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [currencyScale, setCurrencyScale] = useState('2');
  const [barcode, setBarcode] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogProducts, setCatalogProducts] = useState<readonly ProductResponse[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [paymentMethodCode, setPaymentMethodCode] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [tenders, setTenders] = useState<readonly CapturedTender[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<readonly PaymentMethodResponse[]>([]);
  const [discountItemId, setDiscountItemId] = useState('');
  const [discountBasisPoints, setDiscountBasisPoints] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [recipientCountry, setRecipientCountry] = useState('VE');
  const [recipientValue, setRecipientValue] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [saleReturn, setSaleReturn] = useState<SaleReturnResponse | null>(null);
  const [invoice, setInvoice] = useState<SimulatedFiscalDocumentResponse['document'] | null>(null);
  const [voidConfirming, setVoidConfirming] = useState(false);
  /**
   * Receptor, descuento y anulación son acciones ocasionales. Vivían como
   * paneles fijos en la columna del ticket y empujaban el botón de completar
   * fuera de la vista, de modo que cerrar una venta ya cobrada exigía bajar.
   * Ahora se abren cuando hacen falta.
   */
  const [dialog, setDialog] = useState<'recipient' | 'discount' | 'void' | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const barcodeInput = useRef<HTMLInputElement>(null);
  const scale = Number(currencyScale) || 2;
  const refresh = useCallback(async (saleId: string): Promise<void> => {
    try {
      const current = await api.getSale(saleId);
      if (current.status === 'DRAFT') setSale(current);
      else { setSale(null); clearStorage(ACTIVE_SALE_KEY); }
    } catch (nextError) {
      setSale(null); clearStorage(ACTIVE_SALE_KEY);
      if (nextError instanceof ApiProblemError && nextError.problem.code !== 'SALE_NOT_FOUND') setError(nextError);
    }
  }, [api]);
  useEffect(() => { const savedId = readStorage(ACTIVE_SALE_KEY); if (savedId) void refresh(savedId); }, [refresh]);
  /**
   * El turno lo resuelve el nodo a partir de la caja de la estación, nunca una
   * copia en el navegador: `GET /cash-registers/:id/shift` es la autoridad y un
   * turno cerrado desaparece de esta pantalla sin que nadie tenga que borrarlo.
   * Sin caja recordada, una única caja registrada se toma como la de la estación.
   */
  const resolveShift = useCallback(async (): Promise<void> => {
    setShiftLoading(true);
    const registers = await api.listCashRegisters().catch(() => [] as readonly CashRegisterResponse[]);
    const remembered = readStorage(ACTIVE_CASH_REGISTER_KEY);
    const register = registers.find((candidate) => candidate.id === remembered)
      ?? (registers.length === 1 ? registers[0] : undefined);
    setCashRegister(register ?? null);
    const registerId = register?.id ?? remembered;
    if (!registerId) { setShift(null); setShiftLoading(false); return; }
    try {
      const open = await api.getOpenShift(registerId);
      setShift(open.status === 'OPEN' ? open : null);
    } catch (nextError) {
      setShift(null);
      if (!(nextError instanceof ApiProblemError && nextError.problem.code === 'SHIFT_NOT_FOUND')) {
        setError(nextError);
      }
    } finally { setShiftLoading(false); }
  }, [api]);
  useEffect(() => { void resolveShift(); }, [resolveShift]);
  /** Precarga efectivo como método sugerido, sin impedir elegir otro. */
  useEffect(() => {
    void api.listPaymentMethods().then((methods) => {
      setPaymentMethods(methods);
      setPaymentMethodCode((current) => current || methods.find((method) => method.kind === 'CASH')?.code || methods[0]?.code || '');
    }).catch(() => undefined);
  }, [api]);
  /**
   * El catálogo acelera la selección manual, pero no sustituye al lector ni es
   * autoridad de la línea: al pulsar una tarjeta se envía su barcode y la venta
   * completa vuelve desde el nodo con importes e impuestos recalculados.
   */
  const loadCatalog = useCallback(async (query: string): Promise<void> => {
    setCatalogLoading(true); setCatalogFailed(false);
    try {
      const products = await api.listProducts(query);
      setCatalogProducts(products.filter((product) => product.isActive && product.barcodes.length > 0));
    } catch {
      setCatalogProducts([]); setCatalogFailed(true);
    } finally { setCatalogLoading(false); }
  }, [api]);
  useEffect(() => { void loadCatalog(''); }, [loadCatalog]);
  const paymentMethod = paymentMethods.find((method) => method.code === paymentMethodCode);
  const paymentCurrency = paymentMethod?.currencyCode ?? '';
  const outstanding = sale?.status === 'DRAFT' ? sale.balanceMinorUnits : 0;
  /**
   * Porción comercial de la venta: el total que el nodo devuelve menos el IGTF
   * que ya haya asentado. Mientras el lote no se registra, el impuesto vale
   * cero y las dos cifras coinciden.
   */
  const commercialOutstanding = outstanding - (sale?.financialTransactionTaxMinorUnits ?? 0);
  const checkout = projectCheckout(
    commercialOutstanding, sale?.currencyCode ?? '', tenders, paymentMethod
  );
  const suggestedAmount = checkout.suggestedAmountMinorUnits;
  /**
   * Precarga el importe sugerido cada vez que el nodo recalcula el saldo, el
   * cajero cambia de método o agrega un pago. Lo que él escriba después se
   * conserva: escribir no mueve ninguna de estas dependencias.
   */
  useEffect(() => {
    if (suggestedAmount > 0) setPaymentAmount(formatScaledDecimal(suggestedAmount, scale));
  }, [suggestedAmount, scale]);
  const intentKey = (intent: string): string => {
    const storageKey = 'supermarket.sale-intent.' + intent;
    const saved = readStorage(storageKey);
    if (saved) return saved;
    const next = createIdempotencyKey();
    writeStorage(storageKey, next);
    return next;
  };
  const dismissFeedback = (): void => { setError(null); setNotice(null); };
  /** Devuelve la venta actualizada, o `null` si la accion fallo: quien llama decide que limpiar. */
  const run = async (action: () => Promise<SaleResponse>, success: string, intent: string): Promise<SaleResponse | null> => {
    setLoading(true); setError(null); setNotice(null);
    try {
      const next = await action(); setSale(next);
      if (next.status === 'DRAFT') writeStorage(ACTIVE_SALE_KEY, next.id); else clearStorage(ACTIVE_SALE_KEY);
      clearStorage('supermarket.sale-intent.' + intent);
      setNotice(success);
      return next;
    } catch (nextError) { setError(nextError); return null; } finally { setLoading(false); }
  };
  const focusBarcode = (): void => { barcodeInput.current?.focus(); barcodeInput.current?.select(); };
  const start = (): void => {
    if (!shift) { setError(new Error('SHIFT_REQUIRED')); return; }
    const intent = 'start-' + shift.id + '-' + currencyCode.trim().toUpperCase();
    void run(() => api.startSale({ shiftId: shift.id, currencyCode: currencyCode.trim().toUpperCase() }, intentKey(intent)), 'Venta iniciada.', intent)
      .then((next) => { if (next) focusBarcode(); });
  };
  /**
   * Busca el producto para tomar su escala de cantidad — la única que el
   * dominio acepta — y solo entonces agrega la línea. Un barcode rechazado
   * conserva el campo y devuelve el foco; vaciarlo siempre hacía que pareciera
   * una acción sin efecto ni causa visible.
   */
  const appendProduct = async (product: ProductResponse, scanned: string): Promise<SaleResponse | null> => {
    if (!sale) return null;
    const quantityScaled = parseMinorUnits(quantity, product.unitScale);
    const intent = 'add-' + scanned + '-' + quantityScaled + '-' + product.unitScale;
    return run(
      () => api.addSaleItem(
        sale.id, { barcode: scanned, quantityScaled, quantityScale: product.unitScale }, intentKey(intent)
      ),
      'Producto agregado al ticket.', intent
    );
  };
  const markProductAdded = (next: SaleResponse): void => {
    setQuantity('1');
    setHighlightedItemId(next.items[next.items.length - 1]?.id ?? null);
  };
  const addItem = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault(); if (!sale) return;
    const scanned = barcode.trim();
    if (!scanned) { focusBarcode(); return; }
    void (async () => {
      setLoading(true); setError(null); setNotice(null);
      try {
        const { product } = await api.findProductByBarcode(scanned);
        const next = await appendProduct(product, scanned);
        if (next) { setBarcode(''); markProductAdded(next); }
      } catch (nextError) { setError(nextError); setLoading(false); } finally { focusBarcode(); }
    })();
  };
  const addCatalogProduct = (product: ProductResponse): void => {
    const scanned = product.barcodes[0];
    if (!sale || !scanned) return;
    void appendProduct(product, scanned)
      .then((next) => { if (next) markProductAdded(next); })
      .catch((nextError) => { setError(nextError); setLoading(false); })
      .finally(focusBarcode);
  };
  const searchCatalog = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void loadCatalog(catalogQuery.trim());
  };
  const removeItem = (itemId: string): void => { if (sale) void run(() => api.removeSaleItem(sale.id, itemId, intentKey('remove-' + itemId)), 'Línea eliminada.', 'remove-' + itemId); };
  const applyDiscount = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault(); if (!sale || !discountItemId) return;
    const intent = 'discount-' + discountItemId + '-' + discountBasisPoints + '-' + discountReason.trim();
    void run(() => api.applySaleDiscount(sale.id, { itemId: discountItemId, basisPoints: Number(discountBasisPoints), reason: discountReason.trim() }, intentKey(intent)), 'Descuento aplicado.', intent);
  };
  const complete = (): void => { if (sale) void run(() => api.completeSale(sale.id, intentKey('complete')), 'Venta completada.', 'complete'); };
  /** La pantalla no deriva el tipo ni valida la forma: la API es la autoridad. */
  const setRecipient = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault(); if (!sale) return;
    const country = recipientCountry.trim().toUpperCase();
    const value = recipientValue.trim();
    const intent = 'recipient-' + country + '-' + value + '-' + recipientName.trim() + '-' + recipientAddress.trim();
    void run(() => api.setSaleRecipient(sale.id, {
      recipient: {
        country, value,
        name: recipientName.trim() || null, address: recipientAddress.trim() || null
      }
    }, intentKey(intent)), 'Receptor adjuntado a la venta.', intent);
  };
  const clearRecipient = (): void => {
    if (!sale) return;
    void run(() => api.setSaleRecipient(sale.id, { recipient: null }, intentKey('recipient-clear')), 'Venta sin receptor identificado.', 'recipient-clear')
      .then((next) => { if (next) { setRecipientValue(''); setRecipientName(''); setRecipientAddress(''); } });
  };
  const changeVoidReason = (value: string): void => { setVoidReason(value); setVoidConfirming(false); };
  /** Primer paso: pide confirmación dentro de la pantalla, sin bloquear el proceso con un diálogo nativo. */
  const requestVoid = (): void => {
    if (!sale || !voidReason.trim()) return;
    setVoidConfirming(true);
  };
  const cancelVoid = (): void => setVoidConfirming(false);
  const confirmVoid = (): void => {
    if (!sale || !voidReason.trim()) return;
    setVoidConfirming(false);
    void run(() => api.voidSale(sale.id, { reason: voidReason.trim() }, intentKey('void')), 'Venta anulada.', 'void');
  };
  /**
   * La factura es un comando propio: completar la venta no la emite, porque un
   * fallo del dispositivo fiscal no puede revertir un cobro ya asentado. La
   * devolución la exige, así que sin este paso el nodo la rechaza.
   */
  const issueInvoice = (): void => {
    if (!sale || sale.status !== 'COMPLETED') return;
    setLoading(true); setError(null); setNotice(null);
    void api.issueSaleInvoice(sale.id, 'Emisión de factura de la venta', intentKey('invoice-' + sale.id))
      .then((issued) => {
        setInvoice(issued.document);
        setNotice('Factura ' + (issued.document.fiscalNumber ?? issued.document.id) + ' emitida (SIMULACIÓN).');
      })
      .catch((nextError) => setError(nextError))
      .finally(() => setLoading(false));
  };
  const executeReturn = (): void => {
    if (!sale || sale.status !== 'COMPLETED' || !returnReason.trim()) return;
    setLoading(true); setError(null); setNotice(null);
    void api.returnSale(sale.id, { reason: returnReason.trim() }, intentKey('return-' + sale.id))
      .then((result) => { setSaleReturn(result); setNotice('Devolución registrada. Nota de crédito SIMULACIÓN emitida.'); })
      .catch((nextError) => setError(nextError))
      .finally(() => setLoading(false));
  };
  const startAnotherSale = (): void => {
    setSale(null); setError(null); setNotice(null); setHighlightedItemId(null);
    setBarcode(''); setQuantity('1'); setPaymentAmount(''); setTenders([]);
    setVoidReason(''); setVoidConfirming(false); setDialog(null);
    setDiscountItemId(''); setDiscountBasisPoints(''); setDiscountReason(''); setReturnReason(''); setSaleReturn(null); setInvoice(null);
    setRecipientValue(''); setRecipientName(''); setRecipientAddress('');
  };
  const closeDialog = useCallback((): void => { setDialog(null); setVoidConfirming(false); }, []);
  const shiftLabel = activeShiftLabel(shift, cashRegister?.name ?? null);
  const completionBlocker = saleCompletionBlocker(sale, scale);
  /**
   * El pago que la barra tiene capturado y todavía no es ficha: método elegido
   * más importe escrito. `null` mientras falte alguno de los dos.
   */
  const captured: CapturedTender | null = paymentMethod && typedAmount(paymentAmount, scale) > 0
    ? {
      methodCode: paymentMethod.code, methodName: paymentMethod.name,
      currencyCode: paymentMethod.currencyCode,
      amountMinorUnits: typedAmount(paymentAmount, scale),
      financialTransactionTaxBasisPoints: paymentMethod.financialTransactionTaxBasisPoints
    }
    : null;
  /**
   * Agrega el pago capturado como ficha. El lote no viaja todavía: el dominio
   * acepta los pagos una sola vez —`SALE_PAYMENTS_ALREADY_REGISTERED`—, así que
   * las fichas se acumulan en la pantalla y se envían juntas al final.
   */
  const addTender = (): void => {
    if (!captured) return;
    setTenders([...tenders, captured]);
    setPaymentAmount('');
  };
  const removeTender = (index: number): void => {
    setTenders(tenders.filter((_, position) => position !== index));
  };
  /**
   * Envía el lote completo y cierra la venta en un gesto. Si el registro pasa y
   * el cierre falla, la venta queda cobrada y sin completar: el nodo devuelve
   * saldo cero y la barra vuelve a ofrecer «Completar venta», que es
   * exactamente lo que queda por hacer.
   */
  const settle = (batch: readonly CapturedTender[]): void => {
    if (!sale || batch.length === 0) return;
    const payments = batch.map((tender) => ({
      methodCode: tender.methodCode, currencyCode: tender.currencyCode,
      amountMinorUnits: tender.amountMinorUnits
    }));
    const intent = 'payment-' + payments
      .map((payment) => payment.methodCode + ':' + payment.currencyCode + ':' + payment.amountMinorUnits)
      .join('|');
    void run(() => api.registerSalePayments(sale.id, { payments }, intentKey(intent)), 'Pago registrado.', intent)
      .then((next) => { if (next) { setTenders([]); complete(); } });
  };
  /**
   * La acción de la barra, según el momento del cobro: cubrir el saldo de un
   * gesto cuando no hay fichas, sumar un pago más, o cerrar lo que ya está
   * cubierto. Es siempre un único botón, en el mismo sitio.
   */
  const checkoutAction = checkout.remainingMinorUnits <= 0
    ? {
      label: 'Completar venta',
      act: (): void => { if (tenders.length > 0) settle(tenders); else complete(); },
      disabled: tenders.length === 0 && completionBlocker !== null
    }
    : tenders.length === 0 && captured !== null && captured.amountMinorUnits >= suggestedAmount
      ? {
        label: 'Cobrar y completar',
        act: (): void => { if (captured) settle([captured]); },
        disabled: false
      }
      : { label: 'Agregar pago', act: addTender, disabled: captured === null };
  const voidAuthorized = isPermissionGranted(voidSaleContract.permission, permissionCodes);
  const returnAuthorized = isPermissionGranted(returnSaleContract.permission, permissionCodes);
  const invoiceAuthorized = isPermissionGranted(issueSaleInvoiceContract.permission, permissionCodes);
  return (
    <div className="operation-screen sales-screen">
      {!sale && <ScreenNote>Prepara una venta con el turno abierto de esta estación. Los importes definitivos siempre los confirma el servidor local.</ScreenNote>}
      <Feedback error={error} notice={notice} onDismiss={dismissFeedback} />
      {!sale ? <section className="panel start-panel" aria-labelledby="start-sale-title">
        <div><p className="eyebrow">Nueva venta</p><h3 id="start-sale-title">Abrir carrito</h3><p className="muted">El turno lo abre y lo cierra la pantalla de Caja; aquí solo se usa el que esté abierto.</p></div>
        {shiftLoading
          ? <p className="inline-status" role="status">Consultando el turno de la caja…</p>
          : shiftLabel
            ? <p className="inline-status is-ready" role="status"><span aria-hidden="true">✓</span> {shiftLabel}</p>
            : <p className="inline-status is-warning" role="status"><span aria-hidden="true">!</span> Esta estación no tiene un turno abierto. <a href="#/cash">Abre la caja</a> y vuelve a esta pantalla.</p>}
        <div className="form-grid"><label>Moneda de venta<input value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())} maxLength={8} required /></label><label>Escala visible<input type="number" min="0" max="6" value={currencyScale} onChange={(event) => setCurrencyScale(event.target.value)} /></label></div>
        <div className="button-row">
          <ActionButton className="primary-button" type="button" onClick={start} busy={loading} disabled={loading || shiftLoading || shift === null}>{loading ? 'Abriendo carrito…' : 'Iniciar venta'}</ActionButton>
          <ActionButton type="button" onClick={() => void resolveShift()} busy={shiftLoading} disabled={shiftLoading}>Actualizar turno</ActionButton>
        </div>
      </section> : sale.status !== 'DRAFT' ? <section className="panel closed-sale" aria-labelledby="closed-sale-title">
        <p className="eyebrow">{sale.status === 'COMPLETED' ? 'Venta completada' : 'Venta anulada'}</p>
        <h3 id="closed-sale-title">{money(sale.totalMinorUnits, sale.currencyCode, scale)}</h3>
        <dl className="detail-grid">
          <div><dt>Venta</dt><dd>{sale.id}</dd></div>
          <div><dt>Líneas</dt><dd>{sale.items.length}</dd></div>
          <div><dt>Pagado</dt><dd>{money(sale.paidTotalMinorUnits, sale.currencyCode, scale)}</dd></div>
          <div><dt>Estado</dt><dd>{sale.status}</dd></div>
        </dl>
        <span className="simulation-label">Fiscal · SIMULACIÓN</span>
        {sale.status === 'COMPLETED' && invoiceAuthorized && <section className="panel" aria-labelledby="invoice-title">
          <p className="eyebrow">Documento fiscal</p><h3 id="invoice-title">Emitir factura</h3>
          <p className="muted">
            El nodo arma la factura con los importes que la venta cobró. Es un paso propio para
            que un fallo del dispositivo no revierta el cobro ya asentado en el turno.
          </p>
          <ActionButton className="primary-button" type="button" onClick={issueInvoice} busy={loading} disabled={loading || invoice !== null}>
            {invoice ? 'Factura emitida' : 'Emitir factura'}
          </ActionButton>
          {invoice && <p className="inline-status is-ready" role="status">
            Factura {invoice.fiscalNumber ?? invoice.id} · {invoice.status} · SIMULACIÓN
          </p>}
        </section>}
        {sale.status === 'COMPLETED' && returnAuthorized && <section className="panel danger-panel" aria-labelledby="return-title">
          <p className="eyebrow">Acción sensible</p><h3 id="return-title">Devolver venta completa</h3>
          <p className="muted">Restaura inventario y registra el reintegro en el turno de origen. Solo está disponible como simulación total.</p>
          {invoice === null && <p className="inline-status is-warning" role="status">
            <span aria-hidden="true">!</span> Esta venta todavía no tiene factura emitida. Emítela
            arriba: la nota de crédito se deriva de ese documento.
          </p>}
          <label>Motivo<input value={returnReason} onChange={(event) => setReturnReason(event.target.value)} maxLength={500} required /></label>
          <ActionButton className="primary-button" type="button" onClick={executeReturn} busy={loading} disabled={loading || !returnReason.trim() || saleReturn !== null || invoice === null}>
            {saleReturn ? 'Devolución registrada' : 'Registrar devolución'}
          </ActionButton>
          {saleReturn && <p className="inline-status is-ready" role="status">Nota de crédito {saleReturn.creditNoteFiscalNumber ?? saleReturn.creditNoteId} · SIMULACIÓN</p>}
        </section>}
        <ActionButton className="primary-button" type="button" onClick={startAnotherSale}>Iniciar otra venta</ActionButton>
      </section> : <div className="sale-pos">
        <header className="sale-toolbar">
          <div className="sale-context">
            <span className="sale-live-dot" aria-hidden="true" />
            <div>
              <span>Venta en curso · {sale.id.slice(0, 8)}</span>
              <strong>{shiftLabel ?? cashRegister?.name ?? 'Caja activa'}</strong>
            </div>
          </div>
          <div className="sale-toolbar-status">
            <span className="line-count">{sale.items.length} {sale.items.length === 1 ? 'línea' : 'líneas'}</span>
            <span className="simulation-label">Fiscal · SIMULACIÓN</span>
            <ActionButton type="button" onClick={() => void refresh(sale.id)} busy={loading} disabled={loading}>
              Actualizar
            </ActionButton>
          </div>
        </header>
        <div className="sale-workspace">
          <section className="panel sale-cart" aria-labelledby="cart-title">
            <div className="panel-heading">
              <div><p className="eyebrow">01 · Ticket</p><h3 id="cart-title">Venta actual</h3></div>
              <span className="ticket-counter" aria-label={sale.items.length + ' líneas en el ticket'}>{sale.items.length}</span>
            </div>
            {/* El foco vuelve siempre aquí: el lector es el instrumento principal de una caja. */}
            <form className="sale-scan" onSubmit={addItem}>
              <label className="grow">
                Barcode o PLU
                <input ref={barcodeInput} value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="Escanea o escribe y presiona Enter" autoFocus required />
              </label>
              <label title="Se valida contra la unidad del producto: entera para unidades, decimal para productos pesados.">
                Cant.
                <input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
              </label>
              <ActionButton className="primary-button" type="submit" busy={loading} disabled={loading || !barcode.trim()}>
                {loading ? 'Agregando…' : 'Agregar'}
              </ActionButton>
            </form>
            <div className="sale-lines-wrap">
              {sale.items.length === 0
                ? <EmptyState>El ticket está vacío. Escanea un código o elige un producto del catálogo.</EmptyState>
                : <div className="table-wrap"><table className="sale-lines">
                <caption className="sr-only">Líneas actuales</caption>
                <thead><tr><th>Producto</th><th className="numeric">Cant.</th><th className="numeric">Importe</th><th /></tr></thead>
                <tbody>{sale.items.map((item, index) => (
                  <tr key={item.id} className={item.id === highlightedItemId ? 'is-new' : undefined}>
                    <td>
                      <strong>{item.description}</strong>
                      <small>
                        Línea {index + 1} · {item.unitCode}
                        {item.discountBasisPoints ? ' · −' + (item.discountBasisPoints / 100) + '%' : ''}
                      </small>
                    </td>
                    <td className="numeric">{item.quantityScaled / (10 ** item.quantityScale)}</td>
                    <td className="numeric">{money(item.totalMinorUnits, sale.currencyCode, scale)}</td>
                    <td className="numeric">
                      <button type="button" className="line-remove" onClick={() => removeItem(item.id)} disabled={loading} aria-label={'Quitar ' + item.description}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>}
            </div>

            <div className="sale-secondary" aria-label="Acciones del ticket">
              <button type="button" onClick={() => setDialog('recipient')}>
                {sale.recipient ? 'Receptor · ' + sale.recipient.normalizedValue : 'Agregar receptor'}
              </button>
              {isPermissionGranted(applySaleDiscountContract.permission, permissionCodes) && (
                <button type="button" onClick={() => setDialog('discount')} disabled={sale.items.length === 0}>
                  Descuento de línea
                </button>
              )}
              {voidAuthorized && (
                <button type="button" className="danger-link" onClick={() => setDialog('void')}>Anular venta</button>
              )}
            </div>
          </section>

          <section className="panel sale-catalog" aria-labelledby="catalog-title">
            <div className="panel-heading">
              <div><p className="eyebrow">02 · Catálogo</p><h3 id="catalog-title">Productos</h3></div>
              <span className="catalog-count">{catalogProducts.length} disponibles</span>
            </div>
            <form className="catalog-search" onSubmit={searchCatalog}>
              <label className="sr-only" htmlFor="sale-catalog-query">Buscar producto</label>
              <input id="sale-catalog-query" value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Buscar por nombre o barcode" />
              <ActionButton type="submit" busy={catalogLoading} disabled={catalogLoading}>
                {catalogLoading ? 'Buscando…' : 'Buscar'}
              </ActionButton>
            </form>
            {catalogLoading
              ? <div className="catalog-state" role="status"><span className="mini-spinner" aria-hidden="true" /> Cargando catálogo…</div>
              : catalogFailed
                ? <div className="catalog-state is-error" role="status">
                  <span>El catálogo no respondió. Puedes seguir usando el lector.</span>
                  <button type="button" onClick={() => void loadCatalog(catalogQuery.trim())}>Reintentar</button>
                </div>
                : catalogProducts.length === 0
                  ? <EmptyState>No hay productos activos que coincidan con la búsqueda.</EmptyState>
                  : <div className="product-grid">
                    {catalogProducts.map((product) => (
                      <button
                        className="product-tile"
                        key={product.id}
                        type="button"
                        onClick={() => addCatalogProduct(product)}
                        disabled={loading}
                        aria-label={'Agregar ' + product.name}
                      >
                        <span className="product-mark" aria-hidden="true">{product.name.slice(0, 2).toUpperCase()}</span>
                        <span className="product-copy"><strong>{product.name}</strong><small>{product.unitCode}</small></span>
                        <span className="product-price">{money(product.price.amountMinorUnits, product.price.currencyCode)}</span>
                      </button>
                    ))}
                  </div>}
          </section>

        </div>

        {/*
          El cobro deja de ser columna: baja a una barra de ancho completo al
          pie del área de trabajo. La fila de fichas está siempre presente, con
          su vacío escrito, para que la altura no cambie entre un método y
          varios y nada empuje el ticket a mitad de una venta.
        */}
        <footer className="checkout-bar" aria-label="Cobro de la venta">
          <div className="checkout-total">
            <span className="checkout-label">Total a cobrar</span>
            <strong>{money(checkout.totalMinorUnits, sale.currencyCode, scale)}</strong>
            <span className="checkout-breakdown">
              {'Subtotal ' + money(sale.subtotalMinorUnits, sale.currencyCode, scale) +
                ' · IVA ' + money(sale.taxTotalMinorUnits, sale.currencyCode, scale) +
                ' · IGTF ' + (checkout.taxMinorUnits > 0
                ? money(checkout.taxMinorUnits, sale.currencyCode, scale)
                : '—')}
            </span>
          </div>

          <div className="checkout-capture">
            <fieldset className="method-chips">
              <legend className="sr-only">Método de pago</legend>
              {paymentMethods.map((method) => (
                <label key={method.code} className={method.code === paymentMethodCode ? 'chip is-selected' : 'chip'}>
                  <input type="radio" name="paymentMethod" value={method.code} checked={method.code === paymentMethodCode} onChange={() => setPaymentMethodCode(method.code)} />
                  <span>{method.name}</span>
                  <small>{method.currencyCode}</small>
                  {method.financialTransactionTaxBasisPoints > 0 && <small className="chip-tax">+IGTF</small>}
                </label>
              ))}
            </fieldset>
            <ul className="tender-row">
              {tenders.length === 0
                ? <li className="tender-empty">Sin pagos agregados todavía</li>
                : tenders.map((tender, index) => (
                  <li key={tender.methodCode + '-' + index} className="tender">
                    <span>{tender.methodName}</span>
                    <strong>{money(tender.amountMinorUnits, tender.currencyCode, scale)}</strong>
                    <button type="button" onClick={() => removeTender(index)} aria-label={'Quitar ' + tender.methodName}>
                      ×
                    </button>
                  </li>
                ))}
            </ul>
          </div>

          <form className="checkout-action" id="sale-payment-form" onSubmit={(event) => { event.preventDefault(); checkoutAction.act(); }}>
            <div className="amount-field">
              <label className="grow">
                <span className="sr-only">Importe {paymentCurrency ? '(' + paymentCurrency + ')' : ''}</span>
                <input inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="0,00" />
              </label>
              <button type="button" onClick={() => setPaymentAmount(formatScaledDecimal(suggestedAmount, scale))} disabled={suggestedAmount <= 0}>
                Resto
              </button>
            </div>
            <ActionButton className="primary-button complete-button" type="submit" busy={loading} disabled={loading || checkoutAction.disabled} aria-describedby={completionBlocker ? 'complete-blocker' : undefined}>
              {loading ? 'Registrando…' : checkoutAction.label}
            </ActionButton>
          </form>
        </footer>

        <p className={checkout.remainingMinorUnits > 0 ? 'sale-balance is-pending' : 'sale-balance is-settled'} role="status" id="complete-blocker">
          {checkout.remainingMinorUnits > 0
            ? 'Falta cobrar ' + money(checkout.remainingMinorUnits, sale.currencyCode, scale) +
              (paymentMethod && paymentMethod.financialTransactionTaxBasisPoints > 0 &&
                suggestedAmount !== checkout.remainingMinorUnits
                ? ' · con ' + paymentMethod.name.toLowerCase() + ' son ' +
                  money(suggestedAmount, sale.currencyCode, scale) + ', IGTF incluido'
                : '')
            : 'Cobro cubierto · ' + money(checkout.totalMinorUnits, sale.currencyCode, scale)}
        </p>

        {dialog === 'recipient' && (
          <Modal title="Receptor fiscal" description="La venta anónima es válida en simulación. El dato se guarda como copia en esta venta; no crea un cliente reutilizable." onClose={closeDialog}>
            <form className="stack-form" onSubmit={setRecipient}>
              <div className="form-grid">
                <label>País<input value={recipientCountry} onChange={(event) => setRecipientCountry(event.target.value)} maxLength={2} required /></label>
                <label>Identificación<input value={recipientValue} onChange={(event) => setRecipientValue(event.target.value)} maxLength={64} placeholder="J-12345678-9" required /></label>
              </div>
              <label>Nombre o razón social (opcional)<input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} maxLength={200} /></label>
              <label>Dirección (opcional)<input value={recipientAddress} onChange={(event) => setRecipientAddress(event.target.value)} maxLength={200} /></label>
              <div className="button-row">
                <ActionButton className="primary-button" type="submit" busy={loading} disabled={loading || !recipientValue.trim()}>
                  {loading ? 'Guardando…' : 'Adjuntar receptor'}
                </ActionButton>
                {sale.recipient && <button type="button" onClick={clearRecipient} disabled={loading}>Quitar receptor</button>}
              </div>
              {sale.recipient && <dl className="detail-grid">
                <div><dt>Identificación</dt><dd>{sale.recipient.type} {sale.recipient.normalizedValue}</dd></div>
                <div><dt>Nombre</dt><dd>{sale.recipient.name ?? '—'}</dd></div>
                <div><dt>Dirección</dt><dd>{sale.recipient.address ?? '—'}</dd></div>
              </dl>}
              <span className="simulation-label">SIMULACIÓN · la captura no certifica una factura fiscal</span>
            </form>
          </Modal>
        )}

        {dialog === 'discount' && (
          <Modal title="Descuento de línea" description="Queda auditado con su motivo y el tope lo fija la política configurada." onClose={closeDialog}>
            <form className="stack-form" onSubmit={applyDiscount}>
              <label>Línea<select value={discountItemId} onChange={(event) => setDiscountItemId(event.target.value)} required>
                <option value="">Selecciona</option>
                {sale.items.map((item) => <option key={item.id} value={item.id}>{item.description}</option>)}
              </select></label>
              <label>Porcentaje (puntos base)<input type="number" min="1" max="10000" value={discountBasisPoints} onChange={(event) => setDiscountBasisPoints(event.target.value)} required /></label>
              <label>Motivo<input value={discountReason} onChange={(event) => setDiscountReason(event.target.value)} maxLength={500} required /></label>
              <ActionButton className="primary-button" type="submit" busy={loading} disabled={loading}>
                {loading ? 'Solicitando…' : 'Solicitar descuento'}
              </ActionButton>
            </form>
          </Modal>
        )}

        {dialog === 'void' && (
          <Modal title="Anular venta" description="La anulación queda auditada con su motivo y no puede deshacerse." onClose={closeDialog}>
            <div className="stack-form">
              <label>Motivo<input value={voidReason} onChange={(event) => changeVoidReason(event.target.value)} maxLength={500} required autoFocus /></label>
              {!voidReason.trim() && <p className="muted">Escribe el motivo para habilitar la anulación.</p>}
              {voidConfirming ? (
                <div className="button-row" role="alert">
                  <p className="muted" id="void-confirm-warning">¿Confirmas anular esta venta?</p>
                  <ActionButton className="primary-button" type="button" onClick={confirmVoid} busy={loading} disabled={loading || !voidAuthorized} aria-describedby="void-confirm-warning">
                    Sí, anular
                  </ActionButton>
                  <button type="button" onClick={cancelVoid}>Cancelar</button>
                </div>
              ) : (
                <ActionButton type="button" onClick={requestVoid} disabled={loading || !voidReason.trim() || !voidAuthorized}>
                  Anular venta
                </ActionButton>
              )}
            </div>
          </Modal>
        )}
      </div>}
    </div>
  );
};
