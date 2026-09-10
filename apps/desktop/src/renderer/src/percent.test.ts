import { describe, expect, it } from 'vitest';
import { basisPointsToPercent, percentToBasisPoints } from './screens/shared.js';

/**
 * Traducción entre lo que una persona escribe y lo que el dominio guarda.
 *
 * Las políticas viajan en puntos base porque una tasa nunca puede ser un float,
 * pero la interfaz pedía «puntos base» literalmente: escribir 16 donde el nodo
 * esperaba 1600 publicaba una política cien veces menor, y 1600 donde se quería
 * 16 % la publicaba cien veces mayor. Ninguna de las dos avisaba.
 */
describe('porcentaje y puntos base', () => {
  it('traduce los porcentajes de la operación diaria', () => {
    expect(percentToBasisPoints('16')).toBe(1600);
    expect(percentToBasisPoints('3')).toBe(300);
    expect(percentToBasisPoints('15')).toBe(1500);
    expect(percentToBasisPoints('0')).toBe(0);
    expect(percentToBasisPoints('100')).toBe(10000);
  });

  it('admite los dos decimales que los puntos base permiten', () => {
    expect(percentToBasisPoints('12.5')).toBe(1250);
    expect(percentToBasisPoints('3.75')).toBe(375);
    /** La coma es el separador decimal que se escribe en Venezuela. */
    expect(percentToBasisPoints('12,5')).toBe(1250);
  });

  it('rechaza más precisión de la que un punto base puede representar', () => {
    expect(() => percentToBasisPoints('3.755')).toThrowError('MONEY_INPUT_SCALE');
  });

  it('rechaza lo que no es un porcentaje en vez de convertirlo en cero', () => {
    for (const value of ['', ' ', 'dieciséis', '16%', '-3', '1.2.3']) {
      expect(() => percentToBasisPoints(value)).toThrowError();
    }
  });

  it('vuelve a mostrar lo que el nodo guardó', () => {
    expect(basisPointsToPercent(1600)).toBe('16.00');
    expect(basisPointsToPercent(300)).toBe('3.00');
    expect(basisPointsToPercent(1250)).toBe('12.50');
    expect(basisPointsToPercent(0)).toBe('0.00');
  });

  it('ida y vuelta conserva el valor', () => {
    for (const basisPoints of [0, 1, 300, 375, 1250, 1600, 10000]) {
      expect(percentToBasisPoints(basisPointsToPercent(basisPoints))).toBe(basisPoints);
    }
  });
});
