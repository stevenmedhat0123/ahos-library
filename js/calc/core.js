// AHOS Calc – value types and arithmetic: real numbers (JS doubles), complex (Cx), matrices (Mat), vectors (Vec) and the
// number-theory helpers. Everything here is pure and has no DOM, so it is tested directly in Node.
import { CalcError, mathErr } from './errors.js';

export class Cx { constructor(re, im) { this.re = re; this.im = im; } }
export class Mat { constructor(r, c, a) { this.r = r; this.c = c; this.a = a; } }     // a = row-major numbers
export class Vec { constructor(a) { this.a = a; } }
export class Multi { constructor(vals, labels) { this.vals = vals; this.labels = labels; } }   // Pol / Rec / equation roots …
export const isC = (v) => v instanceof Cx;
export const isM = (v) => v instanceof Mat;
export const isV = (v) => v instanceof Vec;
export const isN = (v) => typeof v === 'number';
export const re = (v) => (isC(v) ? v.re : v);
export const im = (v) => (isC(v) ? v.im : 0);
export const C = (a, b = 0) => new Cx(a, b);
export const MAXV = 9.999999999e99;

let CM = false;                       // complex mode: √(−4) = 2i instead of Math ERROR
export const setCmplx = (v) => { CM = !!v; };
export const cmplxOn = () => CM;

/** a result that overflows (or is not a number) is a Math ERROR, like on the real thing */
export function chk(x) {
  if (isC(x)) { chk(x.re); chk(x.im); return x; }
  if (typeof x === 'number' && (!isFinite(x) || Math.abs(x) > MAXV)) throw mathErr('range');
  return x;
}
/** a complex number whose imaginary part is only rounding noise becomes real */
export function simp(v) {
  if (!isC(v)) return v;
  const m = Math.max(Math.abs(v.re), Math.abs(v.im));
  if (m === 0) return 0;
  if (Math.abs(v.im) <= 1e-14 * m) return v.re;
  return new Cx(Math.abs(v.re) <= 1e-14 * m ? 0 : v.re, v.im);
}
/** snaps 1 − 1e−16-style noise so that 0.1·3 − 0.3 shows as 0 */
export function clean(x) {
  if (typeof x !== 'number' || x === 0 || !isFinite(x)) return x;
  const r = parseFloat(x.toPrecision(15));
  return r;
}

/* ---------- real / complex arithmetic ---------- */
const bothN = (a, b) => typeof a === 'number' && typeof b === 'number';
const dimErr = () => new CalcError('dim');
const mapMat = (m, f) => new Mat(m.r, m.c, m.a.map(f));

export function add(a, b) {
  if (bothN(a, b)) return chk(a + b);
  if (isM(a) && isM(b)) { if (a.r !== b.r || a.c !== b.c) throw dimErr(); return new Mat(a.r, a.c, a.a.map((x, i) => x + b.a[i])); }
  if (isV(a) && isV(b)) { if (a.a.length !== b.a.length) throw dimErr(); return new Vec(a.a.map((x, i) => x + b.a[i])); }
  if ((isM(a) || isV(a)) || (isM(b) || isV(b))) throw dimErr();
  return simp(chk(new Cx(re(a) + re(b), im(a) + im(b))));
}
export function neg(a) {
  if (isN(a)) return -a;
  if (isM(a)) return mapMat(a, (x) => -x);
  if (isV(a)) return new Vec(a.a.map((x) => -x));
  return new Cx(-a.re, -a.im);
}
export const sub = (a, b) => add(a, neg(b));

export function mul(a, b) {
  if (bothN(a, b)) return chk(a * b);
  if (isM(a) && isM(b)) {
    if (a.c !== b.r) throw dimErr();
    const out = new Array(a.r * b.c).fill(0);
    for (let i = 0; i < a.r; i++) for (let j = 0; j < b.c; j++) { let s = 0; for (let k = 0; k < a.c; k++) s += a.a[i * a.c + k] * b.a[k * b.c + j]; out[i * b.c + j] = chk(s); }
    return new Mat(a.r, b.c, out);
  }
  if (isV(a) && isV(b)) return cross(a, b);
  if (isM(a) && isN(b)) return mapMat(a, (x) => chk(x * b));
  if (isN(a) && isM(b)) return mapMat(b, (x) => chk(x * a));
  if (isV(a) && isN(b)) return new Vec(a.a.map((x) => chk(x * b)));
  if (isN(a) && isV(b)) return new Vec(b.a.map((x) => chk(x * a)));
  if (isM(a) || isV(a) || isM(b) || isV(b)) throw dimErr();
  return simp(chk(new Cx(re(a) * re(b) - im(a) * im(b), re(a) * im(b) + im(a) * re(b))));
}
export function div(a, b) {
  if (bothN(a, b)) { if (b === 0) throw mathErr('div0'); return chk(a / b); }
  if ((isM(a) || isV(a)) && isN(b)) { if (b === 0) throw mathErr('div0'); return isM(a) ? mapMat(a, (x) => x / b) : new Vec(a.a.map((x) => x / b)); }
  if (isM(a) || isV(a) || isM(b) || isV(b)) throw dimErr();
  const d = re(b) * re(b) + im(b) * im(b);
  if (d === 0) throw mathErr('div0');
  return simp(chk(new Cx((re(a) * re(b) + im(a) * im(b)) / d, (im(a) * re(b) - re(a) * im(b)) / d)));
}

/** a small rational p/q (q ≤ 99) that equals x, or null – used for odd roots of negative numbers such as (−8)^(1/3) */
function smallRat(x) { for (let q = 1; q <= 99; q++) { const p = x * q; if (Math.abs(p - Math.round(p)) < 1e-12 * Math.max(1, Math.abs(p))) return [Math.round(p), q]; } return null; }

export function cexp(z) { const e = Math.exp(re(z)); return new Cx(e * Math.cos(im(z)), e * Math.sin(im(z))); }
export function cln(z) { if (re(z) === 0 && im(z) === 0) throw mathErr('ln0'); return new Cx(Math.log(Math.hypot(re(z), im(z))), Math.atan2(im(z), re(z))); }
export function csqrt(z) {
  const m = Math.hypot(re(z), im(z)), a = Math.sqrt((m + re(z)) / 2), b = Math.sqrt(Math.max(0, (m - re(z)) / 2));
  return new Cx(a, im(z) < 0 ? -b : b);
}
export function pow(a, b) {
  if (isM(a)) {
    if (!isN(b) || !Number.isInteger(b)) throw mathErr('matpow');
    if (a.r !== a.c) throw dimErr();
    if (b === -1) return minv(a);
    if (b < 0) return pow(minv(a), -b);
    let r = ident(a.r), base = a, n = b;
    while (n > 0) { if (n & 1) r = mul(r, base); base = n > 1 ? mul(base, base) : base; n >>= 1; }
    return r;
  }
  if (isV(a) || isM(b) || isV(b)) throw dimErr();
  if (bothN(a, b)) {
    if (a === 0 && b === 0) throw mathErr('0^0');
    if (a === 0 && b < 0) throw mathErr('div0');
    if (a < 0 && !Number.isInteger(b)) {
      const q = smallRat(b);
      if (q && q[1] % 2 === 1) { const r = Math.pow(-a, b); return chk(q[0] % 2 === 0 ? r : -r); }
      if (!CM) throw mathErr('neg^frac');
      return simp(chk(cexp(mul(b, cln(a)))));
    }
    return chk(Math.pow(a, b));
  }
  if (re(a) === 0 && im(a) === 0) { if (re(b) === 0 && im(b) === 0) throw mathErr('0^0'); return 0; }
  if (isN(b) && Number.isInteger(b) && Math.abs(b) <= 64) {     // integer powers of a complex number: repeated multiplication (exact for i^2 …)
    let r = 1, base = a, n = Math.abs(b);
    while (n > 0) { if (n & 1) r = mul(r, base); base = n > 1 ? mul(base, base) : base; n >>= 1; }
    return b < 0 ? div(1, r) : r;
  }
  return simp(chk(cexp(mul(b, cln(a)))));
}

/* ---------- complex elementary functions ---------- */
const I = new Cx(0, 1);
export const csin = (z) => new Cx(Math.sin(re(z)) * Math.cosh(im(z)), Math.cos(re(z)) * Math.sinh(im(z)));
export const ccos = (z) => new Cx(Math.cos(re(z)) * Math.cosh(im(z)), -Math.sin(re(z)) * Math.sinh(im(z)));
export const ctan = (z) => div(csin(z), ccos(z));
export const csinh = (z) => new Cx(Math.sinh(re(z)) * Math.cos(im(z)), Math.cosh(re(z)) * Math.sin(im(z)));
export const ccosh = (z) => new Cx(Math.cosh(re(z)) * Math.cos(im(z)), Math.sinh(re(z)) * Math.sin(im(z)));
export const ctanh = (z) => div(csinh(z), ccosh(z));
export const casin = (z) => mul(new Cx(0, -1), cln(add(mul(I, z), csqrt(sub(1, mul(z, z))))));
export const cacos = (z) => sub(Math.PI / 2, casin(z));
export const catan = (z) => mul(new Cx(0, 0.5), sub(cln(sub(1, mul(I, z))), cln(add(1, mul(I, z)))));
export const casinh = (z) => cln(add(z, csqrt(add(mul(z, z), 1))));
export const cacosh = (z) => cln(add(z, mul(csqrt(add(z, 1)), csqrt(sub(z, 1)))));
export const catanh = (z) => mul(0.5, cln(div(add(1, z), sub(1, z))));
export const conj = (z) => (isC(z) ? new Cx(z.re, -z.im) : z);
export const absC = (z) => (isC(z) ? Math.hypot(z.re, z.im) : Math.abs(z));
export const argC = (z) => Math.atan2(im(z), re(z));

/* ---------- number theory ---------- */
export function fact(n) {
  if (!Number.isInteger(n) || n < 0 || n > 69) throw mathErr('fact');
  let r = 1; for (let i = 2; i <= n; i++) r *= i;
  return r;
}
export function nPr(n, r) {
  if (!Number.isInteger(n) || !Number.isInteger(r) || n < 0 || r < 0 || r > n || n >= 1e10) throw mathErr('nPr');
  let p = 1; for (let i = 0; i < r; i++) p *= n - i;
  return chk(p);
}
export function nCr(n, r) {
  if (!Number.isInteger(n) || !Number.isInteger(r) || n < 0 || r < 0 || r > n || n >= 1e10) throw mathErr('nCr');
  r = Math.min(r, n - r);
  let p = 1; for (let i = 1; i <= r; i++) p = (p * (n - r + i)) / i;
  return chk(Math.round(p));
}
export function gcd(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b)) throw mathErr('gcd');
  a = Math.abs(a); b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
export function lcm(a, b) { if (!a || !b) return 0; return chk(Math.abs(a / gcd(a, b) * b)); }
/** prime factorisation of an integer 2 … 9 999 999 999: [[p, k], …] */
export function factorize(n) {
  if (!Number.isInteger(n) || n < 2 || n > 9999999999) throw mathErr('fact');
  const out = [];
  for (let p = 2; p * p <= n; p += p === 2 ? 1 : 2) { let k = 0; while (n % p === 0) { n /= p; k++; } if (k) out.push([p, k]); }
  if (n > 1) out.push([n, 1]);
  return out;
}

/* ---------- matrices and vectors ---------- */
export const ident = (n) => { const a = new Array(n * n).fill(0); for (let i = 0; i < n; i++) a[i * n + i] = 1; return new Mat(n, n, a); };
export function trn(m) { const a = new Array(m.a.length); for (let i = 0; i < m.r; i++) for (let j = 0; j < m.c; j++) a[j * m.r + i] = m.a[i * m.c + j]; return new Mat(m.c, m.r, a); }
export function det(m) {
  if (!isM(m)) throw dimErr();
  if (m.r !== m.c) throw dimErr();
  const n = m.r, a = m.a.slice(); let d = 1;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(a[r * n + c]) > Math.abs(a[p * n + c])) p = r;
    if (a[p * n + c] === 0) return 0;
    if (p !== c) { for (let k = 0; k < n; k++) { const t = a[c * n + k]; a[c * n + k] = a[p * n + k]; a[p * n + k] = t; } d = -d; }
    d *= a[c * n + c];
    for (let r = c + 1; r < n; r++) { const f = a[r * n + c] / a[c * n + c]; for (let k = c; k < n; k++) a[r * n + k] -= f * a[c * n + k]; }
  }
  return clean(d);
}
export function minv(m) {
  if (!isM(m) || m.r !== m.c) throw dimErr();
  const n = m.r, a = m.a.slice(), o = ident(n).a.slice();
  const scale = Math.max(...m.a.map(Math.abs), 1e-300);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(a[r * n + c]) > Math.abs(a[p * n + c])) p = r;
    if (Math.abs(a[p * n + c]) < 1e-13 * scale) throw mathErr('singular');
    if (p !== c) for (let k = 0; k < n; k++) { [a[c * n + k], a[p * n + k]] = [a[p * n + k], a[c * n + k]]; [o[c * n + k], o[p * n + k]] = [o[p * n + k], o[c * n + k]]; }
    const d = a[c * n + c];
    for (let k = 0; k < n; k++) { a[c * n + k] /= d; o[c * n + k] /= d; }
    for (let r = 0; r < n; r++) if (r !== c) { const f = a[r * n + c]; if (f) for (let k = 0; k < n; k++) { a[r * n + k] -= f * a[c * n + k]; o[r * n + k] -= f * o[c * n + k]; } }
  }
  return new Mat(n, n, o.map(clean));
}
export function cross(a, b) {
  if (a.a.length !== b.a.length) throw dimErr();
  const p = a.a.length === 2 ? [...a.a, 0] : a.a, q = b.a.length === 2 ? [...b.a, 0] : b.a;
  if (p.length !== 3) throw dimErr();
  return new Vec([p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]].map(chk));
}
export function dot(a, b) { if (!isV(a) || !isV(b) || a.a.length !== b.a.length) throw dimErr(); return chk(a.a.reduce((s, x, i) => s + x * b.a[i], 0)); }
export const vabs = (v) => Math.hypot(...v.a);
export function vangle(a, b, unit) {
  const d = dot(a, b), m = vabs(a) * vabs(b);
  if (m === 0) throw mathErr('zero');
  return Math.acos(Math.max(-1, Math.min(1, d / m))) * (unit === 'deg' ? 180 / Math.PI : unit === 'gra' ? 200 / Math.PI : 1);
}
export function unitV(v) { const m = vabs(v); if (m === 0) throw mathErr('zero'); return new Vec(v.a.map((x) => x / m)); }
