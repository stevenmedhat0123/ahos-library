// AHOS Calc – BASE-N mode: 32-bit two's-complement integers shown in DEC / HEX / BIN / OCT.
export const BASES = { dec: 10, hex: 16, bin: 2, oct: 8 };
export const BASE_NAMES = { 10: 'DEC', 16: 'HEX', 2: 'BIN', 8: 'OCT' };
/** a signed 32-bit integer as text in the given base (negatives as two's complement) */
export function baseStr(v, base) {
  if (!Number.isInteger(v)) v = Math.trunc(v);
  if (base === 10) return String(v);
  return (v >>> 0).toString(base).toUpperCase();
}
export const BASE_DIGITS = { 2: '01', 8: '01234567', 10: '0123456789', 16: '0123456789ABCDEF' };
