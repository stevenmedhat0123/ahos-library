// Writing on a PDF while it is open as a book.
// The ink is kept in the PDF's own whiteboard (the one "Draw on this PDF" opens), so the book and the board always show the same writing.
// The book shows it baked into the page pictures: it follows every page turn, zoom and view (the strokes are in the page's own coordinates).
import { h } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { state, setSetting } from '../store.js';
import { Doc, setStrokes, patchPage, pdfData } from '../board/doc.js';
import { loadDoc, boardForPdf, createBoardItem, makeSaver, pdfBoardTitle } from '../board/io.js';
import { createAssets, refOf } from '../board/assets.js';
import { drawStroke } from '../board/render.js';
import { hitStroke, isObj } from '../board/geom.js';

const PEN_COL = ['#1F3A8A', '#E5484D', '#16A34A', '#F59E0B', '#111827', '#8B5CF6'];
const HL_COL = ['#FFD43B', '#7EE081', '#FF8FB1', '#6FD3FF', '#FFA94D'];
const SIZES = { pen: [1.4, 2.8, 5.5], hl: [10, 16, 26], eraser: [7, 14, 26] };      // in A4 points (scaled to the page's real width)
const A4W = 595;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * opts: { item (the PDF), N, ratio (page width / height of the frame), sizeOf(n) → [w, h] of page n in PDF points, getBook() → the flip-book,
 *         onPrev(), onNext(), onBoard(), onDone(), onChange() }
 */
export function createBookInk(opts) {
  const { item, N, ratio, sizeOf } = opts;
  const ref = refOf(item);
  const saved = state.settings.pdfInk || {};
  const prefs = { tool: ['pen', 'hl', 'eraser'].includes(saved.tool) ? saved.tool : 'pen', size: clamp(saved.size == null ? 1 : saved.size | 0, 0, 2), pc: clamp(saved.pc | 0, 0, PEN_COL.length - 1), hc: clamp(saved.hc | 0, 0, HL_COL.length - 1) };
  let doc = null, boardId = null, saver = null, assets = null, seen = '', creating = null, destroyed = false, gid = 0, cur = null, busyLoad = null, refreshQ = new Set(), raf = 0;

  /* ---------- the document (the PDF's board) ---------- */
  const sig = () => { const b = boardId && state.items.get(boardId); return b ? `${b.size}:${b.meta?.strokes ?? 0}` : ''; };
  const dirty = () => !!saver && saver.state !== 'saved';
  async function load() {
    const b = boardForPdf(item);
    if (!b) { if (!doc || boardId) { doc = null; boardId = null; } return; }
    boardId = b.id;
    try { doc = await loadDoc(b.id); seen = sig(); } catch (e) { console.warn('book ink', e); }
  }
  const ready = (busyLoad = load());
  /** has the board been changed somewhere else (the board editor) since it was read? then it is read again and the pages redrawn */
  async function fresh() {
    if (destroyed || cur) return false;
    await busyLoad;
    const now = boardForPdf(item);
    if (!now) return false;
    if (boardId === now.id && (sig() === seen || dirty())) return false;
    await (busyLoad = load());
    return true;
  }
  function hook() {
    assets = createAssets(null);
    saver = makeSaver(boardId, doc, assets);
    saver.state = 'saved';
    saver.onState((st) => { saver.state = st; if (st === 'saved') seen = sig(); });
  }
  async function persist() {
    if (boardId && !state.items.has(boardId)) { saver?.cancel(); assets?.destroy(); saver = null; assets = null; boardId = null; }        // the board was deleted meanwhile: make it again
    if (!boardId) {
      if (!creating) {
        creating = (async () => {
          const id = await createBoardItem({ paper: doc.paper, pattern: doc.pattern, night: false, cur: doc.cur, view: null, src: ref, pages: doc.pages }, { title: pdfBoardTitle(item), folderId: item.folderId, src: ref });
          boardId = id; seen = sig(); hook();
        })().finally(() => { creating = null; });
      }
      await creating;
    }
    if (!saver) hook();
    saver.schedule();
    opts.onChange && opts.onChange();
  }
  const ensureDoc = async () => { await busyLoad; if (!doc) { const [w, hh] = sizeOf(1); doc = new Doc(pdfData(ref, { n: N, w, h: hh })); } return doc; };

  /* ---------- geometry: where the page lies inside the frame it is shown in ---------- */
  function box(n) {
    const [w, hh] = sizeOf(n), a = w / hh;
    if (a >= ratio) { const fh = ratio / a; return { fx: 0, fy: (1 - fh) / 2, fw: 1, fh }; }
    const fw = a / ratio; return { fx: (1 - fw) / 2, fy: 0, fw, fh: 1 };
  }
  const pageOf = (n) => (doc && doc.pages[n - 1]) || null;

  /** draws the writing of page n over a picture of that page (the canvas shows exactly the page, w px wide) */
  function paintInk(ctx, n, w) {
    const pg = pageOf(n);
    if (!pg || !pg.strokes.length) return;
    const k = w / (pg.w || sizeOf(n)[0]);
    ctx.save(); ctx.setTransform(k, 0, 0, k, 0, 0);
    const env = { dark: false, assets: null, scale: k, dpr: 1 };
    for (const s of pg.strokes) if (!isObj(s)) { try { drawStroke(ctx, s, env); } catch (e) { console.warn('ink stroke', e); } }
    ctx.restore();
  }
  const hasInk = (n) => { const pg = pageOf(n); return !!pg && pg.strokes.some((s) => !isObj(s)); };

  /* ---------- the pen ---------- */
  const color = () => (prefs.tool === 'hl' ? HL_COL[prefs.hc] : PEN_COL[prefs.pc]);
  const widthOf = (pg) => SIZES[prefs.tool][prefs.size] * ((pg.w || A4W) / A4W);
  function savePrefs() { setSetting('pdfInk', { ...prefs }); }
  function previewCanvas(g) {
    const host = g.pg.querySelector('.fb-ink');
    let cv = host.querySelector('canvas.fb-prev');
    if (!cv) { cv = h('canvas', { class: 'fb-prev' }); host.append(cv); }
    if (cv.width !== g.cv.width || cv.height !== g.cv.height) { cv.width = g.cv.width; cv.height = g.cv.height; }
    return cv;
  }
  function drawPreview() {
    raf = 0;
    if (!cur || !cur.stroke) return;
    const { cv, b, pg } = cur, ctx = cv.getContext('2d'), sx = b.fw * cv.width / (pg.w || 1), sy = b.fh * cv.height / (pg.h || 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(sx, 0, 0, sy, b.fx * cv.width, b.fy * cv.height);
    drawStroke(ctx, cur.stroke, { dark: false, assets: null, scale: sx, dpr: 1, live: true });
  }
  const clearPreview = (cv) => { if (cv) { const c = cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height); } };
  /** pointer position on the page → the page's own coordinates (null when the page is not part of this PDF's board) */
  function place(ev, pg) {
    const b = box(ev.n);
    return [clamp((ev.u - b.fx) / b.fw, 0, 1) * pg.w, clamp((ev.v - b.fy) / b.fh, 0, 1) * pg.h];
  }
  function pgIndex(n) { return n - 1; }
  const book = () => opts.getBook && opts.getBook();

  function refresh(n) {
    refreshQ.add(n);
    if (refreshQ.size === 1) requestAnimationFrame(() => { const list = [...refreshQ]; refreshQ.clear(); list.forEach((x) => book()?.refreshPage(x)); });
  }
  async function onInk(ev) {
    if (destroyed) return;
    if (ev.type === 'down') {
      const d = await ensureDoc();
      const i = pgIndex(ev.n), pg = d.pages[i];
      if (!pg) return;
      const sz = sizeOf(ev.n);
      if ((pg.w !== sz[0] || pg.h !== sz[1]) && !pg.strokes.length) { d.quiet((pages) => patchPage(pages, i, { w: sz[0], h: sz[1] })); }
      const pg2 = d.pages[i];
      const [x, y] = place(ev, pg2);
      const group = 'bi' + (++gid);
      if (prefs.tool === 'eraser') { cur = { n: ev.n, i, group, erase: true, r: SIZES.eraser[prefs.size] * ((pg2.w || A4W) / A4W), hit: false }; erase(x, y); return; }
      const stroke = { t: prefs.tool === 'hl' ? 'hl' : 'pen', c: color(), w: widthOf(pg2), pts: [round(x), round(y)] };
      cur = { n: ev.n, i, group, stroke, pg: pg2, b: box(ev.n), cv: previewCanvas(ev), lastX: x, lastY: y };
      drawPreview();
      return;
    }
    if (!cur || ev.n !== cur.n) { if (ev.type === 'cancel') { cancelCur(); } return; }
    if (ev.type === 'cancel') { cancelCur(); return; }
    const d = doc, pg = d.pages[cur.i];
    const [x, y] = place(ev, pg);
    if (cur.erase) { erase(x, y); if (ev.type === 'up') endErase(); return; }
    const min = 0.35 * ((pg.w || A4W) / A4W);
    if (Math.hypot(x - cur.lastX, y - cur.lastY) >= min || ev.type === 'up') {
      if (Math.hypot(x - cur.lastX, y - cur.lastY) > 0.01) cur.stroke.pts.push(round(x), round(y));
      cur.lastX = x; cur.lastY = y;
      if (!raf) raf = requestAnimationFrame(drawPreview);
    }
    if (ev.type === 'up') commit();
  }
  const round = (v) => Math.round(v * 100) / 100;
  function cancelCur() {
    if (cur && cur.cv) clearPreview(cur.cv);
    if (cur && cur.erase) endErase();
    cur = null;
  }
  function commit() {
    const c = cur; cur = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!c || !c.stroke) return;
    doc.edit((pages) => setStrokes(pages, c.i, [...pages[c.i].strokes, c.stroke]), c.group, c.i);
    doc.endGroup();
    const done = book()?.refreshPage(c.n);
    Promise.resolve(done).then(() => clearPreview(c.cv));
    persist(); ui();
  }
  function erase(x, y) {
    const c = cur, pg = doc.pages[c.i];
    const keep = pg.strokes.filter((s) => isObj(s) || !hitStroke(s, x, y, c.r));
    if (keep.length === pg.strokes.length) return;
    doc.edit((pages) => setStrokes(pages, c.i, keep), c.group, c.i);
    c.hit = true;
    refresh(c.n);
  }
  function endErase() {
    const c = cur; cur = null;
    doc?.endGroup();
    if (c && c.hit) { persist(); ui(); }
  }
  function changed(before) {
    const after = doc.pages;
    for (let i = 0; i < after.length; i++) if (!before[i] || before[i].strokes !== after[i].strokes) refresh(i + 1);
    persist(); ui();
  }
  function undo() { if (!doc || !doc.canUndo) return; const b = doc.pages; doc.undo(); changed(b); }
  function redo() { if (!doc || !doc.canRedo) return; const b = doc.pages; doc.redo(); changed(b); }

  /* ---------- the little tool bar ---------- */
  const tool = (id, icon, label) => h('button', { class: 'fbc-b ib-t', type: 'button', dataset: { tool: id }, 'aria-label': label, title: label, onClick: () => { prefs.tool = id; savePrefs(); ui(); } , html: ic(icon) });
  const undoB = h('button', { class: 'fbc-b', type: 'button', 'aria-label': t('bd_undo'), title: t('bd_undo'), dataset: { act: 'undo' }, onClick: undo, html: ic('undo') });
  const redoB = h('button', { class: 'fbc-b', type: 'button', 'aria-label': t('bd_redo'), title: t('bd_redo'), dataset: { act: 'redo' }, onClick: redo, html: ic('redo') });
  const dot = h('i', { class: 'ib-dot' });
  const sizeB = h('button', { class: 'fbc-b', type: 'button', 'aria-label': t('bi_size'), title: t('bi_size'), dataset: { act: 'size' }, onClick: () => { prefs.size = (prefs.size + 1) % 3; savePrefs(); ui(); } }, dot);
  const swatches = h('div', { class: 'ib-sw' });
  const btn = (act, icon, label, fn) => h('button', { class: 'fbc-b', type: 'button', 'aria-label': label, title: label, dataset: { act }, onClick: fn, html: ic(icon) });
  const prevB = btn('prev', 'prev', t('previous'), () => opts.onPrev && opts.onPrev());
  const nextB = btn('next', 'next', t('next'), () => opts.onNext && opts.onNext());
  const bar = h('div', { class: 'pdf-inkbar', dir: 'ltr' },
    h('div', { class: 'ib-row' },
      tool('pen', 'bdPen', t('bd_pen')), tool('hl', 'bdMarker', t('bd_hl')), tool('eraser', 'bdEraser', t('bd_eraser')), sizeB,
      h('span', { class: 'ib-sep' }), undoB, redoB, h('span', { class: 'ib-sep' }), prevB, nextB,
      h('span', { class: 'ib-sep' }), btn('board', 'bdPdf', t('bi_board'), () => opts.onBoard && opts.onBoard()), btn('done', 'check', t('bi_done'), () => opts.onDone && opts.onDone())),
    swatches);
  function ui() {
    bar.querySelectorAll('.ib-t').forEach((b) => b.classList.toggle('on', b.dataset.tool === prefs.tool));
    undoB.disabled = !(doc && doc.canUndo); redoB.disabled = !(doc && doc.canRedo);
    const px = prefs.tool === 'eraser' ? [8, 13, 19][prefs.size] : [3, 6, 11][prefs.size];
    dot.style.cssText = `width:${px}px;height:${px}px;background:${prefs.tool === 'eraser' ? 'transparent' : color()};${prefs.tool === 'eraser' ? 'border:2px solid currentColor;' : ''}`;
    swatches.hidden = prefs.tool === 'eraser';
    if (!swatches.hidden) {
      const list = prefs.tool === 'hl' ? HL_COL : PEN_COL, on = prefs.tool === 'hl' ? prefs.hc : prefs.pc;
      swatches.replaceChildren(...list.map((c, i) => h('button', { class: 'ib-c' + (i === on ? ' on' : ''), type: 'button', style: { background: c }, 'aria-label': c, dataset: { c }, onClick: () => { if (prefs.tool === 'hl') prefs.hc = i; else prefs.pc = i; savePrefs(); ui(); } })));
    }
  }
  ui();

  return {
    bar, ready, fresh, paintInk, hasInk, onInk, undo, redo, ui,
    get dirty() { return dirty(); },
    get boardId() { return boardId; },
    /** writes everything still waiting to the board (before the board editor opens, or the PDF closes) */
    async flush(withThumb = false) { if (creating) await creating; if (saver) await saver.flush(withThumb); },
    /** ends a stroke that is still going on and writes everything out */
    destroy() {
      destroyed = true; cancelCur();
      const done = saver ? saver.flush(true) : Promise.resolve();
      Promise.resolve(done).catch(() => {}).finally(() => { try { assets?.destroy(); } catch { /* ignore */ } });
    },
  };
}
