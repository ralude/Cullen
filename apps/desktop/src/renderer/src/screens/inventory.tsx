import { useEffect, useState } from 'react';
import {
  completePurchaseReceiptContract,
  getInventoryReportContract,
  isPermissionGranted,
  listSuppliersContract,
  receivePurchaseContract,
  registerStockAdjustmentContract,
  startPurchaseReceiptContract,
  type InventoryReportResponse,
  type KardexDto,
  type SupplierResponse
} from '@supermarket/shared';
import { formatScaledDecimal } from '../amount-input.js';
import { createIdempotencyKey } from '../api-transport.js';
import { ProductPicker, productLabel, useProductCatalog } from './product-picker.js';
import {
  ActionButton, EmptyState, Feedback, ReasonField, ScreenNote, type ScreenProps
} from './shared.js';

import { filterSuppliers, PurchaseReceiptPanel } from './purchase-receipt.js';

/** El filtro vive con el panel que lo usa; la pantalla lo reexporta. */
export { filterSuppliers };

export const InventoryScreen = ({ api, permissionCodes }: ScreenProps): React.JSX.Element => {
  const [productId, setProductId] = useState('');
  const [consultedProductId, setConsultedProductId] = useState('');
  const [kardex, setKardex] = useState<KardexDto | null>(null);
  const [kardexBatchId, setKardexBatchId] = useState('');
  const [kardexFrom, setKardexFrom] = useState('');
  const [kardexTo, setKardexTo] = useState('');
  const [kardexReason, setKardexReason] = useState('');
  const [kardexLimit, setKardexLimit] = useState('100');
  const [type, setType] = useState<'WASTE' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT'>('WASTE');
  const [quantity, setQuantity] = useState('');
  /**
   * Un motivo por operación. Las tres compartían una sola variable, así que
   * escribir el motivo de un ajuste lo dejaba escrito en la recepción, y la
   * recepción documentada —que no tenía campo propio— enviaba lo que hubiera
   * quedado al lado. Una recepción completada es inmutable y lleva efectos de
   * costo: su motivo queda en la auditoría tal como se envió.
   */
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [referenceId, setReferenceId] = useState('');
  const [suppliers, setSuppliers] = useState<readonly SupplierResponse[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<readonly InventoryReportResponse[] | null>(null);
  const products = useProductCatalog(api);
  const canReceive = isPermissionGranted(receivePurchaseContract.permission, permissionCodes);
  const canReceiveDocumented = isPermissionGranted(startPurchaseReceiptContract.permission, permissionCodes)
    && isPermissionGranted(completePurchaseReceiptContract.permission, permissionCodes);
  const canAdjust = isPermissionGranted(registerStockAdjustmentContract.permission, permissionCodes);

  useEffect(() => {
    if (isPermissionGranted(listSuppliersContract.permission, permissionCodes)) {
      void api.listSuppliers('ACTIVE').then(setSuppliers).catch(setError);
    }
    if (isPermissionGranted(getInventoryReportContract.permission, permissionCodes)) {
      void api.getInventoryReport({ asOf: new Date().toISOString(), limit: 100 })
        .then(setOverview).catch(setError);
    }
  }, [api, permissionCodes]);

  const dismissFeedback = (): void => { setError(null); setNotice(null); };

  /**
   * Lo que toda recepción comparte con la pantalla: marcar ocupado, limpiar el
   * error anterior, refrescar el kardex del artículo consultado y publicar su
   * aviso en el mismo feedback que usan la consulta y los ajustes.
   */
  const submitReceipt = async (run: () => Promise<void>, notice: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await run();
      setKardex(await api.getKardex(consultedProductId));
      setNotice(notice);
    } catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  };

  /**
   * Un producto sin kardex todavía puede recibirse: el nodo crea el artículo
   * en la primera recepción. Por eso la consulta conserva el producto aunque
   * no exista existencia previa que mostrar.
   */
  const consultKardex = async (consulted: string): Promise<void> => {
    if (!consulted) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    setConsultedProductId(consulted);
    try { setKardex(await api.getKardex(consulted, {
      ...(kardexBatchId.trim() ? { batchId: kardexBatchId.trim() } : {}),
      ...(kardexFrom ? { from: new Date(`${kardexFrom}T00:00:00.000Z`).toISOString() } : {}),
      ...(kardexTo ? { to: new Date(`${kardexTo}T23:59:59.999Z`).toISOString() } : {}),
      ...(kardexReason.trim() ? { reason: kardexReason.trim() } : {}),
      limit: Number(kardexLimit)
    })); }
    catch (nextError) {
      setKardex(null);
      setError(nextError);
    }
    finally { setLoading(false); }
  };

  const load = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await consultKardex(productId.trim());
  };

  /** Salta del listado de existencia al kardex de esa fila, sin copiar un UUID. */
  const showKardexOf = async (selected: string): Promise<void> => {
    setProductId(selected);
    await consultKardex(selected);
  };

  /** El stock item, su unidad y su escala se toman del kardex ya consultado. */
  const adjust = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!kardex) return;
    setLoading(true);
    setError(null);
    try {
      setKardex(await api.registerStockAdjustment(kardex.id, {
        type, quantityScaled: Number(quantity), quantityScale: kardex.quantityScale,
        reason: adjustmentReason.trim(), referenceId: referenceId.trim()
      }, createIdempotencyKey()));
      setNotice('Movimiento de inventario registrado.');
    } catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  };

  return (
    <div className="operation-screen">
      <ScreenNote>
        Consulta el kardex y registra recepciones o ajustes autorizados. La existencia y la
        trazabilidad pertenecen al agregado del nodo.
      </ScreenNote>
      <Feedback error={error} notice={notice} onDismiss={dismissFeedback} />
      {overview && <section className="panel">
        <div className="panel-heading">
          <div><h3>Artículos y vencimientos de este nodo</h3></div>
          <span className="status-label">Máximo 100 filas</span>
        </div>
        {overview.length === 0 ? <EmptyState>Sin existencia registrada.</EmptyState> :
          <div className="table-wrap"><table><thead><tr>
            <th>Producto</th><th>Lote</th><th>Unidad</th><th>Existencia</th><th>Vence</th><th />
          </tr></thead><tbody>{overview.map((entry) => <tr key={entry.stockItemId + (entry.batchId ?? '')}>
            <td title={entry.productId}>{productLabel(products, entry.productId)}</td>
            <td>{entry.lotNumber ?? '—'}</td><td>{entry.unitCode}</td>
            <td>{formatScaledDecimal(entry.onHandScaled, entry.quantityScale)}</td>
            <td>{entry.expiresAt ? new Date(entry.expiresAt).toLocaleDateString('es-VE') : 'Sin vencimiento'}</td>
            <td>
              <ActionButton type="button" disabled={loading}
                onClick={() => { void showKardexOf(entry.productId); }}>
                Ver kardex
              </ActionButton>
            </td>
          </tr>)}</tbody></table></div>}
      </section>}
      <section className="panel">
        <form className="inline-form" onSubmit={load}>
          <ProductPicker products={products} value={productId} onChange={setProductId} required />
          <ActionButton className="primary-button" type="submit" busy={loading}
            disabled={loading || !productId}>
            {loading ? 'Consultando…' : 'Consultar kardex'}
          </ActionButton>
          <label>Lote<input value={kardexBatchId} onChange={(event) => setKardexBatchId(event.target.value)} /></label>
          <label>Desde<input type="date" value={kardexFrom} onChange={(event) => setKardexFrom(event.target.value)} /></label>
          <label>Hasta<input type="date" value={kardexTo} onChange={(event) => setKardexTo(event.target.value)} /></label>
          <label>Motivo<input value={kardexReason} onChange={(event) => setKardexReason(event.target.value)} /></label>
          <label>Límite<input type="number" min="1" max="500" value={kardexLimit} onChange={(event) => setKardexLimit(event.target.value)} required /></label>
        </form>
      </section>
      {consultedProductId && (
        <div className="inventory-layout">
          {kardex ? (
          <section className="panel">
            <div className="panel-heading">
              <div><p className="eyebrow">Saldo actual</p><h3 title={kardex.productId}>{productLabel(products, kardex.productId)}</h3></div>
              <strong className="total-figure">
                {formatScaledDecimal(kardex.currentBalanceScaled, kardex.quantityScale)}
              </strong>
            </div>
            {kardex.batches.length > 0 && (
              <div>
                <p className="eyebrow">Lotes y vencimientos</p>
                <div className="detail-grid">
                  {kardex.batches.map((batch) => (
                    <div key={batch.id}>
                      <dt>{batch.lotNumber}</dt>
                      <dd>{batch.expiresAt
                        ? new Date(batch.expiresAt).toLocaleDateString('es-VE')
                        : 'Sin vencimiento'}</dd>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="table-wrap">
              <table>
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Dirección</th><th>Cantidad</th><th>Motivo</th></tr></thead>
                <tbody>{kardex.movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{new Date(movement.occurredAt).toLocaleString('es-VE')}</td>
                    <td>{movement.type}</td><td>{movement.direction}</td>
                    <td>{formatScaledDecimal(movement.quantityScaled, movement.quantityScale)}</td>
                    <td>{movement.reason}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
          ) : (
            <section className="panel">
              <EmptyState>
                <strong>{productLabel(products, consultedProductId)}</strong> todavía no tiene existencia registrada. La
                primera recepción crea su artículo de inventario con la unidad del catálogo.
              </EmptyState>
            </section>
          )}
          {(canReceive || canReceiveDocumented || (kardex && canAdjust)) && <section className="panel">
            <PurchaseReceiptPanel
              api={api}
              productId={consultedProductId}
              productLabel={productLabel(products, consultedProductId)}
              unitCode={kardex?.unitCode ?? null}
              suppliers={suppliers}
              canReceive={canReceive}
              canReceiveDocumented={canReceiveDocumented}
              busy={loading}
              onSubmit={submitReceipt}
            />
            {kardex && canAdjust && (
            <>
            <h3>Ajustar existencia</h3>
            <form className="stack-form" onSubmit={adjust}>
              <label>Tipo
                <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
                  <option value="WASTE">Merma</option>
                  <option value="ADJUSTMENT_IN">Ajuste entrada</option>
                  <option value="ADJUSTMENT_OUT">Ajuste salida</option>
                </select>
              </label>
              <label>Cantidad escalada<input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
              <label>Referencia<input value={referenceId} onChange={(event) => setReferenceId(event.target.value)} required /></label>
              <ReasonField
                value={adjustmentReason}
                onChange={setAdjustmentReason}
                suggestions={['Merma por daño', 'Producto vencido', 'Diferencia de conteo', 'Consumo interno', 'Robo o pérdida']}
              />
              <ActionButton className="primary-button" type="submit" busy={loading}
                disabled={loading || !isPermissionGranted(registerStockAdjustmentContract.permission, permissionCodes)}>
                {loading ? 'Registrando…' : 'Registrar ajuste'}
              </ActionButton>
            </form>
            </>
            )}
          </section>}
        </div>
      )}
    </div>
  );
};
