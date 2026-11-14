// Drawing for the whiteboard: paper + patterns, strokes, shapes, text, placed objects. Used by the viewer, thumbnails and export.
import { outline, FREE, cropOf } from './geom.js';
import { cornerSet } from './path.js';
import { drawBook } from './bookdraw.js';
import { t } from '../i18n.js';

export const PAPERS = [
  { id: 'white', c: '#ffffff' }, { id: 'cream', c: '#fbf3df' }, { id: 'blue', c: '#e6f0fb' }, { id: 'mint', c: '#e5f5ea' },
  { id: 'gray', c: '#2b2f3a' }, { id: 'black', c: '#000000' }, { id: 'board', c: '#1f3d2c' },
];
export const PATTERNS = ['none', 'lines', 'english', 'notes', 'grid', 'dots', 'graph', 'cornell'];
// the English copybook: every row is TWO lines close together (the letters sit between them), rows repeat every EN_PITCH
export const EN_PITCH = 64, EN_GAP = 17, EN_TOP = 40;
// the daily note: a coloured band, a place for the date (the date itself is a text on the page) and ruled lines under it
export const NOTE_PAD = 36, NOTE_DATE_Y = 50, NOTE_LINE0 = 116, NOTE_PITCH = 30;
export const A4 = [595, 842];

export const lum = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};
export const isDark = (hex) => lum(hex) < 0.45;
export const inkFor = (paper) => (isDark(paper) ? '#ffffff' : '#14161c');

/* ---------------- rainbow ink ----------------
 * A "colour" that is really a recipe: the hue turns along the stroke (by arc length), so the line itself is a rainbow.
 * The full colour wheel at maximum saturation, drawn as a glossy tube. Shapes and text get the same rainbow as a gradient. */
export const RB_L = 'rb:l', RB_D = 'rb:d';
const CYCLE = 260;   // world units for one full turn through all the colours: not rushed, not lazy
// Every "magic ink" is a ring of [hue, lightness shift] keys: the colour flows from one key to the next (always the short way round the wheel)
// as ONE continuously changing colour. The deep rainbow has all the colours of the neon-clouds reference picture:
// coral red, red-orange, orange, gold, olive-yellow, lime, green, emerald, teal, turquoise, cyan, azure, blue, indigo, violet, purple, magenta, hot pink.
const KEYS_D = [
  [2, 3], [14, 3], [30, 2], [48, -2], [66, -5], [85, -4], [125, -6], [152, -6], [168, -5], [182, -3],
  [196, -1], [212, 1], [228, 3], [252, 5], [270, 4], [288, 2], [308, 2], [330, 4],
];
// the light rainbow: the same journey round the wheel, in sweet pastel tones
const KEYS_L = [[350, 0], [12, 0], [32, 0], [50, -1], [78, -2], [110, -2], [145, -2], [170, -2], [190, -1], [208, 0], [228, 1], [255, 2], [278, 2], [300, 1], [325, 0]];
const ink = (name, keys, o = {}) => ({ name, keys, sat: 100, rim: 25, body: 46, sheen: 62, glint: 91, thin: 47, hl: 48, shape: 48, lift: 14, cycle: CYCLE, solid: '#e11d2e', ...o });
const INKS = {
  'rb:d': ink('bd_rbDark', KEYS_D),
  'rb:l': ink('bd_rbLight', KEYS_L, { sat: 90, rim: 56, body: 72, sheen: 83, glint: 97, thin: 70, hl: 74, shape: 70, lift: 3, solid: '#f48fb1' }),
  'gr:sunset': ink('bd_inkSunset', [[14, 0], [32, 2], [48, 3], [20, 1], [350, 0], [326, 0], [300, -2], [326, 0], [350, 0]], { cycle: 220, solid: '#f97316' }),
  'gr:fire': ink('bd_inkFire', [[0, -2], [10, 0], [24, 2], [40, 3], [52, 4], [40, 3], [24, 2], [10, 0]], { cycle: 200, solid: '#ea580c' }),
  'gr:ocean': ink('bd_inkOcean', [[178, -2], [190, 0], [204, 2], [220, 3], [236, 3], [220, 3], [204, 2], [190, 0]], { cycle: 220, solid: '#0284c7' }),
  'gr:aurora': ink('bd_inkAurora', [[150, -4], [168, -3], [188, 0], [216, 3], [262, 4], [296, 3], [262, 4], [216, 3], [188, 0], [168, -3]], { cycle: 240, solid: '#14b8a6' }),
  'gr:galaxy': ink('bd_inkGalaxy', [[236, 0], [256, 2], [276, 3], [300, 3], [322, 2], [300, 3], [276, 3], [256, 2]], { cycle: 210, solid: '#7c3aed' }),
  'gr:forest': ink('bd_inkForest', [[96, -8], [118, -7], [140, -6], [160, -4], [140, -6], [118, -7]], { cycle: 190, solid: '#15803d' }),
  'gr:gold': ink('bd_inkGold', [[36, -3], [44, 1], [52, 5], [58, 8], [52, 5], [44, 1]], { cycle: 150, body: 50, sheen: 68, glint: 95, thin: 50, hl: 54, shape: 52, solid: '#eab308' }),
};
export const INK_IDS = Object.keys(INKS);
export const isRainbow = (c) => typeof c === 'string' && Object.prototype.hasOwnProperty.call(INKS, c);   // "is a magic ink" (kept under the old name)
export const inkName = (c) => (INKS[c] ? INKS[c].name : '');
// Equal length for every colour. The keys above only say WHICH colours come in WHICH order. How far along the stroke each one lasts is decided here:
// the ring is sampled finely, every step is measured as a perceived colour difference (OKLab), and the stroke position is mapped so that the colour
// changes at the same perceived speed everywhere. So no colour is long and none is squeezed into a tiny spot.
const hsl2rgb = (h, s, l) => { s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l); const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return [f(0), f(8), f(4)]; };
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const oklab = ([r, g, b]) => {
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), q = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * q, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * q, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * q];
};
const rawAt = (f, keys) => {            // f in [0,1): position along the key ring -> [hue, lightness shift]
  const n = keys.length, g = f * n;
  const i = Math.floor(g) % n, j = (i + 1) % n, k = g - Math.floor(g);
  const dh = ((keys[j][0] - keys[i][0] + 540) % 360) - 180;   // always blend the short way round the wheel, up or down
  return [keys[i][0] + dh * k, keys[i][1] + (keys[j][1] - keys[i][1]) * k];
};
const WARP_N = 1440;
function warpOf(K) {
  if (K.warp) return K.warp;
  const cum = new Float64Array(WARP_N + 1);
  let prev = null;
  for (let i = 0; i <= WARP_N; i++) {
    const [h, dl] = rawAt((i % WARP_N) / WARP_N, K.keys);
    const c = oklab(hsl2rgb(((h % 360) + 360) % 360, K.sat, Math.max(8, Math.min(97, K.body + dl))));
    cum[i] = i ? cum[i - 1] + Math.hypot(c[0] - prev[0], c[1] - prev[1], c[2] - prev[2]) : 0;
    prev = c;
  }
  return (K.warp = cum);
}
/** Position t in [0,1) along one cycle -> raw ring position, so that equal steps of t are equal perceived colour changes. */
function unwarp(K, t) {
  const cum = warpOf(K), total = cum[WARP_N], goal = t * total;
  let lo = 0, hi = WARP_N;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= goal) lo = mid; else hi = mid; }
  const span = cum[hi] - cum[lo];
  return (lo + (span > 1e-9 ? (goal - cum[lo]) / span : 0)) / WARP_N;
}
const INK_BY_KEYS = new Map(Object.values(INKS).map((k) => [k.keys, k]));
const colorAt = (deg, keys) => {
  const t = (((deg % 360) + 360) % 360) / 360;
  return rawAt(unwarp(INK_BY_KEYS.get(keys), t) % 1, keys);
};
const hsl = (deg, s, l, keys) => { const [h, dl] = colorAt(deg, keys); return `hsl(${(((Math.round(h * 10) / 10) % 360) + 360) % 360} ${s}% ${Math.round(Math.max(8, Math.min(97, l + dl)) * 10) / 10}%)`; };
/** A CSS background for swatches and previews: the colours in the same even order the stroke shows them. */
export const inkCss = (c) => {
  const k = INKS[c];
  if (!k) return c;
  const N = 14, stops = [];
  for (let i = 0; i <= N; i++) stops.push(`${hsl((i / N) * 360, k.sat, k.body, k.keys)} ${Math.round((i / N) * 100)}%`);
  return `linear-gradient(135deg,${stops.join(',')})`;
};
/** The colours of one cycle (for tests): n evenly spaced stops of the body colour, as hsl() strings. */
export const inkRamp = (c, n = 48) => { const k = INKS[c]; return Array.from({ length: n }, (_, i) => hsl((i / n) * 360, k.sat, k.body, k.keys)); };
/** A plain colour to use where a gradient cannot be (text caret, tiny previews). */
export const inkSolid = (c) => (INKS[c] ? INKS[c].solid : c);
/** length (page units) over which a magic ink runs through all its colours */
export const inkCycle = (c) => (INKS[c] || INKS['rb:d']).cycle;
export const inkLabel = (c) => (INKS[c] ? INKS[c].name : c);

/** Rainbow gradient across a box, for shapes and text (two full turns of the wheel). */
function rainbowGradient(ctx, c, b, dark) {
  const k = INKS[c] || INKS['rb:d'];
  const [x0, y0, x1, y1] = b;
  const g = ctx.createLinearGradient(x0, y0, x1 === x0 ? x0 + 1 : x1, y1 === y0 ? y0 + 1 : y1);
  const n = 36;
  for (let i = 0; i <= n; i++) g.addColorStop(i / n, hsl((i / n) * 720, k.sat, k.shape + (dark ? Math.min(8, k.lift) : 0), k.keys));
  return g;
}

/**
 * The pen path as dense samples along ONE smooth curve: quadratic pieces through the midpoints of the points (so a fast, sparse stroke is
 * round, not a polygon), running straight into every true corner (so a corner stays a corner). Nothing is ever offset or mitred.
 * Returns { x, y, w, d, sg, pr } – w = pressure/speed factor per sample, d = distance along the stroke (+ s.u), sg = index of the pen point the piece belongs to.
 */
function curveSamples(p, pr, u0, gap) {
  const n = p.length >> 1;
  const pw = (i) => (pr ? pr[i] : 0.5);
  const x = [p[0]], y = [p[1]], w = [pw(0)], d = [u0], sg = [0];
  if (n < 2) return { x, y, w, d, sg, pr: !!pr };
  let cx = p[0], cy = p[1], cw = pw(0), dist = u0;
  const put = (px, py, pwv, seg) => { dist += Math.hypot(px - x[x.length - 1], py - y[y.length - 1]); x.push(px); y.push(py); w.push(pwv); d.push(dist); sg.push(seg); };
  const line = (ex, ey, ew, seg) => {
    const L = Math.hypot(ex - cx, ey - cy), k = Math.min(400, Math.max(1, Math.ceil(L / gap)));
    for (let j = 1; j <= k; j++) { const t = j / k; put(cx + (ex - cx) * t, cy + (ey - cy) * t, cw + (ew - cw) * t, seg); }
    cx = ex; cy = ey; cw = ew;
  };
  const quad = (qx, qy, qw, ex, ey, ew, seg) => {
    const L = Math.hypot(qx - cx, qy - cy) + Math.hypot(ex - qx, ey - qy), k = Math.min(400, Math.max(1, Math.ceil(L / gap)));
    for (let j = 1; j <= k; j++) {
      const t = j / k, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t;
      put(a * cx + b * qx + c * ex, a * cy + b * qy + c * ey, a * cw + b * qw + c * ew, seg);
    }
    cx = ex; cy = ey; cw = ew;
  };
  const cr = n >= 4 ? cornerSet(p, 3, 50) : null;
  for (let i = 1; i < n - 1; i++) {
    if (cr && cr.has(i)) line(p[2 * i], p[2 * i + 1], pw(i), i);
    else quad(p[2 * i], p[2 * i + 1], pw(i), (p[2 * i] + p[2 * i + 2]) / 2, (p[2 * i + 1] + p[2 * i + 3]) / 2, (pw(i) + pw(i + 1)) / 2, i);
  }
  line(p[2 * n - 2], p[2 * n - 1], pw(n - 1), n - 1);
  return { x, y, w, d, sg, pr: !!pr };
}

/** Everything the painter needs about one rainbow stroke: its samples and where the colour pieces (chunks) start and end. */
export function rbPrepare(s) {
  const K = INKS[s.c] || INKS['rb:d'];
  const pr = s.pr && s.t !== 'hl' ? s.pr : null;
  const CH = Math.min(9, Math.max(3.5, 80 / Math.max(1, s.w)));   // thick tubes are cut finer so the colour lines stay square to the stroke
  const smp = curveSamples(s.pts, pr, s.u || 0, 2);
  const n = smp.x.length, chunks = [];
  let ca = 0;
  for (let i = 1; i < n; i++) if (smp.d[i] - smp.d[ca] >= CH || i === n - 1) { chunks.push([ca, i]); ca = i; }
  let same = true;
  for (let i = 1; i < n; i++) if (Math.abs(smp.x[i] - smp.x[0]) > 0.05 || Math.abs(smp.y[i] - smp.y[0]) > 0.05) { same = false; break; }
  return { K, smp, n, chunks, CH, dot: n === 1 || same };
}

/**
 * How many colour pieces from the start of a stroke that is still being written can no longer change: the pieces whose pen points lie
 * at least `lag` (page units) behind the pen. (The last point or two of a live path are still being re-shaped by the next samples.)
 */
export function rbStable(plan, pts, lag) {
  const n = pts.length >> 1;
  let dist = 0, i = n - 1;
  while (i > 0 && dist < lag) { dist += Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]); i--; }
  const sg = plan.smp.sg;
  let last = -1;
  for (let j = plan.n - 1; j >= 0; j--) if (sg[j] <= i - 2) { last = j; break; }
  let kc = 0;
  for (let k = 0; k < plan.chunks.length; k++) { if (plan.chunks[k][1] + 1 <= last) kc = k + 1; else break; }
  return kc;
}

/**
 * Is the path calm around the start of colour piece k (no corner and no bend tighter than the tube within r page units each way)?
 * A live stroke is only frozen at a calm spot, where a straight cut across the tube leaves nothing behind it to paint.
 */
export function rbJoinOk(plan, k, r, w = 6) {
  const { smp, chunks, n } = plan;
  const a = chunks[k][0];
  let i0 = a, i1 = a;
  while (i0 > 0 && smp.d[a] - smp.d[i0] < r) i0--;
  while (i1 < n - 1 && smp.d[i1] - smp.d[a] < r) i1++;
  i0 = Math.max(0, i0 - 1); i1 = Math.min(n - 1, i1 + 1);
  const maxT = Math.min(0.3, 2 / (w * 0.9 + 1));   // a bend tighter than the tube is wide would leave a hole behind a straight cut
  let prev = null;
  for (let i = i0; i < i1; i++) {
    const dx = smp.x[i + 1] - smp.x[i], dy = smp.y[i + 1] - smp.y[i];
    if (dx * dx + dy * dy < 1e-8) continue;
    const th = Math.atan2(dy, dx);
    if (prev !== null) {
      let dt = th - prev;
      while (dt > Math.PI) dt -= 2 * Math.PI;
      while (dt < -Math.PI) dt += 2 * Math.PI;
      if (Math.abs(dt) > maxT) return false;
    }
    prev = th;
  }
  return true;
}

/**
 * Paints chunks k0..k1-1 of a prepared rainbow stroke, one pass after the other (deep rim, saturated body, sheen, glint).
 * Every piece is one gradient from its start colour to its end colour and the next piece starts with exactly that colour, so the colour flows
 * without a visible step. Pieces overlap by one sample (no seams); all joins are ROUND, so a sharp turn can never grow a mitre spike.
 * A live stroke is painted in parts. opt.junction: this part continues one that is already painted – a thin slice right at the joint is left alone.
 * opt.ext: the last piece of the earlier part runs one sample further, so the two parts overlap and the joint has no seam.
 */
export function rbPaint(ctx, s, env, plan, k0, k1, opt = {}) {
  const { K, smp, n, chunks } = plan;
  if (k0 >= k1 || n < 2) return;
  const CYC = K.cycle, KS = K.keys, dk = env.dark ? K.lift : 0, baseW = s.w;
  const widthAt = (i0, i1) => {
    if (!smp.pr) return baseW;
    let a = 0; for (let i = i0; i <= i1; i++) a += smp.w[i];
    return baseW * (0.4 + 1.2 * a / (i1 - i0 + 1));
  };
  const degOf = (d) => (d / CYC) * 360;
  let clipped = false;
  if (opt.junction && k0 > 0) {
    // everything is painted except a 1.5-unit slice just behind the joint (the earlier part already holds it)
    const a = chunks[k0][0], i0 = Math.max(0, a - 1), i1 = Math.min(n - 1, a + 1);
    let tx = smp.x[i1] - smp.x[i0], ty = smp.y[i1] - smp.y[i0];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const nx = -ty, ny = tx, jx = smp.x[a], jy = smp.y[a], r = baseW * 0.85 + 2, dp = 1.5, R = 1e5;
    ctx.save(); clipped = true;
    ctx.beginPath();
    ctx.rect(jx - R, jy - R, 2 * R, 2 * R);
    ctx.moveTo(jx + nx * r, jy + ny * r); ctx.lineTo(jx - nx * r, jy - ny * r);
    ctx.lineTo(jx - nx * r - tx * dp, jy - ny * r - ty * dp); ctx.lineTo(jx + nx * r - tx * dp, jy + ny * r - ty * dp); ctx.closePath();
    ctx.clip('evenodd');
  }
  const first = k0 === 0, lastK = k1 === chunks.length;
  const pass = (width, color, dx = 0, dy = 0) => {
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    for (let k = k0; k < k1; k++) {
      const [a, b0] = chunks[k];
      const b = opt.ext && k === k1 - 1 && b0 + 1 < n ? b0 + 1 : b0;
      const lw = Math.max(0.3, width(a, b0));
      const from = k && !(opt.junction && k === k0) ? a - 1 : a;   // a continuation starts exactly at the joint
      const x0 = smp.x[a] + dx, y0 = smp.y[a] + dy, x1 = smp.x[b0] + dx, y1 = smp.y[b0] + dy;
      const c0 = color(degOf(smp.d[a])), c1 = color(degOf(smp.d[b0]));
      if (Math.hypot(x1 - x0, y1 - y0) > 0.05) {
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, c0); g.addColorStop(0.5, color(degOf((smp.d[a] + smp.d[b0]) / 2))); g.addColorStop(1, c1);
        ctx.strokeStyle = g;
      } else ctx.strokeStyle = c0;
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(smp.x[from] + dx, smp.y[from] + dy);
      for (let i = from + 1; i <= b; i++) ctx.lineTo(smp.x[i] + dx, smp.y[i] + dy);
      ctx.stroke();
      if (first && k === 0) { ctx.fillStyle = c0; ctx.beginPath(); ctx.arc(x0, y0, lw / 2, 0, 6.2832); ctx.fill(); }
      if (lastK && k === k1 - 1) { ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(x1, y1, lw / 2, 0, 6.2832); ctx.fill(); }
    }
  };
  const W = (f) => (a, b) => widthAt(a, b) * f;
  if (baseW < 2.4) {
    pass(W(1), (g) => hsl(g, K.sat, K.thin + dk, KS));
  } else {
    pass(W(1), (g) => hsl(g, K.sat, K.rim + dk * 0.5, KS));                                 // deep rim
    pass(W(0.8), (g) => hsl(g, K.sat, K.body + dk, KS));                                    // saturated body
    pass(W(0.46), (g) => hsl(g, K.sat, K.sheen + dk * 0.6, KS), -baseW * 0.07, -baseW * 0.1); // sheen
    pass(W(0.15), (g) => hsl(g, K.sat, K.glint, KS), -baseW * 0.13, -baseW * 0.18);           // specular glint
  }
  if (clipped) ctx.restore();
}

/* A finished rainbow stroke is painted once and kept as a small bitmap at the current zoom; every later repaint (pan, undo, erase elsewhere)
 * is one drawImage instead of hundreds of gradient strokes. Strokes never change, so the bitmap stays valid until the zoom changes. */
const RBC = new Map();
let RBC_PX = 0;
const RBC_MAX = 16e6;
function rbDrop(s) { const e = RBC.get(s); if (e) { RBC_PX -= e.px || 0; if (e.oc) { e.oc.width = 0; e.oc.height = 0; } RBC.delete(s); } }
function rbBlit(ctx, s, env) {
  const M = ctx.getTransform ? ctx.getTransform() : null;
  if (!M || Math.abs(M.b) > 1e-6 || Math.abs(M.c) > 1e-6 || Math.abs(M.a - M.d) > 1e-6 * M.a) return false;
  const ps = M.a;
  let e = RBC.get(s);
  if (e && !e.no && (Math.abs(e.ps / ps - 1) > 0.002 || e.dark !== !!env.dark)) { rbDrop(s); e = null; }
  if (e && e.no) return false;
  if (!e) {
    const p = s.pts;
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (let i = 0; i < p.length; i += 2) { if (p[i] < a) a = p[i]; if (p[i] > c) c = p[i]; if (p[i + 1] < b) b = p[i + 1]; if (p[i + 1] > d) d = p[i + 1]; }
    const pad = s.w * 1.1 + 2, ox = a - pad, oy = b - pad;
    const wpx = Math.ceil((c - a + 2 * pad) * ps) + 1, hpx = Math.ceil((d - b + 2 * pad) * ps) + 1;
    if (!(wpx > 0 && hpx > 0) || wpx > 4096 || hpx > 4096 || wpx * hpx > 9e6) { RBC.set(s, { no: true }); return false; }
    const oc = document.createElement('canvas'); oc.width = wpx; oc.height = hpx;
    const x = oc.getContext('2d');
    x.setTransform(ps, 0, 0, ps, -ox * ps, -oy * ps);
    paintRainbowAll(x, s, env);
    e = { oc, ps, dark: !!env.dark, ox, oy, px: wpx * hpx };
    RBC.set(s, e); RBC_PX += e.px;
    while (RBC_PX > RBC_MAX && RBC.size > 1) rbDrop(RBC.keys().next().value);
  } else { RBC.delete(s); RBC.set(s, e); }
  const dx = Math.round(M.e + M.a * e.ox), dy = Math.round(M.f + M.d * e.oy);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(e.oc, dx, dy); ctx.restore();
  return true;
}

function paintRainbowAll(ctx, s, env) {
  const plan = rbPrepare(s);
  if (plan.dot) {
    const K = plan.K;
    ctx.fillStyle = hsl(((plan.smp.d[0] / K.cycle) * 360) % 360, K.sat, K.body + (env.dark ? K.lift : 0), K.keys);
    ctx.beginPath(); ctx.arc(plan.smp.x[0], plan.smp.y[0], Math.max(s.w / 2, 0.4), 0, 6.2832); ctx.fill();
    return;
  }
  rbPaint(ctx, s, env, plan, 0, plan.chunks.length);
}

function drawRainbowFree(ctx, s, env) {
  const hl = s.t === 'hl';
  const K = INKS[s.c] || INKS['rb:d'], CYC = K.cycle, KS = K.keys;
  const dk = env.dark ? K.lift : 0;   // on a dark page the colours are lifted a little so they still glow
  const p = s.pts, np = p.length / 2;
  if (hl) {
    // a marker is one see-through layer, so it is a single stroke with the rainbow as a gradient along its chord
    ctx.globalAlpha = env.dark ? 0.5 : 0.42; if (!env.live && !env.dark) ctx.globalCompositeOperation = 'multiply';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = s.w;
    const x0 = p[0], y0 = p[1], x1 = p[np * 2 - 2], y1 = p[np * 2 - 1];
    const chord = Math.hypot(x1 - x0, y1 - y0);
    if (np < 2 || chord < 2) {
      ctx.fillStyle = hsl(((s.u || 0) / CYC) * 360, K.sat - 5, K.hl + dk, KS);
      ctx.beginPath(); ctx.arc(x0, y0, Math.max(s.w / 2, 0.4), 0, 6.2832); ctx.fill();
      return;
    }
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    const stops = Math.min(60, Math.max(3, Math.ceil(chord / (CYC / 18))));
    for (let i = 0; i <= stops; i++) g.addColorStop(i / stops, hsl(((((s.u || 0) + (i / stops) * chord) / CYC) * 360) % 360, K.sat - 5, K.hl + dk, KS));
    ctx.strokeStyle = g;
    ctx.beginPath(); smoothPath(ctx, p); ctx.stroke();
    return;
  }
  if (!env.live && env.scale && env.dpr && np > 3 && rbBlit(ctx, s, env)) return;
  paintRainbowAll(ctx, s, env);
}

const FONT = '"Segoe UI", Roboto, "Noto Sans Arabic", "Noto Naskh Arabic", system-ui, sans-serif';
export const fontOf = (s) => `${s.bold ? '700 ' : ''}${s.size}px ${FONT}`;
const RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
const strongRtl = (str) => { for (const ch of str) { if (RTL.test(ch)) return true; if (/[A-Za-zÀ-ɏЀ-ӿ]/.test(ch)) return false; } return false; };

/* ---------------- text ---------------- */
const layouts = new WeakMap();
export const textPad = (s) => (s.bg ? 10 : 3);

/** Wraps the text to the box width. Returns { lines:[{t, rtl}], lh, h }. Cached per stroke. */
export function layoutText(ctx, s) {
  let l = layouts.get(s);
  if (l) return l;
  ctx.save();
  ctx.font = fontOf(s);
  const maxW = Math.max(10, s.bw - textPad(s) * 2);
  const lines = [];
  for (const para of String(s.s).split('\n')) {
    if (!para) { lines.push({ t: '', rtl: false }); continue; }
    const rtl = strongRtl(para);
    const words = para.split(/(\s+)/);
    let cur = '';
    for (const w of words) {
      const test = cur + w;
      if (cur && ctx.measureText(test).width > maxW) {
        lines.push({ t: cur.trimEnd(), rtl });
        cur = w.trimStart();
      } else cur = test;
      // a single word longer than the box: break it by characters
      while (ctx.measureText(cur).width > maxW && cur.length > 1) {
        let i = cur.length - 1;
        while (i > 1 && ctx.measureText(cur.slice(0, i)).width > maxW) i--;
        lines.push({ t: cur.slice(0, i), rtl });
        cur = cur.slice(i);
      }
    }
    lines.push({ t: cur.trimEnd(), rtl });
  }
  ctx.restore();
  const lh = s.size * 1.32;
  l = { lines, lh, h: lines.length * lh + textPad(s) * 2 };
  layouts.set(s, l);
  return l;
}

/** Natural width for new text: the longest line (up to maxW), so a short word doesn't get a huge box. */
export function naturalWidth(ctx, text, size, bold, bg, maxW) {
  ctx.save();
  ctx.font = fontOf({ size, bold });
  let w = 0;
  for (const line of String(text).split('\n')) w = Math.max(w, ctx.measureText(line).width);
  ctx.restore();
  return Math.min(maxW, Math.max(60, Math.ceil(w + textPad({ bg }) * 2 + 4)));
}

/** Returns the text stroke with its height recomputed for its width and content. */
export function refitText(ctx, s) {
  const probe = { ...s, bh: 0 };
  const l = layoutText(ctx, probe);
  const out = { ...s, bh: Math.ceil(l.h) };
  return out;
}

/* ---------------- paper ---------------- */
function patternColor(dark, a = 1) { return dark ? `rgba(255,255,255,${0.15 * a})` : `rgba(45,70,120,${0.17 * a})`; }

/**
 * Paints the paper (and its ruling) for the visible part of the page.
 * vp = { x, y, s, W, H } maps world -> css pixels; the context is already scaled to world units.
 */
export function drawPaper(ctx, page, paper, pattern, vp) {
  const dark = isDark(paper);
  const fixed = !!page.w;
  const x0 = fixed ? 0 : -vp.x / vp.s, y0 = fixed ? 0 : -vp.y / vp.s;
  const w = fixed ? page.w : vp.W / vp.s, h = fixed ? page.h : vp.H / vp.s;
  ctx.fillStyle = paper;
  ctx.fillRect(x0, y0, w, h);
  if (pattern === 'none' || !pattern) { outlinePage(ctx, page, dark, vp); return; }
  // visible part only
  const vx1 = Math.max(x0, -vp.x / vp.s), vy1 = Math.max(y0, -vp.y / vp.s);
  const vx2 = Math.min(x0 + w, (vp.W - vp.x) / vp.s), vy2 = Math.min(y0 + h, (vp.H - vp.y) / vp.s);
  if (vx2 <= vx1 || vy2 <= vy1) return;
  const px = 1 / vp.s;
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
  if (pattern === 'notes') {
    const fx = fixed ? 0 : vx1, fw = fixed ? w : vx2 - vx1;
    if (NOTE_PITCH * vp.s >= 5) {
      ctx.lineWidth = Math.max(px, 0.9); ctx.strokeStyle = patternColor(dark, 1.25); ctx.beginPath();
      const kMin = fixed ? Math.max(0, Math.ceil((vy1 - NOTE_LINE0) / NOTE_PITCH)) : Math.floor((vy1 - NOTE_LINE0) / NOTE_PITCH);
      const yMax = fixed ? Math.min(vy2, h - 18) : vy2, pad = fixed ? NOTE_PAD * 0.5 : 0;
      for (let y = NOTE_LINE0 + kMin * NOTE_PITCH; y <= yMax; y += NOTE_PITCH) { ctx.moveTo(fx + pad, y); ctx.lineTo(fx + fw - pad, y); }
      ctx.stroke();
    }
    if (fixed) {
      ctx.fillStyle = dark ? 'rgba(245,158,11,.55)' : 'rgba(245,158,11,.9)'; ctx.fillRect(0, 0, w, 12);
      ctx.fillStyle = dark ? 'rgba(255,255,255,.5)' : 'rgba(40,50,80,.55)'; ctx.font = `600 11px ${FONT}`; ctx.textBaseline = 'alphabetic';
      ctx.direction = 'inherit'; ctx.textAlign = 'left'; ctx.fillText(t('note_date'), NOTE_PAD, NOTE_DATE_Y - 8);
      ctx.strokeStyle = dark ? 'rgba(255,255,255,.4)' : 'rgba(40,50,80,.45)'; ctx.lineWidth = Math.max(px * 1.3, 1.2); ctx.beginPath();
      ctx.moveTo(NOTE_PAD, NOTE_DATE_Y + 32); ctx.lineTo(w - NOTE_PAD, NOTE_DATE_Y + 32); ctx.stroke();
    }
    ctx.restore();
    outlinePage(ctx, page, dark, vp);
    return;
  }
  if (pattern === 'english') {
    if (EN_PITCH * vp.s >= 5) {
      const k0 = Math.floor((vy1 - EN_TOP - EN_GAP) / EN_PITCH), k1 = Math.ceil((vy2 - EN_TOP) / EN_PITCH);
      // like the printed copybook, but light and fine so the writing stands out (both lines of a pair look the same)
      ctx.lineWidth = Math.max(px * 0.9, 0.9); ctx.strokeStyle = dark ? 'rgba(235,235,245,.30)' : 'rgba(58,64,86,.30)'; ctx.beginPath();
      for (let k = k0; k <= k1; k++) { const y = EN_TOP + k * EN_PITCH; ctx.moveTo(vx1, y); ctx.lineTo(vx2, y); ctx.moveTo(vx1, y + EN_GAP); ctx.lineTo(vx2, y + EN_GAP); }
      ctx.stroke();
    }
    ctx.restore();
    outlinePage(ctx, page, dark, vp);
    return;
  }
  let sp = pattern === 'dots' ? 24 : pattern === 'grid' ? 24 : pattern === 'graph' ? 12 : 32;
  while (sp * vp.s < (pattern === 'graph' ? 5 : 8)) sp *= 2;
  const fromX = Math.floor(vx1 / sp) * sp, fromY = Math.floor(vy1 / sp) * sp;
  if (pattern === 'dots') {
    ctx.fillStyle = patternColor(dark, 1.7);
    const r = Math.max(1.1, 1.3 * px);
    ctx.beginPath();
    for (let y = fromY; y <= vy2; y += sp) for (let x = fromX; x <= vx2; x += sp) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); }
    ctx.fill();
  } else {
    ctx.lineWidth = Math.max(px, 0.8);
    ctx.strokeStyle = patternColor(dark);
    ctx.beginPath();
    if (pattern !== 'lines' && pattern !== 'cornell') for (let x = fromX; x <= vx2; x += sp) { ctx.moveTo(x, vy1); ctx.lineTo(x, vy2); }
    for (let y = fromY; y <= vy2; y += sp) { ctx.moveTo(vx1, y); ctx.lineTo(vx2, y); }
    ctx.stroke();
    if (pattern === 'graph') {
      const big = sp * 5;
      ctx.strokeStyle = patternColor(dark, 1.9); ctx.beginPath();
      for (let x = Math.floor(vx1 / big) * big; x <= vx2; x += big) { ctx.moveTo(x, vy1); ctx.lineTo(x, vy2); }
      for (let y = Math.floor(vy1 / big) * big; y <= vy2; y += big) { ctx.moveTo(vx1, y); ctx.lineTo(vx2, y); }
      ctx.stroke();
    }
    if ((pattern === 'lines' || pattern === 'cornell') && fixed) {
      ctx.strokeStyle = dark ? 'rgba(255,120,120,.4)' : 'rgba(220,60,60,.35)';
      ctx.beginPath();
      if (pattern === 'lines') { ctx.moveTo(56, 0); ctx.lineTo(56, h); }
      else { ctx.moveTo(150, 0); ctx.lineTo(150, h - 130); ctx.moveTo(0, h - 130); ctx.lineTo(w, h - 130); }
      ctx.stroke();
    }
  }
  ctx.restore();
  outlinePage(ctx, page, dark, vp);
}

function outlinePage(ctx, page, dark, vp) {
  if (!page.w) return;
  ctx.lineWidth = 1 / vp.s;
  ctx.strokeStyle = dark ? 'rgba(255,255,255,.28)' : 'rgba(0,0,0,.22)';
  ctx.strokeRect(0, 0, page.w, page.h);
}

/* ---------------- strokes ---------------- */
function smoothPath(ctx, p) {
  const n = p.length / 2;
  ctx.moveTo(p[0], p[1]);
  if (n === 2) { ctx.lineTo(p[2], p[3]); return; }
  const cr = n >= 4 ? cornerSet(p, 3, 50) : null;   // true corners stay corners; everything else is one smooth curve
  for (let i = 1; i < n - 1; i++) {
    if (cr && cr.has(i)) ctx.lineTo(p[i * 2], p[i * 2 + 1]);
    else ctx.quadraticCurveTo(p[i * 2], p[i * 2 + 1], (p[i * 2] + p[i * 2 + 2]) / 2, (p[i * 2 + 1] + p[i * 2 + 3]) / 2);
  }
  ctx.lineTo(p[(n - 1) * 2], p[(n - 1) * 2 + 1]);
}

/* Old-fashioned ink pen: a flat nib held at an angle. The mark is everything the nib sweeps over, so strokes along the nib are fine hairlines
 * and strokes across it are full – the classic thick-and-thin of a dip or fountain pen – and a sharp turn can never grow a spike. */
/* ---- more pen nibs ---- */
const hex3 = (c) => { const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c || ''); if (!m) return null; let h = m[1]; if (h.length === 3) h = h.replace(/./g, '$&$&'); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
const mixWhite = (c, t) => { const r = hex3(c); if (!r) return c; return `rgb(${r.map((v) => Math.round(v + (255 - v) * t)).join(',')})`; };

/* Neon: a tube of light. A soft halo, a saturated body and a hot white-ish core; on a dark page the halo ADDS light, so it really glows. */
function drawNeon(ctx, s, env) {
  const col = isRainbow(s.c) ? inkSolid(s.c) : s.c, w = s.w, path = new Path2D();
  smoothPath(path, s.pts);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const dark = !!env.dark;
  if (s.pts.length < 4) { ctx.lineWidth = w; }
  ctx.strokeStyle = col;
  if (dark) ctx.globalCompositeOperation = 'lighter';
  for (const [f, a] of [[4.4, dark ? 0.09 : 0.07], [2.8, dark ? 0.15 : 0.12], [1.6, dark ? 0.34 : 0.3]]) { ctx.globalAlpha = a; ctx.lineWidth = w * f; ctx.stroke(path); }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1; ctx.lineWidth = w * 0.95; ctx.stroke(path);
  ctx.strokeStyle = mixWhite(col, dark ? 0.8 : 0.5); ctx.lineWidth = Math.max(0.6, w * 0.4); ctx.stroke(path);
}

/* Pencil: graphite on paper. The line is painted with a grain that stays fixed to the page, so the paper tooth shows through it. */
const GRAIN = new Map();
function grainTile(col) {
  let t = GRAIN.get(col);
  if (t) return t;
  const N = 128; t = document.createElement('canvas'); t.width = t.height = N;
  const x = t.getContext('2d'), img = x.createImageData(N, N);
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const rgb = hex3(col) || [40, 44, 56];
  for (let i = 0; i < N * N; i++) {
    const a = Math.pow(rnd(), 0.55);                 // many fairly dark specks, a few light gaps
    const j = i * 4; img.data[j] = rgb[0]; img.data[j + 1] = rgb[1]; img.data[j + 2] = rgb[2]; img.data[j + 3] = Math.round(70 + a * 185);
  }
  x.putImageData(img, 0, 0);
  if (GRAIN.size > 24) GRAIN.delete(GRAIN.keys().next().value);
  GRAIN.set(col, t);
  return t;
}
function drawPencil(ctx, s, env) {
  void env;
  const col = isRainbow(s.c) ? inkSolid(s.c) : s.c, w = s.w, path = new Path2D();
  smoothPath(path, s.pts);
  const M = ctx.getTransform ? ctx.getTransform() : null, ps = M ? Math.hypot(M.a, M.b) || 1 : 1;
  const pat = ctx.createPattern(grainTile(col), 'repeat');
  const pat2 = ctx.createPattern(grainTile(col), 'repeat');
  if (pat.setTransform && typeof DOMMatrix !== 'undefined') { pat.setTransform(new DOMMatrix().scale(1 / ps)); pat2.setTransform(new DOMMatrix().translate(37 / ps, 19 / ps).scale(1 / ps)); }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = pat; ctx.globalAlpha = 0.9; ctx.lineWidth = w * 1.1; ctx.stroke(path);
  ctx.strokeStyle = pat2; ctx.globalAlpha = 0.7; ctx.lineWidth = Math.max(0.6, w * 0.62); ctx.stroke(path);
}

const NIB = -0.62;   // nib edge direction (radians, y down): up and to the right, like a right-handed italic nib
function drawInk(ctx, s, env) {
  void env;
  const p = s.pts, n = p.length / 2, w = s.w;
  const col = isRainbow(s.c) ? inkSolid(s.c) : s.c;
  ctx.fillStyle = ctx.strokeStyle = col;
  const ex = Math.cos(NIB), ey = Math.sin(NIB);
  const half = (f) => 0.5 * w * 1.25 * f;
  if (n < 2 || (() => { for (let i = 2; i < p.length; i += 2) if (Math.abs(p[i] - p[0]) > 0.05 || Math.abs(p[i + 1] - p[1]) > 0.05) return false; return true; })()) {
    const h = half(s.pr ? 0.4 + 1.2 * s.pr[0] : 1);
    ctx.beginPath(); ctx.ellipse(p[0], p[1], Math.max(h * 0.5, 0.45), Math.max(h * 0.5, 0.45), 0, 0, 6.2832); ctx.fill();
    return;
  }
  const smp = curveSamples(p, s.pr || null, 0, Math.max(0.8, w * 0.3));
  const m = smp.x.length;
  const hs = new Array(m);
  for (let i = 0; i < m; i++) hs[i] = half(smp.pr ? 0.4 + 1.2 * smp.w[i] : 1);
  ctx.beginPath();
  for (let i = 0; i < m - 1; i++) {
    const x0 = smp.x[i], y0 = smp.y[i], x1 = smp.x[i + 1], y1 = smp.y[i + 1];
    const ax = ex * hs[i], ay = ey * hs[i], bx = ex * hs[i + 1], by = ey * hs[i + 1];
    // the swept piece: the nib at the start joined to the nib at the end (all pieces wound the same way, so they merge)
    const cross = (x1 + bx - (x0 + ax)) * (y1 - by - (y1 + by)) - (y1 + by - (y0 + ay)) * (x1 - bx - (x1 + bx));
    if (cross >= 0) { ctx.moveTo(x0 + ax, y0 + ay); ctx.lineTo(x1 + bx, y1 + by); ctx.lineTo(x1 - bx, y1 - by); ctx.lineTo(x0 - ax, y0 - ay); }
    else { ctx.moveTo(x0 + ax, y0 + ay); ctx.lineTo(x0 - ax, y0 - ay); ctx.lineTo(x1 - bx, y1 - by); ctx.lineTo(x1 + bx, y1 + by); }
    ctx.closePath();
  }
  ctx.fill('nonzero');
  // a hairline floor, so a stroke that runs exactly along the nib is still a fine line, not nothing
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1, w * 0.32);
  ctx.beginPath(); smoothPath(ctx, p); ctx.stroke();
}

function drawFree(ctx, s, env) {
  if (s.t === 'pen' && s.k === 'ink') { drawInk(ctx, s, env); return; }
  if (s.t === 'pen' && s.k === 'neon') { drawNeon(ctx, s, env); return; }
  if (s.t === 'pen' && s.k === 'pencil') { drawPencil(ctx, s, env); return; }
  if (isRainbow(s.c)) { drawRainbowFree(ctx, s, env); return; }
  const p = s.pts, n = p.length / 2;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const hl = s.t === 'hl';
  if (hl) { ctx.globalAlpha = env.dark ? 0.5 : 0.42; if (!env.live && !env.dark) ctx.globalCompositeOperation = 'multiply'; }
  ctx.strokeStyle = ctx.fillStyle = s.c;
  let same = true;
  for (let i = 2; i < p.length; i += 2) if (Math.abs(p[i] - p[0]) > 0.05 || Math.abs(p[i + 1] - p[1]) > 0.05) { same = false; break; }
  if (n === 1 || same) {
    ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(s.w / 2, 0.4), 0, 6.2832); ctx.fill();
  } else if (s.pr && !hl) {
    // width follows pressure / speed: runs of segments with (nearly) the same width are drawn as one path
    let q = -1, open = false;
    for (let i = 0; i < n - 1; i++) {
      const lw = Math.round(s.w * (0.4 + 1.2 * ((s.pr[i] + s.pr[i + 1]) / 2)) * 8) / 8;
      if (lw !== q) {
        if (open) ctx.stroke();
        q = lw; ctx.lineWidth = Math.max(0.2, lw); ctx.beginPath(); ctx.moveTo(p[i * 2], p[i * 2 + 1]); open = true;
      }
      ctx.lineTo(p[i * 2 + 2], p[i * 2 + 3]);
    }
    if (open) ctx.stroke();
  } else {
    ctx.lineWidth = s.w;
    ctx.beginPath(); smoothPath(ctx, p); ctx.stroke();
  }
}

function shapeBox(s) {
  if (s.a && s.b) return [Math.min(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.max(s.a[0], s.b[0]), Math.max(s.a[1], s.b[1])];
  const o = outline(s).pts;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < o.length; i += 2) { x0 = Math.min(x0, o[i]); x1 = Math.max(x1, o[i]); y0 = Math.min(y0, o[i + 1]); y1 = Math.max(y1, o[i + 1]); }
  return [x0, y0, x1, y1];
}

function polyPath(ctx, pts, closed) {
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  if (closed) ctx.closePath();
}

function drawShape(ctx, s, env) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = s.w;
  ctx.strokeStyle = ctx.fillStyle = isRainbow(s.c) ? rainbowGradient(ctx, s.c, shapeBox(s), env?.dark) : s.c;
  ctx.beginPath();
  if (s.t === 'ellipse') {
    const cx = (s.a[0] + s.b[0]) / 2, cy = (s.a[1] + s.b[1]) / 2;
    ctx.ellipse(cx, cy, Math.max(0.1, Math.abs(s.b[0] - s.a[0]) / 2), Math.max(0.1, Math.abs(s.b[1] - s.a[1]) / 2), 0, 0, 6.2832);
  } else {
    const o = outline(s);
    polyPath(ctx, o.pts, o.closed);
  }
  if (s.f && s.t !== 'line' && s.t !== 'arrow') { ctx.save(); ctx.globalAlpha = 0.22; ctx.fill(); ctx.restore(); }
  ctx.stroke();
  if (s.t === 'arrow') {
    const [x1, y1] = s.a, [x2, y2] = s.b;
    const ang = Math.atan2(y2 - y1, x2 - x1), hd = Math.max(10, s.w * 4.2);
    ctx.beginPath();
    ctx.moveTo(x2 - hd * Math.cos(ang - 0.5), y2 - hd * Math.sin(ang - 0.5)); ctx.lineTo(x2, y2); ctx.lineTo(x2 - hd * Math.cos(ang + 0.5), y2 - hd * Math.sin(ang + 0.5));
    ctx.stroke();
  }
}

function drawText(ctx, s, env) {
  const l = layoutText(ctx, s);
  const pad = textPad(s);
  if (s.bg) {
    ctx.fillStyle = s.bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(s.x, s.y, s.bw, s.bh, 5); else ctx.rect(s.x, s.y, s.bw, s.bh);
    ctx.fill();
  }
  ctx.font = fontOf(s);
  ctx.fillStyle = isRainbow(s.c) ? rainbowGradient(ctx, s.c, [s.x, s.y, s.x + s.bw, s.y + s.bh], env?.dark) : s.c;
  ctx.textBaseline = 'top';
  let y = s.y + pad + (s.size * 1.32 - s.size) / 2;
  for (const ln of l.lines) {
    ctx.direction = ln.rtl ? 'rtl' : 'ltr';
    ctx.textAlign = ln.rtl ? 'right' : 'left';
    ctx.fillText(ln.t, ln.rtl ? s.x + s.bw - pad : s.x + pad, y);
    y += l.lh;
  }
  ctx.direction = 'ltr'; ctx.textAlign = 'left';
}

const roundRect = (ctx, x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };

function placeholder(ctx, s, text, dark) {
  ctx.fillStyle = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
  ctx.fillRect(s.x, s.y, s.w, s.h);
  ctx.strokeStyle = dark ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.25)';
  ctx.lineWidth = 1; ctx.setLineDash([6, 5]); ctx.strokeRect(s.x, s.y, s.w, s.h); ctx.setLineDash([]);
  if (text) {
    ctx.fillStyle = dark ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.55)';
    ctx.font = `${Math.max(10, Math.min(18, s.w / 12))}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, s.x + s.w / 2, s.y + s.h / 2, s.w - 12);
    ctx.textAlign = 'left';
  }
}

function drawMedia(ctx, s, env) {
  const thumb = env.assets?.thumb(s.ref);
  const video = s.kind === 'video';
  roundRect(ctx, s.x, s.y, s.w, s.h, Math.min(14, s.h / 6));
  ctx.save();
  ctx.clip();
  // a cropped video card shows part of the whole card: draw the whole card (F) and let the clip keep the part
  const cr = cropOf(s), fw = s.w / (cr[2] - cr[0]), fh = s.h / (cr[3] - cr[1]), fx = s.x - cr[0] * fw, fy = s.y - cr[1] * fh;
  if (thumb) {
    const k = Math.max(fw / thumb.w, fh / thumb.h);
    ctx.drawImage(thumb.src, fx + (fw - thumb.w * k) / 2, fy + (fh - thumb.h * k) / 2, thumb.w * k, thumb.h * k);
  } else {
    const g = ctx.createLinearGradient(fx, fy, fx + fw, fy + fh);
    if (video) { g.addColorStop(0, '#12485a'); g.addColorStop(1, '#0a1233'); } else { g.addColorStop(0, '#3a2c8a'); g.addColorStop(1, '#0f1640'); }
    ctx.fillStyle = g; ctx.fillRect(fx, fy, fw, fh);
  }
  const shade = ctx.createLinearGradient(0, s.y + s.h * 0.45, 0, s.y + s.h);
  shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,.72)');
  ctx.fillStyle = shade; ctx.fillRect(s.x, s.y, s.w, s.h);
  ctx.restore();
  // play button
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2 - Math.min(8, s.h * 0.05), r = Math.max(14, Math.min(s.w, s.h) * 0.17);
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(1.5, r * 0.08); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath();
  ctx.moveTo(cx - r * 0.28, cy - r * 0.42); ctx.lineTo(cx + r * 0.5, cy); ctx.lineTo(cx - r * 0.28, cy + r * 0.42); ctx.closePath(); ctx.fill();
  // title
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${Math.max(11, Math.min(17, s.h / 7))}px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  const title = s.title || '';
  const rtl = strongRtl(title);
  ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = rtl ? 'right' : 'left';
  ctx.fillText(title, rtl ? s.x + s.w - 10 : s.x + 10, s.y + s.h - 10, s.w - 20);
  ctx.direction = 'ltr'; ctx.textAlign = 'left';
  ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1;
  roundRect(ctx, s.x, s.y, s.w, s.h, Math.min(14, s.h / 6)); ctx.stroke();
}

/**
 * env = { dark, assets, live, hideMedia }
 * dark: is the paper dark (changes highlighter blending); live: drawing on a transparent overlay; hideMedia: media card being played.
 */
export function drawStroke(ctx, s, env) {
  ctx.save();
  try {
    switch (s.t) {
      case 'pen': case 'hl': drawFree(ctx, s, env); break;
      case 'text': drawText(ctx, s, env); break;
      case 'img': {
        const b = env.assets?.image(s.ref);
        if (b) { const c = cropOf(s); ctx.drawImage(b.src, c[0] * b.w, c[1] * b.h, (c[2] - c[0]) * b.w, (c[3] - c[1]) * b.h, s.x, s.y, s.w, s.h); } else placeholder(ctx, s, env.assets?.missing(s.ref) ? '⚠' : '…', env.dark);
        break;
      }
      case 'pdfp': {
        const b = env.assets?.pdfPage(s.ref, s.page, Math.ceil(s.w * (env.scale || 1) * (env.dpr || 1)), false, s.crop ? cropOf(s) : null);
        if (b) { ctx.fillStyle = '#fff'; ctx.fillRect(s.x, s.y, s.w, s.h); ctx.drawImage(b.src, s.x, s.y, s.w, s.h); ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1 / (env.scale || 1); ctx.strokeRect(s.x, s.y, s.w, s.h); } else placeholder(ctx, s, env.assets?.missing(s.ref) ? '⚠ PDF' : 'PDF …', env.dark);
        break;
      }
      case 'media': if (env.hideMedia !== s) drawMedia(ctx, s, env); break;
      case 'book': drawBook(ctx, s, env); break;
      default: drawShape(ctx, s, env);
    }
  } finally { ctx.restore(); }
}

export const isFreeStroke = FREE;

/**
 * Stand-in for the free-hand ink while the view is being moved (pinch, pan, fling) on a heavy board: every stroke is one flat
 * polyline with its points thinned to what the screen can show, and runs of strokes with the same colour and width share one path.
 * No grain, glow, pressure or colour cycling, so a frame costs a few milliseconds and the whole screen is always filled.
 * The real drawing comes back as soon as the fingers lift. lvl 2 is coarser still (used when even this is too slow).
 */
export function lodBatch(ctx, env, lvl) {
  const sc = env.scale || 1;
  const minD = (lvl > 2 ? 7 : lvl > 1 ? 3 : 1.1) / sc, minBox = (lvl > 2 ? 6 : lvl > 1 ? 2.4 : 0.7) / sc, minW = (lvl > 2 ? 2 : lvl > 1 ? 1.4 : 0.9) / sc;
  let key = '', open = false;
  const flush = () => { if (open) { ctx.stroke(); open = false; } key = ''; };
  return {
    flush,
    add(st, bb) {
      const p = st.pts, n = p.length >> 1;
      if (!n) return;
      if (bb[2] - bb[0] < minBox && bb[3] - bb[1] < minBox && st.w < minBox * 2) return;   // a speck the screen cannot show
      const hl = st.t === 'hl';
      const col = isRainbow(st.c) ? inkSolid(st.c) : st.c;
      const lw = Math.max(st.w, minW);
      if (hl) {
        flush();
        ctx.save();
        ctx.globalAlpha = env.dark ? 0.5 : 0.42;
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(p[0], p[1]);
        let lx = p[0], ly = p[1];
        for (let i = 2; i < p.length; i += 2) { if (Math.abs(p[i] - lx) + Math.abs(p[i + 1] - ly) >= minD || i >= p.length - 2) { ctx.lineTo(p[i], p[i + 1]); lx = p[i]; ly = p[i + 1]; } }
        if (n === 1) ctx.lineTo(p[0] + 0.01, p[1]);
        ctx.stroke(); ctx.restore();
        return;
      }
      const k = col + '|' + (Math.round(lw * 4) / 4);
      if (k !== key) {
        flush();
        key = k; open = true;
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
      }
      ctx.moveTo(p[0], p[1]);
      let lx = p[0], ly = p[1];
      for (let i = 2; i < p.length; i += 2) { if (Math.abs(p[i] - lx) + Math.abs(p[i + 1] - ly) >= minD || i >= p.length - 2) { ctx.lineTo(p[i], p[i + 1]); lx = p[i]; ly = p[i + 1]; } }
      if (n === 1) ctx.lineTo(p[0] + 0.01, p[1]);
    },
  };
}
