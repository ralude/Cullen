import { useState } from 'react';
import type { ExchangeRateResponse, ExchangeRateSuggestionResponse } from '@supermarket/shared';
import { isPermissionGranted, updateExchangeRateContract } from '@supermarket/shared';
import { ApiProblemError, createIdempotencyKey, formatScaledDecimal, parseScaledDecimal, type OperationApi } from '../api-client.js';
import {
  ActionButton, EmptyState, Feedback, ScreenNote, SectionError, problemMessage, section,
  type ReportSection, type ScreenProps
} from './shared.js';

type CurrencyPairQuery = { readonly baseCurrency: string; readonly quoteCurrency: string };
type CurrencyReadsApi = Pick<OperationApi, 'getCurrentExchangeRate' | 'getExchangeRateHistory'>;
export type CurrencyPairReads = {
  readonly current: ReportSection<ExchangeRateResponse>;
  readonly history: ReportSection<readonly ExchangeRateResponse[]>;
};

/** Consulta tasa vigente e histórico en paralelo; una falla no oculta la otra. */
export const loadCurrentAndHistory = async (
  api: CurrencyReadsApi,
  pair: CurrencyPairQuery,
  limit?: number
): Promise<CurrencyPairReads> => {
  const [current, history] = await Promise.all([
    section(() => api.getCurrentExchangeRate(pair)),
    section(() => api.getExchangeRateHistory({ ...pair, ...(limit === undefined ? {} : { limit }) }))
  ]);
  return { current, history };
};

type CurrencySuggestionApi = Pick<OperationApi, 'getSuggestedExchangeRate'>;

/** Lectura pura de la sugerencia externa; nunca persiste ni sustituye a UpdateExchangeRate. */
export const loadSuggestion = (
  api: CurrencySuggestionApi,
  pair: CurrencyPairQuery
): Promise<ReportSection<ExchangeRateSuggestionResponse>> =>
  section(async () => (await api.getSuggestedExchangeRate(pair)).suggestion);

export type ManualRateForm = {
  readonly value: string; readonly source: string;
  readonly validFrom: string; readonly validUntil: string; readonly reason: string;
};

const EMPTY_MANUAL_FORM: ManualRateForm = {
  value: '', source: '', validFrom: new Date().toISOString().slice(0, 10), validUntil: '', reason: ''
};

/** Copia los valores visibles de la sugerencia al formulario revisable; no ejecuta ningún comando. */
export const suggestionToManualForm = (suggestion: ExchangeRateSuggestionResponse): ManualRateForm => ({
  value: formatScaledDecimal(suggestion.rateValue, suggestion.rateScale),
  source: suggestion.source,
  validFrom: (suggestion.validFrom ?? new Date().toISOString()).slice(0, 10),
  validUntil: suggestion.validUntil ? suggestion.validUntil.slice(0, 10) : '',
  reason: 'Sugerencia externa confirmada por el operador'
});

type CurrencyWriteApi = Pick<OperationApi, 'updateExchangeRate'>;

/** Único camino de persistencia: siempre UpdateExchangeRate, con motivo e idempotencia por intención. */
export const confirmManualRate = async (
  api: CurrencyWriteApi,
  pair: CurrencyPairQuery,
  form: ManualRateForm,
  idempotencyKey: string
): Promise<ExchangeRateResponse> => {
  const parsed = parseScaledDecimal(form.value);
  return api.updateExchangeRate({
    ...pair, rateValue: parsed.value, rateScale: parsed.scale, source: form.source.trim(),
    validFrom: new Date(form.validFrom).toISOString(),
    validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : null,
    reason: form.reason.trim()
  }, idempotencyKey);
};

/** Antigüedad local frente al reloj de esta estación; no implica sincronización distribuida (Fase 10). */
export const ageLabel = (iso: string): string => {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'hace instantes';
  if (minutes < 60) return 'hace ' + minutes + ' min';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return 'hace ' + hours + ' h';
  return 'hace ' + Math.floor(hours / 24) + ' d';
};

const suggestionErrorLabel = (error: unknown): string => {
  if (error instanceof ApiProblemError) {
    const labels: Record<string, string> = {
      EXCHANGE_RATE_PROVIDER_NOT_CONFIGURED: 'Este nodo no tiene una fuente de sugerencia configurada.',
      NETWORK_UNAVAILABLE: 'El proveedor externo no respondió a tiempo. La tasa local y la carga manual siguen disponibles.',
      EXCHANGE_RATE_PROVIDER_INVALID_RESPONSE: 'El proveedor externo devolvió una respuesta inválida.',
      EXCHANGE_RATE_PAIR_UNSUPPORTED: 'El proveedor externo no soporta este par de monedas.'
    };
    if (labels[error.problem.code]) {
      return labels[error.problem.code] + ' (correlación ' + error.problem.correlationId + ')';
    }
  }
  return problemMessage(error);
};

export const CurrencyScreen = ({ api, permissionCodes }: ScreenProps): React.JSX.Element => {
  const [baseCurrency, setBaseCurrency] = useState('USD'); const [quoteCurrency, setQuoteCurrency] = useState('VES'); const [historyLimit, setHistoryLimit] = useState('50'); const [reads, setReads] = useState<CurrencyPairReads | null>(null); const [suggestion, setSuggestion] = useState<ReportSection<ExchangeRateSuggestionResponse> | null>(null); const [manual, setManual] = useState<ManualRateForm>(EMPTY_MANUAL_FORM); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  const dismissFeedback = (): void => { setError(null); setNotice(null); };
  const pair = (): CurrencyPairQuery => ({ baseCurrency: baseCurrency.trim().toUpperCase(), quoteCurrency: quoteCurrency.trim().toUpperCase() });
  const query = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault(); setLoading(true); setNotice(null);
    setReads(await loadCurrentAndHistory(api, pair(), historyLimit.trim() ? Number(historyLimit) : undefined));
    setLoading(false);
  };
  const askSuggestion = async (): Promise<void> => {
    setLoading(true);
    setSuggestion(await loadSuggestion(api, pair()));
    setLoading(false);
  };
  const useSuggestion = (): void => {
    if (!suggestion?.ok) return;
    setManual(suggestionToManualForm(suggestion.value));
    setNotice('Sugerencia cargada en el formulario. Revisa los valores y confirma para registrarla.');
  };
  const discardSuggestion = (): void => setSuggestion(null);
  /**
   * Un solo gesto para lo que se hace todos los dias: fija USD/VES, pide la
   * tasa publicada y la deja cargada en el formulario. Sigue sin registrar
   * nada: confirmar es un acto de una persona, con su motivo y su permiso.
   */
  const bringOfficialUsdRate = async (): Promise<void> => {
    setLoading(true); setError(null); setNotice(null);
    setBaseCurrency('USD'); setQuoteCurrency('VES');
    const published = await loadSuggestion(api, { baseCurrency: 'USD', quoteCurrency: 'VES' });
    setSuggestion(published);
    if (published.ok) {
      setManual(suggestionToManualForm(published.value));
      setNotice('Dolar oficial cargado en el formulario. Revisalo y confirma para registrarlo.');
    }
    setLoading(false);
  };
  const updateManual = (key: keyof ManualRateForm) => (event: React.ChangeEvent<HTMLInputElement>): void =>
    setManual((current) => ({ ...current, [key]: event.target.value }));
  const submitManual = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault(); setLoading(true); setError(null); setNotice(null);
    try {
      await confirmManualRate(api, pair(), manual, createIdempotencyKey());
      setNotice('Tasa registrada.');
      setSuggestion(null);
      setReads(await loadCurrentAndHistory(api, pair(), historyLimit.trim() ? Number(historyLimit) : undefined));
    } catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  };
  const current = reads?.current; const history = reads?.history;
  return <div className="operation-screen"><ScreenNote>La tasa vigente y su histórico vienen de SQLite local. Una sugerencia externa es una propuesta efímera: solo se aplica tras confirmarla explícitamente.</ScreenNote><Feedback error={error} notice={notice} onDismiss={dismissFeedback} /><section className="panel"><h3>Selecciona el par</h3><form className="inline-form" onSubmit={(event) => void query(event)}><label>Base<input value={baseCurrency} onChange={(event) => setBaseCurrency(event.target.value.toUpperCase())} maxLength={3} required /></label><label>Cotizada<input value={quoteCurrency} onChange={(event) => setQuoteCurrency(event.target.value.toUpperCase())} maxLength={3} required /></label><label>Filas del histórico<input type="number" min="1" max="500" value={historyLimit} onChange={(event) => setHistoryLimit(event.target.value)} placeholder="50" /></label><ActionButton className="primary-button" type="submit" busy={loading} disabled={loading}>{loading ? 'Consultando…' : 'Consultar tasa e histórico'}</ActionButton></form></section><section className="panel"><h3>Tasa vigente de {baseCurrency}/{quoteCurrency}</h3>{!current ? <EmptyState>Consulta el par para ver la tasa vigente.</EmptyState> : current.ok ? <><dl className="detail-grid"><div><dt>Valor</dt><dd>{formatScaledDecimal(current.value.rateValue, current.value.rateScale)}</dd></div><div><dt>Fuente</dt><dd>{current.value.source}</dd></div><div><dt>Vigente desde</dt><dd>{new Date(current.value.validFrom).toLocaleString('es-VE')}</dd></div><div><dt>Antigüedad local</dt><dd>{ageLabel(current.value.validFrom)}</dd></div></dl><p className="muted">Antigüedad calculada con el reloj de esta estación; la sincronización entre nodos pertenece a la Fase 10.</p></> : <SectionError error={current.error} />}</section><section className="panel"><h3>Histórico local del par</h3>{!history ? <EmptyState>Consulta el par para ver su histórico.</EmptyState> : history.ok ? (history.value.length === 0 ? <EmptyState>Sin registros históricos para este par todavía.</EmptyState> : <div className="table-wrap"><table><thead><tr><th>Vigente desde</th><th>Vigente hasta</th><th>Valor</th><th>Fuente</th><th>Registrado por</th></tr></thead><tbody>{history.value.map((entry) => <tr key={entry.id}><td>{new Date(entry.validFrom).toLocaleString('es-VE')}</td><td>{entry.validUntil ? new Date(entry.validUntil).toLocaleString('es-VE') : 'Sin cierre'}</td><td>{formatScaledDecimal(entry.rateValue, entry.rateScale)}</td><td>{entry.source}</td><td>{entry.registeredBy}</td></tr>)}</tbody></table></div>) : <SectionError error={history.error} />}</section><section className="panel"><h3>Sugerencia externa, todavía no aplicada</h3><p className="muted">«Traer dólar BCV de hoy» consulta la tasa oficial publicada y la deja cargada abajo. Ni eso ni actualizar la sugerencia registran una tasa: solo confirmar con el formulario lo hace.</p><div className="button-row"><ActionButton className="primary-button" type="button" onClick={() => void bringOfficialUsdRate()} busy={loading} disabled={loading}>{loading ? 'Consultando al BCV…' : 'Traer dólar BCV de hoy'}</ActionButton><ActionButton type="button" onClick={() => void askSuggestion()} busy={loading} disabled={loading}>{suggestion ? 'Actualizar sugerencia' : 'Solicitar sugerencia del par'}</ActionButton></div>{!suggestion ? <EmptyState>Sin sugerencia solicitada todavía.</EmptyState> : suggestion.ok ? <><dl className="detail-grid"><div><dt>Valor sugerido</dt><dd>{formatScaledDecimal(suggestion.value.rateValue, suggestion.value.rateScale)}</dd></div><div><dt>Fuente</dt><dd>{suggestion.value.source}</dd></div><div><dt>Observado</dt><dd>{new Date(suggestion.value.observedAt).toLocaleString('es-VE')}</dd></div><div><dt>Vigencia sugerida</dt><dd>{suggestion.value.validFrom ? new Date(suggestion.value.validFrom).toLocaleString('es-VE') : 'No especificada'}</dd></div></dl><span className="simulation-label">PROPUESTA · no es la tasa vigente</span><div className="button-row"><button className="primary-button" type="button" onClick={useSuggestion}>Usar en el formulario</button><button type="button" onClick={discardSuggestion}>Descartar</button></div></> : <p className="form-error" role="alert">{suggestionErrorLabel(suggestion.error)}</p>}</section><section className="panel"><h3>Confirmar una tasa para {baseCurrency}/{quoteCurrency}</h3><form className="stack-form" onSubmit={(event) => void submitManual(event)}><label>Valor decimal<input inputMode="decimal" value={manual.value} onChange={updateManual('value')} placeholder="0,000" required /></label><label>Fuente<input value={manual.source} onChange={updateManual('source')} placeholder="Carga manual confirmada" required /></label><div className="form-grid"><label>Vigente desde<input type="date" value={manual.validFrom} onChange={updateManual('validFrom')} required /></label><label>Vigente hasta (opcional)<input type="date" value={manual.validUntil} onChange={updateManual('validUntil')} /></label></div><label>Motivo<input value={manual.reason} onChange={updateManual('reason')} required /></label><ActionButton className="primary-button" type="submit" busy={loading} disabled={loading || !isPermissionGranted(updateExchangeRateContract.permission, permissionCodes)}>{loading ? 'Confirmando…' : 'Confirmar tasa'}</ActionButton></form><p className="muted">Ninguna tasa externa se aplica sola: confirmar siempre exige este formulario, motivo y autorización del servidor.</p></section></div>;
};
