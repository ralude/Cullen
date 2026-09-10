import { describe, expect, it } from 'vitest';
import { ApiProblemError } from './api-client.js';
import { Feedback, correlationOf, problemMessage } from './screens/shared.js';
import { click, mount } from './testing/dom.js';

/**
 * Cómo se le cuenta un fallo a quien está cobrando.
 *
 * El identificador de correlación es la llave para rastrear la operación en el
 * nodo y no se pierde, pero no es lo que esa persona necesita leer: vivía
 * dentro de la frase y treinta y seis caracteres de hexadecimal tapaban el
 * único dato accionable del mensaje.
 */

const problem = (code: string): ApiProblemError => new ApiProblemError({
  type: 'urn:supermarket:problem:' + code.toLowerCase(),
  title: code,
  status: 400,
  code,
  correlationId: '036a69fe-98ad-4a82-aea2-662a4f2b3a00'
});

describe('mensaje de un fallo', () => {
  it('dice qué pasó, sin arrastrar el identificador de correlación', () => {
    const message = problemMessage(problem('SALE_PAYMENT_TOTAL_MISMATCH'));

    expect(message).toBe('El pago no coincide con el total de la venta.');
    expect(message).not.toContain('036a69fe');
    expect(message).not.toContain('correlación');
  });

  it('conserva un mensaje entendible para un código que no tiene traducción', () => {
    expect(problemMessage(problem('SOMETHING_UNMAPPED')))
      .toBe('La operación no pudo completarse.');
  });

  it('expone el identificador para quien tenga que escalar el caso', () => {
    expect(correlationOf(problem('FORBIDDEN')))
      .toBe('036a69fe-98ad-4a82-aea2-662a4f2b3a00');
    expect(correlationOf(new Error('offline'))).toBeNull();
  });

  it('lo muestra plegado, fuera de la frase', async () => {
    const screen = await mount(<Feedback error={problem('SHIFT_NOT_FOUND')} notice={null} />);

    const sentence = screen.get('.feedback-body > p');
    expect(sentence.textContent).toBe('No hay un turno abierto para esta caja.');

    const trace = screen.get<HTMLDetailsElement>('.feedback-trace');
    expect(trace.open).toBe(false);
    expect(trace.querySelector('code')?.textContent)
      .toBe('036a69fe-98ad-4a82-aea2-662a4f2b3a00');
    screen.unmount();
  });

  it('no ofrece seguimiento cuando el fallo no viene del nodo', async () => {
    const screen = await mount(<Feedback error={new Error('offline')} notice={null} />);

    expect(screen.query('.feedback-trace')).toBeNull();
    screen.unmount();
  });

  it('un aviso de éxito no lleva seguimiento ni rol de alerta', async () => {
    const screen = await mount(<Feedback error={null} notice="Pago registrado." />);

    expect(screen.get('.feedback').getAttribute('role')).toBe('status');
    expect(screen.query('.feedback-trace')).toBeNull();
    screen.unmount();
  });

  it('se puede descartar cuando la pantalla lo permite', async () => {
    let dismissed = false;
    const screen = await mount(
      <Feedback error={null} notice="Pago registrado." onDismiss={() => { dismissed = true; }} />
    );

    await click(screen.button('Descartar'));

    expect(dismissed).toBe(true);
    screen.unmount();
  });
});
