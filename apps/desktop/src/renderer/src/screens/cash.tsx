import { useEffect, useRef, useState } from 'react';
import {
  closeShiftContract, isPermissionGranted, openShiftContract,
  registerCashMovementContract, type CashRegisterResponse,
  type PaymentMethodResponse, type RegisterCashMovementRequest, type ShiftResponse
} from '@supermarket/shared';
import { ApiProblemError, createIdempotencyKey, parseMinorUnits } from '../api-client.js';
import {
  ACTIVE_CASH_REGISTER_KEY, ActionButton, EmptyState, Feedback, ReasonField, ScreenNote,
  money, readStorage, writeStorage, type ScreenProps
} from './shared.js';

export const CashScreen = ({ api, permissionCodes }: ScreenProps): React.JSX.Element => {
  const [cashRegisterId, setCashRegisterId] = useState('');
  const [cashMethodCode, setCashMethodCode] = useState('');
  const [shift, setShift] = useState<ShiftResponse | null>(null);
  const [openingAmount, setOpeningAmount] = useState('');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementType, setMovementType] = useState<RegisterCashMovementRequest['type']>('INCOME');
  const [movementReason, setMovementReason] = useState('');
  const [declaredAmount, setDeclaredAmount] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<readonly PaymentMethodResponse[]>([]);
  const [cashRegisters, setCashRegisters] = useState<readonly CashRegisterResponse[]>([]);
  /** Distingue «todavía no respondió» de «el nodo no tiene ninguna caja». */
  const [registersLoaded, setRegistersLoaded] = useState(false);
  const [configuredCashRegisterId] = useState(() => readStorage(ACTIVE_CASH_REGISTER_KEY) ?? '');
  const intentKeys = useRef(new Map<string, string>());
  const intentKey = (intent: string): string => {
    const current = intentKeys.current.get(intent);
    if (current) return current;
    const created = createIdempotencyKey();
    intentKeys.current.set(intent, created);
    return created;
  };

  /**
   * La estación solo recuerda su caja. El turno abierto se vuelve a pedir al
   * nodo en cada carga, así que un turno cerrado desde otra pantalla nunca
   * sobrevive como dato local ni llega a la pantalla de Venta.
   */
  const remember = (next: ShiftResponse | null): void => {
    if (next) writeStorage(ACTIVE_CASH_REGISTER_KEY, next.cashRegisterId);
  };

  useEffect(() => {
    if (configuredCashRegisterId) setCashRegisterId(configuredCashRegisterId);
  }, [configuredCashRegisterId]);
  useEffect(() => {
    void api.listPaymentMethods().then(setPaymentMethods).catch(() => undefined);
    void api.listCashRegisters().then((registers) => {
      setCashRegisters(registers);
      setRegistersLoaded(true);
      if (registers.length === 1) setCashRegisterId((current) => current || registers[0]!.id);
    }).catch(() => undefined);
  }, [api]);
  useEffect(() => {
    if (!configuredCashRegisterId) return;
    void api.getOpenShift(configuredCashRegisterId).then((next) => {
      setShift(next); remember(next);
    }).catch((nextError: unknown) => {
      if (!(nextError instanceof ApiProblemError && nextError.problem.code === 'SHIFT_NOT_FOUND')) {
        setError(nextError);
      }
    });
  }, [api, configuredCashRegisterId]);

  const cashMethodCurrency = paymentMethods
    .find((method) => method.code === cashMethodCode)?.currencyCode ?? '';
  const canOpen = isPermissionGranted(openShiftContract.permission, permissionCodes);
  const canMove = isPermissionGranted(registerCashMovementContract.permission, permissionCodes);
  const canClose = isPermissionGranted(closeShiftContract.permission, permissionCodes);
  const run = async (
    action: () => Promise<ShiftResponse>, success: string, intent: string
  ): Promise<void> => {
    setLoading(true); setError(null); setNotice(null);
    try {
      const next = await action();
      setShift(next);
      intentKeys.current.delete(intent);
      remember(next);
      setNotice(success);
    } catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  };
  const dismissFeedback = (): void => { setError(null); setNotice(null); };
  const load = async (): Promise<void> => {
    if (!cashRegisterId.trim()) return;
    setLoading(true); setError(null);
    writeStorage(ACTIVE_CASH_REGISTER_KEY, cashRegisterId.trim());
    try { const next = await api.getOpenShift(cashRegisterId.trim()); setShift(next); remember(next); }
    catch (nextError) {
      if (nextError instanceof ApiProblemError && nextError.problem.code === 'SHIFT_NOT_FOUND') {
        setShift(null);
      } else setError(nextError);
    } finally { setLoading(false); }
  };
  const submitOpen = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    try {
      const amount = openingAmount ? parseMinorUnits(openingAmount, 2) : 0;
      const intent = `open-${cashRegisterId}-${cashMethodCode}-${amount}`;
      void run(() => api.openShift({
        cashRegisterId: cashRegisterId.trim(),
        openingFunds: amount ? [{
          paymentMethodCode: cashMethodCode,
          currencyCode: cashMethodCurrency,
          amountMinorUnits: amount
        }] : []
      }, intentKey(intent)), 'Turno abierto.', intent);
    } catch (nextError) { setError(nextError); }
  };
  const submitMovement = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!shift) return;
    try {
      const amount = parseMinorUnits(movementAmount, 2);
      const intent = `movement-${shift.id}-${movementType}-${cashMethodCode}-${amount}-${movementReason.trim()}`;
      void run(() => api.registerCashMovement(shift.id, {
        type: movementType, paymentMethodCode: cashMethodCode,
        currencyCode: cashMethodCurrency, amountMinorUnits: amount,
        reason: movementReason.trim()
      }, intentKey(intent)), 'Movimiento registrado.', intent);
    } catch (nextError) { setError(nextError); }
  };
  const submitClose = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!shift) return;
    try {
      const amount = parseMinorUnits(declaredAmount, 2);
      const reason = closeReason.trim();
      const intent = `close-${shift.id}-${cashMethodCode}-${amount}-${reason}`;
      void run(() => api.closeShift(shift.id, {
        declaredBalances: [{
          paymentMethodCode: cashMethodCode,
          currencyCode: cashMethodCurrency,
          amountMinorUnits: amount
        }],
        reason
      }, intentKey(intent)), 'Turno cerrado.', intent);
    } catch (nextError) { setError(nextError); }
  };

  return <div className="operation-screen">
    <ScreenNote>Apertura, movimientos y cierre se envían al turno dueño de la caja. Las diferencias quedan visibles para autorización.</ScreenNote>
    <Feedback error={error} notice={notice} onDismiss={dismissFeedback} />
    {registersLoaded && cashRegisters.length === 0 && (
      <p className="inline-status is-warning" role="status">
        <span aria-hidden="true">!</span> Este nodo todavía no tiene ninguna caja registrada, así
        que no hay turno que abrir. Regístrala en <a href="#/config">Configuración</a>.
      </p>
    )}
    <section className="panel"><div className="form-grid">
      {cashRegisters.length > 1
        ? <label>Caja asignada<select value={cashRegisterId} onChange={(event) => setCashRegisterId(event.target.value)} required><option value="">Selecciona</option>{cashRegisters.map((cashRegister) => <option key={cashRegister.id} value={cashRegister.id}>{cashRegister.name}</option>)}</select></label>
        : <label>Caja asignada<input value={cashRegisterId} onChange={(event) => setCashRegisterId(event.target.value)} placeholder="Configuración de estación" required /></label>}
      <label>Método de efectivo<select value={cashMethodCode} onChange={(event) => setCashMethodCode(event.target.value)} required><option value="">Selecciona</option>{paymentMethods.map((method) => <option key={method.code} value={method.code}>{method.name} ({method.currencyCode})</option>)}</select></label>
      <div className="align-end"><ActionButton type="button" onClick={() => void load()} busy={loading} disabled={loading || !cashRegisterId.trim()}>Consultar turno</ActionButton></div>
    </div></section>
    {!shift ? canOpen ? <section className="panel">
      <h3>Abrir caja</h3>
      <form className="inline-form" onSubmit={submitOpen}>
        <label>Fondo inicial<input inputMode="decimal" value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value)} placeholder="0,00" /></label>
        <ActionButton className="primary-button" type="submit" busy={loading} disabled={loading || !cashRegisterId.trim() || !cashMethodCode}>Abrir turno</ActionButton>
      </form>
    </section> : <EmptyState>No hay un turno local para consultar.</EmptyState> : <div className="cash-layout">
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Turno {shift.id.slice(0, 8)}</p><h3>{shift.status === 'OPEN' ? 'Turno abierto' : 'Turno cerrado'}</h3></div><span className="status-label">{shift.movements.length} movimientos</span></div>
        <dl className="totals">{shift.expectedBalances.map((balance) => <div key={`${balance.paymentMethodCode}-${balance.currencyCode}`}><dt>{balance.paymentMethodCode} · Esperado</dt><dd>{money(balance.minorUnits, balance.currencyCode)}</dd></div>)}</dl>
        {canMove && <form className="stack-form" onSubmit={submitMovement}>
          <h4>Registrar movimiento</h4>
          <label>Tipo<select value={movementType} onChange={(event) => setMovementType(event.target.value as RegisterCashMovementRequest['type'])}><option value="INCOME">Ingreso</option><option value="WITHDRAWAL">Retiro</option></select></label>
          <label>Importe<input inputMode="decimal" value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} required /></label>
          <ReasonField
            value={movementReason}
            onChange={setMovementReason}
            suggestions={['Fondo de cambio', 'Retiro parcial a bóveda', 'Pago a proveedor', 'Corrección de arqueo']}
          />
          <ActionButton type="submit" busy={loading} disabled={loading || shift.status !== 'OPEN' || !cashMethodCode}>Registrar movimiento</ActionButton>
        </form>}
      </section>
      <section className="panel">
        <h3>Declarar efectivo para cerrar</h3>
        {canClose && <form className="stack-form" onSubmit={submitClose}>
          <label>Saldo declarado<input inputMode="decimal" value={declaredAmount} onChange={(event) => setDeclaredAmount(event.target.value)} required /></label>
          <ReasonField
            label="Motivo del cierre"
            value={closeReason}
            onChange={setCloseReason}
            suggestions={['Fin de turno', 'Relevo de cajero', 'Cierre anticipado']}
          />
          <ActionButton className="primary-button" type="submit" busy={loading} disabled={loading || shift.status !== 'OPEN' || !cashMethodCode || !closeReason.trim()}>Cerrar turno</ActionButton>
        </form>}
        {shift.closingBalances && <div className="table-wrap"><table><thead><tr><th>Método</th><th>Esperado</th><th>Declarado</th><th>Diferencia</th></tr></thead><tbody>{shift.closingBalances.map((balance) => <tr key={`${balance.paymentMethodCode}-${balance.currencyCode}`}><td>{balance.paymentMethodCode}</td><td>{money(balance.expectedMinorUnits, balance.currencyCode)}</td><td>{money(balance.declaredMinorUnits, balance.currencyCode)}</td><td>{money(balance.differenceMinorUnits, balance.currencyCode)}</td></tr>)}</tbody></table></div>}
      </section>
    </div>}
  </div>;
};
