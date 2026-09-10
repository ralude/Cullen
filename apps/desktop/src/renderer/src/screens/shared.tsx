import { useEffect, useRef } from 'react';
import type { CapabilitiesResponse } from '@supermarket/shared';
import {
  ApiProblemError, formatScaledDecimal, parseMinorUnits, type OperationApi
} from '../api-client.js';

/**
 * Permisos efectivos de la sesión. El renderer solo decide qué ofrece: el
 * servidor vuelve a autorizar cada acción dentro de su caso de uso.
 */
export type ScreenProps = {
  readonly api: OperationApi;
  readonly capabilities: CapabilitiesResponse;
  readonly permissionCodes: readonly string[];
};

export const ACTIVE_SALE_KEY = 'supermarket.active-sale.v1';
/**
 * La estación recuerda su caja, nunca su turno: el turno abierto lo resuelve el
 * nodo con `GET /cash-registers/:id/shift`. Una copia local del `shiftId`
 * sobrevivía al cierre y abría ventas contra un turno que ya no existía.
 */
export const ACTIVE_CASH_REGISTER_KEY = 'supermarket.active-cash-register.v1';

export const readStorage = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
};
export const writeStorage = (key: string, value: string): void => {
  try { window.localStorage.setItem(key, value); } catch { /* optional */ }
};
export const clearStorage = (key: string): void => {
  try { window.localStorage.removeItem(key); } catch { /* optional */ }
};

export const problemMessage = (error: unknown): string => {
  if (error instanceof ApiProblemError) {
    const labels: Record<string, string> = {
      SALE_NOT_FOUND: 'La venta ya no está disponible.',
      SALE_PAYMENT_TOTAL_MISMATCH: 'El pago no coincide con el total de la venta.',
      SALE_INVALID_STATE: 'La venta no puede modificarse en este estado.',
      PAYMENT_METHOD_NOT_FOUND: 'El método de pago no está habilitado.',
      PRODUCT_NOT_FOUND: 'No encontramos ese producto.',
      FORBIDDEN: 'No tienes autorización para esta operación.',
      SHIFT_NOT_FOUND: 'No hay un turno abierto para esta caja.',
      SHIFT_ALREADY_OPEN: 'La caja ya tiene un turno abierto.',
      SHIFT_INVALID_STATE: 'El turno no puede modificarse en este estado.',
      SHIFT_HAS_OPEN_SALES: 'La caja conserva ventas sin cerrar: cóbralas o anúlalas antes del arqueo.',
      STOCK_ITEM_NOT_FOUND: 'No encontramos el artículo de inventario.',
      STOCK_INSUFFICIENT_BALANCE: 'La existencia no alcanza para este ajuste.',
      SUPPLIER_NOT_FOUND: 'No encontramos el proveedor seleccionado.',
      SUPPLIER_NOT_ACTIVE: 'El proveedor seleccionado no está activo para nuevas recepciones.',
      SUPPLIER_TAX_IDENTITY_CONFLICT: 'Ya existe un proveedor con esa identificación fiscal.',
      SUPPLIER_TAX_IDENTITY_INVALID: 'La identificación fiscal no tiene un formato válido.',
      SUPPLIER_TAX_IDENTITY_REQUIRED: 'La identificación fiscal es obligatoria.',
      SUPPLIER_TAX_COUNTRY_INVALID: 'El país de la identificación fiscal no es válido.',
      SUPPLIER_TAX_TYPE_INVALID: 'El tipo de identificación fiscal no es válido.',
      SUPPLIER_LEGAL_NAME_REQUIRED: 'La razón social del proveedor es obligatoria.',
      SUPPLIER_UPDATE_REQUIRED: 'No hay cambios que guardar en este proveedor.',
      SUPPLIER_CORRECTION_REASON_REQUIRED: 'La corrección fiscal exige un motivo.',
      QUANTITY_INVALID_TEXT: 'Escribe la cantidad como un número positivo.',
      QUANTITY_SCALE_EXCEEDED: 'La cantidad tiene más decimales de los que admite la unidad.',
      STOCK_BATCH_REQUIRED: 'Este artículo maneja lotes: indica el lote recibido.',
      STOCK_BATCH_NOT_ACCEPTED: 'Este artículo no maneja lotes.',
      STOCK_BATCH_NOT_FOUND: 'No encontramos ese lote en el artículo.',
      STOCK_COUNT_NOT_FOUND: 'No encontramos el conteo seleccionado.',
      STOCK_COUNT_NOT_OPEN: 'El conteo ya no admite nuevas líneas.',
      STOCK_COUNT_NOT_COUNTED: 'El conteo debe estar cerrado antes de aprobarlo o rechazarlo.',
      STOCK_COUNT_EMPTY: 'Registra al menos una línea antes de cerrar el conteo.',
      STOCK_COUNT_LINE_QUANTITY_INVALID: 'La cantidad contada no puede ser negativa.',
      STOCK_COUNT_REJECTION_REASON_REQUIRED: 'El rechazo exige un motivo.',
      BRANCH_NOT_FOUND: 'No encontramos la sucursal seleccionada.',
      BRANCH_CODE_INVALID: 'El código de sucursal no es válido.',
      BRANCH_CODE_CONFLICT: 'Ya existe una sucursal con ese código.',
      BRANCH_UPDATE_REQUIRED: 'No hay cambios que guardar en esta sucursal.',
      DEVICE_NOT_FOUND: 'No encontramos el dispositivo seleccionado.',
      DEVICE_TYPE_INVALID: 'El tipo de dispositivo no es válido.',
      DEVICE_IDENTIFIER_REQUIRED: 'El identificador del dispositivo es obligatorio.',
      DEVICE_UPDATE_REQUIRED: 'No hay cambios que guardar en este dispositivo.',
      IDENTITY_NOT_OWNED_BY_NODE: 'La administración de identidad pertenece al coordinador de la tienda.',
      IDENTITY_LAST_ADMINISTRATOR: 'El cambio dejaría al sistema sin ningún administrador activo.',
      IDENTITY_OPERATOR_NOT_FOUND: 'No encontramos ese operador en este nodo.',
      IDENTITY_OPERATOR_CODE_TAKEN: 'Ya existe un operador con ese código.',
      IDENTITY_ROLE_NOT_FOUND: 'No encontramos el rol seleccionado.',
      IDENTITY_ROLE_CODE_TAKEN: 'Ya existe un rol con ese código.',
      IDENTITY_PERMISSION_UNKNOWN: 'Ese permiso no existe en este nodo.',
      IDENTITY_INPUT_INVALID: 'Revisa los datos: el motivo es obligatorio.',
      IDENTITY_CREDENTIAL_NOT_FOUND: 'Ese operador no tiene credencial en esta terminal.',
      IDENTITY_ENROLLMENT_NOT_FOUND: 'El código de enrolamiento no es válido.',
      IDENTITY_ENROLLMENT_EXPIRED: 'El código de enrolamiento venció: pide uno nuevo.',
      IDENTITY_ENROLLMENT_CONSUMED: 'Ese código ya se usó: pide uno nuevo.',
      IDENTITY_ENROLLMENT_NODE_MISMATCH: 'Ese código pertenece a otra terminal.',
      USER_ROLE_NOT_ASSIGNABLE: 'Ese rol no se puede asignar mientras esté inactivo.',
      USER_DISPLAY_NAME_REQUIRED: 'El nombre visible del operador es obligatorio.',
      ROLE_INVALID_CODE: 'El código del rol no tiene un formato válido.',
      ROLE_NAME_REQUIRED: 'El nombre del rol es obligatorio.',
      AUTH_PIN_POLICY_VIOLATION: 'El PIN debe tener entre 6 y 12 dígitos.',
      AUTH_PIN_CHANGE_REQUIRED: 'Tu credencial está caducada: cambia tu PIN para continuar.',
      AUTHENTICATION_FAILED: 'El PIN actual no es correcto.',
      FISCAL_REPORT_FAILED: 'El reporte fiscal simulado falló; revisa su estado.',
      NETWORK_UNAVAILABLE: 'No hay conexión con el nodo local.',
      CURRENCY_HISTORY_LIMIT_INVALID: 'El límite de filas del histórico no es válido.',
      CURRENCY_RATE_MISSING: 'No hay una tasa vigente registrada para ese par.',
      EXCHANGE_RATE_INVALID_PAIR: 'La moneda base y la cotizada deben ser distintas.',
      EXCHANGE_RATE_INVALID_CURRENCY: 'El código de moneda debe tener tres letras mayúsculas.',
      EXCHANGE_RATE_INVALID_VALUE: 'El valor de la tasa no es un entero positivo válido.',
      EXCHANGE_RATE_INVALID_SCALE: 'La escala de la tasa debe estar entre 0 y 8.',
      EXCHANGE_RATE_SOURCE_REQUIRED: 'La fuente de la tasa es obligatoria.',
      EXCHANGE_RATE_INVALID_VALIDITY: 'La vigencia hasta debe ser posterior a la vigencia desde.'
    };
    return labels[error.problem.code] ?? 'La operación no pudo completarse.';
  }
  if (error instanceof Error && error.message === 'MONEY_INPUT_SCALE') {
    return 'La cantidad de decimales supera la escala configurada.';
  }
  if (error instanceof Error && error.message === 'SHIFT_REQUIRED') {
    return 'Abre o selecciona un turno desde Caja antes de iniciar la venta.';
  }
  if (error instanceof Error && error.message === 'RATE_INPUT_INVALID') {
    return 'Escribe un valor decimal positivo con hasta 8 decimales.';
  }
  return 'No pudimos completar la operación. Intenta nuevamente.';
};

/**
 * El identificador de correlación es la llave para rastrear una operación en
 * los registros del nodo, así que no se pierde. Pero deja de vivir dentro de
 * la frase: quien cobra leía «El pago no coincide con el total de la venta.
 * (correlación 036a69fe-98ad-4a82-aea2-662a4f2b3a00)», y treinta y seis
 * caracteres de hexadecimal no le dicen nada ni le dejan ver lo que sí
 * importa. Queda a un clic, para cuando alguien tenga que escalar el caso.
 */
export const correlationOf = (error: unknown): string | null =>
  error instanceof ApiProblemError ? error.problem.correlationId : null;

export type FeedbackProps = {
  readonly error: unknown;
  readonly notice: string | null;
  readonly onDismiss?: () => void;
};

/**
 * Confirmación o fallo de la última acción. Se mantiene pegado al inicio del
 * área de trabajo para que el operador lo vea sin desplazarse.
 */
export const Feedback = ({ error, notice, onDismiss }: FeedbackProps): React.JSX.Element | null => {
  if (!error && !notice) return null;
  const failed = Boolean(error);
  const correlation = correlationOf(error);
  return (
    <div
      className={failed ? 'feedback form-error' : 'feedback form-success'}
      role={failed ? 'alert' : 'status'}
      aria-live={failed ? 'assertive' : 'polite'}
    >
      <span className="feedback-icon" aria-hidden="true">{failed ? '!' : '✓'}</span>
      <div className="feedback-body">
        <p>{failed ? problemMessage(error) : notice}</p>
        {correlation && (
          <details className="feedback-trace">
            <summary>Código de seguimiento</summary>
            <code>{correlation}</code>
            <span>Dáselo a quien administre la estación para encontrar esta operación.</span>
          </details>
        )}
      </div>
      {onDismiss && (
        <button type="button" className="feedback-dismiss" onClick={onDismiss}>
          Descartar
        </button>
      )}
    </div>
  );
};

export type ActionButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly busy?: boolean;
};

/** Botón con estado ocupado visible y anunciado mientras la acción viaja al nodo. */
export const ActionButton = (
  { busy = false, className, children, ...rest }: ActionButtonProps
): React.JSX.Element => (
  <button
    className={busy ? [className, 'is-busy'].filter(Boolean).join(' ') : className}
    {...rest}
    aria-busy={busy || undefined}
  >
    {children}
  </button>
);

/**
 * Un porcentaje son puntos base con dos decimales: 16 % son 1600, y 3,5 %
 * son 350. El dominio conserva el entero —una tasa nunca es un float— y la
 * interfaz pide lo que una persona sabe decir. Escribir «1600» donde se
 * esperaba 16 % publica una política dieciséis veces mayor sin que nada
 * avise, así que la traducción ocurre en la frontera y en un solo lugar.
 */
export const percentToBasisPoints = (value: string): number => parseMinorUnits(value, 2);
export const basisPointsToPercent = (basisPoints: number): string =>
  formatScaledDecimal(basisPoints, 2);

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

/**
 * Formatea unidades menores respetando la escala configurada. Un código que
 * `Intl` no reconoce degrada a texto con sufijo en lugar de romper el render.
 */
export const money = (minorUnits: number, currencyCode: string, scale = 2): string => {
  const amount = minorUnits / (10 ** scale);
  const digits = { minimumFractionDigits: scale, maximumFractionDigits: scale };
  const code = currencyCode.trim().toUpperCase();
  if (CURRENCY_CODE_PATTERN.test(code)) {
    try {
      return new Intl.NumberFormat('es-VE', { style: 'currency', currency: code, ...digits })
        .format(amount);
    } catch { /* código no soportado por Intl: se usa el formato neutro */ }
  }
  return new Intl.NumberFormat('es-VE', digits).format(amount) + ' ' + code;
};

/** Contexto de la pantalla. El título lo publica la barra superior del shell. */
export const ScreenNote = ({ children }: { readonly children: React.ReactNode }): React.JSX.Element => (
  <p className="screen-note">{children}</p>
);
export const EmptyState = ({ children }: { readonly children: React.ReactNode }): React.JSX.Element => (
  <div className="empty-state" role="status">{children}</div>
);

export type ReportSection<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

/** Envuelve una lectura para que su falla no oculte las lecturas hermanas que sí respondieron. */
export const section = async <T,>(load: () => Promise<T>): Promise<ReportSection<T>> => {
  try { return { ok: true, value: await load() }; } catch (error) { return { ok: false, error }; }
};

export const SectionError = ({ error }: { readonly error: unknown }): React.JSX.Element => (
  <p className="form-error" role="alert">{problemMessage(error)}</p>
);

export type ModalProps = {
  readonly title: string;
  readonly description?: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
};

/**
 * Formulario secundario sobre la pantalla, no debajo de ella.
 *
 * Desplegar estos formularios en el flujo empujaba el contenido hacia abajo y
 * obligaba a buscar el boton fuera de la vista para completar una accion que ya
 * se habia iniciado. Encima, el foco entra en el dialogo, `Escape` lo cierra,
 * el fondo queda inerte y el desplazamiento ocurre **dentro** del dialogo: la
 * pagina de atras nunca se mueve.
 */
export const Modal = ({ title, description, onClose, children }: ModalProps): React.JSX.Element => {
  const dialog = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<Element | null>(null);

  useEffect(() => {
    restoreFocus.current = document.activeElement;
    const focusable = dialog.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, textarea, button, [href], [tabindex]:not([tabindex="-1"])'
    );
    (focusable ?? dialog.current)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (restoreFocus.current instanceof HTMLElement) restoreFocus.current.focus();
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      /** Solo el fondo cierra: un clic dentro del dialogo no debe perder lo escrito. */
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        className="modal"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="modal-header">
          <div>
            <h3>{title}</h3>
            {description && <p className="muted">{description}</p>}
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
};
