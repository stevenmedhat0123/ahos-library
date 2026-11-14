// AHOS Calc – EQN mode: simultaneous linear equations (2 and 3 unknowns) and polynomial equations (degree 2 and 3, complex roots included).
import { CalcError, mathErr } from './errors.js';
import { Cx, clean, simp } from './core.js';

/** rows: n rows of n+1 numbers (the last is the right-hand side) → [x, y, (z)] or Math ERROR when there is no single solution */
export function solveLinear(n, rows) {
  const a = rows.map((r) => r.slice());
  const scale = Math.max(1e-300, ...a.flat().map(Math.abs));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12 * scale) throw mathErr('nosolution');
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = a[r][c] / a[c][c]; for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k]; }
  }
  return a.map((r, i) => clean(r[n] / r[i]));
}

/** coefficients from the highest power: [a, b, c] or [a, b, c, d] → roots (numbers or Cx), real ones first */
export function solvePoly(co) {
  const deg = co.length - 1;
  if (!co[0]) throw mathErr('a0');
  if (deg === 2) {
    const [a, b, c] = co, D = b * b - 4 * a * c;
    if (D >= 0) { const s = Math.sqrt(D); const r1 = clean((-b + s) / (2 * a)), r2 = clean((-b - s) / (2 * a)); return D === 0 ? [r1] : [r1, r2]; }
    const s = Math.sqrt(-D) / (2 * a), r = -b / (2 * a);
    return [simp(new Cx(clean(r), clean(s))), simp(new Cx(clean(r), clean(-s)))];
  }
  if (deg === 3) {
    const [a, b0, c0, d0] = co, b = b0 / a, c = c0 / a, d = d0 / a;
    const p = c - (b * b) / 3, q = (2 * b * b * b) / 27 - (b * c) / 3 + d, sh = -b / 3;
    const disc = (q * q) / 4 + (p * p * p) / 27;
    let roots;
    if (Math.abs(disc) < 1e-14 * Math.max(1, Math.abs(q * q), Math.abs(p * p * p))) {
      if (Math.abs(p) < 1e-14 && Math.abs(q) < 1e-14) roots = [sh];
      else { const u = Math.cbrt(-q / 2); roots = [2 * u + sh, -u + sh]; }
    } else if (disc > 0) {
      const sd = Math.sqrt(disc), u = Math.cbrt(-q / 2 + sd), v = Math.cbrt(-q / 2 - sd), t = u + v;
      const re = -t / 2 + sh, imag = ((u - v) * Math.sqrt(3)) / 2;
      roots = [t + sh, new Cx(re, imag), new Cx(re, -imag)];
    } else {
      const r = Math.sqrt(-(p * p * p) / 27), ph = Math.acos(Math.max(-1, Math.min(1, -q / (2 * r)))), m = 2 * Math.cbrt(r);
      roots = [0, 1, 2].map((k) => m * Math.cos((ph + 2 * Math.PI * k) / 3) + sh).sort((x, y) => y - x);
    }
    const f = (x) => ((a * x + b0) * x + c0) * x + d0;      // polish real roots with a few Newton steps
    roots = roots.map((x) => { if (typeof x !== 'number') return x; for (let i = 0; i < 4; i++) { const dd = (3 * a * x + 2 * b0) * x + c0; if (!dd) break; x -= f(x) / dd; } return clean(x); });
    return roots.map((x) => (x instanceof Cx ? simp(new Cx(clean(x.re), clean(x.im))) : x));
  }
  throw new CalcError('arg');
}
