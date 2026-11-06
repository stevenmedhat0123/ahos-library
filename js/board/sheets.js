// Sheets for the whiteboard: new board, colours, page style, pages, picking a library file, drawing settings.
import { h, stripExt, fmtDur, fmtBytes } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { state, visibleItems } from '../store.js';
import { openSheet, confirmDialog, toast } from '../ui.js';
import { coverEl } from '../covers.js';
import { pickFiles, importFiles } from '../import.js';
import { PAPERS, PATTERNS, drawPaper, A4 } from './render.js';
import { blankData, patchPage, insertPage, removePage, movePage, clonePage, newPage } from './doc.js';
import { createBoardItem, renderPageCanvas } from './io.js';

export const PALETTE = ['#14161c', '#ffffff', '#ef4444', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#92400e', '#94a3b8'];
export const HL_PALETTE = ['#fde047', '#86efac', '#f9a8d4', '#93c5fd', '#fdba74', '#c4b5fd'];

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
export function newBoardSheet({ folderId = null, onCreate } = {}) {
  const st = { paper: '#ffffff', pattern: 'none', page: 'portrait' };
  const S = openSheet({ title: t('bd_new'), tall: true });
  const prev = h('div', { class: 'bd-prev' });
  const papers = h('div', { class: 'bd-papers' });
  const pats = h('div', { class: 'bd-pats' });
  const pages = h('div', { class: 'bd-row' });
  const draw = () => {
    prev.replaceChildren();
    const ratio = st.page === 'portrait' ? 842 / 595 : st.page === 'landscape' ? 595 / 842 : 1;
    prev.style.aspectRatio = `1 / ${ratio}`;
    prev.style.maxWidth = st.page === 'landscape' ? '240px' : '170px';
    prev.append(patternPreview(st.paper, st.pattern, 170, Math.round(170 * ratio), st.page !== 'endless'));
    papers.replaceChildren(...PAPERS.map((p) => h('button', { class: 'bd-paper' + (st.paper === p.c ? ' on' : ''), onClick: () => { st.paper = p.c; draw(); } }, h('i', { style: { background: p.c } }), t('bd_paper_' + p.id))));
    pats.replaceChildren(...PATTERNS.map((p) => h('button', { class: 'bd-paper' + (st.pattern === p ? ' on' : ''), onClick: () => { st.pattern = p; draw(); } }, h('i', { style: { background: st.paper } }, patternPreview(st.paper, p, 80, 80)), t('bd_pat_' + p))));
    pages.replaceChildren(...[['portrait', 'bdBlank'], ['landscape', 'bdBlank'], ['endless', 'bdEndless']].map(([k, icon]) => h('button', { class: 'chip' + (st.page === k ? ' on' : ''), onClick: () => { st.page = k; draw(); } }, h('span', { html: ic(icon) }), t('bd_' + k))));
  };
  draw();
  S.body.append(prev, h('div', { class: 'bd-lab' }, t('bd_paper')), papers, h('div', { class: 'bd-lab' }, t('bd_pattern')), pats, h('div', { class: 'bd-lab' }, t('bd_page')), pages,
    h('button', { class: 'btn primary lg', style: { width: '100%', marginTop: '6px' }, onClick: async () => {
      S.close();
      const id = await createBoardItem(blankData({ paper: st.paper, pattern: st.pattern, infinite: st.page === 'endless', landscape: st.page === 'landscape' }), { title: t('boardName'), folderId });
      onCreate?.(id);
    } }, t('bd_create')));
}

/* ---------------- colours ---------------- */
export function colorSheet({ title = t('bd_color'), current, palette = PALETTE, onPick }) {
  const S = openSheet({ title });
  const grid = h('div', { class: 'bd-colors' });
  const draw = () => {
    grid.replaceChildren(...palette.map((c) => h('button', { class: 'bd-sw' + (c.toLowerCase() === (current || '').toLowerCase() ? ' on' : ''), style: { background: c }, 'aria-label': c, onClick: () => { current = c; onPick(c); S.close(); } })));
    const pick = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(current || '') ? current : '#3b82f6', style: { position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%' } });
    pick.addEventListener('input', () => { current = pick.value; onPick(pick.value); });
    pick.addEventListener('change', () => S.close());
    grid.append(h('div', { class: 'bd-sw rainbow', style: { position: 'relative', width: '38px', height: '38px' }, 'aria-label': t('bd_custom') }, pick));
  };
  draw();
  S.body.append(grid);
  return S;
}

/* ---------------- page style ---------------- */
export function styleSheet({ doc, canvas, hasPdf }) {
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
    papers.replaceChildren(...PAPERS.map((p) => h('button', { class: 'bd-paper' + (c.paper === p.c ? ' on' : ''), onClick: () => apply({ paper: p.c }) }, h('i', { style: { background: p.c } }), t('bd_paper_' + p.id))));
    pats.replaceChildren(...PATTERNS.map((p) => h('button', { class: 'bd-paper' + (c.pattern === p ? ' on' : ''), onClick: () => apply({ pattern: p }) }, h('i', { style: { background: c.paper } }, patternPreview(c.paper, p, 80, 80)), t('bd_pat_' + p))));
    opts.replaceChildren(...[
      h('button', { class: 'chip' + (only ? ' on' : ''), onClick: () => { only = !only; draw(); } }, t('bd_thisPageOnly')),
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
      act('plus', t('bd_addPage'), () => { const p = doc.page; doc.edit((pages) => insertPage(pages, doc.cur + 1, newPage(p.w, p.h)), null, doc.cur + 1); }),
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
      seg(t('bd_assist'), [['off', t('bd_assistOff')], ['hold', t('bd_assistHold')], ['auto', t('bd_assistAuto')]], prefs.assist, (v) => { prefs.assist = v; }, t('bd_assistHint')),
      h('div', { class: 'bd-lab' }, t('bd_snap')),
      h('div', { class: 'bd-row' }, h('button', { class: 'chip' + (prefs.snap ? ' on' : ''), onClick: () => { prefs.snap = !prefs.snap; save(); draw(); } }, h('span', { html: ic('grid') }), t('bd_snap'))),
      hasPdf ? h('div', { class: 'bd-row' }, h('button', { class: 'chip' + (doc.night ? ' on' : ''), onClick: () => { doc.night = !doc.night; doc.changed('style'); canvas.invalidate(); draw(); } }, h('span', { html: ic('moon') }), t('bd_pdfNight'))) : null,
      h('p', { style: { color: 'var(--mute)', fontSize: '12.5px', lineHeight: 1.6, margin: '6px 2px 0' } }, t('bd_hint'))].filter(Boolean));
  };
  draw();
}

export { A4 };
