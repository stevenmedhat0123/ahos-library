// Sheets for the whiteboard: new board, colours, page style, pages, picking a library file, drawing settings.
import { h, stripExt, fmtDur, fmtBytes } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { state, visibleItems } from '../store.js';
import { openSheet, confirmDialog, toast } from '../ui.js';
import { coverEl } from '../covers.js';
import { pickFiles, importFiles } from '../import.js';
import { PAPERS, PATTERNS, drawPaper, A4, RB_D, RB_L, INK_IDS, isRainbow, inkCss, inkName, isDark, inkFor } from './render.js';
import { blankData, patchPage, insertPage, removePage, movePage, clonePage, newPage } from './doc.js';
import { createBoardItem, renderPageCanvas } from './io.js';
import { notePage, NOTE_PAPER, longDate } from './note.js';

export const PALETTE = ['#14161c', '#ffffff', '#ef4444', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#92400e', '#94a3b8'];
// A big, hand-picked set of colours in families: each family is one row of 6 or two rows of 12.
export const GROUPS = {
  vivid: ['#ff1744', '#ff5722', '#ff9100', '#ffc400', '#c6ff00', '#00e676', '#00e5d4', '#00b0ff', '#2979ff', '#651fff', '#d500f9', '#ff4081'],
  deep: ['#7f1d1d', '#9a3412', '#854d0e', '#365314', '#14532d', '#134e4a', '#164e63', '#1e3a8a', '#312e81', '#581c87', '#831843', '#0f172a'],
  pastel: ['#fecaca', '#fed7aa', '#fef08a', '#d9f99d', '#bbf7d0', '#a7f3d0', '#bae6fd', '#c7d2fe', '#ddd6fe', '#f5d0fe', '#fbcfe8', '#e2e8f0'],
  neon: ['#ff2e63', '#ff6b00', '#ffee00', '#aaff00', '#39ff14', '#00ffa3', '#00f0ff', '#2d8cff', '#7a5cff', '#bf00ff', '#ff00c8', '#ff0099'],
  earth: ['#78350f', '#a16207', '#b45309', '#c2410c', '#a8a29e', '#57534e', '#44403c', '#d6a77a', '#e7c9a9', '#8d6e63', '#6d4c41', '#3e2723'],
  gray: ['#000000', '#0b1020', '#1f2937', '#374151', '#4b5563', '#6b7280', '#9ca3af', '#d1d5db', '#e5e7eb', '#f3f4f6', '#ffffff', '#fffbeb'],
};
export const HL_PALETTE = ['#fde047', '#86efac', '#f9a8d4', '#93c5fd', '#fdba74', '#c4b5fd', RB_L];

function patternPreview(paper, pattern, w = 64, h = 64, fixed = true) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const c = h2('canvas', { width: w * dpr, height: h * dpr });
  c.style.cssText = `width:100%;height:100%;display:block`;
  const ctx = c.getContext('2d');
  const k = (w / 300) * dpr;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  drawPaper(ctx, fixed ? { w: 300, h: (300 * h) / w } : { w: 0, h: 0 }, paper, pattern, { x: 0, y: 0, s: k, W: w * dpr, H: h * dpr });
  return c;
}
const h2 = (tag, props) => Object.assign(document.createElement(tag), props);

/* ---------------- new board ---------------- */
// page sizes in board units (1 unit = 1/72 inch, so A4 = 595 x 842); `o` = the way the size is usually held
export const SIZES = [
  { id: 'a4', w: 595, h: 842 }, { id: 'a5', w: 420, h: 595 }, { id: 'a3', w: 842, h: 1191 }, { id: 'a6', w: 298, h: 420 },
  { id: 'b5', w: 499, h: 709 }, { id: 'letter', w: 612, h: 792 }, { id: 'legal', w: 612, h: 1008 },
  { id: 'square', w: 700, h: 700 }, { id: 's169', w: 960, h: 540, land: true }, { id: 's43', w: 800, h: 600, land: true }, { id: 'phone', w: 540, h: 960 },
];
const UNITS = { cm: 28.3465, mm: 2.83465, in: 72, px: 1 };
const sizeName = (id) => ({ a3: 'A3', a4: 'A4', a5: 'A5', a6: 'A6', b5: 'B5', letter: 'Letter', legal: 'Legal' }[id] || t('bd_sz_' + id));
const clampDim = (v) => Math.max(100, Math.min(6000, v));
const fmtNum = (v) => String(Math.round(v * 100) / 100);

/** One row of paper colours: the ready ones + a button that opens every colour. `get` / `set` read and write the current colour. */
function paperRow(get, set, redraw, extra = []) {
  const cur = get(), all = [...extra, ...PAPERS];
  const known = all.some((p) => p.c.toLowerCase() === String(cur).toLowerCase());
  return [
    ...all.map((p) => h('button', { class: 'bd-paper' + (String(cur).toLowerCase() === p.c.toLowerCase() ? ' on' : ''), onClick: () => { set(p.c); redraw(); } }, h('i', { style: { background: p.c } }), p.label || t('bd_paper_' + p.id))),
    known ? null : h('button', { class: 'bd-paper on' }, h('i', { style: { background: cur } }), t('bd_custom')),
    h('button', { class: 'bd-paper bd-morecol', onClick: () => colorSheet({ title: t('bd_paperColor'), current: cur, rainbow: false, onPick: (c) => { set(c); redraw(); } }) }, h('i', { html: ic('bdPalette') }), t('bd_moreColors')),
  ].filter(Boolean);
}

/** The same sheet makes a new board and sets up the draft: colour, pattern and page size (`allowEndless` off for the draft: it always has a size). */
export function pageSetupSheet({ title = t('bd_new'), cta = t('bd_create'), init = {}, allowEndless = true, onDone } = {}) {
  const st = { paper: '#ffffff', pattern: 'none', size: 'a4', land: false, endless: false, unit: 'cm', cw: '21', ch: '29.7', ...init };
  if (!allowEndless) st.endless = false;
  const S = openSheet({ title, tall: true });
  const prev = h('div', { class: 'bd-prev' });
  const papers = h('div', { class: 'bd-papers' });
  const pats = h('div', { class: 'bd-pats' });
  const sizes = h('div', { class: 'bd-row bd-sizes' });
  const orient = h('div', { class: 'bd-row' });
  const custom = h('div', { class: 'bd-custom' });
  /** [w, h] in board units, or null for an endless board */
  const dims = () => {
    if (st.endless) return null;
    if (st.size === 'custom') {
      const k = UNITS[st.unit], w = parseFloat(String(st.cw).replace(',', '.')), hh = parseFloat(String(st.ch).replace(',', '.'));
      return [clampDim(Number.isFinite(w) ? w * k : 595), clampDim(Number.isFinite(hh) ? hh * k : 842)];
    }
    const z = SIZES.find((x) => x.id === st.size) || SIZES[0];
    const [w, hh] = [z.w, z.h];
    const landscape = z.land ? !st.land : st.land;   // slides are wide by nature; "Landscape" turns every other size on its side
    return landscape === (w > hh) || w === hh ? [w, hh] : [hh, w];
  };
  const drawCustom = () => {
    custom.replaceChildren();
    if (st.size !== 'custom' || st.endless) return;
    const num = (key) => {
      const i = h('input', { class: 'bd-num', type: 'text', inputmode: 'decimal', value: st[key], 'aria-label': t(key === 'cw' ? 'bd_w' : 'bd_h'), dir: 'ltr' });
      i.addEventListener('input', () => { st[key] = i.value; drawPrev(); });
      i.addEventListener('focus', () => i.select());
      return i;
    };
    const unitBtn = (u) => h('button', { class: 'chip' + (st.unit === u ? ' on' : ''), onClick: () => {
      const d = dims(), to = UNITS[u];
      st.unit = u;
      if (d) { st.cw = fmtNum(d[0] / to); st.ch = fmtNum(d[1] / to); }
      drawCustom(); drawPrev();
    } }, t('bd_u_' + u));
    custom.append(
      h('div', { class: 'bd-dimrow' }, h('label', null, t('bd_w')), num('cw'), h('span', { class: 'x' }, '×'), h('label', null, t('bd_h')), num('ch')),
      h('div', { class: 'bd-row' }, ...Object.keys(UNITS).map(unitBtn)));
  };
  const drawPrev = () => {
    const d = dims();
    prev.replaceChildren();
    const ratio = d ? d[1] / d[0] : 1.4;
    const wide = d && ratio < 1;
    prev.style.aspectRatio = `1 / ${Math.max(0.2, Math.min(5, ratio))}`;
    prev.style.maxWidth = (wide ? 250 : ratio > 1.8 ? 120 : 170) + 'px';
    prev.append(patternPreview(st.paper, st.pattern, 170, Math.round(170 * Math.max(0.2, Math.min(5, ratio))), !st.endless));
    sizeNote.textContent = d ? t('bd_sizeIs', { w: Math.round(d[0] / UNITS.cm * 10) / 10, h: Math.round(d[1] / UNITS.cm * 10) / 10 }) : t('bd_endless');
  };
  const sizeNote = h('div', { class: 'bd-sizenote' });
  const draw = () => {
    papers.replaceChildren(...paperRow(() => st.paper, (c) => { st.paper = c; }, draw));
    pats.replaceChildren(...PATTERNS.map((p) => h('button', { class: 'bd-paper' + (st.pattern === p ? ' on' : ''), onClick: () => { st.pattern = p; draw(); } }, h('i', { style: { background: st.paper } }, patternPreview(st.paper, p, 80, 80)), t('bd_pat_' + p))));
    sizes.replaceChildren(...[
      ...SIZES.map((z) => h('button', { class: 'chip' + (!st.endless && st.size === z.id ? ' on' : ''), onClick: () => { st.endless = false; st.size = z.id; draw(); } }, sizeName(z.id))),
      h('button', { class: 'chip' + (!st.endless && st.size === 'custom' ? ' on' : ''), onClick: () => { st.endless = false; if (st.size !== 'custom') { const d = dims() || [595, 842]; st.cw = fmtNum(d[0] / UNITS[st.unit]); st.ch = fmtNum(d[1] / UNITS[st.unit]); } st.size = 'custom'; draw(); } }, h('span', { html: ic('edit') }), t('bd_sz_custom')),
      allowEndless ? h('button', { class: 'chip' + (st.endless ? ' on' : ''), onClick: () => { st.endless = true; draw(); } }, h('span', { html: ic('bdEndless') }), t('bd_endless')) : null].filter(Boolean));
    orient.replaceChildren(...(st.endless || st.size === 'custom' ? [] : [['p', 'bd_portrait'], ['l', 'bd_landscape']].map(([k, label]) => {
      const z = SIZES.find((x) => x.id === st.size);
      const isLand = z?.land ? !st.land : st.land;
      return h('button', { class: 'chip' + ((k === 'l') === isLand ? ' on' : ''), onClick: () => { st.land = z?.land ? (k === 'p') : (k === 'l'); draw(); } }, h('span', { html: ic('bdBlank') }), t(label));
    })));
    drawCustom();
    drawPrev();
  };
  draw();
  S.body.append(prev, sizeNote, h('div', { class: 'bd-lab' }, t('bd_paper')), papers, h('div', { class: 'bd-lab' }, t('bd_pattern')), pats, h('div', { class: 'bd-lab' }, t('bd_boardSize')), sizes, orient, custom,
    h('button', { class: 'btn primary lg', style: { width: '100%', marginTop: '6px' }, onClick: async () => {
      const d = dims();
      S.close();
      await onDone?.({ paper: st.paper, pattern: st.pattern, size: d });
    } }, cta));
}

export function newBoardSheet({ folderId = null, onCreate } = {}) {
  pageSetupSheet({ onDone: async ({ paper, pattern, size }) => {
    const id = await createBoardItem(blankData({ paper, pattern, infinite: !size, size }), { title: t('boardName'), folderId });
    onCreate?.(id);
  } });
}

/** The "New note" sheet: pick the paper colour (remembered for next time), see the look, create. */
export function newNoteSheet({ folderId = null, onCreate } = {}) {
  let saved = NOTE_PAPER;
  try { saved = localStorage.getItem('ahos.note.paper') || NOTE_PAPER; } catch { /* storage blocked */ }
  const st = { paper: /^#[0-9a-f]{6}$/i.test(saved) ? saved : NOTE_PAPER };
  const S = openSheet({ title: t('note_new') });
  const prev = h('div', { class: 'note-prev' });
  const papers = h('div', { class: 'bd-papers' });
  const draw = () => {
    const dark = isDark(st.paper);
    prev.style.background = st.paper; prev.style.color = inkFor(st.paper);
    prev.classList.toggle('dk', dark);
    prev.replaceChildren(h('i', { class: 'band' }), h('small', null, t('note_date')), h('b', null, longDate()));
    papers.replaceChildren(...paperRow(() => st.paper, (v) => { st.paper = v; }, draw, [{ c: NOTE_PAPER, label: t('note_paper') }]));
  };
  draw();
  S.body.append(prev, h('div', { class: 'bd-lab' }, t('bd_paperColor')), papers,
    h('button', { class: 'btn primary lg', style: { width: '100%', marginTop: '6px' }, onClick: async () => {
      S.close();
      try { localStorage.setItem('ahos.note.paper', st.paper); } catch { /* storage blocked */ }
      onCreate?.(st.paper);
    } }, t('bd_create')));
}

/* ---------------- colours ---------------- */
/** Colour sheet. `palette` (flat list) replaces the families (page-note colours); `hl` puts the soft highlighter tones first;
 *  `rainbow` shows the magic inks (rainbows and gradients). */
export function colorSheet({ title = t('bd_color'), current, palette, hl = false, rainbow = true, onPick }) {
  const S = openSheet({ title, tall: true });
  const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
  const sw = (c) => h('button', { class: 'bd-sw' + (isRainbow(c) ? ' rb' : '') + (same(c, current) ? ' on' : ''), style: { background: inkCss(c) }, 'aria-label': isRainbow(c) ? t(inkName(c)) : c, onClick: () => { current = c; onPick(c); S.close(); } });
  const group = (key, list) => [h('div', { class: 'bd-lab' }, t('bd_cg_' + key)), h('div', { class: 'bd-colors' }, ...list.map(sw))];
  const parts = [];
  if (rainbow && !palette) {
    parts.push(h('div', { class: 'bd-lab' }, t('bd_cg_ink')),
      h('div', { class: 'bd-inks' }, ...INK_IDS.map((id) => h('button', { class: 'bd-ink' + (id === current ? ' on' : ''), 'aria-label': t(inkName(id)), onClick: () => { current = id; onPick(id); S.close(); } },
        h('i', { style: { background: inkCss(id) } }), h('span', null, t(inkName(id)))))));
  }
  if (palette) parts.push(h('div', { class: 'bd-colors' }, ...palette.map(sw)));
  else if (hl) parts.push(...group('pastel', GROUPS.pastel), ...group('neon', GROUPS.neon), ...group('basic', PALETTE), ...group('vivid', GROUPS.vivid), ...group('deep', GROUPS.deep), ...group('earth', GROUPS.earth), ...group('gray', GROUPS.gray));
  else parts.push(...group('basic', PALETTE), ...group('vivid', GROUPS.vivid), ...group('deep', GROUPS.deep), ...group('pastel', GROUPS.pastel), ...group('neon', GROUPS.neon), ...group('earth', GROUPS.earth), ...group('gray', GROUPS.gray));
  // any colour at all
  const pick = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(current || '') ? current : '#3b82f6', style: { position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%' } });
  pick.addEventListener('input', () => { current = pick.value; onPick(pick.value); });
  pick.addEventListener('change', () => S.close());
  parts.push(h('div', { class: 'bd-lab' }, t('bd_custom')), h('div', { class: 'bd-colors' }, h('div', { class: 'bd-sw custom', style: { position: 'relative', width: '38px', height: '38px' }, 'aria-label': t('bd_custom'), html: ic('bdPalette') }, pick)));
  S.body.append(...parts);
  return S;
}

/* ---------------- page style ---------------- */
export function styleSheet({ doc, canvas, hasPdf, simple = false }) {
  const S = openSheet({ title: t('bd_style'), tall: true });
  let only = false;
  const papers = h('div', { class: 'bd-papers' });
  const pats = h('div', { class: 'bd-pats' });
  const opts = h('div', { class: 'bd-row' });
  const cur = () => ({ paper: doc.paperOf(), pattern: doc.patternOf() });
  const apply = (patch) => {
    if (only) doc.edit((pages) => patchPage(pages, doc.cur, patch));
    else {
      Object.assign(doc, patch);
      doc.quiet((pages) => pages.map((p) => ((p.paper || p.pattern) ? { ...p, paper: undefined, pattern: undefined } : p)));
      doc.changed('style');
    }
    canvas.invalidate();
    draw();
  };
  const draw = () => {
    const c = cur();
    papers.replaceChildren(...paperRow(() => c.paper, (v) => apply({ paper: v }), () => {}));
    pats.replaceChildren(...PATTERNS.map((p) => h('button', { class: 'bd-paper' + (c.pattern === p ? ' on' : ''), onClick: () => apply({ pattern: p }) }, h('i', { style: { background: c.paper } }, patternPreview(c.paper, p, 80, 80)), t('bd_pat_' + p))));
    opts.replaceChildren(...[
      simple ? null : h('button', { class: 'chip' + (only ? ' on' : ''), onClick: () => { only = !only; draw(); } }, t('bd_thisPageOnly')),
      hasPdf ? h('button', { class: 'chip' + (doc.night ? ' on' : ''), onClick: () => { doc.night = !doc.night; doc.changed('style'); canvas.invalidate(); draw(); } }, h('span', { html: ic('moon') }), t('bd_pdfNight')) : null].filter(Boolean));
  };
  draw();
  S.body.append(h('div', { class: 'bd-lab' }, t('bd_paper')), papers, h('div', { class: 'bd-lab' }, t('bd_pattern')), pats, opts);
}

/* ---------------- pages ---------------- */
export function pagesSheet({ doc, canvas, assets }) {
  const S = openSheet({ title: t('bd_pages'), tall: true, onClose: () => { alive = false; off(); } });
  let alive = true;
  const grid = h('div', { class: 'bd-pgrid' });
  const cache = new WeakMap();
  const queue = [];
  let running = false;
  const pump = async () => {
    if (running) return;
    running = true;
    while (queue.length && alive) {
      const { page, idx, host } = queue.shift();
      let cv = cache.get(page);
      if (!cv) {
        try { cv = await renderPageCanvas(doc, idx, { width: 220, assets, maxPx: 600 }); cache.set(page, cv); } catch { continue; }
      }
      if (alive && host.isConnected) { host.replaceChildren(cv.cloneNode ? copyCanvas(cv) : cv); }
      await new Promise((r) => setTimeout(r, 0));
    }
    running = false;
  };
  const copyCanvas = (cv) => { const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; c.getContext('2d').drawImage(cv, 0, 0); return c; };
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); const d = e.target._job; if (d) { queue.push(d); pump(); } }
  }, { root: S.body, rootMargin: '300px' });

  const act = (icon, label, fn, cls = '') => h('button', { class: 'bd-ob ' + cls, onClick: fn }, h('span', { html: ic(icon) }), label);
  const bar = h('div', { class: 'bd-row' });
  const build = () => {
    bar.replaceChildren(
      act('plus', t('bd_addPage'), () => { const p = doc.page; doc.edit((pages) => insertPage(pages, doc.cur + 1, doc.note ? notePage(p.w, p.h) : newPage(p.w, p.h)), null, doc.cur + 1); }),
      act('copy', t('bd_dupPage'), () => { doc.edit((pages) => insertPage(pages, doc.cur + 1, clonePage(doc.page)), null, doc.cur + 1); }),
      act('trash', t('bd_delPage'), async () => {
        if (doc.pages.length < 2) return;
        if (doc.page.strokes.length && !(await confirmDialog({ title: t('bd_delPage'), message: t('bd_delPageQ'), ok: t('delete'), danger: true }))) return;
        doc.edit((pages) => removePage(pages, doc.cur), null, Math.max(0, doc.cur - (doc.cur === doc.pages.length - 1 ? 1 : 0)));
      }, 'danger'),
      act('bdChevUp', t('bd_movePrev'), () => { if (doc.cur > 0) doc.edit((pages) => movePage(pages, doc.cur, doc.cur - 1), null, doc.cur - 1); }),
      act('down', t('bd_moveNext'), () => { if (doc.cur < doc.pages.length - 1) doc.edit((pages) => movePage(pages, doc.cur, doc.cur + 1), null, doc.cur + 1); }));
    grid.replaceChildren(...doc.pages.map((p, i) => {
      const th = h('div', { class: 'th' });
      if (p.w && p.h) th.style.aspectRatio = `${p.w} / ${p.h}`; else th.style.aspectRatio = '4 / 3';
      th.style.background = doc.paperOf(p);
      const tile = h('button', { class: 'bd-pg' + (i === doc.cur ? ' on' : ''), onClick: () => { canvas.setPage(i); S.close(); } }, th, String(i + 1));
      th._job = { page: p, idx: i, host: th };
      io.observe(th);
      return tile;
    }));
    const on = grid.children[doc.cur];
    on?.scrollIntoView?.({ block: 'nearest' });
  };
  const off = doc.onChange(() => { if (alive) { build(); } });
  build();
  S.body.append(bar, grid);
}

/* ---------------- choose a file from the library ---------------- */
export function pickItem({ title, filter, accept, folderId = null }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const S = openSheet({ title, tall: true, onClose: () => finish(null) });
    const q = h('input', { class: 'field', type: 'search', placeholder: t('bd_search'), autocomplete: 'off', style: { marginBottom: '8px' } });
    const list = h('div', { class: 'bd-pick' });
    const fromPhone = h('button', { class: 'btn ghost', style: { width: '100%', marginBottom: '10px' }, onClick: async () => {
      const files = await pickFiles({ accept, multiple: false });
      if (!files.length) return;
      const f = files[0];
      toast(t('bd_importing'));
      await importFiles([f], folderId, { quiet: true });
      const it = [...state.items.values()].find((x) => x.name === f.name && x.size === f.size);
      if (it) { finish(it); S.close(); }
    } }, h('span', { html: ic('upload') }), t('bd_fromDevice'));
    const sub = (it) => {
      const m = it.meta || {};
      if ((it.kind === 'video' || it.kind === 'audio') && m.duration && isFinite(m.duration)) return `${fmtDur(m.duration)} · ${fmtBytes(it.size)}`;
      if (it.kind === 'book' && m.pages) return `${t('nPages', { n: m.pages })} · ${fmtBytes(it.size)}`;
      return fmtBytes(it.size);
    };
    const draw = () => {
      const needle = q.value.trim().toLowerCase();
      const items = visibleItems().filter((it) => filter(it) && (!needle || it.name.toLowerCase().includes(needle))).sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 150);
      list.replaceChildren(...(items.length ? items.map((it) => h('button', { class: 'bd-pick-row', onClick: () => { finish(it); S.close(); } }, coverEl(it), h('div', null, h('b', { dir: 'auto' }, stripExt(it.meta?.title || it.name)), h('small', null, sub(it))))) : [h('p', { style: { textAlign: 'center', color: 'var(--mute)', padding: '24px 0' } }, t('bd_nothing'))]));
    };
    q.addEventListener('input', draw);
    draw();
    S.body.append(fromPhone, q, list);
  });
}

/* ---------------- drawing settings ---------------- */
export function settingsSheet({ prefs, save, hasPdf, doc, canvas }) {
  const S = openSheet({ title: t('bd_settings') });
  const body = S.body;
  const draw = () => {
    const seg = (label, opts, cur, set, hint) => h('div', null,
      h('div', { class: 'bd-lab' }, label),
      h('div', { class: 'bd-row' }, opts.map(([v, text]) => h('button', { class: 'chip' + (cur === v ? ' on' : ''), onClick: () => { set(v); save(); draw(); } }, text))),
      hint ? h('p', { style: { color: 'var(--mute)', fontSize: '12.5px', lineHeight: 1.6, margin: '0 2px 10px' } }, hint) : null);
    body.replaceChildren(...[
      seg(t('bd_drawWith'), [[false, t('bd_fingerAndPen')], [true, t('bd_penOnly')]], prefs.penOnly, (v) => { prefs.penOnly = v; }, prefs.penOnly ? t('bd_penOnlySub') : null),
      seg(t('bd_smart'), [['precise', t('bd_smartPrecise')], ['natural', t('bd_smartNat')], ['smart', t('bd_smartSmart')], ['neat', t('bd_smartNeat')], ['off', t('bd_smartOff')]], prefs.smart, (v) => { prefs.smart = v; }, t('bd_smartHint')),
      seg(t('bd_width'), [['natural', t('bd_widthNat')], ['exact', t('bd_widthExact')], ['screen', t('bd_widthScreen')]], prefs.width || 'natural', (v) => { prefs.width = v; canvas.invalidate(); }, t('bd_widthHint')),
      seg(t('bd_assist'), [['off', t('bd_assistOff')], ['hold', t('bd_assistHold')], ['auto', t('bd_assistAuto')]], prefs.assist, (v) => { prefs.assist = v; }, t('bd_assistHint')),
      seg(t('dr_set'), [[true, t('dr_setClear')], [false, t('dr_setKeep')]], prefs.draftClear !== false, (v) => { prefs.draftClear = v; }, t('dr_setHint')),
      h('div', { class: 'bd-lab' }, t('bd_snap')),
      h('div', { class: 'bd-row' }, h('button', { class: 'chip' + (prefs.snap ? ' on' : ''), onClick: () => { prefs.snap = !prefs.snap; save(); draw(); } }, h('span', { html: ic('grid') }), t('bd_snap'))),
      hasPdf ? h('div', { class: 'bd-row' }, h('button', { class: 'chip' + (doc.night ? ' on' : ''), onClick: () => { doc.night = !doc.night; doc.changed('style'); canvas.invalidate(); draw(); } }, h('span', { html: ic('moon') }), t('bd_pdfNight'))) : null,
      h('p', { style: { color: 'var(--mute)', fontSize: '12.5px', lineHeight: 1.6, margin: '6px 2px 0' } }, t('bd_hint'))].filter(Boolean));
  };
  draw();
}

export { A4 };
