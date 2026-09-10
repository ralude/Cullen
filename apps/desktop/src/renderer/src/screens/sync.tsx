import { useCallback, useEffect, useState } from 'react';
import {
  getSyncStatusContract,
  isPermissionGranted,
  listSyncNodesContract,
  type CoordinatedOperationResponse,
  type OperationalDeliveryResponse,
  type OperationalDiagnosticsResponse,
  type SyncDestinationStatusResponse,
  type SyncNodeResponse,
  type SyncReferenceEntryResponse,
  type SyncStatusResponse
} from '@supermarket/shared';
import { ActionButton, EmptyState, Feedback, ScreenNote, type ScreenProps } from './shared.js';

/**
 * La pantalla existe para quien puede revisar la recepción. El servidor vuelve
 * a autorizar cada lectura: ocultarla nunca sustituye esa autorización.
 */
export const canReviewSync = (permissionCodes: readonly string[]): boolean =>
  isPermissionGranted(getSyncStatusContract.permission, permissionCodes)
  || isPermissionGranted(listSyncNodesContract.permission, permissionCodes);

export const SYNC_STATUS_LABELS: Record<SyncStatusResponse, string> = {
  OFFLINE: 'Sin contacto',
  CONNECTING: 'Conectando',
  SYNCING: 'Sincronizando',
  SYNCED: 'Al día',
  ATTENTION_REQUIRED: 'Requiere atención'
};

/**
 * Qué significa cada rótulo, en los términos de ADR-0026. `SYNCED` no promete
 * que no vayan a llegar hechos nuevos: dice que el último ciclo verificado no
 * dejó trabajo pendiente conocido.
 */
export const SYNC_STATUS_HINTS: Record<SyncStatusResponse, string> = {
  OFFLINE: 'El destino configurado no respondió en el último ciclo. La operación local continúa.',
  CONNECTING: 'Intentando establecer una conexión confiable; todavía no promete entrega.',
  SYNCING: 'Hay transferencia, carga inicial o aplicación pendiente conocida.',
  SYNCED: 'El último ciclo verificado no dejó trabajo pendiente conocido a esta fecha.',
  ATTENTION_REQUIRED: 'Hay algo que exige intervención: pausa, bloqueo, discrepancia o concesión vencida.'
};

const CONNECTIVITY_LABELS: Record<SyncDestinationStatusResponse['connectivity'], string> = {
  ONLINE: 'En línea',
  OFFLINE: 'Sin contacto',
  CONNECTING: 'Conectando',
  UNKNOWN: 'Desconocida'
};

const COORDINATED_KIND_LABELS: Record<CoordinatedOperationResponse['kind'], string> = {
  PURCHASE_RECEIPT_COMPLETION: 'Recepción de compra',
  STOCK_COUNT_APPROVAL: 'Aprobación de conteo',
  SALE_RETURN: 'Devolución de venta'
};

const COORDINATED_STEP_LABELS: Record<'LOCAL_EFFECT' | 'COORDINATOR_EFFECT', string> = {
  LOCAL_EFFECT: 'Efectos locales',
  COORDINATOR_EFFECT: 'Efectos del coordinador'
};

const COORDINATED_STATE_LABELS: Record<'PENDING' | 'APPLIED' | 'REJECTED', string> = {
  PENDING: 'Pendiente',
  APPLIED: 'Aplicado',
  REJECTED: 'Rechazado'
};


/**
 * Estado de una entrega, en las palabras de quien supervisa la tienda. El
 * nombre interno sigue disponible en el error y en el código de seguimiento,
 * que es lo que hace falta para escalar el caso.
 */
export const DELIVERY_STATE_LABELS: Record<OperationalDeliveryResponse['status'], string> = {
  PENDING: 'En cola',
  PROCESSING: 'Enviando',
  PUBLISHED: 'Entregada',
  BLOCKED: 'Bloqueada',
  PAUSED: 'En pausa'
};

const SALE_ATTENTION_LABELS: Record<
  OperationalDiagnosticsResponse['salesAttention'][number]['state'], string
> = {
  LOCAL_REJECTED: 'Rechazo local de inventario',
  DELIVERY_PENDING: 'Entrega pendiente',
  DELIVERY_BLOCKED: 'Entrega pausada o bloqueada',
  APPLICATION_PENDING: 'Aplicación remota pendiente',
  APPLICATION_UNKNOWN: 'Aplicación remota sin confirmar',
  DISCREPANCY: 'Discrepancia abierta'
};

/**
 * Antigüedad legible. `null` significa **nunca recibida**, que no es lo mismo
 * que una referencia vacía ni que una recién llegada.
 */
export const referenceAge = (ageMilliseconds: number | null): string => {
  if (ageMilliseconds === null) return 'Nunca recibida';
  const minutes = Math.floor(ageMilliseconds / 60_000);
  if (minutes < 1) return 'hace instantes';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
};

/**
 * Vigencia de una referencia con vencimiento. Una vencida se rotula como tal:
 * volver a conectarse no la habilita.
 */
export const validityLabel = (expiresAt: string | null, expired: boolean): string => {
  if (expiresAt === null) return 'Sin vigencia declarada';
  const instant = new Date(expiresAt).toLocaleString('es-VE');
  return expired ? `Vencida el ${instant}` : `Vigente hasta ${instant}`;
};

type ReferenceRow = {
  readonly label: string;
  readonly entry: SyncReferenceEntryResponse;
  readonly validity: string | null;
  readonly expired: boolean;
  readonly note: string;
};

export const referenceRows = (
  references: SyncDestinationStatusResponse['references']
): readonly ReferenceRow[] => [{
  label: 'Catálogo',
  entry: references.catalog,
  validity: null,
  expired: false,
  note: 'Productos, precios e impuestos publicados por el coordinador.'
}, {
  label: 'Tasa de cambio',
  entry: references.exchangeRate,
  validity: validityLabel(references.exchangeRate.validUntil, references.exchangeRate.expired),
  expired: references.exchangeRate.expired,
  note: 'Una tasa vencida no se habilita porque el nodo haya vuelto a conectarse.'
}, {
  label: 'Concesiones de operador',
  entry: references.operatorGrants,
  validity: validityLabel(references.operatorGrants.expiresAt, references.operatorGrants.expired),
  expired: references.operatorGrants.expired,
  note: 'Vencidas, no se abren sesiones nuevas ni se autorizan acciones protegidas.'
}, {
  label: 'Disponibilidad',
  entry: references.stockAvailability,
  validity: null,
  expired: false,
  note: 'Informativa: no reserva existencias ni bloquea una venta offline.'
}];

export const SyncScreen = ({ api, permissionCodes }: ScreenProps): React.JSX.Element => {
  const [nodes, setNodes] = useState<readonly SyncNodeResponse[]>([]);
  const [destination, setDestination] = useState('');
  const [status, setStatus] = useState<SyncDestinationStatusResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<OperationalDiagnosticsResponse | null>(null);
  const [correlationId, setCorrelationId] = useState('');
  const [pending, setPending] = useState<readonly CoordinatedOperationResponse[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canReview = isPermissionGranted(getSyncStatusContract.permission, permissionCodes);

  const loadNodes = useCallback(async () => {
    if (!isPermissionGranted(listSyncNodesContract.permission, permissionCodes)) return;
    try {
      const registered = await api.listSyncNodes();
      setNodes(registered);
      setDestination((current) => current || (registered[0]?.nodeId ?? ''));
    } catch (nextError) {
      setError(nextError);
    }
  }, [api, permissionCodes]);

  useEffect(() => { void loadNodes(); }, [loadNodes]);

  const refresh = async (): Promise<void> => {
    if (!destination.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const [nextStatus, nextDiagnostics, operations] = await Promise.all([
        api.getSyncStatus(destination.trim()),
        api.getOperationalDiagnostics(
          destination.trim(), correlationId.trim() || undefined
        ),
        api.listCoordinatedOperations('PENDING_RECONCILIATION')
      ]);
      setStatus(nextStatus);
      setDiagnostics(nextDiagnostics);
      setPending(operations);
      setNotice(`Lectura tomada el ${new Date(nextStatus.observedAt).toLocaleString('es-VE')}.`);
    } catch (nextError) {
      setError(nextError);
    } finally {
      setLoading(false);
    }
  };

  const dismiss = (): void => { setError(null); setNotice(null); };

  return (
    <div className="operation-screen">
      <ScreenNote>
        Aquí se ve qué falta enviar a otro nodo y desde cuándo. Consultar este estado
        no confirma ninguna entrega ni envía nada, y una cola vacía todavía no significa que
        la otra punta haya aplicado lo recibido.
      </ScreenNote>
      <Feedback error={error} notice={notice} onDismiss={dismiss} />

      <section className="panel">
        <h3>Nodo consultado</h3>
        <form
          className="inline-form"
          onSubmit={(event) => { event.preventDefault(); void refresh(); }}
        >
          <label>
            Nodo
            {nodes.length > 0
              ? (
                <select
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                >
                  {nodes.map((node) => (
                    <option key={node.nodeId} value={node.nodeId}>
                      {node.nodeId} · {node.role === 'COORDINATOR' ? 'Coordinador' : 'Terminal'}
                    </option>
                  ))}
                </select>
              )
              : (
                <input
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                  placeholder="node-coordinator"
                  required
                />
              )}
          </label>
          <label>
            Código de seguimiento (opcional)
            <input
              id="tracking-code"
              value={correlationId}
              onChange={(event) => setCorrelationId(event.target.value)}
              placeholder="Pégalo desde el detalle de un fallo"
              minLength={8}
              maxLength={128}
            />
          </label>
          <ActionButton
            className="primary-button"
            type="submit"
            busy={loading}
            disabled={loading || !canReview}
          >
            {loading ? 'Consultando…' : 'Consultar estado'}
          </ActionButton>
        </form>
        {!canReview && (
          <p className="muted">Esta sesión no tiene permiso para revisar la recepción.</p>
        )}
      </section>

      <section className="panel">
        <h3>Ventas completadas que requieren atención</h3>
        {diagnostics === null
          ? <EmptyState>Consulta un destino para revisar efectos pendientes.</EmptyState>
          : diagnostics.salesAttention.length === 0
            ? <EmptyState>Sin ventas con efectos pendientes conocidos.</EmptyState>
            : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Venta</th><th>Estado</th><th>Detalle</th><th>Antigüedad</th><th>Seguimiento</th></tr></thead>
                  <tbody>
                    {diagnostics.salesAttention.map((sale) => (
                      <tr key={`${sale.eventId}:${sale.state}`}>
                        <td>{sale.saleId}</td>
                        <td>{SALE_ATTENTION_LABELS[sale.state]}</td>
                        <td>{sale.errorCode ?? sale.evidenceState}</td>
                        <td>{referenceAge(sale.ageMilliseconds)}</td>
                        <td>{sale.correlationId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </section>

      <section className="panel">
        <h3>Entregas hacia el destino</h3>
        <p className="muted">
          Una entrega reservada está tomada por un ciclo de envío en curso; hasta que esa
          reserva vence, ningún otro ciclo la vuelve a intentar.
        </p>
        {diagnostics === null
          ? <EmptyState>Consulta un destino para revisar sus entregas.</EmptyState>
          : diagnostics.deliveries.length === 0
            ? <EmptyState>Sin entregas materializadas para este destino.</EmptyState>
            : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Hecho</th><th>Estado</th><th>Intentos</th><th>Reservada hasta</th><th>Próximo intento</th><th>Error</th></tr></thead>
                  <tbody>
                    {diagnostics.deliveries.map((delivery) => (
                      <tr key={delivery.eventId}>
                        <td>{delivery.eventType}<br /><span className="muted">{delivery.eventId}</span></td>
                        <td>{DELIVERY_STATE_LABELS[delivery.status]}</td>
                        <td>{delivery.attempts} (ciclo: {delivery.cycleAttempts})</td>
                        <td>{delivery.leaseUntil === null ? '—' : new Date(delivery.leaseUntil).toLocaleString('es-VE')}</td>
                        <td>{new Date(delivery.nextAttemptAt).toLocaleString('es-VE')}</td>
                        <td>{delivery.lastError ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </section>

      <section className="panel">
        <h3>Recorrido de una operación</h3>
        {diagnostics === null || diagnostics.trace === null
          ? <EmptyState>
            Pega el código de seguimiento de una operación para ver por dónde va.
          </EmptyState>
          : (
            <>
              <dl className="detail-grid">
                <div>
                  <dt>Hechos registrados</dt>
                  <dd>{diagnostics.trace.events.length}</dd>
                </div>
                <div>
                  <dt>En cola de salida</dt>
                  <dd>{diagnostics.trace.outbox.length}</dd>
                </div>
                <div>
                  <dt>Entregas</dt>
                  <dd>{diagnostics.trace.deliveries.length}</dd>
                </div>
                <div>
                  <dt>Registros de auditoría</dt>
                  <dd>{diagnostics.trace.audits.length}</dd>
                </div>
              </dl>
              {diagnostics.trace.audits.some((entry) => entry.costEvidence !== null) && (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Entidad</th><th>Costo unitario</th><th>Moneda</th><th>Fuente</th></tr></thead>
                    <tbody>
                      {diagnostics.trace.audits.filter((entry) => entry.costEvidence !== null)
                        .map((entry) => (
                          <tr key={entry.auditId}>
                            <td>{entry.entityId}</td>
                            <td>{entry.costEvidence?.unitCostMinorUnits ?? 'Desconocido'}</td>
                            <td>{entry.costEvidence?.currencyCode ?? '—'}</td>
                            <td>{entry.costEvidence?.source ?? '—'}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
      </section>

      <section className="panel">
        <h3>Sincronización con el destino</h3>
        {status === null
          ? <EmptyState>Consulta un destino para ver su estado.</EmptyState>
          : (
            <>
              <dl className="detail-grid">
                <div>
                  <dt>Rótulo</dt>
                  <dd>{SYNC_STATUS_LABELS[status.status]}</dd>
                </div>
                <div>
                  {/* Conectividad aparte: una caída no puede ocultar una discrepancia. */}
                  <dt>Conectividad</dt>
                  <dd>{CONNECTIVITY_LABELS[status.connectivity]}</dd>
                </div>
                <div>
                  <dt>Pendientes de entrega</dt>
                  <dd>{status.pendingDeliveries}</dd>
                </div>
                <div>
                  <dt>Pendientes de aplicación</dt>
                  <dd>{status.pendingApplications}</dd>
                </div>
                <div>
                  <dt>Entregas pausadas</dt>
                  <dd>{status.pausedDeliveries}</dd>
                </div>
                <div>
                  <dt>Entregas bloqueadas</dt>
                  <dd>{status.blockedDeliveries}</dd>
                </div>
                <div>
                  <dt>Discrepancias abiertas</dt>
                  <dd>{status.openDiscrepancies}</dd>
                </div>
                <div>
                  <dt>Referencias utilizables</dt>
                  <dd>{status.referencesUsable ? 'Sí' : 'No'}</dd>
                </div>
                <div>
                  <dt>Última entrega confirmada</dt>
                  <dd>
                    {status.lastPublishedAt === null
                      ? 'Nunca'
                      : new Date(status.lastPublishedAt).toLocaleString('es-VE')}
                  </dd>
                </div>
                <div>
                  <dt>Lectura tomada</dt>
                  <dd>{new Date(status.observedAt).toLocaleString('es-VE')}</dd>
                </div>
              </dl>
              <p className="muted">{SYNC_STATUS_HINTS[status.status]}</p>
              {status.lastError !== null && (
                <p className="muted">Último error de entrega: {status.lastError}</p>
              )}
            </>
          )}
      </section>

      <section className="panel">
        <h3>Antigüedad de las referencias recibidas</h3>
        {status === null
          ? <EmptyState>Consulta un destino para ver la antigüedad de sus referencias.</EmptyState>
          : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Referencia</th>
                    <th>Fuente</th>
                    <th>Versión</th>
                    <th>Filas</th>
                    <th>Antigüedad</th>
                    <th>Vigencia</th>
                  </tr>
                </thead>
                <tbody>
                  {referenceRows(status.references).map((row) => (
                    <tr key={row.label}>
                      <td>
                        {row.label}
                        <br />
                        <span className="muted">{row.note}</span>
                      </td>
                      <td>{row.entry.publishedBy ?? 'Nunca recibida'}</td>
                      <td>{row.entry.version ?? '—'}</td>
                      <td>{row.entry.count}</td>
                      <td>{referenceAge(row.entry.ageMilliseconds)}</td>
                      <td>
                        {row.validity === null
                          ? '—'
                          : row.expired
                            ? <span className="simulation-label">{row.validity}</span>
                            : row.validity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      <section className="panel">
        <p className="eyebrow">Operaciones distribuidas</p>
        <h3>Pendientes de conciliación</h3>
        <p className="muted">
          Sin evidencia de todos sus pasos una operación no se presenta como exitosa. Un timeout
          no la cancela: se recupera consultando el resultado de cada paso.
        </p>
        {pending.length === 0
          ? <EmptyState>Sin operaciones pendientes de conciliación.</EmptyState>
          : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Operación</th>
                    <th>Referencia</th>
                    <th>Iniciada</th>
                    <th>Pasos</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((operation) => (
                    <tr key={operation.operationId}>
                      <td>{COORDINATED_KIND_LABELS[operation.kind]}</td>
                      <td>{operation.fingerprint}</td>
                      <td>{new Date(operation.startedAt).toLocaleString('es-VE')}</td>
                      <td>
                        {operation.steps.map((step) => (
                          <div key={step.step}>
                            {COORDINATED_STEP_LABELS[step.step]}:{' '}
                            {COORDINATED_STATE_LABELS[step.state]}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  );
};
