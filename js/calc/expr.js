// AHOS Calc – the expression engine: items (what the editor holds) → tokens → syntax tree → value.
// Items are strings ('7', 'sin(', 'A', '×' …) or templates ({k:'frac', n:[…], d:[…]}), so the parser never has to guess where a
// name ends. The same engine drives COMP, CMPLX, BASE-N, STAT cells, TABLE, SOLVE, CALC, integrals, matrices and vectors.
import { CalcError, mathErr } from './errors.js';
import * as K from './core.js';
import { CONSTS, CONVS } from './consts.js';
import { regPredict, regInverse } from './stat.js';

const { Cx, Mat, Vec, Multi, isC, isM, isV, isN, chk, simp, clean } = K;
const syn = (d) => new CalcError('syntax', d);
const arg = (d) => new CalcError('arg', d);

/** result of a prime factorisation (Fact) */
export class PF { constructor(n, list) { this.n = n; this.list = list; } }

/* ============================ items → tokens ============================ */
const POST = new Set(['!', '²', '³', '⁻¹', '%', '°', '′', '″', 'ʳ', 'ᵍ']);
const BINOPS = new Set(['nPr', 'nCr', 'and', 'or', 'xor', 'xnor', '∠', '·']);
const IDS = new Set(['π', 'e', 'i', 'Ans', 'PreAns', 'Ran#', 'MatA', 'MatB', 'MatC', 'MatAns', 'VctA', 'VctB', 'VctC', 'VctAns',
  'A', 'B', 'C', 'D', 'E', 'F', 'X', 'Y', 'M', 'n', 'x̄', 'ȳ', 'Σx', 'Σx²', 'Σy', 'Σy²', 'Σxy', 'σx', 'σy', 'sx', 'sy', 'minX', 'maxX', 'minY', 'maxY', 'Q1', 'Med', 'Q3', 'RegA', 'RegB', 'RegC', 'r']);
const TEMPLATES = { frac: ['n', 'd'], mix: ['w', 'n', 'd'], sqrt: ['a'], root: ['n', 'a'], abs: ['a'], logb: ['b', 'a'], int: ['f', 'a', 'b'], der: ['f', 'a'], sum: ['f', 'a', 'b'] };
export const TEMPLATE_SLOTS = { ...TEMPLATES, pow: ['e'] };

const digitOK = (ch, base) => (base === 10 ? /[0-9.]/.test(ch) : base === 16 ? /[0-9A-F]/.test(ch) : base === 8 ? /[0-7]/.test(ch) : /[01]/.test(ch));

/** items → tokens. `base` is 10 normally; in BASE-N mode digits are read in that base (A–F are digits in HEX). */
export function flatten(items, base = 10) {
  const out = [];
  let num = '';
  const endNum = () => { if (num) { out.push({ t: 'n', s: num, base, dec: num.includes('.') }); num = ''; } };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (typeof it === 'string') {
      if (it.length >= 1 && [...it].every((ch) => digitOK(ch, base))) { num += it; continue; }
      endNum();
      if (it === '+' || it === '-' || it === '−') out.push({ t: 'op', s: it === '+' ? '+' : '-' });
      else if (it === '×' || it === '*') out.push({ t: 'op', s: '×' });
      else if (it === '÷' || it === '/') out.push({ t: 'op', s: '÷' });
      else if (it === '(') out.push({ t: 'lp' });
      else if (it === ')') out.push({ t: 'rp' });
      else if (it === ',') out.push({ t: 'cm' });
      else if (POST.has(it)) out.push({ t: 'post', s: it });
      else if (BINOPS.has(it)) out.push({ t: 'op', s: it });
      else if (it === '→') out.push({ t: 'sto' });
      else if (it === '=') out.push({ t: 'eq' });
      else if (it === 'ᴇ') {
        const nx = items[i + 1];
        if (nx && typeof nx === 'object' && nx.k === 'pow') { out.push({ t: 'exp', e: flatten(nx.e, 10) }); i++; } else out.push({ t: 'exp', e: [] });
      } else if (IDS.has(it)) out.push({ t: 'id', s: it });
      else if (/^c#\d+$/.test(it)) out.push({ t: 'id', s: it });
      else if (/^cv#\d+\($/.test(it)) { out.push({ t: 'fn', s: 'conv', idx: +it.slice(3, -1) }, { t: 'lp' }); }
      else if (it.length > 1 && it.endsWith('(')) out.push({ t: 'fn', s: it.slice(0, -1) }, { t: 'lp' });
      else throw syn('item ' + it);
    } else if (it && typeof it === 'object') {
      endNum();
      if (it.k === 'pow') out.push({ t: 'pow', e: flatten(it.e, 10) });
      else if (TEMPLATES[it.k]) { const slots = {}; for (const s of TEMPLATES[it.k]) slots[s] = flatten(it[s] || [], 10); out.push({ t: 'T', k: it.k, slots }); }
      else throw syn('template ' + it.k);
    }
  }
  endNum();
  return out;
}

/** plain text → items (for tests and quick use). `ᴇ` = ×10^, `^` = superscript of the next group. */
const NAMES = ['PreAns', 'MatAns', 'VctAns', 'RanInt', 'asinh', 'acosh', 'atanh', 'Conjg', 'Ident', 'UnitV', 'Angle', 'xnor', 'Intg', 'sqrt', 'cbrt', 'root', 'logb', 'conv', 'toPolar', 'toRect', 'dms', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'Ran#', 'MatA', 'MatB', 'MatC', 'VctA', 'VctB', 'VctC', 'RegA', 'RegB', 'RegC', 'minX', 'maxX', 'minY', 'maxY',
  'sin', 'cos', 'tan', 'log', 'Abs', 'Int', 'Rnd', 'Pol', 'Rec', 'GCD', 'LCM', 'Arg', 'ReP', 'ImP', 'Det', 'Trn', 'Dot', 'Not', 'Neg', 'Fact', 'nPr', 'nCr', 'and', 'xor', 'Ans', 'ln', 'or', 'Q1', 'Q3', 'Med', 'Σx²', 'Σy²', 'Σxy', 'Σx', 'Σy', 'x̄', 'ȳ', 'σx', 'σy', 'sx', 'sy', 'x̂', 'ŷ'];
export function itemsFromText(s) {
  const out = [];
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (ch === ' ') { i++; continue; }
    if (/[0-9.]/.test(ch)) { out.push(ch); i++; continue; }
    if (ch === '^') {                      // ^3, ^(…), ^-2 → a pow template
      i++; let e = '';
      if (s[i] === '(') { let d = 0, j = i; for (; j < s.length; j++) { if (s[j] === '(') d++; else if (s[j] === ')' && --d === 0) break; } e = s.slice(i + 1, j); i = j + 1; }
      else { const m = /^-?[0-9.]+|^[A-Za-zπ]/.exec(s.slice(i)); e = m ? m[0] : ''; i += e.length; }
      out.push({ k: 'pow', e: itemsFromText(e) }); continue;
    }
    if ('+-×÷*/(),!²³%°′″ʳᵍ→=ᴇ∠·πie'.includes(ch) && !(ch === 'i' && /[a-z]/.test(s[i + 1] || '')) && !(ch === 'e' && /[a-z]/.test(s[i + 1] || ''))) {
      if (ch === '⁻' && s[i + 1] === '¹') { out.push('⁻¹'); i += 2; continue; }
      out.push(ch); i++; continue;
    }
    if (ch === '⁻' && s[i + 1] === '¹') { out.push('⁻¹'); i += 2; continue; }
    const nm = NAMES.find((n) => s.startsWith(n, i));
    if (nm) {
      i += nm.length;
      if (s[i] === '(' && !['Ans', 'PreAns', 'and', 'or', 'xor', 'xnor', 'nPr', 'nCr'].includes(nm) && !/^(Mat|Vct|Reg|min|max|Q|Med|x̄|ȳ|σ|s[xy]|Σ|Ran#)/.test(nm)) { out.push(nm + '('); i++; } else out.push(nm);
      continue;
    }
    if (/^[A-FXYMr]$/.test(ch) || ch === 'n') { out.push(ch); i++; continue; }
    if (/^c#\d+/.test(s.slice(i))) { const m = /^c#\d+/.exec(s.slice(i))[0]; out.push(m); i += m.length; continue; }
    throw syn('char ' + ch);
  }
  return out;
}

/* ============================ tokens → syntax tree ============================ */
class Parser {
  constructor(tk) { this.tk = tk; this.p = 0; }
  peek() { return this.tk[this.p]; }
  next() { return this.tk[this.p++]; }
  isOp(...s) { const t = this.peek(); return t && t.t === 'op' && s.includes(t.s); }
  atomStart() {
    const t = this.peek();
    return !!t && (t.t === 'n' || t.t === 'id' || t.t === 'fn' || t.t === 'lp' || t.t === 'T' || t.t === 'exp');
  }
  expr() { return this.lor(); }
  lor() { let a = this.land(); while (this.isOp('or', 'xor', 'xnor')) { const op = this.next().s; a = { k: 'bin', op, a, b: this.land() }; } return a; }
  land() { let a = this.add(); while (this.isOp('and')) { this.next(); a = { k: 'bin', op: 'and', a, b: this.add() }; } return a; }
  add() { let a = this.mul(); while (this.isOp('+', '-')) { const op = this.next().s; a = { k: 'bin', op, a, b: this.mul() }; } return a; }
  mul() { let a = this.imul(); while (this.isOp('×', '÷')) { const op = this.next().s; a = { k: 'bin', op, a, b: this.imul() }; } return a; }
  imul() {               // implicit multiplication (2π, 3sin30, A(B+1)) binds tighter than × and ÷
    let a = this.perm();
    while (this.atomStart()) a = { k: 'bin', op: '×', a, b: this.perm() };
    return a;
  }
  perm() { let a = this.unary(); while (this.isOp('nPr', 'nCr', '∠', '·')) { const op = this.next().s; a = { k: 'bin', op, a, b: this.unary() }; } return a; }
  unary() {
    if (this.isOp('-')) { this.next(); return { k: 'neg', a: this.unary() }; }
    if (this.isOp('+')) { this.next(); return this.unary(); }
    return this.pow();
  }
  pow() {
    let a = this.post();
    for (;;) {
      const t = this.peek();
      if (t && t.t === 'pow') { this.next(); a = { k: 'pow', a, b: parseTokens(t.e) }; }
      else break;
    }
    return a;
  }
  post() {
    let a = this.atom();
    for (;;) {
      const t = this.peek();
      if (t && t.t === 'post') { this.next(); a = { k: 'post', op: t.s, a }; continue; }
      if (t && t.t === 'pow') { this.next(); a = { k: 'pow', a, b: parseTokens(t.e) }; continue; }
      break;
    }
    return a;
  }
  atom() {
    const t = this.next();
    if (!t) throw syn('end');
    if (t.t === 'n') {
      const base = t.base || 10;
      if (base !== 10) { let v = parseInt(t.s, base); if (!isFinite(v) || v > 4294967295) throw mathErr('range'); if (v > 2147483647) v |= 0; return { k: 'num', v, dec: false }; }
      if ((t.s.match(/\./g) || []).length > 1) throw syn('num');
      let v = t.s === '.' ? NaN : parseFloat(t.s); if (isNaN(v)) throw syn('num');
      let node = { k: 'num', v, dec: t.dec };
      const nx = this.peek();
      if (nx && nx.t === 'exp') { this.next(); node = { k: 'numx', v, e: parseTokens(nx.e), dec: t.dec }; }
      const d = this.peek();
      if (d && d.t === 'post' && d.s === '°' && !node.e) {             // 12°30′15″
        this.next(); let deg = v, mn = 0, sc = 0;
        const a1 = this.peek(), a2 = this.tk[this.p + 1];
        if (a1 && a1.t === 'n' && a2 && a2.t === 'post' && a2.s === '′') { mn = parseFloat(a1.s); this.p += 2; }
        const b1 = this.peek(), b2 = this.tk[this.p + 1];
        if (b1 && b1.t === 'n' && b2 && b2.t === 'post' && b2.s === '″') { sc = parseFloat(b1.s); this.p += 2; }
        node = { k: 'dms', d: deg, m: mn, s: sc, dec: node.dec || mn % 1 !== 0 || sc % 1 !== 0 };
      }
      return node;
    }
    if (t.t === 'exp') return { k: 'numx', v: 1, e: parseTokens(t.e), dec: false };
    if (t.t === 'id') return /^c#/.test(t.s) ? { k: 'const', i: +t.s.slice(2) } : { k: 'id', s: t.s };
    if (t.t === 'fn') {
      if (!this.peek() || this.peek().t !== 'lp') throw syn('fn');
      this.next();
      const args = [];
      if (this.peek() && this.peek().t === 'rp') this.next();
      else {
        for (;;) {
          args.push(this.expr());
          const q = this.peek();
          if (!q) break;                               // an unclosed bracket at the end is closed for you
          if (q.t === 'cm') { this.next(); continue; }
          if (q.t === 'rp') { this.next(); break; }
          throw syn('arg');
        }
      }
      return { k: 'call', f: t.s, args, idx: t.idx };
    }
    if (t.t === 'lp') {
      const e = this.expr();
      const q = this.peek();
      if (q && q.t === 'rp') this.next(); else if (q) throw syn('paren');
      return { k: 'paren', a: e };
    }
    if (t.t === 'T') {
      const s = {}; for (const key of Object.keys(t.slots)) s[key] = parseTokens(t.slots[key]);
      switch (t.k) {
        case 'frac': return { k: 'bin', op: '÷', a: s.n, b: s.d, frac: true };
        case 'mix': return { k: 'bin', op: '+', a: s.w, b: { k: 'bin', op: '÷', a: s.n, b: s.d, frac: true }, mixed: true };
        case 'sqrt': return { k: 'call', f: 'sqrt', args: [s.a] };
        case 'root': return { k: 'call', f: 'root', args: [s.n, s.a] };
        case 'abs': return { k: 'call', f: 'Abs', args: [s.a] };
        case 'logb': return { k: 'call', f: 'logb', args: [s.b, s.a] };
        case 'int': return { k: 'int', f: s.f, a: s.a, b: s.b };
        case 'der': return { k: 'der', f: s.f, a: s.a };
        case 'sum': return { k: 'sum', f: s.f, a: s.a, b: s.b };
        default: throw syn('template');
      }
    }
    throw syn('unexpected');
  }
}
/** tokens → tree, or throws Syntax ERROR. An empty slot is a syntax error too. */
export function parseTokens(tk) {
  if (!tk.length) throw syn('empty');
  const p = new Parser(tk);
  const e = p.expr();
  if (p.p < tk.length) throw syn('trailing');
  return e;
}
/** items → { ast, kind } where kind is 'expr' | 'sto' | 'eq' */
export function parseItems(items, base = 10) {
  const tk = flatten(items, base);
  const si = tk.findIndex((t) => t.t === 'sto');
  if (si >= 0) {
    const tail = tk.slice(si + 1);
    if (tail.length !== 1 || tail[0].t !== 'id') throw syn('sto');
    return { kind: 'sto', ast: parseTokens(tk.slice(0, si)), to: tail[0].s };
  }
  const ei = tk.findIndex((t) => t.t === 'eq');
  if (ei >= 0) return { kind: 'eq', l: parseTokens(tk.slice(0, ei)), r: parseTokens(tk.slice(ei + 1)) };
  return { kind: 'expr', ast: parseTokens(tk) };
}

/* ============================ evaluation ============================ */
export const deg2 = (ang) => (ang === 'deg' ? 180 / Math.PI : ang === 'gra' ? 200 / Math.PI : 1);   // radians → current unit
export function angToDeg(x, ang) { return ang === 'deg' ? x : ang === 'rad' ? (x * 180) / Math.PI : x * 0.9; }
export function degToAng(d, ang) { return ang === 'deg' ? d : ang === 'rad' ? (d * Math.PI) / 180 : d / 0.9; }
function trig(name, x, ang) {
  const d = angToDeg(x, ang), k = d / 90, kr = Math.round(k);
  if (Math.abs(k - kr) < 1e-11 * Math.max(1, Math.abs(k))) {          // exact multiples of 90° give exact results (sin 180 = 0, cos 90 = 0)
    const q = ((kr % 4) + 4) % 4;
    if (name === 'sin') return [0, 1, 0, -1][q];
    if (name === 'cos') return [1, 0, -1, 0][q];
    if (q % 2) throw mathErr('tan90');
    return 0;
  }
  return clean(Math[name]((d * Math.PI) / 180));
}
const needReal = (v) => { if (!isN(v)) { if (isC(v)) throw mathErr('complex'); throw arg('type'); } return v; };
const needInt = (v) => { needReal(v); if (!Number.isInteger(v)) throw mathErr('int'); return v; };

function toBase32(x) {
  if (!Number.isInteger(x)) x = Math.trunc(x);
  if (x > 2147483647 || x < -2147483648) throw mathErr('range');
  return x;
}

/** numeric integration: adaptive Gauss–Kronrod (7,15) */
const GK_X = [0.991455371120813, 0.949107912342759, 0.864864423359769, 0.741531185599394, 0.58608723546769, 0.405845151377397, 0.207784955007898, 0];
const GK_WK = [0.022935322010529, 0.063092092629979, 0.104790010322250, 0.140653259715525, 0.169004726639267, 0.190350578064785, 0.204432940075298, 0.209482141084728];
const GK_WG = [0, 0.129484966168870, 0, 0.279705391489277, 0, 0.381830050505119, 0, 0.417959183673469];
function gk(f, a, b) {
  const c = (a + b) / 2, h = (b - a) / 2, fc = f(c);
  let K15 = fc * GK_WK[7], G7 = fc * GK_WG[7];
  for (let i = 0; i < 7; i++) {
    const dx = h * GK_X[i], f1 = f(c - dx), f2 = f(c + dx), s = f1 + f2;
    K15 += GK_WK[i] * s; G7 += GK_WG[i] * s;
  }
  return [K15 * h, Math.abs((K15 - G7) * h)];
}
export function integrate(f, a, b) {
  if (a === b) return 0;
  let sign = 1; if (a > b) { [a, b] = [b, a]; sign = -1; }
  let n = 0;
  const guard = () => { if (++n > 4000) throw new CalcError('time'); };
  const rec = (l, r, whole, err, depth) => {
    guard();
    const m = (l + r) / 2, [s1, e1] = gk(f, l, m), [s2, e2] = gk(f, m, r);
    const tot = s1 + s2, e = e1 + e2;
    if (depth >= 18 || e <= Math.max(1e-11 * Math.abs(tot), 1e-14) || Math.abs(tot - whole) <= 1e-12 * Math.max(1, Math.abs(tot))) return tot;
    return rec(l, m, s1, e1, depth + 1) + rec(m, r, s2, e2, depth + 1);
  };
  const [w0, e0] = gk(f, a, b);
  const v = rec(a, b, w0, e0, 0);
  if (!isFinite(v)) throw mathErr('int');
  return sign * clean(v);
}
/** derivative: Ridders' extrapolation – accurate to ~1e−12 for smooth functions */
export function derive(f, x) {
  let h = 0.1 * Math.max(1, Math.abs(x)), best = NaN, bestErr = Infinity;
  const T = [[(f(x + h) - f(x - h)) / (2 * h)]];
  for (let i = 1; i < 10; i++) {
    h /= 1.4;
    T[i] = [(f(x + h) - f(x - h)) / (2 * h)];
    let fac = 1.96;
    for (let j = 1; j <= i; j++) {
      T[i][j] = (T[i][j - 1] * fac - T[i - 1][j - 1]) / (fac - 1);
      fac *= 1.96;
      const err = Math.max(Math.abs(T[i][j] - T[i][j - 1]), Math.abs(T[i][j] - T[i - 1][j - 1]));
      if (err <= bestErr) { bestErr = err; best = T[i][j]; }
    }
    if (Math.abs(T[i][i] - T[i - 1][i - 1]) >= 2 * bestErr) break;
  }
  if (!isFinite(best)) throw mathErr('der');
  return clean(best);
}
/** SOLVE: Newton's method from the guess, then a bracket search around it. Returns { x, res } or throws Can't Solve. */
export function solveRoot(g, x0) {
  const safe = (x) => { try { const v = g(x); return isN(v) && isFinite(v) ? v : NaN; } catch (e) { return NaN; } };
  let x = x0, best = null;
  const keep = (xx) => { const r = safe(xx); if (!isNaN(r) && (!best || Math.abs(r) < Math.abs(best.res))) best = { x: xx, res: r }; };
  keep(x);
  for (let it = 0; it < 120; it++) {
    const fx = safe(x); if (isNaN(fx)) break;
    if (fx === 0) { best = { x, res: 0 }; break; }
    const hh = 1e-6 * Math.max(1, Math.abs(x)), d = (safe(x + hh) - safe(x - hh)) / (2 * hh);
    if (!isFinite(d) || d === 0) break;
    let step = fx / d, nx = x - step;
    for (let k = 0; k < 30; k++) { const f2 = safe(nx); if (!isNaN(f2) && Math.abs(f2) <= Math.abs(fx) * 1.0001 + 1e-300) break; step /= 2; nx = x - step; }
    keep(nx);
    if (Math.abs(nx - x) <= 1e-14 * Math.max(1, Math.abs(nx))) { x = nx; break; }
    x = nx;
  }
  if (best && Math.abs(best.res) <= 1e-9 * Math.max(1, Math.abs(best.x))) return polish(safe, best);
  // bracket search: widen around the guess until the sign changes, then bisect
  for (let s = 0.5; s <= 1e7; s *= 2) {
    let prev = x0 - s, fp = safe(prev);
    const N = 40;
    for (let i = 1; i <= N; i++) {
      const cur = x0 - s + (2 * s * i) / N, fc = safe(cur);
      if (!isNaN(fp) && !isNaN(fc) && fp * fc <= 0) {
        let lo = prev, hi = cur, flo = fp;
        for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2, fm = safe(mid); if (isNaN(fm)) break; if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; } }
        const xx = (lo + hi) / 2, rr = safe(xx);
        if (!isNaN(rr) && Math.abs(rr) <= 1e-6 * Math.max(1, Math.abs(xx))) return polish(safe, { x: xx, res: rr });
      }
      prev = cur; fp = fc;
    }
  }
  throw new CalcError('cant');
}
function polish(g, r) { const x = clean(r.x); const res = g(x); return { x, res: Math.abs(res) < 1e-9 ? clean(res) : res }; }

export class Env {
  constructor(ctx) { this.ctx = ctx; this.scope = {}; this.depth = 0; }
}
const MEM = ['A', 'B', 'C', 'D', 'E', 'F', 'X', 'Y', 'M'];

function getId(s, E) {
  const c = E.ctx;
  if (s in E.scope) return E.scope[s];
  switch (s) {
    case 'π': return Math.PI;
    case 'e': return Math.E;
    case 'i': if (!c.cmplx) throw syn('i'); return new Cx(0, 1);
    case 'Ans': return c.ans == null ? 0 : c.ans;
    case 'PreAns': return c.preans == null ? 0 : c.preans;
    case 'Ran#': return Math.floor(c.rand() * 1000) / 1000;
    case 'MatAns': if (!c.matAns) throw arg('MatAns'); return c.matAns;
    case 'VctAns': if (!c.vctAns) throw arg('VctAns'); return c.vctAns;
  }
  if (MEM.includes(s)) { const v = c.vars && c.vars[s]; return v == null ? 0 : v; }
  if (/^Mat[ABC]$/.test(s)) { const m = c.mats && c.mats[s[3]]; if (!m) throw arg('Mat'); return m; }
  if (/^Vct[ABC]$/.test(s)) { const v = c.vcts && c.vcts[s[3]]; if (!v) throw arg('Vct'); return v; }
  const st = c.stat;
  if (st && st.vars && s in st.vars) return st.vars[s];
  if (['n', 'x̄', 'ȳ', 'Σx', 'Σx²', 'Σy', 'Σy²', 'Σxy', 'σx', 'σy', 'sx', 'sy', 'minX', 'maxX', 'minY', 'maxY', 'Q1', 'Med', 'Q3', 'RegA', 'RegB', 'RegC', 'r'].includes(s)) throw mathErr('stat');
  throw syn('id ' + s);
}

function applyAngle(op, v, ang) {
  if (op === '°') return degToAng(v, ang);
  if (op === 'ʳ') return ang === 'rad' ? v : ang === 'deg' ? (v * 180) / Math.PI : (v * 200) / Math.PI;
  return ang === 'gra' ? v : ang === 'deg' ? v * 0.9 : (v * Math.PI) / 200;          // ᵍ
}

function sciMath(f, x) { const r = f(x); return chk(r); }
const realOrCx = (x, rf, cf, E) => {            // the real version when it exists, otherwise the complex one in CMPLX mode
  if (isN(x)) { const r = rf(x); if (r !== undefined) return r; if (!E.ctx.cmplx) throw mathErr('domain'); return simp(chk(cf(x))); }
  if (isC(x)) { if (!E.ctx.cmplx) throw mathErr('complex'); return simp(chk(cf(x))); }
  throw arg('type');
};

function callFn(name, a, E, node) {
  const c = E.ctx, ang = c.ang;
  const n = a.length;
  const one = () => { if (n !== 1) throw arg(name); return a[0]; };
  const two = () => { if (n !== 2) throw arg(name); return a; };
  switch (name) {
    case 'sin': case 'cos': case 'tan': {
      const x = one();
      if (isN(x)) return trig(name, x, ang);
      if (!c.cmplx) throw mathErr('complex');
      return simp(chk((name === 'sin' ? K.csin : name === 'cos' ? K.ccos : K.ctan)(x)));
    }
    case 'asin': case 'acos': return realOrCx(one(), (x) => (Math.abs(x) <= 1 ? clean(degToAng((Math[name](x) * 180) / Math.PI, ang)) : undefined), (z) => { const r = (name === 'asin' ? K.casin : K.cacos)(z); return K.mul(r, deg2(ang)); }, E);
    case 'atan': return realOrCx(one(), (x) => clean(degToAng((Math.atan(x) * 180) / Math.PI, ang)), (z) => K.mul(K.catan(z), deg2(ang)), E);
    case 'sinh': return realOrCx(one(), (x) => clean(sciMath(Math.sinh, x)), K.csinh, E);
    case 'cosh': return realOrCx(one(), (x) => clean(sciMath(Math.cosh, x)), K.ccosh, E);
    case 'tanh': return realOrCx(one(), (x) => clean(Math.tanh(x)), K.ctanh, E);
    case 'asinh': return realOrCx(one(), (x) => clean(Math.asinh(x)), K.casinh, E);
    case 'acosh': return realOrCx(one(), (x) => (x >= 1 ? clean(Math.acosh(x)) : undefined), K.cacosh, E);
    case 'atanh': return realOrCx(one(), (x) => (Math.abs(x) < 1 ? clean(Math.atanh(x)) : undefined), K.catanh, E);
    case 'ln': return realOrCx(one(), (x) => (x > 0 ? clean(Math.log(x)) : x === 0 ? (() => { throw mathErr('ln0'); })() : undefined), (z) => K.cln(z), E);
    case 'log': {
      if (n === 2) { const [b, x] = a; needReal(b); needReal(x); if (b <= 0 || b === 1 || x <= 0) throw mathErr('log'); return clean(Math.log(x) / Math.log(b)); }
      return realOrCx(one(), (x) => (x > 0 ? clean(Math.log10(x)) : x === 0 ? (() => { throw mathErr('ln0'); })() : undefined), (z) => K.div(K.cln(z), Math.LN10), E);
    }
    case 'logb': { const [b, x] = two(); needReal(b); needReal(x); if (b <= 0 || b === 1 || x <= 0) throw mathErr('log'); return clean(Math.log(x) / Math.log(b)); }
    case 'sqrt': return realOrCx(one(), (x) => (x >= 0 ? clean(Math.sqrt(x)) : undefined), (z) => K.csqrt(z), E);
    case 'cbrt': { const x = needReal(one()); return clean(Math.cbrt(x)); }
    case 'root': {
      const [nn, x] = two(); needReal(nn);
      if (nn === 0) throw mathErr('root0');
      if (isN(x)) {
        if (x >= 0) return clean(Math.pow(x, 1 / nn));
        if (Number.isInteger(nn) && nn % 2 !== 0) return -clean(Math.pow(-x, 1 / nn));
        if (!c.cmplx) throw mathErr('root');
      }
      return simp(chk(K.pow(x, 1 / nn)));
    }
    case 'Abs': {
      const x = one();
      if (isN(x)) return Math.abs(x);
      if (isC(x)) return K.absC(x);
      if (isM(x)) return new Mat(x.r, x.c, x.a.map(Math.abs));
      if (isV(x)) return K.vabs(x);
      throw arg('Abs');
    }
    case 'Int': return Math.trunc(needReal(one()));
    case 'Intg': return Math.floor(needReal(one()));
    case 'Rnd': return roundTo(needReal(one()), c.fmt);
    case 'GCD': { const [p, q] = two(); return K.gcd(needInt(p), needInt(q)); }
    case 'LCM': { const [p, q] = two(); return K.lcm(needInt(p), needInt(q)); }
    case 'RanInt': { const [p, q] = two(); needInt(p); needInt(q); if (q < p) throw arg('RanInt'); return p + Math.floor(c.rand() * (q - p + 1)); }
    case 'Fact': { const x = needInt(one()); return new PF(x, K.factorize(x)); }
    case 'Pol': {
      const [x, y] = two(); needReal(x); needReal(y);
      const r = Math.hypot(x, y), th = clean(degToAng((Math.atan2(y, x) * 180) / Math.PI, ang));
      if (c.vars) { c.vars.X = r; c.vars.Y = th; }
      return new Multi([r, th], ['r', 'θ']);
    }
    case 'Rec': {
      const [r, th] = two(); needReal(r); needReal(th);
      const x = clean(r * trig('cos', th, ang)), y = clean(r * trig('sin', th, ang));
      if (c.vars) { c.vars.X = x; c.vars.Y = y; }
      return new Multi([x, y], ['x', 'y']);
    }
    case 'Conjg': return K.conj(one());
    case 'Arg': { const z = one(); return clean(degToAng((K.argC(z) * 180) / Math.PI, ang)); }
    case 'ReP': return K.re(one());
    case 'ImP': return K.im(one());
    case 'toPolar': case 'toRect': return one();
    case 'dms': return needReal(one());
    case 'Det': return K.det(one());
    case 'Trn': { const m = one(); if (!isM(m)) throw arg('Trn'); return K.trn(m); }
    case 'Ident': { const k = needInt(one()); if (k < 1 || k > 4) throw arg('Ident'); return K.ident(k); }
    case 'Dim': { const m = one(); if (isM(m)) return new Multi([m.r, m.c], ['rows', 'cols']); if (isV(m)) return m.a.length; throw arg('Dim'); }
    case 'Dot': { const [p, q] = two(); return K.dot(p, q); }
    case 'Angle': { const [p, q] = two(); return clean(K.vangle(p, q, ang)); }
    case 'UnitV': return K.unitV(one());
    case 'Not': return ~toBase32(needReal(one()));
    case 'Neg': return toBase32(-needReal(one()));
    case 'conv': { const x = needReal(one()); const cv = CONVS[node.idx - 1]; if (!cv) throw arg('conv'); return clean(cv.f(x)); }
    case 'x̂': case 'ŷ': {
      const v = needReal(one()), st = c.stat;
      if (!st || !st.reg) throw mathErr('stat');
      return clean(name === 'ŷ' ? regPredict(st.reg, v) : regInverse(st.reg, v));
    }
    default: throw syn('fn ' + name);
  }
}

export function roundTo(x, fmt) {
  if (!fmt) return parseFloat(x.toPrecision(10));
  if (fmt.mode === 'fix') return parseFloat(x.toFixed(fmt.digits));
  if (fmt.mode === 'sci') return parseFloat(x.toPrecision(Math.max(1, fmt.digits || 10)));
  return parseFloat(x.toPrecision(10));
}

function binop(op, a, b, E, node) {
  const base = E.ctx.base;
  const fit = (v) => (base ? toBase32(v) : v);
  switch (op) {
    case '+': return fit(K.add(a, b));
    case '-': return fit(K.sub(a, b));
    case '×': return fit(K.mul(a, b));
    case '÷': {
      if (base) { needReal(a); needReal(b); if (b === 0) throw mathErr('div0'); return toBase32(Math.trunc(a / b)); }
      return K.div(a, b);
    }
    case 'nPr': return K.nPr(needReal(a), needReal(b));
    case 'nCr': return K.nCr(needReal(a), needReal(b));
    case '∠': { needReal(a); needReal(b); return simp(new Cx(a * trig('cos', b, E.ctx.ang), a * trig('sin', b, E.ctx.ang))); }
    case '·': return K.dot(a, b);
    case 'and': return toBase32(needReal(a)) & toBase32(needReal(b));
    case 'or': return toBase32(needReal(a)) | toBase32(needReal(b));
    case 'xor': return toBase32(needReal(a)) ^ toBase32(needReal(b));
    case 'xnor': return ~(toBase32(needReal(a)) ^ toBase32(needReal(b)));
  }
  throw syn('op');
}

export function ev(n, E) {
  if (++E.depth > 400) { E.depth = 0; throw new CalcError('stack'); }
  try { return ev1(n, E); } finally { E.depth--; }
}
function ev1(n, E) {
  const c = E.ctx;
  switch (n.k) {
    case 'num': return n.v;
    case 'numx': { const e = ev(n.e, E); needReal(e); if (!Number.isInteger(e)) throw mathErr('exp'); return chk(n.v * Math.pow(10, e)); }
    case 'dms': return degToAng(n.d + n.m / 60 + n.s / 3600, c.ang);
    case 'id': return getId(n.s, E);
    case 'const': { const k = CONSTS[n.i]; if (!k) throw syn('const'); return k.v; }
    case 'paren': return ev(n.a, E);
    case 'neg': return K.neg(ev(n.a, E));
    case 'bin': return binop(n.op, ev(n.a, E), ev(n.b, E), E, n);
    case 'pow': return K.pow(ev(n.a, E), ev(n.b, E));
    case 'post': {
      const v = ev(n.a, E);
      switch (n.op) {
        case '!': return K.fact(needReal(v));
        case '²': return K.mul(v, v);
        case '³': return K.mul(K.mul(v, v), v);
        case '⁻¹': { if (isM(v)) return K.minv(v); if (isN(v) || isC(v)) return K.div(1, v); throw arg('inv'); }
        case '%': return K.div(v, 100);
        default: return applyAngle(n.op, needReal(v), c.ang);
      }
    }
    case 'call': {
      const a = n.args.map((x) => ev(x, E));
      return callFn(n.f, a, E, n);
    }
    case 'sum': {
      const a = needInt(ev(n.a, E)), b = needInt(ev(n.b, E));
      if (b < a || b - a > 100000) { if (b < a) throw arg('sum'); throw new CalcError('time'); }
      let s = 0; const prev = E.scope.X;
      for (let k = a; k <= b; k++) { E.scope.X = k; s = K.add(s, ev(n.f, E)); }
      if (prev === undefined) delete E.scope.X; else E.scope.X = prev;
      return s;
    }
    case 'int': {
      const a = needReal(ev(n.a, E)), b = needReal(ev(n.b, E));
      const prev = E.scope.X;
      const f = (x) => { E.scope.X = x; const v = ev(n.f, E); if (!isN(v)) throw mathErr('int'); return v; };
      try { return integrate(f, a, b); } finally { if (prev === undefined) delete E.scope.X; else E.scope.X = prev; }
    }
    case 'der': {
      const a = needReal(ev(n.a, E));
      const prev = E.scope.X;
      const f = (x) => { E.scope.X = x; const v = ev(n.f, E); if (!isN(v)) throw mathErr('der'); return v; };
      try { return derive(f, a); } finally { if (prev === undefined) delete E.scope.X; else E.scope.X = prev; }
    }
  }
  throw syn('node ' + n.k);
}

/** does the tree contain anything that makes an exact (fraction / radical) display meaningless? */
export function isDecimal(n) {
  if (!n || typeof n !== 'object') return false;
  if (Array.isArray(n)) return n.some(isDecimal);
  if (n.k === 'num' || n.k === 'numx' || n.k === 'dms') { if (n.dec) return true; }
  if (n.k === 'id' && n.s === 'Ran#') return true;
  if (n.k === 'int' || n.k === 'der') return true;
  if (n.k === 'call' && (n.f === 'RanInt' || n.f === 'conv' || n.f === 'Rnd')) return true;
  if (n.k === 'const') return true;
  for (const key of Object.keys(n)) if (typeof n[key] === 'object' && isDecimal(n[key])) return true;
  return false;
}

/** the context used by every mode */
export function makeCtx(over = {}) {
  return { ang: 'deg', cmplx: false, base: 0, vars: {}, ans: 0, preans: 0, mats: {}, vcts: {}, stat: null, fmt: null, rand: Math.random, ...over };
}

/**
 * Evaluate a list of items. Returns { value, ast, decimal, dir } — `dir` is a display request such as 'polar' or 'dms'.
 * STO (→) stores into the context's variables; Ans / PreAns are updated by the caller.
 */
export function evaluate(items, ctx) {
  K.setCmplx(ctx.cmplx);
  const P = parseItems(items, ctx.base || 10);
  const E = new Env(ctx);
  if (P.kind === 'eq') throw syn('eq');
  const v0 = ev(P.ast, E);
  let v = v0;
  if (isN(v)) v = chk(v);
  if (ctx.base) { if (isN(v)) v = toBase32(v); }
  let dir = null;
  if (P.ast.k === 'call') { if (P.ast.f === 'toPolar') dir = 'polar'; else if (P.ast.f === 'toRect') dir = 'rect'; else if (P.ast.f === 'dms') dir = 'dms'; }
  if (P.kind === 'sto') {
    const to = P.to;
    if (MEM.includes(to)) { if (!(isN(v) || isC(v))) throw arg('sto'); ctx.vars[to] = v; }
    else if (/^Mat[ABC]$/.test(to)) { if (!isM(v)) throw arg('sto'); ctx.mats[to[3]] = v; }
    else if (/^Vct[ABC]$/.test(to)) { if (!isV(v)) throw arg('sto'); ctx.vcts[to[3]] = v; }
    else throw syn('sto');
  }
  return { value: v, ast: P.ast, decimal: isDecimal(P.ast), dir };
}

/** which of A–F, X, Y, M does the tree read? (CALC asks for them) */
export function usedVars(n, out = new Set()) {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach((x) => usedVars(x, out)); return out; }
  if (n.k === 'id' && MEM.includes(n.s)) out.add(n.s);
  for (const key of Object.keys(n)) if (typeof n[key] === 'object') usedVars(n[key], out);
  return out;
}

/** a function of X for TABLE / SOLVE: items → f(x) (real numbers only) */
export function compileFn(items, ctx) {
  K.setCmplx(false);
  const P = parseItems(items, 10);
  if (P.kind !== 'expr') throw syn('fn');
  const E = new Env({ ...ctx, vars: { ...ctx.vars }, cmplx: false });
  return (x) => { E.scope.X = x; E.depth = 0; const v = ev(P.ast, E); if (!isN(v)) throw mathErr('fn'); return v; };
}
/** SOLVE: items contain '=' (or are an expression equal to 0); returns { x, res } */
export function solveItems(items, ctx, guess) {
  K.setCmplx(false);
  const P = parseItems(items, 10);
  const E = new Env({ ...ctx, vars: { ...ctx.vars }, cmplx: false });
  const g = (x) => {
    E.scope.X = x; E.depth = 0;
    if (P.kind === 'eq') { const l = ev(P.l, E), r = ev(P.r, E); if (!isN(l) || !isN(r)) throw mathErr('solve'); return l - r; }
    const v = ev(P.ast, E); if (!isN(v)) throw mathErr('solve'); return v;
  };
  return solveRoot(g, guess);
}
