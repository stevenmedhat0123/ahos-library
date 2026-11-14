// Draws a book that lies on the board: flat ('2d') or like a real hardcover seen from above ('3d').
// Only the book is drawn here. Writing on its pages is ordinary board ink (drawn afterwards, so it is always on top).
import { bookModel, clampSp } from './bookmath.js';

export const COVER_COLORS = ['#2b3d6b', '#6b2b3a', '#1f5a46', '#4a3a2a', '#3b2b5e', '#2a2a2e', '#a3541f', '#1b6f8a'];
const PAPER = '#fbfaf6';

export const trimCrop = (tr) => (tr && (tr[0] > 0 || tr[1] > 0 || tr[2] > 0 || tr[3] > 0) ? [tr[0], tr[1], 1 - tr[2], 1 - tr[3]] : null);

function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const shade = (hex, amt) => {
  const n = parseInt((hex || '#2b3d6b').slice(1), 16), f = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

/** The page a book shows at `sp`, or `over` = [l, r] while a leaf is turning. */
export function pagesShown(b, over) {
  const m = bookModel(b.n);
  return over || m.pagesOf(clampSp(b));
}

/** page `n` of the book as a bitmap source: a PDF page, the back cover, a blank pad page or nothing yet */
function pageSource(b, n, env, pwPx) {
  const m = bookModel(b.n);
  if (n > b.n) return n === m.BK ? 'back' : 'blank';
  const bm = env.assets?.pdfPage(b.ref, n, Math.ceil(pwPx), false, trimCrop(b.trim));
  return bm || 'wait';
}

export function drawPage(ctx, src, x, y, w, h, rtl, cc, flat) {
  ctx.save();
  if (src === 'back') {
    const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, shade(cc, 14)); g.addColorStop(1, shade(cc, -26));
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = Math.max(0.6, w * 0.006); ctx.strokeRect(x + w * 0.08, y + w * 0.08, w * 0.84, h - w * 0.16);
  } else {
    ctx.fillStyle = PAPER; ctx.fillRect(x, y, w, h);
    if (src && src !== 'blank' && src !== 'wait') {
      if (rtl) { ctx.translate(x + w, 0); ctx.scale(-1, 1); ctx.drawImage(src.src, 0, y, w, h); } else ctx.drawImage(src.src, x, y, w, h);
    } else if (src === 'wait') {
      ctx.fillStyle = 'rgba(0,0,0,.06)'; ctx.fillRect(x + w * 0.12, y + h * 0.12, w * 0.76, h * 0.02); ctx.fillRect(x + w * 0.12, y + h * 0.18, w * 0.6, h * 0.02);
    }
  }
  ctx.restore();
  if (flat) { ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = Math.max(0.5, w * 0.003); ctx.strokeRect(x, y, w, h); }
}

/* ---------------- the 3D book ----------------
 * Everything that does not change while you look at the book (soft shadow, cover board with its thickness and bevel, the blocks of
 * page edges) is painted once into a small bitmap and only copied afterwards, so zooming, moving and turning stay light.
 * Only the pages themselves and the thin shading on top are drawn live. */

/** How thick the block of pages looks: a few pages is a booklet, hundreds of pages is a real block. */
export const blockThickness = (pw, n) => pw * (0.004 + 0.075 * Math.pow(Math.min(1, n / 260), 0.7));

function geometry(b, l, r) {
  const pw = b.w / 2, ph = b.h, x0 = b.x, y0 = b.y, sx = b.x + pw;
  const mg = pw * 0.035, mgb = pw * 0.05, rad = pw * 0.025, spine = pw * 0.03, cth = pw * 0.01;
  const nl = l ? Math.min(l, b.n) : 0, nr = r ? b.n - Math.min(r, b.n) + 1 : 0;
  const thk = blockThickness(pw, b.n), q = (v) => Math.round(v * 8) / 8;           // quantised, so a few pictures serve every spread
  const tl = thk * q(nl / b.n), tr = thk * q(nr / b.n);
  const both = !!(l && r), closedFront = !l, closedBack = !r;
  const bx0 = both ? x0 - mg : closedFront ? sx - spine : x0 - mg;
  const bx1 = both ? sx + pw + mg : closedFront ? sx + pw + mg : sx + spine;
  const by0 = y0 - mg, bh = ph + mg + mgb;
  return { pw, ph, x0, y0, sx, mg, mgb, rad, spine, cth, tl, tr, both, closedFront, closedBack, bx0, bx1, by0, bh, l: !!l, r: !!r };
}

/** the part that never changes while the same pages are showing: shadow, board of the cover, edges of the page blocks */
function paintUnder(ctx, g, cc) {
  const { pw, ph, x0, y0, sx, rad, cth, tl, tr, both, bx0, bx1, by0, bh } = g;
  const dark = shade(cc, -46), thk = Math.max(tl, tr);
  const W = bx1 - bx0;
  // soft shadow: a few translucent rounded rectangles instead of a blur (a blur costs far more than the whole book)
  const sdx = pw * 0.014, sdy = pw * 0.024 + thk * 0.8;
  for (let i = 5; i >= 0; i--) {
    const e = pw * 0.011 * i;
    ctx.fillStyle = `rgba(0,0,0,${(0.05 + (5 - i) * 0.011).toFixed(3)})`;
    rr(ctx, bx0 - e + sdx, by0 - e + sdy + cth, W + 2 * e, bh + 2 * e, rad + e); ctx.fill();
  }
  // the page blocks: fine edges, stepped, lighter at the top and darker towards the bottom
  const strips = (x, w, t, dir) => {
    if (t < 0.3) return;
    const n = Math.max(1, Math.min(9, Math.round(t / (pw * 0.0034))));
    ctx.lineWidth = Math.max(0.35, pw * 0.0013);
    for (let i = n; i >= 1; i--) {
      const f = i / n, ox = dir * t * 0.62 * f, oy = t * 0.8 * f;
      ctx.fillStyle = shade('#f3eedf', -Math.round(24 * f));
      rr(ctx, dir > 0 ? x : x + ox, y0, w + Math.abs(ox), ph + oy, rad * 0.4); ctx.fill();
      ctx.strokeStyle = 'rgba(95,75,45,.28)'; ctx.stroke();
    }
  };
  if (!both) { if (g.r) strips(sx, pw, tr, 1); if (g.l) strips(x0, pw, tl, -1); }     // closed: the cover lies over the pages, their edges peek out
  // the edge of the cover board, then the board itself with a light top-left and a dark bottom-right bevel
  const ed = ctx.createLinearGradient(0, by0, 0, by0 + bh + cth); ed.addColorStop(0, shade(cc, -30)); ed.addColorStop(1, dark);
  ctx.fillStyle = ed; rr(ctx, bx0, by0 + cth, W, bh, rad); ctx.fill();
  const body = ctx.createLinearGradient(bx0, by0, bx1, by0 + bh); body.addColorStop(0, shade(cc, 26)); body.addColorStop(0.5, shade(cc, -4)); body.addColorStop(1, shade(cc, -26));
  ctx.fillStyle = body; rr(ctx, bx0, by0, W, bh, rad); ctx.fill();
  const bw = Math.max(0.5, pw * 0.005);
  ctx.lineWidth = bw;
  ctx.strokeStyle = 'rgba(255,255,255,.26)'; ctx.beginPath(); ctx.moveTo(bx0 + rad, by0 + bw / 2); ctx.lineTo(bx1 - rad, by0 + bw / 2); ctx.moveTo(bx0 + bw / 2, by0 + rad); ctx.lineTo(bx0 + bw / 2, by0 + bh - rad); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,.26)'; ctx.beginPath(); ctx.moveTo(bx0 + rad, by0 + bh - bw / 2); ctx.lineTo(bx1 - rad, by0 + bh - bw / 2); ctx.moveTo(bx1 - bw / 2, by0 + rad); ctx.lineTo(bx1 - bw / 2, by0 + bh - rad); ctx.stroke();
  if (both) { strips(sx, pw, tr, 1); strips(x0, pw, tl, -1); }                        // open: the blocks of pages rest on the board
}

const SPR = new Map();      // key -> { cv, k, ox, oy, w, h }: the cached "under" pictures (a handful, most recently used last)
const SPR_MAX = 6, SPR_SIDE = 2200;
function underSprite(b, g, sc) {
  const pad = g.pw * 0.12 + Math.max(g.tl, g.tr);
  const rx = g.bx0 - pad, ry = g.by0 - pad, rw = g.bx1 - g.bx0 + 2 * pad, rh = g.bh + g.cth + 2 * pad;
  let k = Math.pow(1.6, Math.ceil(Math.log(Math.max(sc, 0.05)) / Math.log(1.6)));    // a touch sharper than needed, changes only when the zoom grows 1.6×
  const cap = SPR_SIDE / Math.max(rw, rh);
  if (cap < sc * 0.75) return null;                                               // zoomed in so far that a picture would look soft: paint live (only a part is on screen)
  k = Math.min(k, cap);
  const key = `${b.n}|${b.cc}|${Math.round(b.w * 10)}|${Math.round(b.h * 10)}|${g.l ? 1 : 0}${g.r ? 1 : 0}|${g.tl.toFixed(2)}|${g.tr.toFixed(2)}|${k.toFixed(3)}`;
  let e = SPR.get(key);
  if (e) { SPR.delete(key); SPR.set(key, e); }
  else {
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.ceil(rw * k)); cv.height = Math.max(1, Math.ceil(rh * k));
    const x = cv.getContext('2d');
    x.setTransform(k, 0, 0, k, -rx * k, -ry * k);
    paintUnder(x, g, b.cc || COVER_COLORS[0]);
    e = { cv, k, ox: rx - b.x, oy: ry - b.y, w: cv.width / k, h: cv.height / k };
    SPR.set(key, e);
    while (SPR.size > SPR_MAX) { const [k0, v] = SPR.entries().next().value; v.cv.width = v.cv.height = 0; SPR.delete(k0); }
  }
  return e;
}

export function drawBook(ctx, b, env) {
  const m = bookModel(b.n), [l, r] = pagesShown(b, env.bookOver?.get(b.id));
  const pw = b.w / 2, ph = b.h, sx = b.x + pw, x0 = b.x, y0 = b.y, rtl = !!b.rtl;
  const sc = (env.scale || 1) * (env.dpr || 1), pwPx = pw * sc;
  const cc = b.cc || COVER_COLORS[0], flat = b.st === '2d';
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = env.lod ? 'low' : 'high';
  if (rtl) { ctx.translate(2 * b.x + b.w, 0); ctx.scale(-1, 1); }

  if (flat) {
    if (l) drawPage(ctx, pageSource(b, l, env, pwPx), x0, y0, pw, ph, rtl, cc, true);
    if (r) drawPage(ctx, pageSource(b, r, env, pwPx), sx, y0, pw, ph, rtl, cc, true);
    if (l && r) { const g = ctx.createLinearGradient(sx - pw * 0.05, 0, sx + pw * 0.05, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,.16)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(sx - pw * 0.05, y0, pw * 0.1, ph); }
    ctx.restore();
    return;
  }

  /* ---------- 3D: a hardcover book seen from above ---------- */
  const G = geometry(b, l, r);
  const { bx0, bx1, by0, bh, both, closedFront, closedBack, spine, rad } = G;
  const spr = underSprite(b, G, sc);
  if (spr) ctx.drawImage(spr.cv, b.x + spr.ox, b.y + spr.oy, spr.w, spr.h);
  else {                                                                       // zoomed in far: paint only the ring round the pages (the pages cover the rest)
    const hx0 = l ? x0 : sx + (closedFront ? pw * 0.04 : 0), hx1 = r ? sx + pw : sx;
    ctx.save();
    ctx.beginPath(); ctx.rect(bx0 - pw, by0 - pw, bx1 - bx0 + 2 * pw, bh + 2 * pw); ctx.rect(hx0, y0, Math.max(0, hx1 - hx0), ph); ctx.clip('evenodd');
    paintUnder(ctx, G, cc);
    ctx.restore();
  }

  // the pages
  if (l) drawPage(ctx, pageSource(b, l, env, pwPx), x0, y0, pw, ph, rtl, cc, false);
  if (r) {
    if (closedFront) {                                                         // the front cover: the first page is printed on it
      const gap = pw * 0.04;
      drawPage(ctx, pageSource(b, r, env, pwPx), sx + gap, y0, pw - gap, ph, rtl, cc, false);
      const g = ctx.createLinearGradient(sx, 0, sx + gap * 1.6, 0); g.addColorStop(0, 'rgba(0,0,0,.45)'); g.addColorStop(0.55, 'rgba(255,255,255,.1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(sx - spine, by0, spine + gap * 1.6, bh);
    } else drawPage(ctx, pageSource(b, r, env, pwPx), sx, y0, pw, ph, rtl, cc, false);
  }
  // a hairline round each page, like the cut edge of paper
  ctx.lineWidth = Math.max(0.4, pw * 0.0015); ctx.strokeStyle = 'rgba(0,0,0,.16)';
  if (l) ctx.strokeRect(x0, y0, pw, ph);
  if (r && !closedFront) ctx.strokeRect(sx, y0, pw, ph);
  if (closedBack && l) {                                                       // the back cover
    const g = ctx.createLinearGradient(sx - pw * 0.04, 0, sx, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.35)');
    ctx.fillStyle = g; ctx.fillRect(sx - pw * 0.04, by0, pw * 0.04 + spine, bh);
  }

  // the gutter: pages curve down into the spine; the outer edges lift a little
  if (both) {
    const gw = pw * 0.14;
    let g = ctx.createLinearGradient(sx, 0, sx + gw, 0); g.addColorStop(0, 'rgba(0,0,0,.36)'); g.addColorStop(0.3, 'rgba(0,0,0,.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(sx, y0, gw, ph);
    g = ctx.createLinearGradient(sx, 0, sx - gw, 0); g.addColorStop(0, 'rgba(0,0,0,.36)'); g.addColorStop(0.3, 'rgba(0,0,0,.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(sx - gw, y0, gw, ph);
    ctx.fillStyle = 'rgba(0,0,0,.34)'; ctx.fillRect(sx - pw * 0.004, y0, pw * 0.008, ph);
    g = ctx.createLinearGradient(x0, 0, x0 + pw * 0.05, 0); g.addColorStop(0, 'rgba(0,0,0,.07)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x0, y0, pw * 0.05, ph);
    g = ctx.createLinearGradient(sx + pw, 0, sx + pw - pw * 0.05, 0); g.addColorStop(0, 'rgba(0,0,0,.07)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(sx + pw - pw * 0.05, y0, pw * 0.05, ph);
  }
  // the gloss of the cover when it is closed
  if (!both) {
    const g = ctx.createLinearGradient(bx0, by0, bx1, by0 + bh); g.addColorStop(0, 'rgba(255,255,255,.2)'); g.addColorStop(0.4, 'rgba(255,255,255,.03)'); g.addColorStop(1, 'rgba(0,0,0,.14)');
    ctx.fillStyle = g; rr(ctx, bx0, by0, bx1 - bx0, bh, rad); ctx.fill();
  }
  void m;
  ctx.restore();
}
