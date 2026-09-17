/**
 * Conversión entre lo que el operador escribe y lo que el contrato transporta.
 *
 * Dinero y cantidades viajan como enteros con su escala, nunca como decimales.
 * Vive aparte del cliente HTTP desde 12.05.04: formatear una cantidad en
 * pantalla no tiene por qué cargar el transporte ni las noventa operaciones.
 */

export const parseMinorUnits = (value: string, scale: number): number => {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error('MONEY_INPUT_INVALID');
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > scale) throw new Error('MONEY_INPUT_SCALE');
  const padded = fraction.padEnd(scale, '0');
  const result = Number(`${whole}${padded}`);
  if (!Number.isSafeInteger(result)) throw new Error('MONEY_INPUT_INVALID');
  return result;
};

export const parseScaledDecimal = (value: string): { readonly value: number; readonly scale: number } => {
  const normalized = value.trim().replace(',', '.');
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(normalized);
  if (!match) throw new Error('RATE_INPUT_INVALID');
  const fraction = match[2] ?? '';
  const parsed = Number(`${match[1]}${fraction}`);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('RATE_INPUT_INVALID');
  return { value: parsed, scale: fraction.length };
};

/** Formatea un entero escalado como texto decimal sin perder precisión. */
export const formatScaledDecimal = (value: number, scale: number): string =>
  (() => {
    if (!Number.isSafeInteger(value) || !Number.isInteger(scale) || scale < 0) {
      throw new Error('SCALED_DECIMAL_INVALID');
    }
    const sign = value < 0 ? '-' : '';
    const digits = Math.abs(value).toString().padStart(scale + 1, '0');
    if (scale === 0) return sign + digits;
    return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  })();