import { useEffect, useMemo, useState } from 'react';
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
import { createIdempotencyKey, formatScaledDecimal } from '../api-client.js';
import { ActionButton, EmptyState, Feedback, ScreenNote, type ScreenProps } from './shared.js';

export const filterSuppliers = (
  suppliers: readonly SupplierResponse[],
  query: string
): readonly SupplierResponse[] => {
  const normalized = query.trim().toLocaleUpperCase('es-VE');
  if (!normalized) return suppliers;
  return suppliers.filter((supplier) => [
    supplier.code,
    supplier.legalName,
    supplier.tradeName ?? '',
    supplier.taxIdentity.normalizedValue
  ].some((value) => value.toLocaleUpperCase('es-VE').includes(normalized)));
};

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
  const [reason, setReason] = useState('');
  const [referenceId, setReferenceId] = useState('');
  const [suppliers, setSuppliers] = useState<readonly SupplierResponse[]>([]);
  const [supplierQuery, setSupplierQuery] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [receiptId, setReceiptId] = useState('');
  const [receiveQuantity, setReceiveQuantity] = useState('');
  const [lotNumber, setLotNumber] = useState('');
  const [lotExpiresAt, setLotExpiresAt] = useState('');
  const [documentType, setDocumentType] = useState<'INVOICE' | 'DELIVERY_NOTE'>('INVOICE');
  const [documentNumber, setDocumentNumber] = useState('');
  const [unitCostMinorUnits, setUnitCostMinorUnits] = useState('');
  const [purchaseCurrency, setPurchaseCurrency] = useState('USD');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<readonly InventoryReportResponse[] | null>(null);
  const visibleSuppliers = useMemo(
    () => filterSuppliers(suppliers, supplierQuery),
    [suppliers, supplierQuery]
  );
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
   * Un producto sin kardex todavía puede recibirse: el nodo crea el artículo
   * en la primera recepción. Por eso la consulta conserva el producto aunque
   * no exista existencia previa que mostrar.
   */
  const load = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const consulted = productId.trim();
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

  /** El stock item, su unidad y su escala se toman del kardex ya consultado. */
  const adjust = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!kardex) return;
    setLoading(true);
    setError(null);
    try {
      setKardex(await api.registerStockAdjustment(kardex.id, {
        type, quantityScaled: Number(quantity), quantityScale: kardex.quantityScale,
        reason: reason.trim(), referenceId: referenceId.trim()
      }, createIdempotencyKey()));
      setNotice('Movimiento de inventario registrado.');
    } catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  };

  /**
   * La recepción solo declara negocio. El artículo de inventario, su unidad,
   * su escala y si maneja lotes los resuelve el nodo desde el catálogo.
   */
  const receive = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!consultedProductId) return;
    setLoading(true);
    setError(null);
    try {
      await api.receivePurchase({
        productId: consultedProductId, quantity: receiveQuantity.trim(), supplierId,
        receiptId: receiptId.trim(), reason: reason.trim(),
        ...(lotNumber.trim() ? {
          lot: {
            lotNumber: lotNumber.trim(),
            ...(lotExpiresAt ? { expiresAt: new Date(lotExpiresAt).toISOString() } : {})
          }
        } : {})
      }, createIdempotencyKey());
      setKardex(await api.getKardex(consultedProductId));
      setNotice('Recepción registrada.');
    } catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  };

  /**
   * Recepción documentada (9B.04): crea el borrador con su documento de origen
   * y su costo, y lo completa en un segundo comando explícito. El promedio
   * ponderado y la valoración los calcula el caso de uso, no esta pantalla.
   */
  const receiveWithDocument = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!consultedProductId) return;
    setLoading(true);
    setError(null);
    try {
      const draft = await api.startPurchaseReceipt({
        supplierId,
        sourceDocument: { type: documentType, number: documentNumber.trim() },
        effectiveAt: new Date().toISOString(),
        reason: reason.trim(),
        lines: [{
          productId: consultedProductId, quantity: receiveQuantity.trim(),
          purchaseUnitCostMinorUnits: Number(unitCostMinorUnits),
          purchaseCurrency: purchaseCurrency.trim().toUpperCase(),
          ...(lotNumber.trim() ? {
            lot: {
              lotNumber: lotNumber.trim(),
              ...(lotExpiresAt ? { expiresAt: new Date(lotExpiresAt).toISOString() } : {})
            }
          } : {})
        }]
      }, createIdempotencyKey());
      await api.completePurchaseReceipt(draft.id, { reason: reason.trim() }, createIdempotencyKey());
      setKardex(await api.getKardex(consultedProductId));
      setNotice('Recepción documentada completada con su costo.');
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
          <div><p className="eyebrow">Existencia del nodo</p><h3>Artículos y vencimientos</h3></div>
          <span className="status-label">Máximo 100 filas</span>
        </div>
        {overview.length === 0 ? <EmptyState>Sin existencia registrada.</EmptyState> :
          <div className="table-wrap"><table><thead><tr>
            <th>Producto</th><th>Lote</th><th>Unidad</th><th>Existencia</th><th>Vence</th>
          </tr></thead><tbody>{overview.map((entry) => <tr key={entry.stockItemId + (entry.batchId ?? '')}>
            <td>{entry.productId}</td><td>{entry.lotNumber ?? '—'}</td><td>{entry.unitCode}</td>
            <td>{formatScaledDecimal(entry.onHandScaled, entry.quantityScale)}</td>
            <td>{entry.expiresAt ? new Date(entry.expiresAt).toLocaleDateString('es-VE') : 'Sin vencimiento'}</td>
          </tr>)}</tbody></table></div>}
      </section>}
      <section className="panel">
        <form className="inline-form" onSubmit={load}>
          <label className="grow">Producto
            <input value={productId} onChange={(event) => setProductId(event.target.value)}
              placeholder="Identificador del producto" required />
          </label>
          <ActionButton className="primary-button" type="submit" busy={loading} disabled={loading}>
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
              <div><p className="eyebrow">Saldo actual</p><h3>{kardex.productId}</h3></div>
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
                <strong>{consultedProductId}</strong> todavía no tiene existencia registrada. La
                primera recepción crea su artículo de inventario con la unidad del catálogo.
              </EmptyState>
            </section>
          )}
          {(canReceive || canReceiveDocumented || (kardex && canAdjust)) && <section className="panel">
            {canReceive && <>
            <p className="eyebrow">Recepción</p>
            <h3>Registrar compra</h3>
            <form className="stack-form" onSubmit={receive}>
              <p className="muted">
                Recepción de <strong>{consultedProductId}</strong>
                {kardex ? ` (${kardex.unitCode})` : ''}. La unidad, la escala y el artículo los
                resuelve el nodo desde el catálogo.
              </p>
              <label>Buscar proveedor
                <input value={supplierQuery} onChange={(event) => setSupplierQuery(event.target.value)}
                  placeholder="Código, nombre o RIF" />
              </label>
              <label>Proveedor
                <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
                  <option value="">Selecciona un proveedor activo</option>
                  {visibleSuppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.code} — {supplier.tradeName ?? supplier.legalName}
                    </option>
                  ))}
                </select>
              </label>
              <label>Recibo<input value={receiptId} onChange={(event) => setReceiptId(event.target.value)} required /></label>
              <label>Cantidad<input inputMode="decimal" pattern="\d+([.,]\d+)?" placeholder="0,000" value={receiveQuantity} onChange={(event) => setReceiveQuantity(event.target.value)} required /></label>
              <label>Lote (opcional)<input value={lotNumber} onChange={(event) => setLotNumber(event.target.value)} /></label>
              <label>Vencimiento<input type="date" value={lotExpiresAt} onChange={(event) => setLotExpiresAt(event.target.value)} /></label>
              <label>Motivo<input value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
              <ActionButton className="primary-button" type="submit" busy={loading}
                disabled={loading}>
                {loading ? 'Registrando…' : 'Registrar recepción'}
              </ActionButton>
            </form>
            </>}
            {canReceiveDocumented && <>
            <p className="eyebrow">Recepción documentada</p>
            <h3>Compra con documento y costo</h3>
            <form className="stack-form" onSubmit={receiveWithDocument}>
              <p className="muted">
                Usa el proveedor, la cantidad, el lote y el motivo capturados arriba. El costo
                unitario viaja en unidades menores enteras y el nodo calcula la valoración y el
                promedio ponderado.
              </p>
              <label>Documento de origen
                <select value={documentType}
                  onChange={(event) => setDocumentType(event.target.value as typeof documentType)}>
                  <option value="INVOICE">Factura</option>
                  <option value="DELIVERY_NOTE">Guía de despacho</option>
                </select>
              </label>
              <label>Número del documento
                <input value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} />
              </label>
              <label>Costo unitario (unidades menores)
                <input type="number" min="0" value={unitCostMinorUnits}
                  onChange={(event) => setUnitCostMinorUnits(event.target.value)} />
              </label>
              <label>Moneda de compra
                <input value={purchaseCurrency} maxLength={3}
                  onChange={(event) => setPurchaseCurrency(event.target.value)} />
              </label>
              <ActionButton className="primary-button" type="submit" busy={loading}
                disabled={loading
                  || !documentNumber.trim() || !unitCostMinorUnits.trim()}>
                {loading ? 'Registrando…' : 'Completar recepción documentada'}
              </ActionButton>
            </form>
            </>}
            {kardex && canAdjust && (
            <>
            <p className="eyebrow">Movimiento autorizado</p>
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
              <label>Motivo<input value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
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
