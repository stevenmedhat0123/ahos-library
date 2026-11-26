// The shape gallery: flat figures, solids, maths drawings and (from optics.js) mirrors and lenses.
// Pure functions: the box you drag (two opposite corners) -> a list of items { t:'poly'|'line'|'arrow'|'text', … }.
//   poly  { pts, closed, f? }   line / arrow { a, b }   text { x, y, s, size, center? }
//   d: 1 → dashed (a hidden edge, a virtual ray)   k → line width relative to the pen width   c → a fixed colour (otherwise the shape's colour)
// The board turns the items into ordinary strokes (a poly is a normal "poly" stroke), so every one of them can be moved, resized, erased, exported.
import { OPTICS, opticItems } from './optics.js';

export const GEO_GROUPS = [
  ['flat', ['rtri', 'pent', 'hex', 'oct', 'star', 'para', 'trap', 'semi', 'sect', 'cross']],
  ['solid', ['cube', 'cyl', 'cone', 'pyr', 'sphere']],
  ['math', ['axes', 'grid', 'numline', 'angle', 'dim']],
  ['optics', OPTICS],
];
export const GEO = GEO_GROUPS.flatMap((g) => g[1]);
export const isGeo = (k) => GEO.includes(k);
export const GEO_FILLABLE = new Set(['rtri', 'pent', 'hex', 'oct', 'star', 'para', 'trap', 'semi', 'sect', 'cross']);

const PI = Math.PI;
const r1 = (v) => Math.round(v * 10) / 10;
const P = (x, y) => [r1(x), r1(y)];
const flat = (...pts) => pts.flatMap((p) => P(p[0], p[1]));
const poly = (pts, closed = true, extra = {}) => ({ t: 'poly', pts: flat(...pts), closed, ...extra });
const line = (a, b, extra = {}) => ({ t: 'line', a: P(...a), b: P(...b), ...extra });
const arc = (cx, cy, rx, ry, t0, t1, n = 40) => { const out = []; for (let i = 0; i <= n; i++) { const t = t0 + ((t1 - t0) * i) / n; out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); } return out; };
const regular = (cx, cy, rx, ry, n, start) => Array.from({ length: n }, (_, i) => { const t = start + (i * 2 * PI) / n; return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)]; });

/** Items for one gallery shape in the box a–b. opts (optics): { pos, rays }. */
export function geoItems(kind, a, b, opts = {}) {
  const x1 = Math.min(a[0], b[0]), x2 = Math.max(a[0], b[0]), y1 = Math.min(a[1], b[1]), y2 = Math.max(a[1], b[1]);
  const w = x2 - x1, h = y2 - y1, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, m = Math.min(w, h);
  if (OPTICS.includes(kind)) return opticItems(kind, [x1, y1, x2, y2], opts);
  switch (kind) {
    case 'rtri': {
      const q = Math.min(w, h) * 0.16;
      return [poly([[x1, y1], [x1, y2], [x2, y2]]), poly([[x1 + q, y2], [x1 + q, y2 - q], [x1, y2 - q]], false, { k: 0.6 })];
    }
    case 'pent': return [poly(regular(cx, cy, w / 2, h / 2, 5, -PI / 2))];
    case 'hex': return [poly(regular(cx, cy, w / 2, h / 2, 6, 0))];
    case 'oct': return [poly(regular(cx, cy, w / 2, h / 2, 8, PI / 8))];
    case 'star': {
      const out = [];
      for (let i = 0; i < 10; i++) { const t = -PI / 2 + (i * PI) / 5, k = i % 2 ? 0.382 : 1; out.push([cx + (w / 2) * k * Math.cos(t), cy + (h / 2) * k * Math.sin(t)]); }
      return [poly(out)];
    }
    case 'para': { const k = w * 0.25; return [poly([[x1 + k, y1], [x2, y1], [x2 - k, y2], [x1, y2]])]; }
    case 'trap': { const k = w * 0.2; return [poly([[x1 + k, y1], [x2 - k, y1], [x2, y2], [x1, y2]])]; }
    case 'semi': return [poly(arc(cx, y2, w / 2, h, PI, 2 * PI, 48))];
    case 'sect': return [poly([[x1, y2], ...arc(x1, y2, w, h, 0, -PI / 2, 40)])];
    case 'cross': {
      const t = m / 3, hx = w / 2 - t / 2, hy = h / 2 - t / 2;
      return [poly([[x1 + hx, y1], [x2 - hx, y1], [x2 - hx, y1 + hy], [x2, y1 + hy], [x2, y2 - hy], [x2 - hx, y2 - hy], [x2 - hx, y2], [x1 + hx, y2], [x1 + hx, y2 - hy], [x1, y2 - hy], [x1, y1 + hy], [x1 + hx, y1 + hy]])];
    }
    case 'cube': {
      const o = m * 0.28;
      const fl = [x1, y1 + o], fr = [x2 - o, y1 + o], br = [x2 - o, y2], bl = [x1, y2];          // the front face
      const tl = [x1 + o, y1], tr = [x2, y1], rb = [x2, y2 - o], lb = [x1 + o, y2 - o];            // the back face
      return [poly([fl, fr, br, bl]), line(tl, tr), line(tr, rb), line(fr, tr), line(br, rb), line(fl, tl), line(tl, lb, { d: 1 }), line(lb, rb, { d: 1 }), line(bl, lb, { d: 1 })];
    }
    case 'cyl': {
      const ry = Math.min(h * 0.14, w * 0.22), rx = w / 2;
      return [poly(arc(cx, y1 + ry, rx, ry, 0, 2 * PI, 48).slice(0, -1)), line([x1, y1 + ry], [x1, y2 - ry]), line([x2, y1 + ry], [x2, y2 - ry]),
        poly(arc(cx, y2 - ry, rx, ry, 0, PI, 28), false), poly(arc(cx, y2 - ry, rx, ry, PI, 2 * PI, 28), false, { d: 1 })];
    }
    case 'cone': {
      const ry = Math.min(h * 0.14, w * 0.22), rx = w / 2, by = y2 - ry;
      return [line([cx, y1], [x1, by]), line([cx, y1], [x2, by]), poly(arc(cx, by, rx, ry, 0, PI, 28), false), poly(arc(cx, by, rx, ry, PI, 2 * PI, 28), false, { d: 1 }), line([cx, y1], [cx, by], { d: 1, k: 0.7 })];
    }
    case 'pyr': {
      const o = h * 0.22;
      const A = [cx, y1], FL = [x1, y2], FR = [x2 - o, y2], BR = [x2, y2 - o], BL = [x1 + o, y2 - o];
      return [line(FL, FR), line(FR, BR), line(A, FL), line(A, FR), line(A, BR), line(BL, BR, { d: 1 }), line(BL, FL, { d: 1 }), line(A, BL, { d: 1 })];
    }
    case 'sphere': {
      const r = m / 2;
      return [poly(arc(cx, cy, r, r, 0, 2 * PI, 64).slice(0, -1)), poly(arc(cx, cy, r, r * 0.3, 0, PI, 32), false), poly(arc(cx, cy, r, r * 0.3, PI, 2 * PI, 32), false, { d: 1 })];
    }
    case 'axes': {
      const out = [{ t: 'arrow', a: P(x1, cy), b: P(x2, cy) }, { t: 'arrow', a: P(cx, y2), b: P(cx, y1) }];
      const sp = Math.max(10, m / 12);
      for (let v = sp; cx + v < x2 - 8; v += sp) out.push(line([cx + v, cy - 4], [cx + v, cy + 4], { k: 0.6 }));
      for (let v = sp; cx - v > x1 + 4; v += sp) out.push(line([cx - v, cy - 4], [cx - v, cy + 4], { k: 0.6 }));
      for (let v = sp; cy + v < y2 - 4; v += sp) out.push(line([cx - 4, cy + v], [cx + 4, cy + v], { k: 0.6 }));
      for (let v = sp; cy - v > y1 + 8; v += sp) out.push(line([cx - 4, cy - v], [cx + 4, cy - v], { k: 0.6 }));
      const sz = Math.max(11, Math.min(22, m * 0.07));
      out.push({ t: 'text', x: r1(x2 - sz), y: r1(cy + 6), s: 'x', size: r1(sz), center: true }, { t: 'text', x: r1(cx + sz * 0.9), y: r1(y1), s: 'y', size: r1(sz), center: true }, { t: 'text', x: r1(cx - sz * 0.7), y: r1(cy + 5), s: 'O', size: r1(sz), center: true });
      return out;
    }
    case 'grid': {
      const sp = Math.max(14, Math.max(w, h) / 14), out = [];
      const nx = Math.min(40, Math.floor(w / sp)), ny = Math.min(40, Math.floor(h / sp));
      for (let i = 0; i <= nx; i++) out.push(line([x1 + i * sp, y1], [x1 + i * sp, y1 + ny * sp], { k: i === 0 || i === nx ? 0.7 : 0.35 }));
      for (let j = 0; j <= ny; j++) out.push(line([x1, y1 + j * sp], [x1 + nx * sp, y1 + j * sp], { k: j === 0 || j === ny ? 0.7 : 0.35 }));
      return out;
    }
    case 'numline': {
      const out = [{ t: 'arrow', a: P(x1, cy), b: P(x2, cy) }], n = 11, pad = Math.min(30, w * 0.08), sp = (w - 2 * pad) / (n - 1);
      const sz = Math.max(10, Math.min(24, sp * 0.45));
      for (let i = 0; i < n; i++) {
        const x = x1 + pad + i * sp;
        out.push(line([x, cy - 6], [x, cy + 6], { k: 0.7 }), { t: 'text', x: r1(x), y: r1(cy + 9), s: String(i - 5).replace('-', '−'), size: r1(sz), center: true });
      }
      return out;
    }
    case 'angle': {
      const V = [x1, y2], deg = (Math.atan2(h, w) * 180) / PI, ra = Math.min(w, h) * 0.34;
      const sz = Math.max(11, Math.min(22, m * 0.12));
      const tm = Math.atan2(h, w) / 2;
      return [line(V, [x2, y2]), line(V, [x2, y1]), poly(arc(x1, y2, ra, ra, 0, -Math.atan2(h, w), 24), false, { k: 0.7 }),
        { t: 'text', x: r1(x1 + ra * 1.45 * Math.cos(tm)), y: r1(y2 - ra * 1.45 * Math.sin(tm) - sz * 0.6), s: Math.round(deg) + '°', size: r1(sz), center: true }];
    }
    case 'dim': {
      const cm = w / 28.35, sz = Math.max(11, Math.min(22, h * 0.5 + 10));
      return [{ t: 'arrow', a: P(cx, cy), b: P(x1, cy) }, { t: 'arrow', a: P(cx, cy), b: P(x2, cy) }, line([x1, cy - 9], [x1, cy + 9]), line([x2, cy - 9], [x2, cy + 9]),
        { t: 'text', x: r1(cx), y: r1(cy - sz * 1.6), s: (Math.round(cm * 10) / 10) + ' cm', size: r1(sz), center: true }];
    }
    default: return [];
  }
}
