import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDay, namedPeriods, toReportQuery } from './screens/reports.js';

/**
 * El período que un reporte consulta es el día de la tienda.
 *
 * Interpretar «2026-09-09» como medianoche UTC recorta la ventana cuatro horas
 * en Venezuela: incluye la noche del día anterior y deja fuera el último turno
 * del día consultado. El total no cuadra y nada en pantalla dice por qué.
 *
 * Estas pruebas fijan la zona de la tienda para que el fallo no dependa de
 * dónde corra el runner: en UTC el defecto era invisible.
 */
const ambient = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/Caracas'; });
/** `TZ` es global del proceso: sin restaurarla, el resto de la suite hereda Caracas. */
afterAll(() => {
  if (ambient === undefined) delete process.env.TZ; else process.env.TZ = ambient;
});

const filters = (from: string, to: string) => ({
  from, to, limit: '100', cashRegisterId: ''
});

const localOf = (iso: string): string => new Date(iso).toLocaleString('sv');

describe('período de un reporte', () => {
  it('abre el período en la medianoche de la tienda', () => {
    const query = toReportQuery(filters('2026-09-09', '2026-09-09'));

    expect(localOf(query.from!)).toBe('2026-09-09 00:00:00');
  });

  it('lo cierra en el último milisegundo del mismo día de la tienda', () => {
    const query = toReportQuery(filters('2026-09-09', '2026-09-09'));

    expect(localOf(query.to!)).toBe('2026-09-09 23:59:59');
  });

  it('un solo día cubre veinticuatro horas exactas', () => {
    const query = toReportQuery(filters('2026-09-09', '2026-09-09'));

    const span = new Date(query.to!).getTime() - new Date(query.from!).getTime();
    expect(span).toBe(24 * 60 * 60 * 1000 - 1);
  });

  it('viaja al nodo en UTC, que es como el nodo guarda el tiempo', () => {
    const query = toReportQuery(filters('2026-09-09', '2026-09-09'));

    /** Caracas es UTC−4: la medianoche local son las cuatro en Greenwich. */
    expect(query.from).toBe('2026-09-09T04:00:00.000Z');
    expect(query.to).toBe('2026-09-10T03:59:59.999Z');
  });

  it('respeta un período de varios días', () => {
    const query = toReportQuery(filters('2026-09-01', '2026-09-30'));

    expect(localOf(query.from!)).toBe('2026-09-01 00:00:00');
    expect(localOf(query.to!)).toBe('2026-09-30 23:59:59');
  });

  it('conserva el límite y omite lo que no se declaró', () => {
    expect(toReportQuery(filters('2026-09-09', '2026-09-09')).limit).toBe(100);
    expect(toReportQuery({ from: '', to: '', limit: '', cashRegisterId: '' })).toEqual({});
  });

  it('el día por defecto es el de la tienda, no el del meridiano', () => {
    /** 21:30 del 9 en Caracas ya es el 10 en UTC: el día no ha cambiado en la caja. */
    expect(localDay(new Date('2026-09-10T01:30:00.000Z'))).toBe('2026-09-09');
    /** Y a las 00:30 del 10 en Caracas sí cambió, aunque en UTC sean las 04:30. */
    expect(localDay(new Date('2026-09-10T04:30:00.000Z'))).toBe('2026-09-10');
  });

  it('escribe el día con ceros a la izquierda', () => {
    expect(localDay(new Date('2026-03-05T15:00:00.000Z'))).toBe('2026-03-05');
  });
});

describe('períodos con nombre', () => {
  /** Un martes 9 de septiembre de 2026, a media tarde en Caracas. */
  const at = new Date('2026-09-09T18:00:00.000Z');

  it('ofrece los períodos que de verdad se consultan', () => {
    expect(namedPeriods(at).map((period) => period.label))
      .toEqual(['Hoy', 'Ayer', 'Últimos 7 días', 'Este mes']);
  });

  it('resuelve cada uno sobre el día de la tienda', () => {
    const [hoy, ayer, semana, mes] = namedPeriods(at);

    expect(hoy).toMatchObject({ from: '2026-09-09', to: '2026-09-09' });
    expect(ayer).toMatchObject({ from: '2026-09-08', to: '2026-09-08' });
    expect(semana).toMatchObject({ from: '2026-09-03', to: '2026-09-09' });
    expect(mes).toMatchObject({ from: '2026-09-01', to: '2026-09-09' });
  });

  it('cruza el fin de mes hacia atrás sin inventar un día 0', () => {
    const firstOfMonth = new Date('2026-09-01T18:00:00.000Z');
    const [, ayer, semana] = namedPeriods(firstOfMonth);

    expect(ayer).toMatchObject({ from: '2026-08-31', to: '2026-08-31' });
    expect(semana?.from).toBe('2026-08-26');
  });

  it('«hoy» sigue siendo el día de la tienda cuando en UTC ya es mañana', () => {
    /** 21:00 del 9 en Caracas son las 01:00 del 10 en Greenwich. */
    const lateEvening = new Date('2026-09-10T01:00:00.000Z');

    expect(namedPeriods(lateEvening)[0]).toMatchObject({ from: '2026-09-09', to: '2026-09-09' });
  });
});
