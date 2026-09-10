import { describe, expect, it } from 'vitest';
import { ReasonField } from './screens/shared.js';
import { click, mount, type } from './testing/dom.js';

/**
 * El motivo de una operación sensible va a la auditoría, y era un campo vacío
 * repetido en treinta formularios. Quien tiene prisa escribe «x» y el registro
 * queda inservible justo cuando alguien lo necesita.
 *
 * Lo que se fija aquí es que las sugerencias sean un atajo para escribir el
 * motivo, no una lista cerrada: el caso imprevisto es el que más importa
 * contar bien, y nada se rellena solo.
 */
const suggestions = ['Merma por daño', 'Producto vencido', 'Diferencia de conteo'];

const field = (value: string, onChange: (next: string) => void) => (
  <ReasonField value={value} onChange={onChange} suggestions={suggestions} />
);

describe('motivo de una operación sensible', () => {
  it('ofrece los motivos frecuentes ya escritos', async () => {
    const screen = await mount(field('', () => undefined));

    expect(screen.all('.reason-suggestions button').map((button) => button.textContent))
      .toEqual(suggestions);
    screen.unmount();
  });

  it('escribe el motivo elegido en el campo', async () => {
    let written = '';
    const screen = await mount(field('', (next) => { written = next; }));

    await click(screen.button('Producto vencido'));

    expect(written).toBe('Producto vencido');
    screen.unmount();
  });

  it('marca cuál está elegido sin impedir escribir otro', async () => {
    let written = 'Merma por daño';
    const screen = await mount(field(written, (next) => { written = next; }));

    expect(screen.button('Merma por daño').getAttribute('aria-pressed')).toBe('true');
    expect(screen.button('Producto vencido').getAttribute('aria-pressed')).toBe('false');

    await type(screen.get<HTMLInputElement>('.reason-field input'), 'Se cayó una paleta completa');

    expect(written).toBe('Se cayó una paleta completa');
    screen.unmount();
  });

  it('no rellena nada por su cuenta: un motivo en blanco sigue en blanco', async () => {
    const screen = await mount(field('', () => undefined));

    const input = screen.get<HTMLInputElement>('.reason-field input');
    expect(input.value).toBe('');
    expect(input.required).toBe(true);
    screen.unmount();
  });

  it('funciona sin sugerencias, para una acción que no tiene motivos típicos', async () => {
    const screen = await mount(<ReasonField value="" onChange={() => undefined} />);

    expect(screen.query('.reason-suggestions')).toBeNull();
    expect(screen.get('.reason-field label').textContent).toContain('Motivo');
    screen.unmount();
  });

  it('admite un rótulo propio cuando la acción lo pide', async () => {
    const screen = await mount(
      <ReasonField label="Motivo del cierre" value="" onChange={() => undefined} />
    );

    expect(screen.get('.reason-field label').textContent).toContain('Motivo del cierre');
    screen.unmount();
  });

  it('acota el largo que el servidor acepta', async () => {
    const screen = await mount(field('', () => undefined));

    expect(screen.get<HTMLInputElement>('.reason-field input').maxLength).toBe(500);
    screen.unmount();
  });
});

describe('identificación del campo', () => {
  /**
   * Varias pruebas de identidad seleccionan el motivo por su `name`. El
   * componente lo lleva al input real: la alternativa era dejar un input oculto
   * duplicado solo para que un selector siguiera encontrándolo.
   */
  it('lleva el name al campo, no a un duplicado escondido', async () => {
    const screen = await mount(
      <ReasonField name="operatorReason" value="" onChange={() => undefined} />
    );

    expect(screen.all('input')).toHaveLength(1);
    expect(screen.get<HTMLInputElement>('input[name="operatorReason"]').value).toBe('');
    screen.unmount();
  });

  it('no inventa un name cuando nadie lo pide', async () => {
    const screen = await mount(<ReasonField value="" onChange={() => undefined} />);

    expect(screen.get('input').hasAttribute('name')).toBe(false);
    screen.unmount();
  });

  it('deja el motivo opcional cuando la acción no lo exige', async () => {
    const screen = await mount(
      <ReasonField value="" onChange={() => undefined} required={false} />
    );

    expect(screen.get<HTMLInputElement>('input').required).toBe(false);
    screen.unmount();
  });
});
