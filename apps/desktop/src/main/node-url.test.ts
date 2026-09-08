import { describe, expect, it, vi } from 'vitest';

/**
 * El proceso principal importa `electron`, que no existe fuera del binario.
 * El doble deja probar la resolución del nodo sin arrancar una ventana.
 */
vi.mock('electron', () => ({
  app: { whenReady: () => new Promise(() => undefined), on: () => undefined },
  BrowserWindow: class { static getAllWindows(): unknown[] { return []; } }
}));

const { nodeUrl } = await import('./index.js');

describe('nodo local de la terminal', () => {
  it('usa el loopback del nodo cuando no se declara otro', () => {
    expect(nodeUrl({})).toBe('http://127.0.0.1:3000');
  });

  it('respeta el nodo declarado por la instalación', () => {
    expect(nodeUrl({ CULLEN_NODE_URL: 'http://192.168.1.10:3000' }))
      .toBe('http://192.168.1.10:3000');
  });

  /** La barra final se normaliza: la interfaz se pide como `<nodo>/app/`. */
  it('normaliza la barra final para no pedir una ruta doble', () => {
    expect(nodeUrl({ CULLEN_NODE_URL: 'http://127.0.0.1:3000/' })).toBe('http://127.0.0.1:3000');
    expect(nodeUrl({ CULLEN_NODE_URL: '  http://127.0.0.1:4000//  ' })).toBe('http://127.0.0.1:4000');
  });

  it('ignora un valor vacío en lugar de construir una URL inválida', () => {
    expect(nodeUrl({ CULLEN_NODE_URL: '   ' })).toBe('http://127.0.0.1:3000');
  });
});
