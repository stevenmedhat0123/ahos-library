// Smart handwriting – pure geometry (no DOM), so it can be tested in Node.
// Takes the raw path of a pen / finger and returns a cleaner one WITHOUT changing the person's style:
//   · even spacing + de-jitter (small Gaussian smoothing),
//   · real corners are kept sharp (an "A" keeps its apex, a "L" its corner),
//   · pieces that were meant to be straight are made straight, and two straight pieces meet at their true corner,
//   · width follows the speed of the hand a little (slower = a bit thicker) and the ends taper, like a real pen.
// levels:  precise = YOUR path, only the digitiser's jitter taken out (nothing reshaped) · natural = only de-jitter · smart = + sharp corners + straight pieces · neat = the same, stronger.

import { cornerSet } from './path.js';

export const LEVELS = ['off', 'precise', 'natural', 'smart', 'neat'];

const PARAMS = {
  natural: { sigma: 1.0, corner: 60, straight: 0, snap: 0, amp: 0.12 },
  smart: { sigma: 1.6, corner: 48, straight: 0.04, snap: 4, amp: 0.2 },
  neat: { sigma: 2.4, corner: 44, straight: 0.065, snap: 6, amp: 0.2 },
};
const STEP_PX = 1.5; // spacing of the cleaned path, in screen pixels
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r2 = (v) => Math.round(v * 100) / 100;

/** Evenly spaced copy of the polyline; extra channels (time, pressure) are interpolated along. Always keeps the true first and last point. */
function resample(raw, chans, step) {
  const n = raw.length >> 1;
  const out = [raw[0], raw[1]];
  const ch = chans.map((c) => [c ? c[0] : 0]);
  let carry = 0, px = raw[0], py = raw[1];
  let pc = chans.map((c) => (c ? c[0] : 0));
  for (let i = 1; i < n; i++) {
    const x = raw[2 * i], y = raw[2 * i + 1];
    const cc = chans.map((c) => (c ? c[i] : 0));
    const dx = x - px, dy = y - py, len = Math.hypot(dx, dy);
    if (len < 1e-9) { pc = cc; continue; }
    let pos = 0;
    while (carry + (len - pos) >= step) {
      pos += step - carry; carry = 0;
      const f = pos / len;
      out.push(px + dx * f, py + dy * f);
      for (let k = 0; k < ch.length; k++) ch[k].push(pc[k] + (cc[k] - pc[k]) * f);
    }
    carry += len - pos;
    px = x; py = y; pc = cc;
  }
  const lx = raw[2 * n - 2], ly = raw[2 * n - 1], m = out.length >> 1;
  if (Math.hypot(out[2 * m - 2] - lx, out[2 * m - 1] - ly) > step * 0.35) {
    out.push(lx, ly);
    for (let k = 0; k < ch.length; k++) ch[k].push(chans[k] ? chans[k][n - 1] : 0);
  } else { out[2 * m - 2] = lx; out[2 * m - 1] = ly; }
  return { pts: out, ch };
}

/**
 * Fingers and fast pens give points several pixels apart, so a curve arrives as a polygon. Fill the gaps with a smooth curve
 * through the points – except at sharp turns (>= CORNER_IN degrees), where the path is kept straight so corners stay sharp.
 */
const CORNER_IN = 62;
function densify(raw, chans, maxGap) {
  const n = raw.length >> 1;
  const out = [], ch = chans.map(() => []);
  const dir = (i, side) => { // unit direction of the path at point i; side -1 = arriving, +1 = leaving
    const prv = i > 0 ? i - 1 : i, nxt = i < n - 1 ? i + 1 : i;
    let ax = raw[2 * i] - raw[2 * prv], ay = raw[2 * i + 1] - raw[2 * prv + 1];
    let bx = raw[2 * nxt] - raw[2 * i], by = raw[2 * nxt + 1] - raw[2 * i + 1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (!la || !lb) { const l = la || lb || 1; return [(la ? ax : bx) / l, (la ? ay : by) / l]; }
    ax /= la; ay /= la; bx /= lb; by /= lb;
    const turn = Math.acos(clamp(ax * bx + ay * by, -1, 1)) * 57.29578;
    if (turn >= CORNER_IN) return side < 0 ? [ax, ay] : [bx, by];
    const sx = ax + bx, sy = ay + by, l = Math.hypot(sx, sy) || 1;
    return [sx / l, sy / l];
  };
  for (let i = 0; i < n - 1; i++) {
    const x0 = raw[2 * i], y0 = raw[2 * i + 1], x1 = raw[2 * i + 2], y1 = raw[2 * i + 3];
    out.push(x0, y0);
    for (let k = 0; k < ch.length; k++) ch[k].push(chans[k] ? chans[k][i] : 0);
    const L = Math.hypot(x1 - x0, y1 - y0);
    if (L <= maxGap) continue;
    const m = Math.ceil(L / maxGap), d0 = dir(i, 1), d1 = dir(i + 1, -1);
    for (let j = 1; j < m; j++) {
      const u = j / m, u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      out.push(h00 * x0 + h10 * d0[0] * L + h01 * x1 + h11 * d1[0] * L, h00 * y0 + h10 * d0[1] * L + h01 * y1 + h11 * d1[1] * L);
      for (let k = 0; k < ch.length; k++) ch[k].push(chans[k] ? chans[k][i] + (chans[k][i + 1] - chans[k][i]) * u : 0);
    }
  }
  out.push(raw[2 * n - 2], raw[2 * n - 1]);
  for (let k = 0; k < ch.length; k++) ch[k].push(chans[k] ? chans[k][n - 1] : 0);
  return { pts: out, ch };
}

/** [1 2 1] smoothing, ends pinned. a = flat array, returns a new array. */
function smooth(a, passes) {
  const m = a.length >> 1;
  if (m < 3) return a.slice();
  let cur = a.slice(), nxt = a.slice();
  for (let k = 0; k < passes; k++) {
    for (let i = 1; i < m - 1; i++) {
      nxt[2 * i] = (cur[2 * i - 2] + 2 * cur[2 * i] + cur[2 * i + 2]) / 4;
      nxt[2 * i + 1] = (cur[2 * i - 1] + 2 * cur[2 * i + 1] + cur[2 * i + 3]) / 4;
    }
    [cur, nxt] = [nxt, cur];
  }
  return cur;
}
function smooth1(a, passes) { // same for a single-channel array
  const m = a.length;
  if (m < 3) return a.slice();
  let cur = a.slice(), nxt = a.slice();
  for (let k = 0; k < passes; k++) {
    for (let i = 1; i < m - 1; i++) nxt[i] = (cur[i - 1] + 2 * cur[i] + cur[i + 1]) / 4;
    [cur, nxt] = [nxt, cur];
  }
  return cur;
}

/** Indices of sharp turns: the direction change between the paths k points before and k points after, as a local maximum above thr degrees. */
function findCorners(p, k, thr) {
  const m = p.length >> 1, ang = new Float32Array(m);
  for (let i = k; i < m - k; i++) {
    const ax = p[2 * i] - p[2 * (i - k)], ay = p[2 * i + 1] - p[2 * (i - k) + 1];
    const bx = p[2 * (i + k)] - p[2 * i], by = p[2 * (i + k) + 1] - p[2 * i + 1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) continue;
    ang[i] = Math.acos(clamp((ax * bx + ay * by) / (la * lb), -1, 1)) * 57.29578;
  }
  const out = [];
  for (let i = k; i < m - k; i++) {
    if (ang[i] < thr) continue;
    let top = true;
    for (let j = Math.max(k, i - k); j <= Math.min(m - 1 - k, i + k); j++) if (ang[j] > ang[i] || (ang[j] === ang[i] && j < i)) { top = false; break; }
    if (top) out.push(i);
  }
  return out;
}

/** Least-squares line through the points (flat array), oriented from the first to the last. Returns { cx, cy, dx, dy } (unit direction). */
function fitLine(a, from, to) {
  let sx = 0, sy = 0, n = 0;
  for (let i = from; i <= to; i++) { sx += a[2 * i]; sy += a[2 * i + 1]; n++; }
  const cx = sx / n, cy = sy / n;
  let xx = 0, yy = 0, xy = 0;
  for (let i = from; i <= to; i++) { const x = a[2 * i] - cx, y = a[2 * i + 1] - cy; xx += x * x; yy += y * y; xy += x * y; }
  const th = 0.5 * Math.atan2(2 * xy, xx - yy);
  let dx = Math.cos(th), dy = Math.sin(th);
  const ex = a[2 * to] - a[2 * from], ey = a[2 * to + 1] - a[2 * from + 1];
  if (dx * ex + dy * ey < 0) { dx = -dx; dy = -dy; }
  return { cx, cy, dx, dy };
}
const onLine = (l, x, y) => { const t = (x - l.cx) * l.dx + (y - l.cy) * l.dy; return [l.cx + l.dx * t, l.cy + l.dy * t]; };
function meet(l1, l2) {
  const det = l1.dx * l2.dy - l1.dy * l2.dx;
  if (Math.abs(det) < 0.2) return null; // nearly parallel
  const t = ((l2.cx - l1.cx) * l2.dy - (l2.cy - l1.cy) * l2.dx) / det;
  return [l1.cx + l1.dx * t, l1.cy + l1.dy * t];
}

/**
 * Precise writing: exactly the path that was drawn. Near-duplicate samples are dropped, one light [1 2 1] pass takes the digitiser's
 * jitter out, and every true corner is pinned (never rounded). No resampling, no invented curves, no straightening, no speed tricks.
 * Returns { pts, pr?, ts? } – pr / ts only when given (they are kept in step with the points that are left).
 */
export function precisePath(raw, pr0, ts0, s) {
  const n0 = raw.length >> 1;
  if (n0 < 2) return null;
  const minD = 0.5 / (s || 1), min2 = minD * minD;
  const keep = [0];
  for (let i = 1; i < n0; i++) {
    const k = keep[keep.length - 1], dx = raw[2 * i] - raw[2 * k], dy = raw[2 * i + 1] - raw[2 * k + 1];
    if (dx * dx + dy * dy >= min2) keep.push(i);
  }
  const lastI = n0 - 1;
  if (keep[keep.length - 1] !== lastI) {
    // the true last sample ends the stroke; it replaces a kept one that is nearly the same place
    const k = keep[keep.length - 1], dx = raw[2 * lastI] - raw[2 * k], dy = raw[2 * lastI + 1] - raw[2 * k + 1];
    if (keep.length > 1 && dx * dx + dy * dy < min2 * 4) keep[keep.length - 1] = lastI; else keep.push(lastI);
  }
  const m = keep.length;
  const p = new Array(2 * m);
  for (let j = 0; j < m; j++) { p[2 * j] = raw[2 * keep[j]]; p[2 * j + 1] = raw[2 * keep[j] + 1]; }
  const out = p.slice();
  if (m >= 4) {
    const cr = cornerSet(p, Math.max(2, 3 / (s || 1)) , 50);
    for (let j = 1; j < m - 1; j++) {
      if (cr.has(j)) continue;
      out[2 * j] = (p[2 * j - 2] + 2 * p[2 * j] + p[2 * j + 2]) / 4;
      out[2 * j + 1] = (p[2 * j - 1] + 2 * p[2 * j + 1] + p[2 * j + 3]) / 4;
    }
  }
  const res = { pts: out.map(r2) };
  if (pr0) { const a = keep.map((i) => pr0[i]); res.pr = smooth1(a, 1).map(r2); }
  if (ts0) res.ts = keep.map((i) => ts0[i]);
  return res;
}

/**
 * Old-fashioned ink pen: the width follows the speed of the hand (slow = full, fast = thin) with soft tapered ends; a real stylus pressure wins.
 * pts: flat path · ts: ms per point (or null) · pr0: real pressure per point (or null) · s: screen px per page unit
 * Returns pr[] (0..1, in the same scale the other pens use: width = w * (0.4 + 1.2 * pr)).
 */
export function inkPr(pts, ts, pr0, s) {
  const n = pts.length >> 1;
  const out = new Array(n);
  const sc = s || 1;
  if (pr0 && pr0.length === n) { const a = smooth1(pr0, 3); for (let i = 0; i < n; i++) out[i] = r2(clamp(a[i], 0.05, 1)); return out; }
  let total = 0; const cum = new Array(n); cum[0] = 0;
  for (let i = 1; i < n; i++) { total += Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]); cum[i] = total; }
  const lenPx = total * sc;
  const v = new Array(n).fill(0.6);
  if (ts && ts.length === n) {
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 3), b = Math.min(n - 1, i + 3);
      const dt = Math.max(1, ts[b] - ts[a]);
      v[i] = ((cum[b] - cum[a]) * sc) / dt;     // screen px per ms
    }
  }
  const sv = smooth1(v, 5);
  const T = Math.min(14, lenPx * 0.3);
  for (let i = 0; i < n; i++) {
    let f = 1.18 - 0.62 * clamp(sv[i] / 2.0, 0, 1);                     // 1.18 slow … 0.56 fast
    if (lenPx > 10) {
      const d = cum[i] * sc, u0 = clamp(d / T, 0, 1), u1 = clamp((lenPx - d) / T, 0, 1);
      f *= 0.55 + 0.45 * (u0 * u0 * (3 - 2 * u0));
      f *= 0.5 + 0.5 * (u1 * u1 * (3 - 2 * u1));
    }
    out[i] = r2(clamp((f - 0.4) / 1.2, 0.05, 1));
  }
  return out;
}

/**
 * raw: [x0,y0,x1,y1,…] in page units · ts: time of each point in ms or null · pr0: real pen pressure per point or null
 * o: { level, s (screen pixels per page unit), w (pen width in page units), hl (highlighter) }
 * → { pts, pr? } or null when the stroke is too short / the level is off (keep the raw stroke then).
 */
export function beautify(raw, ts, pr0, o) {
  if (o.level === 'precise') return precisePath(raw, pr0 && pr0.length === (raw.length >> 1) ? pr0 : null, null, o.s);
  const PA = PARAMS[o.level];
  if (!PA) return null;
  const s = o.s || 1, w = o.w || 3, hl = !!o.hl;
  const n0 = raw.length >> 1;
  if (n0 < 3) return null;
  let total = 0;
  for (let i = 1; i < n0; i++) total += Math.hypot(raw[2 * i] - raw[2 * i - 2], raw[2 * i + 1] - raw[2 * i - 1]);
  if (total * s < 5) return null;
  let step = STEP_PX / s;
  if (total / step > 3500) step = total / 3500;
  const useTs = !!ts && ts.length === n0, usePr = !!pr0 && pr0.length === n0;
  const dn = densify(raw, [useTs ? ts : null, usePr ? pr0 : null], 2.5 / s);
  const rs = resample(dn.pts, dn.ch.map((c, k) => (k === 0 ? (useTs ? c : null) : (usePr ? c : null))), step);
  let p = rs.pts;
  const m = p.length >> 1;
  if (m < 4) return null;
  const stepPx = step * s;

  // corners (looked for on a lightly smoothed copy, so jitter is not mistaken for a turn)
  const k = Math.max(2, Math.round(clamp(2.2 * w * s, 4.5, 9) / stepPx));
  const corners = m > 2 * k + 1 ? findCorners(smooth(p, 2), k, PA.corner) : [];
  const idx = [0, ...corners, m - 1];

  // smooth each piece between corners
  const passes = Math.max(1, Math.round(2 * (PA.sigma / stepPx) ** 2));
  const segs = [];
  for (let j = 0; j < idx.length - 1; j++) {
    const sg = smooth(p.slice(2 * idx[j], 2 * idx[j + 1] + 2), passes), c = sg.length >> 1;
    // the loose ends of the stroke follow the line of the smoothed path instead of keeping the tremor of the very first / last sample
    if (c >= 6) {
      if (j === 0) { sg[0] = 0.4 * sg[0] + 0.6 * (2 * sg[2] - sg[4]); sg[1] = 0.4 * sg[1] + 0.6 * (2 * sg[3] - sg[5]); }
      if (j === idx.length - 2) { const e = 2 * c - 2; sg[e] = 0.4 * sg[e] + 0.6 * (2 * sg[e - 2] - sg[e - 4]); sg[e + 1] = 0.4 * sg[e + 1] + 0.6 * (2 * sg[e - 1] - sg[e - 3]); }
    }
    segs.push(sg);
  }

  // straight pieces
  const straight = new Array(segs.length).fill(null);
  if (PA.straight > 0) {
    for (let j = 0; j < segs.length; j++) {
      const a = segs[j], c = a.length >> 1;
      if (c < 4) continue;
      const ax = a[0], ay = a[1], bx = a[2 * c - 2], by = a[2 * c - 1];
      const L = Math.hypot(bx - ax, by - ay);
      if (L * s < 14) continue;
      let path = 0, dev = 0;
      for (let i = 1; i < c; i++) path += Math.hypot(a[2 * i] - a[2 * i - 2], a[2 * i + 1] - a[2 * i - 1]);
      for (let i = 1; i < c - 1; i++) dev = Math.max(dev, Math.abs((a[2 * i] - ax) * (by - ay) - (a[2 * i + 1] - ay) * (bx - ax)) / L);
      if (dev / L <= PA.straight && dev * s <= 9 && path / L <= 1.1) {
        const lo = Math.floor(c * 0.15), hi = Math.max(lo + 2, Math.ceil(c * 0.85) - 1);
        straight[j] = fitLine(a, lo, Math.min(c - 1, hi));
      }
    }
  }
  // ends of the pieces: two straight pieces meet at the true corner; a free end is moved onto its line
  const ends = idx.map((_, j) => null); // new position of the point idx[j]
  const maxMove = 7 / s;
  for (let j = 0; j < idx.length; j++) {
    const before = straight[j - 1] || null, after = straight[j] || null;
    const at = j === 0 ? [segs[0][0], segs[0][1]] : [segs[j - 1][segs[j - 1].length - 2], segs[j - 1][segs[j - 1].length - 1]];
    if (j === 0 || j === idx.length - 1) {
      const l = j === 0 ? after : before;
      if (l) { const q = onLine(l, at[0], at[1]); if (Math.hypot(q[0] - at[0], q[1] - at[1]) <= maxMove) ends[j] = q; }
    } else if (before && after) {
      const q = meet(before, after);
      if (q && Math.hypot(q[0] - at[0], q[1] - at[1]) <= maxMove) ends[j] = q;
    }
  }
  // assemble
  const out = [];
  const cornerAt = []; // indices (in out) of the sharp corners
  for (let j = 0; j < segs.length; j++) {
    const a = segs[j], c = a.length >> 1;
    const sa = ends[j] || [a[0], a[1]], sb = ends[j + 1] || [a[2 * c - 2], a[2 * c - 1]];
    const from = j === 0 ? 0 : 1; // the first point of a piece is the last of the previous one
    for (let i = from; i < c; i++) {
      let x, y;
      if (straight[j]) { const f = i / (c - 1); x = sa[0] + (sb[0] - sa[0]) * f; y = sa[1] + (sb[1] - sa[1]) * f; }
      else if (i === 0) { x = sa[0]; y = sa[1]; } else if (i === c - 1) { x = sb[0]; y = sb[1]; } else { x = a[2 * i]; y = a[2 * i + 1]; }
      if (i === 0 && j > 0) continue;
      out.push(x, y);
    }
    if (j < segs.length - 1) cornerAt.push((out.length >> 1) - 1);
  }
  // a stroke that is one single straight piece snaps to horizontal / vertical when it is nearly so
  if (PA.snap > 0 && segs.length === 1 && straight[0]) {
    const c = out.length >> 1, ax = out[0], ay = out[1], bx = out[2 * c - 2], by = out[2 * c - 1];
    const deg = Math.atan2(by - ay, bx - ax) * 57.29578;
    const q = Math.round(deg / 90) * 90, d = Math.abs(deg - q);
    if (d > 0 && d <= PA.snap) {
      const cx = (ax + bx) / 2, cy = (ay + by) / 2, rot = (q - deg) / 57.29578, co = Math.cos(rot), si = Math.sin(rot);
      for (let i = 0; i < c; i++) { const x = out[2 * i] - cx, y = out[2 * i + 1] - cy; out[2 * i] = cx + x * co - y * si; out[2 * i + 1] = cy + x * si + y * co; }
    }
  }
  const cnt = out.length >> 1;

  // width: real pressure when the pen has it, otherwise a little from the speed of the hand, with tapered ends
  let pr = null;
  if (!hl) {
    if (usePr) pr = smooth1(rs.ch[1], 2);
    else if (useTs && PA.amp > 0) {
      const tt = rs.ch[0], v = new Array(cnt);
      for (let i = 0; i < cnt; i++) {
        const a = Math.max(0, i - 2), b = Math.min(cnt - 1, i + 2);
        const dt = Math.max(1, tt[Math.min(b, tt.length - 1)] - tt[Math.min(a, tt.length - 1)]);
        v[i] = Math.hypot(out[2 * b] - out[2 * a], out[2 * b + 1] - out[2 * a + 1]) * s / dt;
      }
      const sv = smooth1(v, 4);
      pr = new Array(cnt);
      const lenPx = total * s, T = Math.min(9, lenPx * 0.22);
      let dist = 0;
      for (let i = 0; i < cnt; i++) {
        if (i) dist += Math.hypot(out[2 * i] - out[2 * i - 2], out[2 * i + 1] - out[2 * i - 1]) * s;
        let f = 1.05 - PA.amp * clamp(sv[i] / 1.8, 0, 1);
        if (lenPx > 16) {
          const u0 = clamp(dist / T, 0, 1), u1 = clamp((lenPx - dist) / T, 0, 1);
          f *= 0.68 + 0.32 * (u0 * u0 * (3 - 2 * u0));
          f *= 0.58 + 0.42 * (u1 * u1 * (3 - 2 * u1));
        }
        pr[i] = clamp((f - 0.4) / 1.2, 0.04, 1);
      }
    }
  }

  // sharp corners survive the curve drawing: the corner point gets two neighbours very close to it
  const eps = clamp(0.3 * w, 0.25, 0.6 * step);
  const res = [], rp = pr ? [] : null;
  const isCorner = new Set(cornerAt);
  for (let i = 0; i < cnt; i++) {
    const x = out[2 * i], y = out[2 * i + 1];
    if (isCorner.has(i) && i > 0 && i < cnt - 1) {
      let ux = x - out[2 * i - 2], uy = y - out[2 * i - 1], vx = out[2 * i + 2] - x, vy = out[2 * i + 3] - y;
      const lu = Math.hypot(ux, uy) || 1, lv = Math.hypot(vx, vy) || 1;
      ux /= lu; uy /= lu; vx /= lv; vy /= lv;
      res.push(r2(x - ux * eps), r2(y - uy * eps), r2(x), r2(y), r2(x + vx * eps), r2(y + vy * eps));
      if (rp) rp.push(r2(pr[i]), r2(pr[i]), r2(pr[i]));
    } else { res.push(r2(x), r2(y)); if (rp) rp.push(r2(pr[i])); }
  }
  return rp ? { pts: res, pr: rp } : { pts: res };
}
