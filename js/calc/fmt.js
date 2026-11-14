// AHOS Calc – turning values into what the display shows: decimals (Norm / Fix / Sci / Eng), exact forms (fractions, radicals,
// multiples of π – found by value, so they also work for sin 45° or √8) and the item trees the display renders.
import { Cx, Mat, Vec, Multi, isC, isM, isV, re, im, gcd } from './core.js';
import { PF } from './expr.js';

export const DEFAULT_SETUP = { ang: 'deg', mode: 'norm1', digits: 0, frac: 'mixed', display: 'natural', point: '.', sep: false, cplx: 'rect', freq: true, tableG: false };

/* ---------- decimals ---------- */
const stripZeros = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
function expParts(v, digits) {            // v = m × 10^e with `digits` significant digits
  const s = v.toExponential(Math.max(0, digits - 1)), [m, e] = s.split('e');
  return { m: stripZeros(m), e: parseInt(e, 10) };
}
function group(intPart, sep) { return sep ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep) : intPart; }
function pointSep(s, setup) {
  const pt = setup.point === ',' ? ',' : '.';
  let [i, f] = s.split('.');
  const neg = i.startsWith('-'); if (neg) i = i.slice(1);
  i = group(i, setup.sep ? (pt === ',' ? '.' : ',') : '');
  return (neg ? '-' : '') + i + (f !== undefined ? pt + f : '');
}
/** → { m: '1.2345', e: -5 | null } */
export function decimalParts(v, setup = DEFAULT_SETUP) {
  if (v === 0 || Object.is(v, -0)) return { m: '0', e: null };
  const a = Math.abs(v), mode = setup.mode || 'norm1', d = setup.digits || 0;
  if (mode === 'sci') { const p = expParts(v, d === 0 ? 10 : d); return { m: pointSep(setup.digits ? (+p.m).toFixed(Math.max(0, d - 1)) : p.m, setup), e: p.e }; }
  if (mode === 'fix') {
    if (a >= 1e10) { const p = expParts(v, 10); return { m: pointSep(p.m, setup), e: p.e }; }
    return { m: pointSep(v.toFixed(d), setup), e: null };
  }
  const lo = mode === 'norm2' ? 1e-9 : 1e-2;
  const r = Number(v.toPrecision(10));
  if (Math.abs(r) >= 1e10 || Math.abs(r) < lo) { const p = expParts(v, 10); return { m: pointSep(p.m, setup), e: p.e }; }
  const mag = Math.floor(Math.log10(Math.abs(r)));
  const dec = Math.max(0, 9 - mag);
  return { m: pointSep(stripZeros(r.toFixed(Math.min(dec, 100))), setup), e: null };
}
/** engineering notation: exponent a multiple of 3; `shift` moves it in steps of 3 (the ENG key) */
export function engParts(v, shift = 0, setup = DEFAULT_SETUP) {
  if (v === 0) return { m: '0', e: null };
  const p = expParts(v, 10);
  let e = Math.floor(p.e / 3) * 3 + 3 * shift;
  const mant = v / Math.pow(10, e);
  return { m: pointSep(stripZeros(Number(mant.toPrecision(10)).toString()), setup), e };
}
export function decimalText(v, setup) { const p = decimalParts(v, setup); return p.e == null ? p.m : `${p.m}×10^${p.e}`; }

const sup = (s) => ({ k: 'pow', e: [s] });
/** a decimal as display items: ['1.2345','×10',{pow}] */
export function decimalItems(v, setup, eng) {
  const p = eng != null ? engParts(v, eng, setup) : decimalParts(v, setup);
  const sign = p.m.startsWith('-');
  const items = []; if (sign) items.push('-');
  items.push(sign ? p.m.slice(1) : p.m);
  if (p.e != null) items.push('×10', sup(String(p.e).replace('-', '−')));
  return items;
}

/* ---------- exact forms ---------- */
const EPS = 4e-15;
function ratApprox(x, maxQ, eps = EPS) {
  if (!(x > 0) || !isFinite(x)) return null;
  let h0 = 0, h1 = 1, k0 = 1, k1 = 0, b = x;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(b);
    [h0, h1] = [h1, a * h1 + h0]; [k0, k1] = [k1, a * k1 + k0];
    if (k1 > maxQ || h1 > 1e12) return null;
    if (Math.abs(x - h1 / k1) <= eps * x) { const g = gcd(h1, k1); return [h1 / g, k1 / g]; }
    const f = b - a; if (f < 1e-15) return null;
    b = 1 / f;
  }
  return null;
}
function squareFree(n) {          // n = k² · m with m square-free → [k, m]
  let k = 1, m = n;
  for (let p = 2; p * p <= m; p++) while (m % (p * p) === 0) { m /= p * p; k *= p; }
  return [k, m];
}
const SQF = []; for (let c = 2; c <= 60; c++) { const [k] = squareFree(c); if (k === 1) SQF.push(c); }
const dg = (n) => String(n).length;

/** the exact form of a real number, or null. { t:'int'|'frac'|'rad'|'pi'|'sum', s:±1, … } */
export function exactForm(v) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v === 0) return { t: 'int', s: 1, n: 0 };
  const s = v < 0 ? -1 : 1, a = Math.abs(v);
  if (Number.isInteger(a)) return a < 1e10 ? { t: 'int', s, n: a } : null;
  const r = ratApprox(a, 99999);
  if (r && dg(r[0]) + dg(r[1]) <= 10) return { t: 'frac', s, n: r[0], d: r[1] };
  const rp = ratApprox(a / Math.PI, 1000);
  if (rp) return { t: 'pi', s, n: rp[0], d: rp[1], r: 1 };
  const r2 = ratApprox(a * a, 10000, 2 * EPS);
  if (r2) {
    const [k, m] = squareFree(r2[0] * r2[1]), g = gcd(k, r2[1]);
    if (m > 1) return { t: 'rad', s, a: k / g, b: m, d: r2[1] / g };
  }
  const r3 = ratApprox((a / Math.PI) * (a / Math.PI), 1000, 2 * EPS);
  if (r3) { const [k, m] = squareFree(r3[0] * r3[1]), g = gcd(k, r3[1]); if (m > 1) return { t: 'pi', s, n: k / g, d: r3[1] / g, r: m }; }
  for (const c of SQF) {                      // (p + q√c) / d
    const sq = Math.sqrt(c);
    for (let d = 1; d <= 12; d++) for (let q = -24; q <= 24; q++) {
      if (!q) continue;
      const p = Math.round(v * d - q * sq);
      if (Math.abs(p) > 60) continue;
      if (Math.abs((p + q * sq) / d - v) <= 3 * EPS * Math.max(1, a) * (a < 1 ? 1 : 1)) {
        const g = gcd(gcd(Math.abs(p), Math.abs(q)), d);
        return { t: 'sum', p: p / g, q: q / g, c, d: d / g };
      }
    }
  }
  return null;
}

const num = (n) => String(n);
function radItems(a, b) { return [...(a > 1 ? [num(a)] : []), { k: 'sqrt', a: [num(b)] }]; }
/** exact form → display items */
export function exactItems(f, setup = DEFAULT_SETUP) {
  const sg = f.s < 0 ? ['-'] : [];
  switch (f.t) {
    case 'int': return [...sg, num(f.n)];
    case 'frac': {
      if (setup.frac !== 'improper' && f.n > f.d) { const w = Math.floor(f.n / f.d), n = f.n - w * f.d; return [...sg, { k: 'mix', w: [num(w)], n: [num(n)], d: [num(f.d)] }]; }
      return [...sg, { k: 'frac', n: [num(f.n)], d: [num(f.d)] }];
    }
    case 'rad': { const top = radItems(f.a, f.b); return [...sg, f.d > 1 ? { k: 'frac', n: top, d: [num(f.d)] } : top].flat(); }
    case 'pi': {
      const top = [...(f.r > 1 ? [{ k: 'sqrt', a: [num(f.r)] }] : []), ...(f.n > 1 ? [] : []), ...(f.n > 1 ? [num(f.n)] : []), 'π'];
      const top2 = f.r > 1 ? [...(f.n > 1 ? [num(f.n)] : []), { k: 'sqrt', a: [num(f.r)] }, 'π'] : [...(f.n > 1 ? [num(f.n)] : []), 'π'];
      return [...sg, f.d > 1 ? { k: 'frac', n: top2, d: [num(f.d)] } : top2].flat();
    }
    case 'sum': {
      const top = [];
      if (f.p) top.push(f.p < 0 ? '-' + num(-f.p) : num(f.p));
      const qa = Math.abs(f.q);
      top.push(f.q < 0 ? '-' : (f.p ? '+' : ''), ...(qa > 1 ? [num(qa)] : []), { k: 'sqrt', a: [num(f.c)] });
      const t2 = top.filter((x) => x !== '');
      return [f.d > 1 ? { k: 'frac', n: t2, d: [num(f.d)] } : t2].flat();
    }
  }
  return [];
}
/** the items for any real number: its exact form when allowed and found, otherwise the decimal */
export function realItems(v, setup, { exact = true } = {}) {
  if (exact) { const f = exactForm(v); if (f) return exactItems(f, setup); }
  return decimalItems(v, setup);
}
/** natural templates → plain text (for the linear display and for copying) */
export function linearize(items) {
  const out = [];
  const flat = (it) => (typeof it === 'string' ? it : it.k === 'pow' ? '^(' + it.e.map(flat).join('') + ')' : it.k === 'frac' ? it.n.map(flat).join('') + '⌟' + it.d.map(flat).join('') : it.k === 'mix' ? it.w.map(flat).join('') + '⌟' + it.n.map(flat).join('') + '⌟' + it.d.map(flat).join('') : it.k === 'sqrt' ? '√(' + it.a.map(flat).join('') + ')' : '?');
  for (const it of items) {
    if (typeof it === 'object' && it.k === 'pow') out.push(it.e.map(flat).join('') && ('^' + it.e.map(flat).join('')));
    else out.push(flat(it));
  }
  return out;
}
export const itemsText = (items) => items.map((it) => (typeof it === 'string' ? it : it.k === 'pow' ? '^' + it.e.join('') : linearize([it]).join(''))).join('');

/* ---------- any value → a description the UI draws ---------- */
function complexItems(z, setup, exact) {
  const a = re(z), b = im(z);
  const unit = (x) => realItems(x, setup, { exact });
  if (setup.cplx === 'polar' || z.__polar) {
    const r = Math.hypot(a, b), th = Math.atan2(b, a) * (setup.ang === 'deg' ? 180 / Math.PI : setup.ang === 'gra' ? 200 / Math.PI : 1);
    return [...unit(parseFloat(r.toPrecision(14))), '∠', ...unit(parseFloat(th.toPrecision(14)))];
  }
  const A = parseFloat(a.toPrecision(14)), B = parseFloat(b.toPrecision(14));
  const out = [];
  if (A !== 0 || B === 0) out.push(...unit(A));
  if (B !== 0) {
    const ab = Math.abs(B);
    const mag = ab === 1 ? [] : unit(ab);
    const needParen = mag.length > 1 && !(mag.length === 1);
    if (A !== 0) out.push(B < 0 ? '-' : '+'); else if (B < 0) out.push('-');
    if (needParen && mag.some((x) => typeof x === 'object' && x.k === 'frac')) out.push(...mag); else out.push(...mag);
    out.push('i');
  }
  return out;
}
/** value (+ meta) → { kind, … } */
export function describe(value, setup, { decimal = false, dir = null, eng = null, showExact = null } = {}) {
  const exactOK = showExact == null ? !decimal : showExact;
  if (typeof value === 'number') {
    const exactIt = exactForm(value);
    const dec = decimalItems(value, setup, eng);
    let items = dec, isExact = false;
    if (exactOK && exactIt && eng == null) { items = exactItems(exactIt, setup); isExact = exactIt.t !== 'int'; }
    if (dir === 'dms') {
      const sg = value < 0 ? '-' : '', a = Math.abs(value) + 1e-9;
      const d = Math.floor(a), mm = Math.floor((a - d) * 60), ss = ((a - d) * 60 - mm) * 60 - 1e-9 * 3600;
      items = [sg + d, '°', String(mm), '′', parseFloat(Math.max(0, ss).toFixed(2)).toString(), '″'];
      isExact = false;
    }
    return { kind: 'num', items, canToggle: !!exactIt && exactIt.t !== 'int' || isExact, exact: isExact, dec };
  }
  if (isC(value)) {
    const items = complexItems(dir === 'polar' ? Object.assign(new Cx(value.re, value.im), { __polar: true }) : dir === 'rect' ? new Cx(value.re, value.im) : value, dir === 'rect' ? { ...setup, cplx: 'rect' } : setup, exactOK);
    return { kind: 'num', items, canToggle: false };
  }
  if (isM(value)) return { kind: 'mat', r: value.r, c: value.c, cells: value.a.map((x) => realItems(x, setup, { exact: exactOK })) };
  if (isV(value)) return { kind: 'vec', cells: value.a.map((x) => realItems(x, setup, { exact: exactOK })) };
  if (value instanceof Multi) return { kind: 'multi', rows: value.vals.map((x, i) => ({ label: value.labels[i], items: typeof x === 'number' ? realItems(x, setup, { exact: exactOK }) : complexItems(x, setup, exactOK) })) };
  if (value instanceof PF) {
    const items = [];
    value.list.forEach(([p, k], i) => { if (i) items.push('×'); items.push(String(p)); if (k > 1) items.push(sup(String(k))); });
    return { kind: 'num', items, canToggle: false, note: String(value.n) + ' =' };
  }
  return { kind: 'num', items: ['?'], canToggle: false };
}
