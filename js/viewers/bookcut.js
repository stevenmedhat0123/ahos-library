// Cutting a piece out of a book while it is open (PDF reader, book or scroll view).
// A see-through blue area, like a screenshot, lies over the page: drag it, drag its corners / edges, or drag on the page to draw a new one.
// ✓ takes a copy of that part out of the book (onto a new board, ready to solve on); ✗ cancels.
import { h, uid } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { toast, pushLayer } from '../ui.js';
import { cropObject, withNat } from '../board/geom.js';
import { createBoardItem } from '../board/io.js';
import { blankData } from '../board/doc.js';
import { refOf } from '../board/assets.js';

const MIN = 40;                 // the smallest side of the area, in px
const round1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * What the area covers: the part of every page it touches, as fractions of that page.
 * pages: [{ n, x, y, w, h }] where each page lies on the screen; area: { x1, y1, x2, y2 } on the same screen.
 * A page that is only brushed (under an eighth of the biggest part) is left out. Sorted left to right, then top to bottom.
 */
export function coverOf(pages, area) {
  const out = [];
  for (const p of pages) {
    const x1 = Math.max(area.x1, p.x), y1 = Math.max(area.y1, p.y), x2 = Math.min(area.x2, p.x + p.w), y2 = Math.min(area.y2, p.y + p.h);
    if (x2 - x1 < 6 || y2 - y1 < 6 || !(p.w > 0) || !(p.h > 0)) continue;
    out.push({ n: p.n, f: [(x1 - p.x) / p.w, (y1 - p.y) / p.h, (x2 - p.x) / p.w, (y2 - p.y) / p.h], sx: x1, sy: y1, sw: x2 - x1, sh: y2 - y1 });
  }
  const top = Math.max(0, ...out.map((o) => o.sw * o.sh));
  return out.filter((o) => o.sw * o.sh >= top / 8).sort((a, b) => a.sx - b.sx || a.sy - b.sy);
}

/**
 * The pieces (PDF page objects) for the board: the same shape and place relative to each other as on the screen, the whole thing enlarged to
 * fill the top of the page so it is easy to read, with the rest of the page left empty to solve on.
 * list: coverOf(...) result; sizeOf(n) → [w, h] of PDF page n; ref: the file.
 */
export function pieceStrokes({ list, ref, sizeOf, pageW = 595, pageH = 842, margin = 36 }) {
  const x0 = Math.min(...list.map((p) => p.sx)), y0 = Math.min(...list.map((p) => p.sy));
  const W = Math.max(...list.map((p) => p.sx + p.sw)) - x0, H = Math.max(...list.map((p) => p.sy + p.sh)) - y0;
  const k = Math.min((pageW - 2 * margin) / W, (pageH * 0.5) / H);
  const ox = (pageW - W * k) / 2;
  return list.map((p) => {
    const [pw, ph] = sizeOf(p.n);
    const cut = cropObject({ t: 'pdfp', id: uid(), ref, page: p.n, x: 0, y: 0, w: pw, h: ph }, p.f);
    return withNat({ ...cut, x: round1(ox + (p.sx - x0) * k), y: round1(margin + (p.sy - y0) * k), w: round1(p.sw * k), h: round1(p.sh * k) });
  });
}

/** Makes the board with the pieces on its first page and returns its id. */
export async function cutToBoard({ item, list, sizeOf, title }) {
  const data = blankData();
  const page = data.pages[0];
  page.strokes = pieceStrokes({ list, ref: refOf(item), sizeOf, pageW: page.w, pageH: page.h });
  return createBoardItem(data, { title, folderId: item.folderId });
}

/**
 * startBookCut({ host, pages, onTake(list), onCancel })
 *   host: the viewer element the area lies on; pages(): [{ n, x, y, w, h }] where the pages are on the screen right now.
 * Returns { close() }.
 */
export function startBookCut({ host, pages, onTake, onCancel }) {
  const ov = h('div', { class: 'bcut', role: 'dialog', 'aria-label': t('bk_cut') });
  const tag = h('span', { class: 'bcut-tag' });
  const handles = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'].map((k) => h('i', { class: 'bcut-h ' + k }));
  const sel = h('div', { class: 'bcut-sel' }, tag, handles);
  const no = h('button', { class: 'bcut-btn no', type: 'button', 'aria-label': t('cancel'), title: t('cancel'), html: ic('close'), onClick: () => layer.close() });
  const yes = h('button', { class: 'bcut-btn yes', type: 'button', 'aria-label': t('bk_cutTake'), title: t('bk_cutTake'), html: ic('check'), onClick: () => take() });
  ov.append(h('div', { class: 'bcut-hint' }, t('bk_cutHint')), sel, h('div', { class: 'bcut-act' }, no, yes));
  host.append(ov);
  host.classList.add('cutting');                       // the reader's own bars step aside while the area is placed

  let box = ov.getBoundingClientRect();
  const R = { x1: 0, y1: 0, x2: 0, y2: 0 };
  let done = false;

  const layer = pushLayer(() => {
    if (done) return;
    done = true;
    document.removeEventListener('keydown', onKey, true);
    host.classList.remove('cutting');
    ov.remove();
    if (!taken) onCancel && onCancel();
  });
  let taken = false;

  function paint() {
    sel.style.left = R.x1 - box.left + 'px';
    sel.style.top = R.y1 - box.top + 'px';
    sel.style.width = R.x2 - R.x1 + 'px';
    sel.style.height = R.y2 - R.y1 + 'px';
    const list = coverOf(pages(), R);
    tag.textContent = list.map((o) => t('bk_cutPage', { n: o.n })).join(' + ');
    tag.hidden = !list.length;
    yes.disabled = !list.length;
    ov.classList.toggle('off-page', !list.length);
  }

  // where it starts: the middle of the page that shows most
  (function start() {
    let best = null, bestA = 0;
    for (const p of pages()) {
      const x1 = Math.max(p.x, box.left), y1 = Math.max(p.y, box.top), x2 = Math.min(p.x + p.w, box.right), y2 = Math.min(p.y + p.h, box.bottom);
      const a = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
      if (a > bestA) { bestA = a; best = { x1, y1, x2, y2 }; }
    }
    const b = best || { x1: box.left, y1: box.top, x2: box.right, y2: box.bottom };
    const w = (b.x2 - b.x1) * 0.72, hh = (b.y2 - b.y1) * 0.3;
    R.x1 = (b.x1 + b.x2) / 2 - w / 2; R.x2 = R.x1 + w;
    R.y1 = (b.y1 + b.y2) / 2 - hh / 2; R.y2 = R.y1 + hh;
    paint();
  })();

  /* ---------- dragging ---------- */
  let drag = null;
  const hitOf = (x, y) => {
    const w = R.x2 - R.x1, hh = R.y2 - R.y1;
    const g = clamp(Math.min(w, hh) * 0.34, 16, 30);              // grab distance: smaller areas keep room to be moved
    const nx = Math.abs(x - R.x1) <= g ? 'l' : Math.abs(x - R.x2) <= g ? 'r' : '';
    const ny = Math.abs(y - R.y1) <= g ? 't' : Math.abs(y - R.y2) <= g ? 'b' : '';
    const inX = x > R.x1 - g && x < R.x2 + g, inY = y > R.y1 - g && y < R.y2 + g;
    if (nx && ny) return ny + nx;                                       // a corner
    if (nx && inY) return nx;                                           // an edge
    if (ny && inX) return ny;
    if (x > R.x1 && x < R.x2 && y > R.y1 && y < R.y2) return 'move';
    return 'new';
  };
  ov.addEventListener('pointerdown', (e) => {
    if (drag || e.target.closest('.bcut-btn')) return;
    box = ov.getBoundingClientRect();
    const x = e.clientX, y = e.clientY, k = hitOf(x, y);
    drag = { id: e.pointerId, k, x, y, r: { ...R } };
    if (k === 'new') { R.x1 = R.x2 = x; R.y1 = R.y2 = y; drag.r = { ...R }; drag.k = 'br'; drag.fresh = true; }
    try { ov.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
  });
  ov.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y, o = drag.r, k = drag.k;
    const L = box.left, T = box.top, Rr = box.right, B = box.bottom;
    if (k === 'move') {
      const w = o.x2 - o.x1, hh = o.y2 - o.y1;
      R.x1 = clamp(o.x1 + dx, L, Rr - w); R.x2 = R.x1 + w;
      R.y1 = clamp(o.y1 + dy, T, B - hh); R.y2 = R.y1 + hh;
    } else {
      let { x1, y1, x2, y2 } = o;
      if (k.includes('l')) x1 = o.x1 + dx;
      if (k.includes('r')) x2 = o.x2 + dx;
      if (k.includes('t')) y1 = o.y1 + dy;
      if (k.includes('b')) y2 = o.y2 + dy;
      // dragged past the opposite side: the area flips instead of vanishing
      if (x1 > x2) [x1, x2] = [x2, x1];
      if (y1 > y2) [y1, y2] = [y2, y1];
      R.x1 = clamp(x1, L, Rr); R.x2 = clamp(x2, L, Rr); R.y1 = clamp(y1, T, B); R.y2 = clamp(y2, T, B);
      if (!drag.fresh) {                                                // (a new area starts as a point and grows; it is made usable when the finger lifts)
        if (R.x2 - R.x1 < MIN) { if (k.includes('l')) R.x1 = R.x2 - MIN; else R.x2 = R.x1 + MIN; }
        if (R.y2 - R.y1 < MIN) { if (k.includes('t')) R.y1 = R.y2 - MIN; else R.y2 = R.y1 + MIN; }
      }
    }
    paint();
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    // a quick tap that left nothing but a speck: back to a usable size around it
    if (R.x2 - R.x1 < MIN) { const c = (R.x1 + R.x2) / 2; R.x1 = clamp(c - MIN, box.left, box.right - 2 * MIN); R.x2 = R.x1 + 2 * MIN; }
    if (R.y2 - R.y1 < MIN) { const c = (R.y1 + R.y2) / 2; R.y1 = clamp(c - MIN, box.top, box.bottom - 2 * MIN); R.y2 = R.y1 + 2 * MIN; }
    paint();
  };
  ov.addEventListener('pointerup', end);
  ov.addEventListener('pointercancel', end);

  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); layer.close(); }
    else if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); take(); }
  }
  document.addEventListener('keydown', onKey, true);

  function take() {
    const list = coverOf(pages(), R);
    if (!list.length) { toast(t('bk_cutOver')); return; }
    taken = true;
    layer.close();
    onTake && onTake(list);
  }

  return { close: () => layer.close(), get on() { return !done; } };
}
