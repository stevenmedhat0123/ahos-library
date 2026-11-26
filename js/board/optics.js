// Mirrors and lenses for physics lessons, drawn as ordinary board strokes (no new stroke type: everything can be moved, resized, erased and exported).
// Pure functions: the box you drag in -> a list of items { t:'poly'|'line'|'arrow'|'text', … }. The board turns them into strokes in its colour and width.
//
//   concave mirror / convex mirror / convex lens / concave lens
//   with the principal axis, the focus F and the centre C (2F), and – if asked – an object with the three principal rays and its image
//   (solid rays where light really goes, dashed where it only seems to come from; an image that is not real is dashed too).
//
// Thin-element rules (rays are bent / reflected at the plane of the mirror or lens):   1/v = 1/f − 1/u     m = −v/u
//   u = object distance (always > 0, object on the left), v > 0: image on the light's side (real), v < 0: virtual.   f > 0 concave mirror / convex lens.

export const OPTICS = ['cmirror', 'xmirror', 'clens', 'vlens'];
export const OBJ_POS = [['far', 3], ['c', 2], ['mid', 1.5], ['in', 0.6]];   // object distance in focal lengths
const RAY = ['#ef4444', '#16a34a', '#2563eb'];
const r1 = (v) => Math.round(v * 10) / 10;
const PT = (x, y) => [r1(x), r1(y)];

/** The three principal rays and the image. `el` = { x: plane of the element, f: signed focal length, hh: half height, mirror: bool }, `u`, `ho`, `y0` = axis height. */
/** Liang–Barsky: the part of the segment p→q inside the box, or null. */
function clip(p, q, [bx0, by0, bx1, by1]) {
  let t0 = 0, t1 = 1; const dx = q[0] - p[0], dy = q[1] - p[1];
  for (const [pp, qq] of [[-dx, p[0] - bx0], [dx, bx1 - p[0]], [-dy, p[1] - by0], [dy, by1 - p[1]]]) {
    if (pp === 0) { if (qq < 0) return null; continue; }
    const r = qq / pp;
    if (pp < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[p[0] + t0 * dx, p[1] + t0 * dy], [p[0] + t1 * dx, p[1] + t1 * dy]];
}

export function trace({ x, f, hh, mirror }, u, ho, y0, xMin, xMax, yMin = -Infinity, yMax = Infinity) {
  const xo = x - u, T = [xo, ho];
  const inf = Math.abs(u - f) < 1e-6;
  const v = inf ? Infinity : (f * u) / (u - f);
  const real = !inf && v > 0;
  const hi = inf ? 0 : (-ho * v) / u;
  const I = inf ? null : [mirror ? x - v : x + v, hi];
  const items = [];
  const Y = (Yv) => y0 - Yv;                             // math (y up) -> canvas (y down)
  const dirOut = mirror ? -1 : 1;                        // the way the light travels after the element
  const edge = dirOut < 0 ? xMin : xMax;
  const along = (p, d, toX) => { const t = (toX - p[0]) / d[0]; return [toX, p[1] + d[1] * t]; };
  const poly = (pts, c, dash) => {
    let cv = pts.map((p) => [p[0], Y(p[1])]);
    if (cv.length === 2) { const cl = clip(cv[0], cv[1], [xMin, yMin, xMax, yMax]); if (!cl) return; cv = cl; }   // a ray stops at the edge of the drawing
    items.push({ t: 'poly', pts: cv.flatMap((p) => PT(p[0], p[1])), closed: false, c, ...(dash ? { d: 1 } : {}), k: 0.7 });
  };
  // a ray leaving point P on the element: real image → on to the image (and a little further); virtual image → away from it, with the back-extension dashed
  const leave = (P, c) => {
    if (inf) { poly([P, [edge, P[1]]], c); return; }
    const m = (I[1] - P[1]) / (I[0] - P[0] || 1e-9);
    const reach = real ? Math.min(Math.abs(edge - P[0]), Math.abs(I[0] - P[0]) + (xMax - xMin) * 0.1) : Math.abs(edge - P[0]);
    poly([P, [P[0] + dirOut * reach, P[1] + dirOut * reach * m]], c);
    if (!real) poly([P, I], c, true);
  };
  const hit = (yv) => Math.abs(yv) <= hh;
  // 1) parallel to the axis → through F (or as if from F)
  if (hit(ho)) { poly([T, [x, ho]], RAY[0]); leave([x, ho], RAY[0]); }
  // 2) through the pole / centre
  poly([T, [x, 0]], RAY[1]);
  if (mirror) leave([x, 0], RAY[1]);
  else if (inf) poly([[x, 0], along([x, 0], [x - xo, -ho], xMax)], RAY[1]);
  else {
    const d = [x - xo, -ho], end = along([x, 0], d, real ? Math.min(xMax, I[0] + (xMax - xMin) * 0.1) : xMax); poly([[x, 0], end], RAY[1]);
    if (!real && I[0] < xo) poly([T, I], RAY[1], true);   // a virtual image beyond the object: the line is carried back to it
  }
  // 3) through (or towards) the focus → parallel to the axis
  const y3 = inf ? null : (ho * f) / (f - u);
  if (y3 !== null && hit(y3)) {
    poly([T, [x, y3]], RAY[2]);
    const Fp = [x - f, 0];                                  // the focus this ray is aimed at (mirror: on the object's side for a concave one)
    if (f < 0 || (f > 0 && u < f)) poly(f < 0 ? [[x, y3], Fp] : [Fp, T], RAY[2], true);
    if (real) poly([[x, y3], [Math.min(xMax, Math.max(xMin, I[0] + (xMax - xMin) * 0.1 * dirOut)), y3]], RAY[2]);
    else { poly([[x, y3], [edge, y3]], RAY[2]); poly([[x, y3], I], RAY[2], true); }
  }
  // object and image
  items.push({ t: 'arrow', a: PT(xo, Y(0)), b: PT(xo, Y(ho)), c: '#7c3aed', k: 1 });
  if (I && Math.abs(hi) > 0.5) items.push({ t: 'arrow', a: PT(I[0], Y(0)), b: PT(I[0], Y(hi)), c: '#7c3aed', k: 1, ...(real ? {} : { d: 1 }) });
  return { items, v, real, hi, I };
}

/** Everything for one optic in the box [x1,y1,x2,y2]. opts: { pos: 'far'|'c'|'mid'|'in', rays: bool, labels: bool } */
export function opticItems(kind, b, { pos = 'far', rays = true, labels = true } = {}) {
  const x1 = Math.min(b[0], b[2]), x2 = Math.max(b[0], b[2]), y1 = Math.min(b[1], b[3]), y2 = Math.max(b[1], b[3]);
  const W = x2 - x1, H = y2 - y1, y0 = (y1 + y2) / 2, hh = H * 0.42;
  const items = [];
  const mirror = kind === 'cmirror' || kind === 'xmirror';
  const concave = kind === 'cmirror';
  const fAbs = kind === 'cmirror' ? W * 0.22 : W * 0.14;
  const f = kind === 'cmirror' || kind === 'clens' ? fAbs : -fAbs;               // signed: + concave mirror / convex lens
  const x = kind === 'cmirror' ? x2 - W * 0.08 : kind === 'xmirror' ? x1 + W * 0.62 : (x1 + x2) / 2;   // plane of the element (a convex mirror leaves room behind it for F and C)
  const size = Math.max(10, Math.min(22, W * 0.05));
  const text = (s, tx, ty) => labels && items.push({ t: 'text', x: r1(tx), y: r1(ty), s, size: r1(size), center: true });
  items.push({ t: 'line', a: PT(x1, y0), b: PT(x2, y0) });                       // principal axis
  const tick = (tx) => items.push({ t: 'line', a: PT(tx, y0 - 5), b: PT(tx, y0 + 5) });
  if (mirror) {
    const R = 2 * fAbs, n = 40, pts = [];
    for (let i = 0; i <= n; i++) {
      const s = (-1 + (2 * i) / n) * hh, d = R - Math.sqrt(Math.max(0, R * R - s * s));
      pts.push(...PT(concave ? x - d : x + d, y0 + s));
    }
    items.push({ t: 'poly', pts, closed: false, k: 1.4 });
    for (let i = 1; i < 9; i++) {                                                // the hatching on the back of the mirror
      const s = (-1 + (2 * i) / 9) * hh, d = R - Math.sqrt(Math.max(0, R * R - s * s)), px = concave ? x - d : x + d, hs = Math.min(10, hh * 0.12);
      items.push({ t: 'line', a: PT(px, y0 + s), b: PT(px + hs, y0 + s + hs), k: 0.5 });
    }
    const Fx = x - f, Cx = x - 2 * f;                                            // F is behind a convex mirror (right of it)
    tick(Fx); tick(Cx); tick(x);
    text('F', Fx, y0 + 8); text('C', Cx, y0 + 8); text('P', x, y0 + 8);
  } else {
    const n = 30, tE = Math.min(W * 0.05, hh * 0.45), pts = [];
    if (kind === 'clens') {
      for (let i = 0; i <= n; i++) { const s = (-1 + (2 * i) / n) * hh; pts.push(...PT(x + tE * (1 - (s / hh) ** 2) + 0, y0 + s)); }
      for (let i = n; i >= 0; i--) { const s = (-1 + (2 * i) / n) * hh; pts.push(...PT(x - tE * (1 - (s / hh) ** 2), y0 + s)); }
    } else {
      const tc = tE * 0.12, te = tE * 0.9;
      for (let i = 0; i <= n; i++) { const s = (-1 + (2 * i) / n) * hh; pts.push(...PT(x + tc + (te - tc) * (s / hh) ** 2, y0 + s)); }
      for (let i = n; i >= 0; i--) { const s = (-1 + (2 * i) / n) * hh; pts.push(...PT(x - tc - (te - tc) * (s / hh) ** 2, y0 + s)); }
    }
    items.push({ t: 'poly', pts, closed: true, k: 1.2 });
    for (const m of [-2, -1, 1, 2]) tick(x + m * fAbs);
    text("2F", x - 2 * fAbs, y0 + 8); text('F', x - fAbs, y0 + 8); text('O', x, y0 + 8); text('F′', x + fAbs, y0 + 8); text('2F′', x + 2 * fAbs, y0 + 8);
  }
  if (rays) {
    const k = (OBJ_POS.find((p) => p[0] === pos) || OBJ_POS[0])[1];
    const u = k * fAbs;
    let ho = hh * 0.42;
    if (Math.abs(u - fAbs) > 1e-6) ho = Math.min(ho, (0.9 * hh * Math.abs(fAbs - u)) / fAbs);   // small enough that the third ray still meets the element
    const t = trace({ x, f, hh, mirror }, u, ho, y0, x1, x2, y1, y2);
    for (const it of t.items) items.push(it);
  }
  return items;
}
