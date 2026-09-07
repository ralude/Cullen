import { afterEach } from 'vitest';
import { unmountAll } from './src/renderer/src/testing/dom.js';

/**
 * Cada prueba de interacción deja el documento limpio: un árbol montado que
 * sobreviva al caso siguiente haría que sus efectos y su estado se mezclaran
 * con los de otra pantalla.
 */
afterEach(() => {
  unmountAll();
  document.body.replaceChildren();
});
