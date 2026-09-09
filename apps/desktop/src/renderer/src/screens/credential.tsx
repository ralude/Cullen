import { useState } from 'react';
import type { ChangeOwnPinRequest, CompleteCredentialEnrollmentRequest } from '@supermarket/shared';
import { ActionButton, problemMessage } from './shared.js';

/**
 * Las dos operaciones que un operador ejerce sobre su propia credencial
 * ([ADR-0028](../../../../../docs/architecture/adr/0028-enrolamiento-local-de-credenciales.md)).
 * Ninguna necesita permiso y ninguna muestra un PIN ajeno: el enrolamiento se
 * canjea sin sesión, porque el operador todavía no puede tener una, y el cambio
 * de PIN es lo único que una sesión con credencial caducada puede hacer.
 */
export type CredentialApi = {
  changeOwnPin(input: ChangeOwnPinRequest): Promise<void>;
  completeCredentialEnrollment(
    input: CompleteCredentialEnrollmentRequest
  ): Promise<{ readonly operatorCode: string }>;
};

const PIN_FIELD = {
  type: 'password', inputMode: 'numeric', pattern: '[0-9]{6,12}',
  minLength: 6, maxLength: 12, required: true
} as const;

export type MandatoryPinChangeProps = {
  readonly api: CredentialApi;
  readonly displayName: string;
  readonly onChanged: () => void;
  readonly onLogout: () => void;
};

/**
 * Pantalla única de una sesión restringida. No la decide la interfaz: el
 * servidor publica `credentialMustChange` y rechaza cualquier otra operación
 * con `AUTH_PIN_CHANGE_REQUIRED`, así que mostrar el resto sería ofrecer algo
 * que no existe.
 */
export const MandatoryPinChange = (
  { api, displayName, onChanged, onLogout }: MandatoryPinChangeProps
): React.JSX.Element => {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [repeated, setRepeated] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (newPin !== repeated) {
      setError('El PIN nuevo y su confirmación no coinciden.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.changeOwnPin({ currentPin, newPin });
      onChanged();
    } catch (nextError) { setError(problemMessage(nextError)); }
    finally {
      /**
       * El PIN no sobrevive al envío, haya salido bien o mal: el corte 3.5 de
       * 11.02 no lo conserva en el estado del renderer más allá del intento.
       * Reintentar exige volver a escribirlo; el mensaje del fallo se conserva.
       */
      setCurrentPin('');
      setNewPin('');
      setRepeated('');
      setBusy(false);
    }
  };

  return (
    <main className="access-page">
      <section className="access-intro" aria-labelledby="pin-change-title">
        <p className="eyebrow">Sesión restringida</p>
        <h1 id="pin-change-title">Cambia tu PIN para continuar</h1>
        <p>
          Hola {displayName}: tu credencial fue caducada por la administración. Hasta que definas
          un PIN nuevo esta estación no habilita ninguna otra operación.
        </p>
      </section>
      <form className="login-card" onSubmit={(event) => { void submit(event); }}>
        <div>
          <p className="eyebrow">Credencial local</p>
          <h2>Nuevo PIN</h2>
        </div>
        <label>
          PIN actual
          <input
            name="currentPin" {...PIN_FIELD} autoComplete="current-password" autoFocus
            value={currentPin} onChange={(event) => setCurrentPin(event.target.value)}
          />
        </label>
        <label>
          PIN nuevo
          <input
            name="newPin" {...PIN_FIELD} autoComplete="new-password"
            value={newPin} onChange={(event) => setNewPin(event.target.value)}
          />
        </label>
        <label>
          Repite el PIN nuevo
          <input
            name="repeatedPin" {...PIN_FIELD} autoComplete="new-password"
            value={repeated} onChange={(event) => setRepeated(event.target.value)}
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <ActionButton className="primary-button" type="submit" busy={busy} disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar PIN'}
        </ActionButton>
        <button type="button" onClick={onLogout}>Salir</button>
      </form>
    </main>
  );
};

/**
 * Canje del código de enrolamiento en la terminal donde el operador va a
 * trabajar. Se ofrece junto al ingreso porque quien lo usa todavía no puede
 * iniciar sesión: su identidad existe, su credencial local no.
 */
export const CredentialEnrollmentPanel = (
  { api }: { readonly api: CredentialApi }
): React.JSX.Element => {
  const [enrollmentToken, setEnrollmentToken] = useState('');
  const [pin, setPin] = useState('');
  const [repeated, setRepeated] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enrolled, setEnrolled] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (pin !== repeated) {
      setError('El PIN y su confirmación no coinciden.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.completeCredentialEnrollment({ enrollmentToken, pin });
      setEnrolled(result.operatorCode);
    } catch (nextError) { setError(problemMessage(nextError)); }
    finally {
      /** Ni el PIN ni el código de un solo uso sobreviven al envío. */
      setEnrollmentToken('');
      setPin('');
      setRepeated('');
      setBusy(false);
    }
  };

  return (
    <form className="login-card" onSubmit={(event) => { void submit(event); }}>
      <div>
        <p className="eyebrow">Primer acceso</p>
        <h2>Activar credencial</h2>
      </div>
      <p className="muted">
        Escribe el código de un solo uso que te entregó quien autorizó tu enrolamiento y elige tu
        PIN. Solo tú lo conoces.
      </p>
      <label>
        Código de enrolamiento
        <input
          name="enrollmentToken" required maxLength={128} autoComplete="one-time-code"
          value={enrollmentToken} onChange={(event) => setEnrollmentToken(event.target.value)}
        />
      </label>
      <label>
        PIN nuevo
        <input
          name="enrollmentPin" {...PIN_FIELD} autoComplete="new-password"
          value={pin} onChange={(event) => setPin(event.target.value)}
        />
      </label>
      <label>
        Repite el PIN
        <input
          name="repeatedEnrollmentPin" {...PIN_FIELD} autoComplete="new-password"
          value={repeated} onChange={(event) => setRepeated(event.target.value)}
        />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {enrolled && (
        <p className="form-success" role="status">
          Credencial activada para {enrolled}. Ya puedes ingresar con tu PIN.
        </p>
      )}
      <ActionButton className="primary-button" type="submit" busy={busy} disabled={busy}>
        {busy ? 'Activando…' : 'Activar credencial'}
      </ActionButton>
    </form>
  );
};
