import { useCallback, useEffect, useRef, useState } from 'react';
import {
  approveStockCountContract,
  isPermissionGranted,
  openStockCountContract,
  rejectStockCountContract,
  type StockCountResponse,
  type StockCountStatusResponse
} from '@supermarket/shared';
import { createIdempotencyKey, formatScaledDecimal } from '../api-client.js';
import { ActionButton, EmptyState, Feedback, ScreenNote, type ScreenProps } from './shared.js';

/** Contratos que convierten esta pantalla en trabajo real y no en una lectura. */
const STOCK_COUNT_COMMAND_CONTRACTS = [
  openStockCountContract, approveStockCountContract, rejectStockCountContract
] as const;

/**
 * El listado de conteos existe para quien cuenta o quien aprueba; una sesión
 * sin ninguno de los dos permisos no tiene trabajo real en esta pantalla.
 */
export const canWorkOnStockCounts = (permissionCodes: readonly string[]): boolean =>
  STOCK_COUNT_COMMAND_CONTRACTS.some(
    (contract) => isPermissionGranted(contract.permission, permissionCodes)
  );

export const STOCK_COUNT_STATUS_LABELS: Record<StockCountStatusResponse, string> = {
  OPEN: 'Abierto',
  COUNTED: 'Cerrado, pendiente de aprobación',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado'
};

const scaled = formatScaledDecimal;

export const StockCountsScreen = ({ api, permissionCodes }: ScreenProps): React.JSX.Element => {
  const [counts, setCounts] = useState<readonly StockCountResponse[]>([]);
  const [statusFilter, setStatusFilter] = useState<'' | StockCountStatusResponse>('');
  const [selected, setSelected] = useState<StockCountResponse | null>(null);
  const [openReason, setOpenReason] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [batchId, setBatchId] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [decisionReason, setDecisionReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const intentKeys = useRef(new Map<string, string>());
  const intentKey = (intent: string): string => {
    const existing = intentKeys.current.get(intent);
    if (existing) return existing;
    const created = createIdempotencyKey();
    intentKeys.current.set(intent, created);
    return created;
  };

  const canPerform = isPermissionGranted('inventory.count.perform', permissionCodes);
  const canApprove = isPermissionGranted('inventory.count.approve', permissionCodes);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try { setCounts(await api.listStockCounts(statusFilter === '' ? undefined : statusFilter)); }
    catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  }, [api, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const dismissFeedback = (): void => { setError(null); setNotice(null); };

  const select = (count: StockCountResponse): void => {
    setSelected(count);
    setProductId(''); setQuantity(''); setBatchId('');
    setCloseReason(''); setDecisionReason('');
  };

  const run = async (command: () => Promise<StockCountResponse>, message: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const count = await command();
      select(count);
      setNotice(message);
      await load();
      return true;
    } catch (nextError) { setError(nextError); return false; }
    finally { setLoading(false); }
  };

  const open = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const intent = `open:${openReason.trim()}`;
    const succeeded = await run(async () => {
      const count = await api.openStockCount({ reason: openReason.trim() }, intentKey(intent));
      setOpenReason('');
      return count;
    }, 'Conteo abierto.');
    if (succeeded) intentKeys.current.delete(intent);
  };

  const recordLine = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!selected) return;
    const intent = `line:${selected.id}:${productId.trim()}:${quantity.trim()}:${batchId.trim()}`;
    const succeeded = await run(() => api.recordStockCountLine(selected.id, {
      productId: productId.trim(), quantity: quantity.trim(),
      ...(batchId.trim() ? { batchId: batchId.trim() } : {})
    }, intentKey(intent)), 'Línea registrada.');
    if (succeeded) {
      intentKeys.current.delete(intent);
      setProductId(''); setQuantity(''); setBatchId('');
    }
  };

  const close = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!selected) return;
    const intent = `close:${selected.id}:${closeReason.trim()}`;
    if (await run(
      () => api.closeStockCount(selected.id, { reason: closeReason.trim() }, intentKey(intent)),
      'Conteo cerrado. Revisa las diferencias antes de aprobar.'
    )) intentKeys.current.delete(intent);
  };

  const approve = async (): Promise<void> => {
    if (!selected) return;
    const intent = `approve:${selected.id}:${decisionReason.trim()}`;
    if (await run(
      () => api.approveStockCount(selected.id, { reason: decisionReason.trim() }, intentKey(intent)),
      'Conteo aprobado; los ajustes ya quedaron registrados.'
    )) intentKeys.current.delete(intent);
  };

  const reject = async (): Promise<void> => {
    if (!selected) return;
    const intent = `reject:${selected.id}:${decisionReason.trim()}`;
    if (await run(
      () => api.rejectStockCount(selected.id, { reason: decisionReason.trim() }, intentKey(intent)),
      'Conteo rechazado; el inventario no cambió.'
    )) intentKeys.current.delete(intent);
  };

  return (
    <div className="operation-screen">
      <ScreenNote>
        Registra el conteo físico de existencia. La diferencia contra el kardex se calcula al
        cerrar y queda congelada: aprobar produce el ajuste exacto de esa diferencia, sin
        recalcularla contra el saldo del momento.
      </ScreenNote>
      <Feedback error={error} notice={notice} onDismiss={dismissFeedback} />
      <section className="panel">
        <div className="screen-toolbar">
          <label>Estado
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as '' | StockCountStatusResponse)}
            >
              <option value="">Todos</option>
              <option value="OPEN">Abiertos</option>
              <option value="COUNTED">Cerrados, pendientes de aprobación</option>
              <option value="APPROVED">Aprobados</option>
              <option value="REJECTED">Rechazados</option>
            </select>
          </label>
          <ActionButton type="button" onClick={() => void load()} busy={loading} disabled={loading}>
            {loading ? 'Consultando…' : 'Actualizar listado'}
          </ActionButton>
        </div>
        {canPerform && (
          <form className="inline-form" onSubmit={open}>
            <label className="grow">Motivo del nuevo conteo
              <input value={openReason} onChange={(event) => setOpenReason(event.target.value)} required />
            </label>
            <ActionButton className="primary-button" type="submit" busy={loading} disabled={loading}>
              Abrir conteo
            </ActionButton>
          </form>
        )}
        {counts.length === 0 ? (
          <EmptyState>No hay conteos registrados para este filtro.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Abierto</th><th>Estado</th><th>Líneas</th><th /></tr></thead>
              <tbody>
                {counts.map((count) => (
                  <tr key={count.id}>
                    <td>{new Date(count.openedAt).toLocaleString('es-VE')}</td>
                    <td>{STOCK_COUNT_STATUS_LABELS[count.status]}</td>
                    <td>{count.lines.length}</td>
                    <td><button type="button" onClick={() => select(count)}>Ver detalle</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selected && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Conteo</p>
              <h3>{STOCK_COUNT_STATUS_LABELS[selected.status]}</h3>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Producto</th><th>Lote</th><th>Contado</th></tr></thead>
              <tbody>
                {selected.lines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.productId}</td>
                    <td>{line.batchId ?? '—'}</td>
                    <td>{scaled(line.countedQuantityScaled, line.quantityScale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected.status === 'OPEN' && canPerform && (
            <>
              <form className="stack-form" onSubmit={recordLine}>
                <p className="eyebrow">Registrar línea</p>
                <label>Producto
                  <input value={productId} onChange={(event) => setProductId(event.target.value)} required />
                </label>
                <label>Cantidad contada
                  <input inputMode="decimal" pattern="\d+([.,]\d+)?" placeholder="0"
                    value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
                </label>
                <label>Lote (si el artículo lo exige)
                  <input value={batchId} onChange={(event) => setBatchId(event.target.value)} />
                </label>
                <ActionButton className="primary-button" type="submit" busy={loading} disabled={loading}>
                  Registrar
                </ActionButton>
              </form>
              <form className="stack-form" onSubmit={close}>
                <p className="eyebrow">Cerrar conteo</p>
                <label>Motivo
                  <input value={closeReason} onChange={(event) => setCloseReason(event.target.value)} required />
                </label>
                <ActionButton type="submit" busy={loading} disabled={loading || selected.lines.length === 0}>
                  Cerrar y calcular diferencias
                </ActionButton>
              </form>
            </>
          )}
          {selected.status === 'COUNTED' && (
            <>
              <p className="eyebrow">Diferencias congeladas al cerrar</p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Producto/artículo</th><th>Esperado</th><th>Contado</th><th>Diferencia</th></tr></thead>
                  <tbody>
                    {(selected.differences ?? []).map((difference) => (
                      <tr key={difference.lineId}>
                        <td>{difference.stockItemId}</td>
                        <td>{scaled(difference.expectedScaled, difference.quantityScale)}</td>
                        <td>{scaled(difference.countedScaled, difference.quantityScale)}</td>
                        <td>{scaled(difference.differenceScaled, difference.quantityScale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canApprove && (
                <div className="stack-form">
                  <p className="eyebrow">Decisión del supervisor</p>
                  <label>Motivo
                    <input value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} required />
                  </label>
                  <div className="button-row">
                    <ActionButton className="primary-button" type="button" busy={loading} disabled={loading}
                      onClick={() => void approve()}>
                      Aprobar y ajustar inventario
                    </ActionButton>
                    <ActionButton type="button" busy={loading} disabled={loading}
                      onClick={() => void reject()}>
                      Rechazar
                    </ActionButton>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
};
