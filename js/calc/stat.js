// AHOS Calc – STAT mode: one-variable statistics and seven regression models (linear, quadratic, logarithmic, e^x, a·b^x, power, inverse).
import { CalcError, mathErr } from './errors.js';

export const STAT_TYPES = ['sd', 'lin', 'quad', 'log', 'exp', 'ab', 'pow', 'inv'];
export const isPaired = (t) => t !== 'sd';

/** y = f(x) for the model in `reg` */
export function regPredict(reg, x) {
  const { type: t, A, B, C } = reg;
  switch (t) {
    case 'lin': return A + B * x;
    case 'quad': return A + B * x + C * x * x;
    case 'log': if (x <= 0) throw mathErr('log'); return A + B * Math.log(x);
    case 'exp': return A * Math.exp(B * x);
    case 'ab': return A * Math.pow(B, x);
    case 'pow': if (x <= 0) throw mathErr('pow'); return A * Math.pow(x, B);
    case 'inv': if (x === 0) throw mathErr('inv'); return A + B / x;
  }
  throw mathErr('reg');
}
/** x for a given y (x̂) */
export function regInverse(reg, y) {
  const { type: t, A, B, C } = reg;
  switch (t) {
    case 'lin': if (B === 0) throw mathErr('reg'); return (y - A) / B;
    case 'quad': { const d = B * B - 4 * C * (A - y); if (C === 0 || d < 0) throw mathErr('reg'); return (-B + Math.sqrt(d)) / (2 * C); }
    case 'log': return Math.exp((y - A) / B);
    case 'exp': if (y / A <= 0) throw mathErr('reg'); return Math.log(y / A) / B;
    case 'ab': if (y / A <= 0) throw mathErr('reg'); return Math.log(y / A) / Math.log(B);
    case 'pow': if (y / A <= 0) throw mathErr('reg'); return Math.pow(y / A, 1 / B);
    case 'inv': if (y === A) throw mathErr('reg'); return B / (y - A);
  }
  throw mathErr('reg');
}

const wsum = (a, f) => a.reduce((s, v, i) => s + v * f[i], 0);
function median(sorted) { const n = sorted.length, m = n >> 1; return n % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2; }

/** rows: [{ x, y, f }] – y only for paired types, f (frequency, default 1) */
export function computeStat(type, rows) {
  const R = rows.filter((r) => typeof r.x === 'number' && (type === 'sd' || typeof r.y === 'number'));
  if (!R.length) throw mathErr('nodata');
  const f = R.map((r) => (typeof r.f === 'number' ? r.f : 1)), xs = R.map((r) => r.x);
  if (f.some((v) => v < 0 || !Number.isInteger(v) || v > 999)) throw new CalcError('arg', 'freq');
  const n = f.reduce((s, v) => s + v, 0);
  if (n === 0) throw mathErr('nodata');
  const sx = wsum(xs, f), sx2 = wsum(xs.map((v) => v * v), f), mx = sx / n;
  const vx = Math.max(0, sx2 / n - mx * mx);
  const vars = { n, 'x̄': mx, 'Σx': sx, 'Σx²': sx2, 'σx': Math.sqrt(vx), 'sx': n > 1 ? Math.sqrt(Math.max(0, (sx2 - n * mx * mx) / (n - 1))) : NaN, minX: Math.min(...xs), maxX: Math.max(...xs) };
  if (n > 1 && !isFinite(vars.sx)) vars.sx = 0;
  if (type === 'sd') {
    const exp = []; R.forEach((r, i) => { for (let k = 0; k < f[i] && exp.length < 20000; k++) exp.push(r.x); });
    exp.sort((a, b) => a - b);
    const h = exp.length >> 1;
    vars.Med = median(exp);
    vars.Q1 = exp.length > 1 ? median(exp.slice(0, h)) : exp[0];
    vars.Q3 = exp.length > 1 ? median(exp.slice(exp.length % 2 ? h + 1 : h)) : exp[0];
    if (n === 1) vars.sx = NaN;
    return { type, n, vars, reg: null };
  }
  const ys = R.map((r) => r.y), sy = wsum(ys, f), sy2 = wsum(ys.map((v) => v * v), f), my = sy / n, sxy = wsum(xs.map((v, i) => v * ys[i]), f);
  const vy = Math.max(0, sy2 / n - my * my);
  Object.assign(vars, { 'ȳ': my, 'Σy': sy, 'Σy²': sy2, 'Σxy': sxy, 'σy': Math.sqrt(vy), 'sy': n > 1 ? Math.sqrt(Math.max(0, (sy2 - n * my * my) / (n - 1))) : NaN, minY: Math.min(...ys), maxY: Math.max(...ys) });
  const reg = regress(type, xs, ys, f);
  vars.RegA = reg.A; vars.RegB = reg.B; if (type === 'quad') vars.RegC = reg.C; else delete vars.RegC;
  if (reg.r != null) vars.r = reg.r; else delete vars.r;
  return { type, n, vars, reg };
}

function regress(type, xs, ys, f) {
  const tx = (x) => { if (type === 'log' || type === 'pow') { if (x <= 0) throw mathErr('log'); return Math.log(x); } if (type === 'inv') { if (x === 0) throw mathErr('inv'); return 1 / x; } return x; };
  const ty = (y) => { if (type === 'exp' || type === 'ab' || type === 'pow') { if (y <= 0) throw mathErr('log'); return Math.log(y); } return y; };
  const X = xs.map(tx), Y = ys.map(ty), n = f.reduce((s, v) => s + v, 0);
  if (type === 'quad') {
    const s = (k) => wsum(xs.map((x) => Math.pow(x, k)), f), t = (k) => wsum(xs.map((x, i) => Math.pow(x, k) * ys[i]), f);
    const M = [[n, s(1), s(2), t(0)], [s(1), s(2), s(3), t(1)], [s(2), s(3), s(4), t(2)]];
    for (let c = 0; c < 3; c++) {
      let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) throw mathErr('reg');
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < 3; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let q = c; q < 4; q++) M[r][q] -= k * M[c][q]; }
    }
    return { type, A: M[0][3] / M[0][0], B: M[1][3] / M[1][1], C: M[2][3] / M[2][2], r: null };
  }
  const sx = wsum(X, f), sy = wsum(Y, f), sxx = wsum(X.map((v) => v * v), f), syy = wsum(Y.map((v) => v * v), f), sxy = wsum(X.map((v, i) => v * Y[i]), f);
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-14 * Math.max(1, Math.abs(n * sxx))) throw mathErr('reg');
  const b = (n * sxy - sx * sy) / den, a = (sy - b * sx) / n;
  const dy = n * syy - sy * sy, r = dy <= 0 ? NaN : (n * sxy - sx * sy) / Math.sqrt(den * dy);
  let A = a, B = b;
  if (type === 'exp') { A = Math.exp(a); B = b; }
  else if (type === 'ab') { A = Math.exp(a); B = Math.exp(b); }
  else if (type === 'pow') { A = Math.exp(a); B = b; }
  return { type, A, B, C: null, r };
}
