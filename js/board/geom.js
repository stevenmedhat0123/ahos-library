// Pure geometry for the whiteboard: hit tests, erasing, shape recognition, transforms. No DOM here, so it can be tested in Node.
//
// A stroke is a plain object (never edited in place, only replaced):
//   pen / hl : { t, c, w, pts:[x0,y0,x1,y1,...], pr?:[p0,p1,...] }   freehand (pr = pen pressure per point)
//   line / arrow : { t, c, w, a:[x,y], b:[x,y] }
//   rect / ellipse / tri / diamond : { t, c, w, a:[x,y], b:[x,y], f? }  a and b are opposite corners of the bounding box
//   poly : { t:'poly', c, w, pts, closed, f? }                         straight-edged polygon / polyline
//   text : { t:'text', c, x, y, s, size, bw, bh, bold?, bg? }          text box: (x,y) top-left, bw wide, bh tall (bg = sticky-note colour)
//   img / pdfp / media : { t, ref, x, y, w, h, ... }                    things placed on the page (picture, PDF page, video / audio card)

export const FREE = (s) => s.t === 'pen' || s.t === 'hl';
export const isObj = (s) => s.t === 'img' || s.t === 'pdfp' || s.t === 'media';
export const isInk = (s) => !isObj(s);

export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Outline of any non-text stroke as a flat list of points; closed = true when the last point joins the first. */
export function outline(s) {
  switch (s.t) {
    case 'pen': case 'hl': return { pts: s.pts, closed: false };
    case 'poly': return { pts: s.pts, closed: !!s.closed };
    case 'line': case 'arrow': return { pts: [s.a[0], s.a[1], s.b[0], s.b[1]], closed: false };
    case 'rect': {
      const [x1, y1] = s.a, [x2, y2] = s.b;
      return { pts: [x1, y1, x2, y1, x2, y2, x1, y2], closed: true };
    }
    case 'tri': {
      const x1 = Math.min(s.a[0], s.b[0]), x2 = Math.max(s.a[0], s.b[0]), y1 = Math.min(s.a[1], s.b[1]), y2 = Math.max(s.a[1], s.b[1]);
      return { pts: [(x1 + x2) / 2, y1, x2, y2, x1, y2], closed: true };
    }
    case 'diamond': {
      const x1 = Math.min(s.a[0], s.b[0]), x2 = Math.max(s.a[0], s.b[0]), y1 = Math.min(s.a[1], s.b[1]), y2 = Math.max(s.a[1], s.b[1]);
      return { pts: [(x1 + x2) / 2, y1, x2, (y1 + y2) / 2, (x1 + x2) / 2, y2, x1, (y1 + y2) / 2], closed: true };
    }
    case 'ellipse': {
      const cx = (s.a[0] + s.b[0]) / 2, cy = (s.a[1] + s.b[1]) / 2, rx = Math.abs(s.b[0] - s.a[0]) / 2, ry = Math.abs(s.b[1] - s.a[1]) / 2;
      const n = 72, out = [];
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a)); }
      return { pts: out, closed: true };
    }
    default: return { pts: [], closed: false };
  }
}

const BB = new WeakMap();
/** Bounding box [x1,y1,x2,y2]; strokes are never edited in place, so it is computed once per stroke (do not modify the result). */
export function bbox(s) {
  let b = BB.get(s);
  if (!b) { b = computeBBox(s); BB.set(s, b); }
  return b;
}

function computeBBox(s) {
  if (s.t === 'text') return [s.x, s.y, s.x + s.bw, s.y + s.bh];
  if (isObj(s)) return [s.x, s.y, s.x + s.w, s.y + s.h];
  const { pts } = outline(s);
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i] < a) a = pts[i]; if (pts[i] > c) c = pts[i];
    if (pts[i + 1] < b) b = pts[i + 1]; if (pts[i + 1] > d) d = pts[i + 1];
  }
  const pad = (s.w || 0) / 2 + (s.t === 'arrow' ? (s.w || 2) * 4 : 0);
  return [a - pad, b - pad, c + pad, d + pad];
}

export const bboxHit = (b, x1, y1, x2, y2) => !(b[2] < x1 || b[0] > x2 || b[3] < y1 || b[1] > y2);

function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Does a circle at (x,y) with radius r touch this stroke? */
export function hitStroke(s, x, y, r) {
  if (s.t === 'text' || isObj(s)) {
    const b = bbox(s);
    return x >= b[0] - r && x <= b[2] + r && y >= b[1] - r && y <= b[3] + r;
  }
  const b = bbox(s);
  if (x < b[0] - r || x > b[2] + r || y < b[1] - r || y > b[3] + r) return false;
  const { pts, closed } = outline(s);
  const reach = r + (s.w || 0) / 2;
  if (pts.length === 2) return Math.hypot(x - pts[0], y - pts[1]) <= reach;
  const n = pts.length / 2;
  for (let i = 0; i < n - 1; i++) if (segDist(x, y, pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3]) <= reach) return true;
  if (closed && segDist(x, y, pts[pts.length - 2], pts[pts.length - 1], pts[0], pts[1]) <= reach) return true;
  if (closed && s.f && pointInPoly(x, y, pts)) return true;
  return false;
}

/**
 * Removes the part of a stroke covered by a circle. Returns null when nothing was touched,
 * [] when the whole stroke is gone, or the pieces that are left (shapes become freehand pieces).
 */
export function eraseFromStroke(s, cx, cy, r) {
  if (s.t === 'text' || isObj(s)) return null;
  const b = bbox(s);
  if (cx < b[0] - r || cx > b[2] + r || cy < b[1] - r || cy > b[3] + r) return null;
  const rr = r + (s.w || 1) * 0.25;
  const o = outline(s);
  let pts = o.pts;
  let pr = FREE(s) ? s.pr : null;
  if (o.closed) { pts = pts.concat([pts[0], pts[1]]); pr = null; }
  const n = pts.length / 2;
  if (n === 1) return Math.hypot(cx - pts[0], cy - pts[1]) <= rr ? [] : null;

  const runs = [];
  let cur = null;
  let touched = false;
  const push = (run, x, y, p) => { run.p.push(x, y); if (run.r) run.r.push(p); };
  const fresh = () => ({ p: [], r: pr ? [] : null });
  for (let i = 0; i < n - 1; i++) {
    const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[i * 2 + 2], by = pts[i * 2 + 3];
    const pa = pr ? pr[i] : 0, pb = pr ? pr[i + 1] : 0;
    const dx = bx - ax, dy = by - ay;
    const fx = ax - cx, fy = ay - cy;
    const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - rr * rr;
    let t0 = 1, t1 = 0, hit = false;
    if (A === 0) { hit = C <= 0; if (hit) { t0 = 0; t1 = 1; } }
    else {
      const disc = B * B - 4 * A * C;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        const u0 = (-B - sq) / (2 * A), u1 = (-B + sq) / (2 * A);
        if (u1 >= 0 && u0 <= 1) { hit = true; t0 = Math.max(0, u0); t1 = Math.min(1, u1); }
      }
    }
    const lerp = (t) => [ax + dx * t, ay + dy * t, pr ? pa + (pb - pa) * t : 0];
    if (!hit) {
      if (!cur) { cur = fresh(); push(cur, ax, ay, pa); }
      push(cur, bx, by, pb);
      continue;
    }
    touched = true;
    if (t0 > 0) {
      if (!cur) { cur = fresh(); push(cur, ax, ay, pa); }
      const q = lerp(t0); push(cur, q[0], q[1], q[2]);
    }
    if (cur) { runs.push(cur); cur = null; }
    if (t1 < 1) {
      const q = lerp(t1);
      cur = fresh(); push(cur, q[0], q[1], q[2]); push(cur, bx, by, pb);
    }
  }
  if (cur) runs.push(cur);
  if (!touched) return null;

  const out = [];
  for (const run of runs) {
    let len = 0;
    for (let i = 0; i + 3 < run.p.length; i += 2) len += Math.hypot(run.p[i + 2] - run.p[i], run.p[i + 3] - run.p[i + 1]);
    if (run.p.length < 4 || len < 0.4) continue;
    const piece = { t: s.t === 'hl' ? 'hl' : 'pen', c: s.c, w: s.w, pts: run.p.map(round1) };
    if (run.r) piece.pr = run.r.map(round2);
    out.push(piece);
  }
  return out;
}

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

/** Returns a copy of the stroke with every point mapped through fn(x, y) -> [x, y]; k scales sizes (text). */
export function mapStroke(s, fn, k = 1) {
  const m = (p) => fn(p[0], p[1]);
  switch (s.t) {
    case 'pen': case 'hl': case 'poly': {
      const pts = new Array(s.pts.length);
      for (let i = 0; i < s.pts.length; i += 2) { const q = fn(s.pts[i], s.pts[i + 1]); pts[i] = round1(q[0]); pts[i + 1] = round1(q[1]); }
      return { ...s, pts };
    }
    case 'text': {
      const q = fn(s.x, s.y);
      return { ...s, x: round1(q[0]), y: round1(q[1]), size: round1(s.size * k), bw: round1(s.bw * k), bh: round1(s.bh * k) };
    }
    case 'img': case 'pdfp': case 'media': {
      const q = fn(s.x, s.y);
      return { ...s, x: round1(q[0]), y: round1(q[1]), w: round1(s.w * k), h: round1(s.h * k) };
    }
    default: return { ...s, a: m(s.a).map(round1), b: m(s.b).map(round1) };
  }
}

export const moveStroke = (s, dx, dy) => mapStroke(s, (x, y) => [x + dx, y + dy]);
export const scaleStroke = (s, ox, oy, k) => mapStroke(s, (x, y) => [ox + (x - ox) * k, oy + (y - oy) * k], k);

export function unionBox(list) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const s of list) { const q = bbox(s); a = Math.min(a, q[0]); b = Math.min(b, q[1]); c = Math.max(c, q[2]); d = Math.max(d, q[3]); }
  return [a, b, c, d];
}

/* ---------------- shape recognition ---------------- */
function pathLength(pts) {
  let l = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) l += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  return l;
}

function rdp(pts, eps) {
  const n = pts.length / 2;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let far = -1, fd = 0;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(pts[k * 2], pts[k * 2 + 1], pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1]);
      if (d > fd) { fd = d; far = k; }
    }
    if (far > 0 && fd > eps) { keep[far] = 1; stack.push([i, far], [far, j]); }
  }
  const out = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(pts[k * 2], pts[k * 2 + 1]);
  return out;
}

const angleAt = (p, q, r) => {
  const a1 = Math.atan2(p[1] - q[1], p[0] - q[0]), a2 = Math.atan2(r[1] - q[1], r[0] - q[0]);
  let d = Math.abs(a1 - a2);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return (d * 180) / Math.PI;
};

/**
 * Looks at a hand-drawn path and returns the shape it was meant to be:
 *   { t:'line', a, b } | { t:'ellipse', a, b } | { t:'rect', a, b } | { t:'poly', pts, closed:true } | null
 * Scribbles and anything unsure return null, so nothing is ever "corrected" by accident.
 */
export function recognize(pts) {
  const n = pts.length / 2;
  if (n < 4) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x1 = Math.min(x1, pts[i]); x2 = Math.max(x2, pts[i]); y1 = Math.min(y1, pts[i + 1]); y2 = Math.max(y2, pts[i + 1]);
  }
  const bw = x2 - x1, bh = y2 - y1, diag = Math.hypot(bw, bh);
  const L = pathLength(pts);
  if (L < 40 || diag < 34) return null;
  const sx = pts[0], sy = pts[1], ex = pts[pts.length - 2], ey = pts[pts.length - 1];
  const gap = Math.hypot(ex - sx, ey - sy);

  // straight line: every point stays close to the chord, and the path doesn't double back
  if (gap > 0.7 * L) {
    let dev = 0;
    for (let i = 0; i < n; i++) dev = Math.max(dev, segDist(pts[i * 2], pts[i * 2 + 1], sx, sy, ex, ey));
    if (dev <= Math.max(2.5, gap * 0.055)) return { t: 'line', a: [round1(sx), round1(sy)], b: [round1(ex), round1(ey)] };
    return null;
  }
  // a closed shape: the end meets the start, and the path isn't just a loop around nothing
  if (gap > 0.28 * diag || L < 1.6 * diag * 0.8) return null;
  if (bw < 8 || bh < 8) return null;

  // ellipse / circle: normalised radius stays near 1 all the way round
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = bw / 2, ry = bh / 2;
  let mean = 0, sq = 0;
  for (let i = 0; i < n; i++) {
    const q = Math.sqrt(((pts[i * 2] - cx) / rx) ** 2 + ((pts[i * 2 + 1] - cy) / ry) ** 2);
    mean += q; sq += q * q;
  }
  mean /= n; sq = sq / n - mean * mean;
  const std = Math.sqrt(Math.max(0, sq));
  if (std < 0.085 && mean > 0.88 && mean < 1.12) {
    const ratio = bw / bh;
    if (ratio > 0.86 && ratio < 1.16) {
      const d = (bw + bh) / 2;
      return { t: 'ellipse', a: [round1(cx - d / 2), round1(cy - d / 2)], b: [round1(cx + d / 2), round1(cy + d / 2)] };
    }
    return { t: 'ellipse', a: [round1(x1), round1(y1)], b: [round1(x2), round1(y2)] };
  }

  // polygon: simplify the closed path to its corners
  let v = rdp(pts, Math.max(3, diag * 0.075));
  let k = v.length / 2;
  if (k > 3 && Math.hypot(v[0] - v[v.length - 2], v[1] - v[v.length - 1]) < diag * 0.25) { v = v.slice(0, v.length - 2); k--; }
  if (k < 3 || k > 6) return null;
  const P = [];
  for (let i = 0; i < k; i++) P.push([v[i * 2], v[i * 2 + 1]]);
  // every side must be a real side, not a stub
  for (let i = 0; i < k; i++) { const a = P[i], b = P[(i + 1) % k]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < diag * 0.14) return null; }
  if (k === 4) {
    const ang = P.map((p, i) => angleAt(P[(i + 3) % 4], p, P[(i + 1) % 4]));
    if (ang.every((a) => a > 72 && a < 108)) {
      const flat = P.every((p, i) => {
        const q = P[(i + 1) % 4];
        const a = Math.abs((Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI) % 90;
        return a < 12 || a > 78;
      });
      if (flat) return { t: 'rect', a: [round1(x1), round1(y1)], b: [round1(x2), round1(y2)] };
    }
  }
  return { t: 'poly', closed: true, pts: P.flat().map(round1) };
}
