import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Infraestructura mínima de interacción DOM para el renderer.
 *
 * Monta el componente real con `createRoot` sobre `jsdom` y envuelve cada
 * cambio en `act`, de modo que efectos, estado y promesas se resuelven antes de
 * observar la salida. Es lo que distingue una prueba de interacción de un
 * render estático: aquí sí corren `useEffect`, los manejadores de eventos y las
 * transiciones de estado ocupado.
 *
 * No sustituye la autorización del backend ni prueba negocio: comprueba lo que
 * el operador ve y puede hacer (ADR-0015 y `apps/desktop/AGENTS.md`).
 */

/** React exige declarar el entorno de `act` antes del primer render. */
const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const mounted = new Set<Screen>();

export type Screen = {
  readonly container: HTMLElement;
  /** Texto visible del árbol montado, con espacios normalizados. */
  text(): string;
  /** Primer elemento que coincide con el selector CSS, o `null`. */
  query<T extends Element = HTMLElement>(selector: string): T | null;
  /** Primer elemento que coincide; falla con un mensaje útil si no existe. */
  get<T extends Element = HTMLElement>(selector: string): T;
  all<T extends Element = HTMLElement>(selector: string): readonly T[];
  /** Primer elemento cuyo texto contiene `value`, entre los que casan el selector. */
  findByText<T extends Element = HTMLElement>(selector: string, value: string): T | null;
  /** Botón o control accionable cuyo texto contiene `value`. */
  button(value: string): HTMLButtonElement;
  unmount(): void;
};

const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim();

/**
 * Deja que React aplique los efectos y las tareas pendientes. Sin esto, una
 * lectura asíncrona todavía no se reflejó en el DOM y la prueba observaría un
 * estado intermedio.
 *
 * Espera un turno completo del bucle de eventos, no solo una microtarea:
 * `hashchange` y otros eventos del documento se entregan como tarea.
 */
export const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  });
};

export const mount = async (element: ReactElement): Promise<Screen> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });

  const screen: Screen = {
    container,
    text: () => normalize(container.textContent ?? ''),
    query: <T extends Element = HTMLElement>(selector: string): T | null =>
      container.querySelector<T>(selector),
    get: <T extends Element = HTMLElement>(selector: string): T => {
      const found = container.querySelector<T>(selector);
      if (!found) throw new Error(`No se encontró «${selector}» en la pantalla montada.`);
      return found;
    },
    all: <T extends Element = HTMLElement>(selector: string): readonly T[] =>
      [...container.querySelectorAll<T>(selector)],
    findByText: <T extends Element = HTMLElement>(selector: string, value: string): T | null =>
      [...container.querySelectorAll<T>(selector)]
        .find((node) => normalize(node.textContent ?? '').includes(value)) ?? null,
    button: (value: string): HTMLButtonElement => {
      const found = [...container.querySelectorAll('button')]
        .find((node) => normalize(node.textContent ?? '').includes(value));
      if (!found) throw new Error(`No hay un botón con el texto «${value}».`);
      return found;
    },
    unmount: () => {
      act(() => { root.unmount(); });
      container.remove();
      mounted.delete(screen);
    }
  };
  mounted.add(screen);
  await settle();
  return screen;
};

/** Desmonta lo que quedó montado; se llama desde `afterEach`. */
export const unmountAll = (): void => {
  for (const screen of [...mounted]) screen.unmount();
};

export const click = async (element: Element): Promise<void> => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

/**
 * Escribe en un campo controlado por React. Asignar `value` directamente no
 * dispara el `onChange` de React, así que se usa el setter nativo del prototipo
 * antes de emitir el evento.
 */
export const type = async (element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  await act(async () => {
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

export const select = async (element: HTMLSelectElement, value: string): Promise<void> => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(element, value);
  await act(async () => {
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

export const submit = async (form: HTMLFormElement): Promise<void> => {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
};

/**
 * Promesa que la prueba resuelve cuando quiere: sirve para observar el estado
 * ocupado mientras la lectura sigue viajando al nodo local.
 */
export const deferred = <T,>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolveIt, rejectIt) => {
    resolve = resolveIt;
    reject = rejectIt;
  });
  return { promise, resolve, reject };
};
