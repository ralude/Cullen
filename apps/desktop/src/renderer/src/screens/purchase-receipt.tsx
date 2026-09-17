/**
 * Flujo de recepción de compra.
 *
 * Aislado de la pantalla de inventario por 12.05.06: tiene proveedor,
 * documento, costo, lote y ciclo propios, y no comparte nada con la consulta
 * del kardex ni con los ajustes salvo el artículo consultado. Sus doce campos
 * viven aquí y la pantalla ya no los conoce.
 *
 * Los efectos compartidos siguen siendo de la pantalla: `onSubmit` recibe la
 * operación y su aviso, y es la pantalla la que marca ocupado, limpia el error,
 * refresca el kardex y publica el mismo feedback de siempre.
 */
import { useMemo, useState } from 'react';
import type { SupplierResponse } from '@supermarket/shared';
import { createIdempotencyKey } from '../api-transport.js';
import type { OperationApi } from '../api-client.js';
import { ActionButton, ReasonField } from './shared.js';

/** El filtro del selector: código, nombre comercial, razón social o RIF. */
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

type PurchaseReceiptPanelProps = {
  readonly api: OperationApi;
  readonly productId: string;
  readonly productLabel: string;
  readonly unitCode: string | null;
  readonly suppliers: readonly SupplierResponse[];
  readonly canReceive: boolean;
  readonly canReceiveDocumented: boolean;
  readonly busy: boolean;
  readonly onSubmit: (run: () => Promise<void>, notice: string) => Promise<void>;
};

export const PurchaseReceiptPanel = ({
  api, productId, productLabel, unitCode, suppliers, canReceive, canReceiveDocumented,
  busy, onSubmit
}: PurchaseReceiptPanelProps): React.JSX.Element => {
  const [supplierQuery, setSupplierQuery] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [receiptId, setReceiptId] = useState('');
  const [receiveQuantity, setReceiveQuantity] = useState('');
  const [lotNumber, setLotNumber] = useState('');
  const [lotExpiresAt, setLotExpiresAt] = useState('');
  const [receiptReason, setReceiptReason] = useState('');
  const [documentType, setDocumentType] = useState<'INVOICE' | 'DELIVERY_NOTE'>('INVOICE');
  const [documentNumber, setDocumentNumber] = useState('');
  const [unitCostMinorUnits, setUnitCostMinorUnits] = useState('');
  const [purchaseCurrency, setPurchaseCurrency] = useState('USD');
  const [documentReason, setDocumentReason] = useState('');

  const visibleSuppliers = useMemo(
    () => filterSuppliers(suppliers, supplierQuery),
    [suppliers, supplierQuery]
  );

  const lot = (): { readonly lot?: { lotNumber: string; expiresAt?: string } } =>
    (lotNumber.trim()
      ? {
        lot: {
          lotNumber: lotNumber.trim(),
          ...(lotExpiresAt ? { expiresAt: new Date(lotExpiresAt).toISOString() } : {})
        }
      }
      : {});

  /**
   * La recepción solo declara negocio. El artículo de inventario, su unidad,
   * su escala y si maneja lotes los resuelve el nodo desde el catálogo.
   */
  const receive = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!productId) return;
    await onSubmit(async () => {
      await api.receivePurchase({
        productId, quantity: receiveQuantity.trim(), supplierId,
        receiptId: receiptId.trim(), reason: receiptReason.trim(),
        ...lot()
      }, createIdempotencyKey());
    }, 'Recepción registrada.');
  };

  /**
   * Recepción documentada (9B.04): crea el borrador con su documento de origen
   * y su costo, y lo completa en un segundo comando explícito. El promedio
   * ponderado y la valoración los calcula el caso de uso, no esta pantalla.
   */
  const receiveWithDocument = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!productId) return;
    await onSubmit(async () => {
      const draft = await api.startPurchaseReceipt({
        supplierId,
        sourceDocument: { type: documentType, number: documentNumber.trim() },
        effectiveAt: new Date().toISOString(),
        reason: documentReason.trim(),
        lines: [{
          productId, quantity: receiveQuantity.trim(),
          purchaseUnitCostMinorUnits: Number(unitCostMinorUnits),
          purchaseCurrency: purchaseCurrency.trim().toUpperCase(),
          ...lot()
        }]
      }, createIdempotencyKey());
      await api.completePurchaseReceipt(
        draft.id, { reason: documentReason.trim() }, createIdempotencyKey()
      );
    }, 'Recepción documentada completada con su costo.');
  };

  return (<>
  {canReceive && <>
  <h3>Registrar compra</h3>
  <form className="stack-form" onSubmit={receive}>
    <p className="muted">
      Recepción de <strong>{productLabel}</strong>
      {unitCode ? ` (${unitCode})` : ''}. La unidad, la escala y el artículo los
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
    <ReasonField
      value={receiptReason}
      onChange={setReceiptReason}
      suggestions={['Compra a proveedor', 'Reposición de existencia', 'Canje por producto dañado']}
    />
    <ActionButton className="primary-button" type="submit" busy={busy}
      disabled={busy}>
      {busy ? 'Registrando…' : 'Registrar recepción'}
    </ActionButton>
  </form>
  </>}
  {canReceiveDocumented && <>
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
    <ReasonField
      value={documentReason}
      onChange={setDocumentReason}
      suggestions={['Compra con factura', 'Compra con guía de despacho', 'Reposición documentada']}
    />
    <ActionButton className="primary-button" type="submit" busy={busy}
      disabled={busy || !documentNumber.trim() || !unitCostMinorUnits.trim()
        || !documentReason.trim()}>
      {busy ? 'Registrando…' : 'Completar recepción documentada'}
    </ActionButton>
  </form>
  </>}
  </>);
};
