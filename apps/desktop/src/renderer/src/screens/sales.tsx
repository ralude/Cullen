import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CashRegisterResponse, PaymentMethodResponse, SaleResponse, ShiftResponse
} from '@supermarket/shared';
import {
  applySaleDiscountContract, isPermissionGranted, returnSaleContract, voidSaleContract,
  type SaleReturnResponse
} from '@supermarket/shared';
import { ApiProblemError, createIdempotencyKey, formatScaledDecimal, parseMinorUnits } from '../api-client.js';
import {
  ACTIVE_CASH_REGISTER_KEY, ACTIVE_SALE_KEY, ActionButton, EmptyState, Feedback, ScreenNote,
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
  const [paymentMethodCode, setPaymentMethodCode] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethodCode2, setPaymentMethodCode2] = useState('');
  const [paymentAmount2, setPaymentAmount2] = useState('');
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
  const [voidConfirming, setVoidConfirming] = useState(false);
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
  const paymentCurrency = paymentMethods.find((method) => method.code === paymentMethodCode)?.currencyCode ?? '';
  const paymentCurrency2 = paymentMethods.find((method) => method.code === paymentMethodCode2)?.currencyCode ?? '';
  const outstanding = sale?.status === 'DRAFT' ? sale.balanceMinorUnits : 0;
  /** Precarga el saldo pendiente como importe sugerido cada vez que el nodo lo recalcula. */
  useEffect(() => {
    if (outstanding > 0) setPaymentAmount(formatScaledDecimal(outstanding, scale));
  }, [outstanding, scale]);
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
  const addItem = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault(); if (!sale) return;
    const scanned = barcode.trim();
    if (!scanned) { focusBarcode(); return; }
    void (async () => {
      setLoading(true); setError(null); setNotice(null);
      try {
        const { product } = await api.findProductByBarcode(scanned);
        const quantityScaled = parseMinorUnits(quantity, product.unitScale);
        const intent = 'add-' + scanned + '-' + quantityScaled + '-' + product.unitScale;
        const next = await run(
          () => api.addSaleItem(
            sale.id, { barcode: scanned, quantityScaled, quantityScale: product.unitScale }, intentKey(intent)
          ),
          'Producto agregado al carrito.', intent
        );
        if (next) {
          setBarcode('');
          setQuantity('1');
          setHighlightedItemId(next.items[next.items.length - 1]?.id ?? null);
        }
      } catch (nextError) { setError(nextError); setLoading(false); } finally { focusBarcode(); }
    })();
  };
  const removeItem = (itemId: string): void => { if (sale) void run(() => api.removeSaleItem(sale.id, itemId, intentKey('remove-' + itemId)), 'Línea eliminada.', 'remove-' + itemId); };
  const applyDiscount = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault(); if (!sale || !discountItemId) return;
    const intent = 'discount-' + discountItemId + '-' + discountBasisPoints + '-' + discountReason.trim();
    void run(() => api.applySaleDiscount(sale.id, { itemId: discountItemId, basisPoints: Number(discountBasisPoints), reason: discountReason.trim() }, intentKey(intent)), 'Descuento aplicado.', intent);
  };
  const registerPayment = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault(); if (!sale) return;
    try {
      const amountMinorUnits = parseMinorUnits(paymentAmount, scale);
      const payments = [{ methodCode: paymentMethodCode, currencyCode: paymentCurrency, amountMinorUnits }];
      if (paymentMethodCode2 && paymentAmount2.trim()) payments.push({ methodCode: paymentMethodCode2, currencyCode: paymentCurrency2, amountMinorUnits: parseMinorUnits(paymentAmount2, scale) });
      const intent = 'payment-' + paymentMethodCode + '-' + paymentCurrency + '-' + paymentAmount + '-' + paymentMethodCode2 + '-' + paymentAmount2;
      void run(() => api.registerSalePayments(sale.id, { payments }, intentKey(intent)), 'Pago registrado.', intent);
    } catch (nextError) { setError(nextError); }
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
    setBarcode(''); setQuantity('1'); setPaymentAmount(''); setPaymentAmount2('');
    setPaymentMethodCode2(''); setVoidReason(''); setVoidConfirming(false);
    setDiscountItemId(''); setDiscountBasisPoints(''); setDiscountReason(''); setReturnReason(''); setSaleReturn(null);
    setRecipientValue(''); setRecipientName(''); setRecipientAddress('');
  };
  const shiftLabel = activeShiftLabel(shift, cashRegister?.name ?? null);
  const completionBlocker = saleCompletionBlocker(sale, scale);
  const voidAuthorized = isPermissionGranted(voidSaleContract.permission, permissionCodes);
  const returnAuthorized = isPermissionGranted(returnSaleContract.permission, permissionCodes);
  return (
    <div className="operation-screen">
      <ScreenNote>El servidor conserva los totales, impuestos y estado fiscal. Esta pantalla solo coordina intenciones del operador. No se aceptan cálculos locales.</ScreenNote>
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
        {sale.status === 'COMPLETED' && returnAuthorized && <section className="panel danger-panel" aria-labelledby="return-title">
          <p className="eyebrow">Acción sensible</p><h3 id="return-title">Devolver venta completa</h3>
          <p className="muted">Restaura inventario y registra el reintegro en el turno de origen. Solo está disponible como simulación total.</p>
          <label>Motivo<input value={returnReason} onChange={(event) => setReturnReason(event.target.value)} maxLength={500} required /></label>
          <ActionButton className="primary-button" type="button" onClick={executeReturn} busy={loading} disabled={loading || !returnReason.trim() || saleReturn !== null}>
            {saleReturn ? 'Devolución registrada' : 'Registrar devolución'}
          </ActionButton>
          {saleReturn && <p className="inline-status is-ready" role="status">Nota de crédito {saleReturn.creditNoteFiscalNumber ?? saleReturn.creditNoteId} · SIMULACIÓN</p>}
        </section>}
        <ActionButton className="primary-button" type="button" onClick={startAnotherSale}>Iniciar otra venta</ActionButton>
      </section> : <>
        <div className="screen-toolbar"><span className="status-label">Venta {sale.id.slice(0, 8)} · {sale.status}</span><span className="status-label">{sale.items.length} líneas</span><span className="simulation-label">Fiscal · SIMULACIÓN</span><ActionButton type="button" onClick={() => void refresh(sale.id)} busy={loading} disabled={loading}>Actualizar</ActionButton></div>
        <div className="sales-layout">
          <section className="panel" aria-labelledby="cart-title"><div className="panel-heading"><div><p className="eyebrow">Carrito</p><h3 id="cart-title">Líneas de venta</h3></div><strong className="total-figure">{money(sale.totalMinorUnits, sale.currencyCode, scale)}</strong></div>
            <form className="inline-form" onSubmit={addItem}><label className="grow">Barcode<input ref={barcodeInput} value={barcode} onChange={(event) => setBarcode(event.target.value)} autoFocus required /></label><label title="Se valida contra la unidad del producto: entera para unidades, decimal para productos pesados.">Cant.<input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label><ActionButton className="primary-button" type="submit" busy={loading} disabled={loading || !barcode.trim()}>{loading ? 'Agregando…' : 'Agregar'}</ActionButton></form>
            {sale.items.length === 0 ? <EmptyState>Escanea o escribe un barcode y presiona Enter para comenzar.</EmptyState> : <div className="table-wrap"><table><caption className="sr-only">Líneas actuales</caption><thead><tr><th>Producto</th><th>Cant.</th><th>Total</th><th /></tr></thead><tbody>{sale.items.map((item) => <tr key={item.id} className={item.id === highlightedItemId ? 'is-new' : undefined}><td><strong>{item.description}</strong><small>{item.unitCode}</small></td><td>{item.quantityScaled / (10 ** item.quantityScale)}</td><td>{money(item.totalMinorUnits, sale.currencyCode, scale)}</td><td><ActionButton type="button" onClick={() => removeItem(item.id)} disabled={loading}>Quitar</ActionButton></td></tr>)}</tbody></table></div>}
          </section>
          <aside className="sales-side">
            <section className="panel totals-panel" aria-labelledby="totals-title"><p className="eyebrow">Resumen calculado por API</p><h3 id="totals-title">Total a cobrar</h3><dl className="totals"><div><dt>Subtotal</dt><dd>{money(sale.subtotalMinorUnits, sale.currencyCode, scale)}</dd></div><div><dt>Descuentos</dt><dd>−{money(sale.discountTotalMinorUnits, sale.currencyCode, scale)}</dd></div><div><dt>IVA</dt><dd>{money(sale.taxTotalMinorUnits, sale.currencyCode, scale)}</dd></div><div className="grand-total"><dt>Total</dt><dd>{money(sale.totalMinorUnits, sale.currencyCode, scale)}</dd></div><div><dt>Pagado</dt><dd>{money(sale.paidTotalMinorUnits, sale.currencyCode, scale)}</dd></div><div><dt>Saldo</dt><dd>{money(sale.balanceMinorUnits, sale.currencyCode, scale)}</dd></div></dl></section>
            <section className="panel" aria-labelledby="payment-title"><p className="eyebrow">Cobro</p><h3 id="payment-title">Registrar pagos mixtos</h3><form className="stack-form" onSubmit={registerPayment}><label>Método 1<select value={paymentMethodCode} onChange={(event) => setPaymentMethodCode(event.target.value)} required><option value="">Selecciona</option>{paymentMethods.map((method) => <option key={method.code} value={method.code}>{method.name} ({method.currencyCode})</option>)}</select></label><label>Importe 1 ({paymentCurrency || '…'})<input inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="0,00" required /></label><p className="muted">Se sugiere el saldo pendiente: {money(sale.balanceMinorUnits, sale.currencyCode, scale)}.</p><label>Método 2 (opcional)<select value={paymentMethodCode2} onChange={(event) => setPaymentMethodCode2(event.target.value)}><option value="">Ninguno</option>{paymentMethods.map((method) => <option key={method.code} value={method.code}>{method.name} ({method.currencyCode})</option>)}</select></label>{paymentMethodCode2 && <label>Importe 2 ({paymentCurrency2 || '…'})<input inputMode="decimal" value={paymentAmount2} onChange={(event) => setPaymentAmount2(event.target.value)} placeholder="0,00" required={Boolean(paymentMethodCode2)} /></label>}<ActionButton className="primary-button" type="submit" busy={loading} disabled={loading || !paymentMethodCode}>{loading ? 'Registrando…' : 'Registrar lote de pagos'}</ActionButton></form></section>
            <section className="panel" aria-labelledby="recipient-title"><p className="eyebrow">Receptor</p><h3 id="recipient-title">Identificación fiscal (opcional)</h3><p className="muted">La venta anónima es válida en simulación. El dato se guarda como copia en esta venta; no crea un cliente reutilizable.</p><form className="stack-form" onSubmit={setRecipient}><div className="form-grid"><label>País<input value={recipientCountry} onChange={(event) => setRecipientCountry(event.target.value)} maxLength={2} required /></label><label>Identificación<input value={recipientValue} onChange={(event) => setRecipientValue(event.target.value)} maxLength={64} placeholder="J-12345678-9" required /></label></div><label>Nombre o razón social (opcional)<input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} maxLength={200} /></label><label>Dirección (opcional)<input value={recipientAddress} onChange={(event) => setRecipientAddress(event.target.value)} maxLength={200} /></label><div className="button-row"><ActionButton type="submit" busy={loading} disabled={loading || !recipientValue.trim()}>{loading ? "Guardando…" : "Adjuntar receptor"}</ActionButton>{sale.recipient && <button type="button" onClick={clearRecipient} disabled={loading}>Quitar receptor</button>}</div></form>{sale.recipient ? <dl className="detail-grid"><div><dt>Identificación</dt><dd>{sale.recipient.type} {sale.recipient.normalizedValue}</dd></div><div><dt>Nombre</dt><dd>{sale.recipient.name ?? "—"}</dd></div><div><dt>Dirección</dt><dd>{sale.recipient.address ?? "—"}</dd></div></dl> : <p className="muted">Venta anónima.</p>}<span className="simulation-label">SIMULACIÓN · la captura no certifica una factura fiscal</span></section>
            {isPermissionGranted(applySaleDiscountContract.permission, permissionCodes) && <section className="panel" aria-labelledby="discount-title"><p className="eyebrow">Autorización</p><h3 id="discount-title">Descuento de línea</h3><form className="stack-form" onSubmit={applyDiscount}><label>Línea<select value={discountItemId} onChange={(event) => setDiscountItemId(event.target.value)} required><option value="">Selecciona</option>{sale.items.map((item) => <option key={item.id} value={item.id}>{item.description}</option>)}</select></label><label>Porcentaje (puntos base)<input type="number" min="1" max="10000" value={discountBasisPoints} onChange={(event) => setDiscountBasisPoints(event.target.value)} required /></label><label>Motivo<input value={discountReason} onChange={(event) => setDiscountReason(event.target.value)} maxLength={500} required /></label><ActionButton type="submit" busy={loading} disabled={loading}>{loading ? 'Solicitando…' : 'Solicitar descuento'}</ActionButton></form></section>}
            {voidAuthorized && <section className="panel danger-panel" aria-labelledby="void-title">
              <p className="eyebrow">Acción sensible</p><h3 id="void-title">Anular venta</h3>
              <label>Motivo<input value={voidReason} onChange={(event) => changeVoidReason(event.target.value)} maxLength={500} required /></label>
              {!voidReason.trim() && <p className="muted">Escribe el motivo para habilitar la anulación; queda auditada.</p>}
              {voidConfirming ? (
                <div className="button-row" role="alert">
                  <p className="muted" id="void-confirm-warning">¿Confirmas anular esta venta? La anulación queda auditada.</p>
                  <ActionButton
                    className="primary-button" type="button" onClick={confirmVoid} busy={loading}
                    disabled={loading || !voidAuthorized} aria-describedby="void-confirm-warning"
                  >
                    Sí, anular
                  </ActionButton>
                  <button type="button" onClick={cancelVoid}>Cancelar</button>
                </div>
              ) : (
                <ActionButton
                  type="button" onClick={requestVoid} disabled={loading || !voidReason.trim() || !voidAuthorized}
                >
                  Anular venta
                </ActionButton>
              )}
            </section>}
            <div className="complete-block">
              <ActionButton className="primary-button complete-button" type="button" onClick={complete} busy={loading} disabled={loading || completionBlocker !== null} aria-describedby={completionBlocker ? 'complete-blocker' : undefined}>{loading ? 'Completando…' : 'Completar venta'}</ActionButton>
              {completionBlocker && <p className="muted" id="complete-blocker" role="status">{completionBlocker}</p>}
            </div>
          </aside>
        </div>
      </>}
    </div>
  );
};
