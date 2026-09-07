import { useState } from 'react';
import {
  getAuditReportContract, getCashClosureReportContract, getFiscalOperationsReportContract,
  getInventoryReportContract, getMarginReportContract, getSaleHistoryContract,
  getSalesReportContract, getShiftContract, isPermissionGranted,
  printSimulatedXReportContract, printSimulatedZReportContract,
  type AuditReportResponse, type CashClosureReportResponse,
  type FiscalOperationsReportResponse, type InventoryReportResponse,
  type MarginReportResponse, type SaleHistoryVersionResponse,
  type ProductResponse, type SalesReportResponse, type ShiftResponse
} from '@supermarket/shared';
import {
  createIdempotencyKey, formatScaledDecimal, type OperationApi, type ReportQuery
} from '../api-client.js';
import { productLabel, useProductCatalog } from './product-picker.js';
import {
  ActionButton, EmptyState, Feedback, ScreenNote, SectionError, money, section,
  type ReportSection, type ScreenProps
} from './shared.js';

export type OperationalReports = {
  readonly closures: ReportSection<readonly CashClosureReportResponse[]> | null;
  readonly audit: ReportSection<readonly AuditReportResponse[]> | null;
  readonly fiscal: ReportSection<FiscalOperationsReportResponse> | null;
  readonly margin: ReportSection<readonly MarginReportResponse[]> | null;
  readonly sales: ReportSection<readonly SalesReportResponse[]> | null;
  readonly inventory: ReportSection<readonly InventoryReportResponse[]> | null;
};
type ReportFilters = {
  readonly from: string; readonly to: string; readonly limit: string;
  readonly cashRegisterId: string;
};
type ReportsApi = Pick<
  OperationApi,
  'getCashClosureReport' | 'getAuditReport' | 'getFiscalOperationsReport' | 'getMarginReport'
  | 'getSalesReport' | 'getInventoryReport'
>;
const REPORT_CONTRACTS = [
  getCashClosureReportContract, getAuditReportContract, getFiscalOperationsReportContract,
  getMarginReportContract, getSalesReportContract, getInventoryReportContract
] as const;
const EXPIRY_LABELS: Record<InventoryReportResponse['expiryStatus'], string> = {
  NONE: 'Sin vencimiento', OK: 'Vigente', EXPIRING: 'Por vencer', EXPIRED: 'Vencido'
};

export const toReportQuery = (filters: ReportFilters): ReportQuery => ({
  ...(filters.from ? { from: new Date(`${filters.from}T00:00:00.000Z`).toISOString() } : {}),
  ...(filters.to ? { to: new Date(`${filters.to}T23:59:59.999Z`).toISOString() } : {}),
  ...(filters.limit.trim() ? { limit: Number(filters.limit) } : {})
});

export const loadOperationalReports = async (
  api: ReportsApi, filters: ReportFilters, permissionCodes: readonly string[]
): Promise<OperationalReports> => {
  const query = toReportQuery(filters);
  const asOf = new Date(`${filters.to}T23:59:59.999Z`).toISOString();
  const granted = (permission: string | null): boolean =>
    isPermissionGranted(permission, permissionCodes);
  const [closures, audit, fiscal, margin, sales, inventory] = await Promise.all([
    granted(getCashClosureReportContract.permission)
      ? section(() => api.getCashClosureReport({
        ...query,
        ...(filters.cashRegisterId.trim()
          ? { cashRegisterId: filters.cashRegisterId.trim() }
          : {})
      })) : null,
    granted(getAuditReportContract.permission) ? section(() => api.getAuditReport(query)) : null,
    granted(getFiscalOperationsReportContract.permission)
      ? section(() => api.getFiscalOperationsReport(query)) : null,
    granted(getMarginReportContract.permission) ? section(() => api.getMarginReport(query)) : null,
    granted(getSalesReportContract.permission) ? section(() => api.getSalesReport(query)) : null,
    granted(getInventoryReportContract.permission)
      ? section(() => api.getInventoryReport({
        asOf, ...(filters.limit.trim() ? { limit: Number(filters.limit) } : {})
      })) : null
  ]);
  return { closures, audit, fiscal, margin, sales, inventory };
};

export const toCsv = (rows: readonly (readonly string[])[]): string => rows
  .map((row) => row.map((value) => '"' + (/^[=+\-@]/.test(value) ? "'" + value : value)
    .replace(/"/g, '""') + '"').join(','))
  .join('\n');

const downloadCsv = (fileName: string, rows: readonly (readonly string[])[]): void => {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

const CsvButton = ({ fileName, rows }: {
  readonly fileName: string; readonly rows: readonly (readonly string[])[];
}): React.JSX.Element => (
  <div className="button-row"><button type="button" onClick={() => downloadCsv(fileName, rows)}>
    Exportar CSV visible
  </button></div>
);

const CashClosures = ({ report }: {
  readonly report: ReportSection<readonly CashClosureReportResponse[]>;
}): React.JSX.Element => <section className="panel">
  <p className="eyebrow">Caja</p><h3>Cierres y diferencias</h3>
  {!report.ok ? <SectionError error={report.error} /> : report.value.length === 0
    ? <EmptyState>Sin turnos en el período consultado.</EmptyState> : <>
      <div className="table-wrap"><table><thead><tr><th>Turno</th><th>Caja</th><th>Apertura</th><th>Cierre</th><th>Diferencias</th></tr></thead><tbody>
        {report.value.map((entry) => <tr key={entry.shiftId}>
          <td>{entry.shiftId}</td><td>{entry.cashRegisterId}</td><td>{entry.openedAt}</td>
          <td>{entry.closedAt ?? 'Turno abierto'}</td>
          <td>{entry.balances.length === 0 ? '—' : entry.balances.map((balance) =>
            `${balance.paymentMethodCode} ${money(balance.differenceMinorUnits, balance.currencyCode)}`
          ).join(' · ')}</td>
        </tr>)}
      </tbody></table></div>
      <CsvButton fileName="cierres-de-caja.csv" rows={[
        ['turno', 'caja', 'apertura', 'cierre', 'movimientos'],
        ...report.value.map((entry) => [entry.shiftId, entry.cashRegisterId, entry.openedAt,
          entry.closedAt ?? '', String(entry.movementCount)])
      ]} />
    </>}
</section>;

const Audit = ({ report }: {
  readonly report: ReportSection<readonly AuditReportResponse[]>;
}): React.JSX.Element => <section className="panel">
  <p className="eyebrow">Auditoría</p><h3>Operaciones sensibles</h3>
  {!report.ok ? <SectionError error={report.error} /> : report.value.length === 0
    ? <EmptyState>Sin entradas de auditoría en el período consultado.</EmptyState> : <>
      <div className="table-wrap"><table><thead><tr><th>Fecha UTC</th><th>Actor</th><th>Acción</th><th>Entidad</th><th>Motivo</th><th>Terminal</th></tr></thead><tbody>
        {report.value.map((entry) => <tr key={entry.auditId}>
          <td>{entry.occurredAt}</td><td>{entry.actorId}</td><td>{entry.action}</td>
          <td>{entry.entityType} · {entry.entityId}</td><td>{entry.reason}</td>
          <td>{entry.terminalId}</td>
        </tr>)}
      </tbody></table></div>
      <p className="muted">La auditoría no expone el contenido antes/después del agregado.</p>
      <CsvButton fileName="auditoria.csv" rows={[
        ['fechaUtc', 'actor', 'roles', 'accion', 'entidad', 'entidadId', 'motivo', 'terminal',
          'nodo', 'correlacion'],
        ...report.value.map((entry) => [entry.occurredAt, entry.actorId,
          entry.actorRoleCodes.join(' '), entry.action, entry.entityType, entry.entityId,
          entry.reason, entry.terminalId, entry.originNodeId, entry.correlationId])
      ]} />
    </>}
</section>;

const Fiscal = ({ report }: {
  readonly report: ReportSection<FiscalOperationsReportResponse>;
}): React.JSX.Element => <section className="panel">
  <p className="eyebrow">Fiscalidad</p><h3>Operaciones y estados recuperables</h3>
  {!report.ok ? <SectionError error={report.error} /> : report.value.operations.length === 0
    ? <EmptyState>Sin operaciones fiscales en el período consultado.</EmptyState> : <>
      <div className="table-wrap"><table><thead><tr><th>Tipo</th><th>Identificador</th><th>Operación</th><th>Estado</th><th>Intentos</th><th>Número</th><th>Error</th></tr></thead><tbody>
        {report.value.operations.map((entry) => <tr key={`${entry.kind}-${entry.id}`}>
          <td>{entry.kind === 'DOCUMENT' ? 'Documento' : 'Reporte'}</td><td>{entry.id}</td>
          <td>{entry.operationType}</td><td>{entry.status}</td><td>{entry.attempts}</td>
          <td>{entry.fiscalNumber ?? '—'}</td><td>{entry.lastErrorCode ?? '—'}</td>
        </tr>)}
      </tbody></table></div>
      <span className="simulation-label">SIMULACIÓN · {report.value.fiscalMode} · sin validez fiscal</span>
    </>}
</section>;

const Sales = ({ report }: {
  readonly report: ReportSection<readonly SalesReportResponse[]>;
}): React.JSX.Element => <section className="panel">
  <p className="eyebrow">Ventas</p><h3>Ventas completadas por moneda</h3>
  {!report.ok ? <SectionError error={report.error} /> : report.value.length === 0
    ? <EmptyState>Sin ventas completadas en el período consultado.</EmptyState> : <>
      <div className="table-wrap"><table><thead><tr><th>Moneda</th><th>Escala</th><th>Ventas</th><th>Líneas</th><th>Unidades</th><th>Bruto</th><th>Descuentos</th><th>Neto</th></tr></thead><tbody>
        {report.value.map((entry) => <tr key={`${entry.currencyCode}-${entry.quantityScale}`}>
          <td>{entry.currencyCode}</td><td>{entry.quantityScale}</td><td>{entry.salesCount}</td>
          <td>{entry.lineCount}</td>
          <td>{formatScaledDecimal(entry.quantitySoldScaled, entry.quantityScale)}</td>
          <td>{money(entry.grossMinorUnits, entry.currencyCode)}</td>
          <td>{money(entry.discountMinorUnits, entry.currencyCode)}</td>
          <td>{money(entry.netMinorUnits, entry.currencyCode)}</td>
        </tr>)}
      </tbody></table></div>
      <p className="muted">Período UTC del filtro · alcance del nodo · límite visible arriba.</p>
      <CsvButton fileName="ventas.csv" rows={[
        ['moneda', 'escala', 'ventas', 'lineas', 'unidades', 'bruto', 'descuentos', 'neto'],
        ...report.value.map((entry) => [entry.currencyCode, String(entry.quantityScale),
          String(entry.salesCount), String(entry.lineCount), String(entry.quantitySoldScaled),
          String(entry.grossMinorUnits), String(entry.discountMinorUnits),
          String(entry.netMinorUnits)])
      ]} />
    </>}
</section>;

const Margin = ({ report, products }: {
  readonly report: ReportSection<readonly MarginReportResponse[]>;
  readonly products: readonly ProductResponse[];
}): React.JSX.Element => <section className="panel">
  <p className="eyebrow">Margen</p><h3>Ingreso, costo y margen por producto</h3>
  {!report.ok ? <SectionError error={report.error} /> : report.value.length === 0
    ? <EmptyState>Sin ventas valoradas en el período consultado.</EmptyState> : <>
      <div className="table-wrap"><table><thead><tr><th>Producto</th><th>Moneda</th><th>Unidades</th><th>Ingreso</th><th>Costo</th><th>Margen</th></tr></thead><tbody>
        {report.value.map((entry) => <tr key={`${entry.productId}-${entry.currencyCode}-${entry.quantityScale}`}>
          <td title={entry.productId}>{productLabel(products, entry.productId)}</td><td>{entry.currencyCode}</td>
          <td>{formatScaledDecimal(entry.quantitySoldScaled, entry.quantityScale)}</td>
          <td>{entry.revenueMinorUnits === null ? '—' : money(entry.revenueMinorUnits, entry.currencyCode)}</td>
          <td>{entry.costMinorUnits === null ? '—' : money(entry.costMinorUnits, entry.currencyCode)}</td>
          <td>{entry.marginMinorUnits === null ? 'Sin determinar' : money(entry.marginMinorUnits, entry.currencyCode)}</td>
        </tr>)}
      </tbody></table></div>
      <CsvButton fileName="margen.csv" rows={[
        ['producto', 'moneda', 'unidades', 'escala', 'ingreso', 'costo', 'margen'],
        ...report.value.map((entry) => [entry.productId, entry.currencyCode,
          String(entry.quantitySoldScaled), String(entry.quantityScale),
          String(entry.revenueMinorUnits ?? ''), String(entry.costMinorUnits ?? ''),
          String(entry.marginMinorUnits ?? '')])
      ]} />
    </>}
</section>;

const Inventory = ({ report, products }: {
  readonly report: ReportSection<readonly InventoryReportResponse[]>;
  readonly products: readonly ProductResponse[];
}): React.JSX.Element => <section className="panel">
  <p className="eyebrow">Inventario</p><h3>Existencia por artículo y lote</h3>
  {!report.ok ? <SectionError error={report.error} /> : report.value.length === 0
    ? <EmptyState>Sin artículos de inventario para la fecha de corte.</EmptyState> : <>
      <div className="table-wrap"><table><thead><tr><th>Producto</th><th>Lote</th><th>Unidad</th><th>Existencia</th><th>Vence</th><th>Estado</th></tr></thead><tbody>
        {report.value.map((entry) => <tr key={`${entry.stockItemId}-${entry.batchId ?? ''}`}>
          <td title={entry.productId}>{productLabel(products, entry.productId)}</td><td>{entry.lotNumber ?? "—"}</td><td>{entry.unitCode}</td>
          <td>{formatScaledDecimal(entry.onHandScaled, entry.quantityScale)}</td>
          <td>{entry.expiresAt ? new Date(entry.expiresAt).toLocaleDateString('es-VE') : '—'}</td>
          <td>{EXPIRY_LABELS[entry.expiryStatus]}</td>
        </tr>)}
      </tbody></table></div>
      <p className="muted">Fecha de corte UTC del filtro · existencia del nodo · resultado acotado.</p>
      <CsvButton fileName="inventario.csv" rows={[
        ['producto', 'lote', 'unidad', 'escala', 'existencia', 'vence', 'estado'],
        ...report.value.map((entry) => [entry.productId, entry.lotNumber ?? '', entry.unitCode,
          String(entry.quantityScale), String(entry.onHandScaled), entry.expiresAt ?? '',
          entry.expiryStatus])
      ]} />
    </>}
</section>;

/**
 * Identidad legible de un turno cerrado: su apertura y su cierre. El supervisor
 * reconoce la jornada, no el UUID que el arqueo pedía escribir a mano.
 */
export const shiftOptionLabel = (closure: CashClosureReportResponse): string => {
  const opened = new Date(closure.openedAt);
  const stamp = Number.isNaN(opened.getTime())
    ? closure.openedAt
    : opened.toLocaleString('es-VE', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  return stamp + ' · ' + (closure.closedAt ? 'cerrado' : 'abierto')
    + ' · ' + closure.shiftId.slice(0, 8);
};

export const ReportsScreen = ({
  api, capabilities, permissionCodes
}: ScreenProps): React.JSX.Element => {
  const today = new Date().toISOString().slice(0, 10);
  const [filters, setFilters] = useState<ReportFilters>({
    from: today, to: today, limit: '100', cashRegisterId: ''
  });
  const [reports, setReports] = useState<OperationalReports | null>(null);
  const products = useProductCatalog(api);
  /** Turnos que el período consultado ya devolvió: alimentan el selector del arqueo. */
  const closedShifts = reports?.closures?.ok ? reports.closures.value : [];
  const [shiftId, setShiftId] = useState('');
  const [reviewedShift, setReviewedShift] = useState<ShiftResponse | null>(null);
  const [saleId, setSaleId] = useState('');
  const [saleHistory, setSaleHistory] = useState<readonly SaleHistoryVersionResponse[] | null>(null);
  const [dayId, setDayId] = useState('');
  const [businessDate, setBusinessDate] = useState(today);
  const [reason, setReason] = useState('Cierre operativo');
  const [consent, setConsent] = useState(false);
  const [printedReport, setPrintedReport] = useState<
    Awaited<ReturnType<OperationApi['printXReport']>>['report'] | null
  >(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const granted = (permission: string | null): boolean =>
    isPermissionGranted(permission, permissionCodes);
  const canReadReports = REPORT_CONTRACTS.some((contract) => granted(contract.permission));
  const canReviewShift = granted(getShiftContract.permission);
  const canReviewSale = granted(getSaleHistoryContract.permission);
  const canPrintX = granted(printSimulatedXReportContract.permission);
  const canPrintZ = granted(printSimulatedZReportContract.permission);
  const update = (key: keyof ReportFilters) =>
    (event: React.ChangeEvent<HTMLInputElement>): void =>
      setFilters((current) => ({ ...current, [key]: event.target.value }));

  const query = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault(); setLoading(true); setError(null);
    try { setReports(await loadOperationalReports(api, filters, permissionCodes)); }
    catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  };
  const reviewShift = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault(); setLoading(true); setError(null);
    try { setReviewedShift(await api.getShift(shiftId.trim())); }
    catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  };
  const reviewSale = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault(); setLoading(true); setError(null);
    try { setSaleHistory(await api.getSaleHistory(saleId.trim(), { limit: Number(filters.limit) })); }
    catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  };
  const print = async (type: 'X' | 'Z'): Promise<void> => {
    if (!consent) return;
    setLoading(true); setError(null);
    try {
      const input = {
        dayId: dayId.trim(), businessDate, reason: reason.trim(),
        simulationConsent: 'ALLOW_SIMULATED_X_AND_Z' as const
      };
      const response = type === 'X'
        ? await api.printXReport(input, createIdempotencyKey())
        : await api.printZReport(input, createIdempotencyKey());
      setPrintedReport(response.report);
    } catch (nextError) { setError(nextError); }
    finally { setConsent(false); setLoading(false); }
  };

  return <div className="operation-screen">
    <ScreenNote>Cada consulta declara período UTC, alcance del nodo y límite. La vista presenta las proyecciones autorizadas y no recalcula negocio.</ScreenNote>
    <Feedback error={error} notice={null} onDismiss={() => setError(null)} />
    {canReadReports && <section className="panel">
      <p className="eyebrow">Período consultado</p><h3>Filtros en UTC</h3>
      <form className="stack-form" onSubmit={query}><div className="form-grid">
        <label>Desde (UTC)<input type="date" value={filters.from} onChange={update('from')} required /></label>
        <label>Hasta (UTC)<input type="date" value={filters.to} onChange={update('to')} required /></label>
        <label>Caja (opcional)<input value={filters.cashRegisterId} onChange={update('cashRegisterId')} /></label>
        <label>Filas (máximo 500)<input type="number" min="1" max="500" value={filters.limit} onChange={update('limit')} required /></label>
      </div><ActionButton className="primary-button" type="submit" busy={loading} disabled={loading}>{loading ? 'Consultando…' : 'Consultar reportes'}</ActionButton></form>
    </section>}
    {canReviewShift && <section className="panel">
      <p className="eyebrow">Supervisión de caja</p><h3>Consultar arqueo</h3>
      <form className="inline-form" onSubmit={reviewShift}>
        {closedShifts.length > 0
          ? <label className="grow">Turno
            <select value={shiftId} onChange={(event) => setShiftId(event.target.value)} required>
              <option value="">Selecciona un turno del período</option>
              {closedShifts.map((closure) => (
                <option key={closure.shiftId} value={closure.shiftId}>
                  {shiftOptionLabel(closure)}
                </option>
              ))}
            </select>
          </label>
          : <label className="grow">Turno
            <input value={shiftId} onChange={(event) => setShiftId(event.target.value)}
              placeholder="Consulta el período para elegirlo de la lista" required />
          </label>}
        <ActionButton type="submit" busy={loading} disabled={loading || !shiftId.trim()}>Consultar arqueo</ActionButton>
      </form>
      {reviewedShift && <><dl className="detail-grid">
        <div><dt>Operador</dt><dd>{reviewedShift.openedBy}</dd></div>
        <div><dt>Estado</dt><dd>{reviewedShift.status}</dd></div>
        <div><dt>Apertura</dt><dd>{reviewedShift.openedAt}</dd></div>
        <div><dt>Cierre</dt><dd>{reviewedShift.closedAt ?? 'Abierto'}</dd></div>
      </dl>{reviewedShift.closingBalances && <div className="table-wrap"><table><thead><tr><th>Método</th><th>Moneda</th><th>Esperado</th><th>Declarado</th><th>Diferencia</th></tr></thead><tbody>
        {reviewedShift.closingBalances.map((balance) => <tr key={`${balance.paymentMethodCode}-${balance.currencyCode}`}>
          <td>{balance.paymentMethodCode}</td><td>{balance.currencyCode}</td>
          <td>{money(balance.expectedMinorUnits, balance.currencyCode)}</td>
          <td>{money(balance.declaredMinorUnits, balance.currencyCode)}</td>
          <td>{money(balance.differenceMinorUnits, balance.currencyCode)}</td>
        </tr>)}
      </tbody></table></div>}</>}
    </section>}
    {canReviewSale && <section className="panel">
      <p className="eyebrow">Revisión de venta</p><h3>Revisar historia</h3>
      <form className="inline-form" onSubmit={reviewSale}>
        <label className="grow">Venta<input value={saleId} onChange={(event) => setSaleId(event.target.value)} placeholder="Identificador que muestra la pantalla de Venta al cerrar" required /></label>
        <ActionButton type="submit" busy={loading} disabled={loading || !saleId.trim()}>Revisar historia</ActionButton>
      </form>
      {saleHistory && (saleHistory.length === 0
        ? <EmptyState>La venta no tiene versiones consultables.</EmptyState>
        : <div className="table-wrap"><table><thead><tr><th>Versión</th><th>Fecha UTC</th><th>Evento</th><th>Estado</th><th>Actor</th><th>Receptor</th><th>Reintegro</th></tr></thead><tbody>
          {saleHistory.map((entry) => <tr key={`${entry.version}-${entry.eventType}`}>
            <td>{entry.version}</td><td>{entry.occurredAt}</td><td>{entry.eventType}</td>
            <td>{entry.status}</td><td>{entry.actorId}</td>
            <td>{entry.recipientAttached ? 'Sí' : 'No'}</td><td>{entry.refundMinorUnits ?? '—'}</td>
          </tr>)}
        </tbody></table></div>)}
    </section>}
    {reports?.closures && <CashClosures report={reports.closures} />}
    {reports?.audit && <Audit report={reports.audit} />}
    {reports?.fiscal && <Fiscal report={reports.fiscal} />}
    {reports?.sales && <Sales report={reports.sales} />}
    {reports?.margin && <Margin report={reports.margin} products={products} />}
    {reports?.inventory && <Inventory report={reports.inventory} products={products} />}
    {(canPrintX || canPrintZ) && (capabilities.simulatedReportsEnabled
      ? <section className="panel">
        <p className="eyebrow">Acciones fiscales simuladas</p><h3>Reportes X y Z</h3>
        <p className="muted">Estas acciones ejecutan el simulador y quedan registradas.</p>
        <div className="form-grid">
          <label>Día fiscal<input value={dayId} onChange={(event) => setDayId(event.target.value)} required /></label>
          <label>Fecha de negocio<input type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} required /></label>
        </div>
        <label>Motivo<input value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
        <label className="consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> Confirmo que ejecutaré una simulación y que su resultado no es un cierre fiscal legal.</label>
        <div className="button-row">
          {canPrintX && <ActionButton type="button" onClick={() => void print('X')} busy={loading} disabled={loading || !consent || !dayId.trim() || !reason.trim()}>Solicitar X simulado</ActionButton>}
          {canPrintZ && <ActionButton className="primary-button" type="button" onClick={() => void print('Z')} busy={loading} disabled={loading || !consent || !dayId.trim() || !reason.trim()}>Solicitar Z simulado</ActionButton>}
        </div>
      </section>
      : <section className="panel">
        <p className="eyebrow">Acciones fiscales simuladas</p><h3>Reportes X y Z</h3>
        <p className="muted">Los reportes simulados están deshabilitados por la configuración del nodo.</p>
      </section>)}
    {printedReport && <section className="panel">
      <p className="eyebrow">Resultado del simulador</p>
      <h3>Reporte {printedReport.type} · {printedReport.status}</h3>
      <span className="simulation-label">SIMULACIÓN · no es documento fiscal legal</span>
    </section>}
    <section className="panel">
      <p className="eyebrow">Sincronización</p><h3>Estado del nodo</h3>
      <p className="muted">La sincronización offline-first pertenece a la Fase 10. Esta vista no inventa pendientes ni estados de red.</p>
    </section>
  </div>;
};
