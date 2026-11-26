// Pen path helpers shared by the writing filter (ink.js) and the renderer (render.js). Pure geometry, no DOM.

/**
 * Indices of the TRUE corners of a flat [x0,y0,x1,y1,…] path: points where the hand really turned sharply.
 * The turn is measured over a span (not between two neighbouring samples), so digitiser jitter on a slow, dense stroke is never mistaken for a corner.
 * span: world units to look back / ahead · deg: smallest turn that counts.
 */
export function cornerSet(p, span = 3, deg = 50) {
  const n = p.length >> 1, out = new Set();
  if (n < 3) return out;
  const cosT = Math.cos((deg * Math.PI) / 180), s2 = span * span;
  for (let i = 1; i < n - 1; i++) {
    const x = p[2 * i], y = p[2 * i + 1];
    // back / ahead: the closest point that is at least `span` away (or the end of the path) – the same answer however much of the path exists beyond it
    let jb = i - 1; while (jb > 0 && (p[2 * jb] - x) ** 2 + (p[2 * jb + 1] - y) ** 2 < s2) jb--;
    let jf = i + 1; while (jf < n - 1 && (p[2 * jf] - x) ** 2 + (p[2 * jf + 1] - y) ** 2 < s2) jf++;
    const ax = x - p[2 * jb], ay = y - p[2 * jb + 1], bx = p[2 * jf] - x, by = p[2 * jf + 1] - y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) continue;
    // an end that is only reached by running out of path (a short tail) is not a corner
    if (la < span * 0.5 || lb < span * 0.5) continue;
    if ((ax * bx + ay * by) / (la * lb) < cosT) out.add(i);
  }
  // one corner per turn: of neighbouring hits keep the sharpest
  if (out.size > 1) {
    const list = [...out].sort((a, b) => a - b), keep = new Set();
    const ang = (i) => { const jbk = Math.max(0, i - 1), jfk = Math.min(n - 1, i + 1); const ax = p[2 * i] - p[2 * jbk], ay = p[2 * i + 1] - p[2 * jbk + 1], bx = p[2 * jfk] - p[2 * i], by = p[2 * jfk + 1] - p[2 * i + 1]; const m = Math.hypot(ax, ay) * Math.hypot(bx, by); return m > 1e-9 ? (ax * bx + ay * by) / m : 1; };
    let run = [list[0]];
    const flush = () => { let best = run[0], bv = ang(best); for (const i of run) { const v = ang(i); if (v < bv) { bv = v; best = i; } } keep.add(best); };
    for (let k = 1; k < list.length; k++) { if (list[k] - run[run.length - 1] <= 2) run.push(list[k]); else { flush(); run = [list[k]]; } }
    flush();
    return keep;
  }
  return out;
}
