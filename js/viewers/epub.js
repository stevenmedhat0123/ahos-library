// EPUB reader: paginated, RTL aware, themes, font size, table of contents, resume.
import { h, clamp, debounce, ltr } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { state, getBlob, setSetting } from '../store.js';
import { toast, openSheet } from '../ui.js';
import { mountViewer, touchOpened, saveProgress, barBtn } from './common.js';
import { openEpub as parseEpub } from '../epub-core.js';
import { itemActions } from '../actions.js';
import { marksSheet } from '../marks.js';

const THEMES = {
  paper: { bg: '#F6F0E0', fg: '#2B2418', name: 'themePaper' },
  sepia: { bg: '#E7D8BA', fg: '#3A2E1B', name: 'themeSepia' },
  dark: { bg: '#10173A', fg: '#E8E1CC', name: 'themeDarkR' },
  black: { bg: '#000000', fg: '#C9C2AE', name: 'themeBlack' },
};
const FONTS = {
  serif: 'Georgia, "Noto Naskh Arabic", "Droid Naskh Shift", serif',
  sans: 'Inter, "Noto Sans Arabic", system-ui, sans-serif',
  book: '',
};

export async function openEpubBook(id) {
  const item = state.items.get(id);
  if (!item) return;
  touchOpened(id);

  let book = null;
  let ci = 0, page = 0, pages = 1, W = 0, H = 0;
  let rtl = false;
  let destroyed = false;
  let busy = false;
  const rs = { ...state.settings.reader };

  const V = mountViewer('epubv', { onClose: cleanup });
  const root = V.el;
  const frame = h('iframe', { class: 'ep-frame', sandbox: 'allow-same-origin', title: item.name });
  const tap = h('div', { class: 'ep-tap' });
  const stage = h('div', { class: 'ep-stage' }, frame, tap);
  const loader = h('div', { class: 'viewer-loading' }, h('div', { class: 'spinner' }), h('span', null, t('opening')));
  const title = h('div', { class: 'rv-title', dir: 'auto' }, item.meta?.title || item.name.replace(/\.epub$/i, ''));
  const info = h('div', { class: 'ep-info' });
  const slider = h('input', { class: 'pdf-slider', type: 'range', min: 0, max: 1000, value: 0, 'aria-label': t('progress') });
  const top = h('div', { class: 'rv-top' },
    h('button', { class: 'vbtn', 'aria-label': t('back'), onClick: () => V.close(), html: ic('back', 'flip-rtl') }),
    title,
    barBtn('bookmark', t('bookmarks'), () => marksSheet(item, { getHere: () => (book ? { pos: { c: ci, r: page / pages }, extra: { pct: overall() } } : null), onGo: (m) => { const q = m.pos && typeof m.pos === 'object' ? m.pos : { c: 0, r: 0 }; showChapter(q.c || 0, { r: q.r || 0 }); } })),
    barBtn('toc', t('contents'), () => tocSheet()),
    barBtn('textsize', t('readerSettings'), () => settingsSheet()),
    barBtn('more', t('more'), () => itemActions(id, { afterDelete: () => V.close() })));
  const bottom = h('div', { class: 'rv-bot ep-bot' }, slider, info);
  root.append(stage, top, bottom, loader);
  applyShell();

  function applyShell() {
    const th = THEMES[rs.theme] || THEMES.paper;
    root.style.setProperty('--ep-bg', th.bg);
    root.style.setProperty('--ep-fg', th.fg);
    root.dataset.eptheme = rs.theme;
  }

  /* ---------- document building ---------- */
  function buildDoc(ch) {
    const th = THEMES[rs.theme] || THEMES.paper;
    const padX = Math.round(clamp(W * 0.07, 16, 56));
    const padY = 34;
    const colW = W - padX * 2;
    const ff = FONTS[rs.font];
    const override = rs.font === 'book' ? '' : 'font-family:inherit!important;';
    return `<!doctype html><html dir="${ch.dir}" lang="${book.lang || ''}"><head><meta charset="utf-8">
<meta name="viewport" content="width=${W},height=${H}">
<style>${ch.css}</style>
<style id="ahos">
html{margin:0!important;padding:0!important;width:${W}px;height:${H}px;overflow:hidden;background:${th.bg}!important;scroll-behavior:smooth}
body{margin:0!important;padding:0!important;background:transparent!important;color:${th.fg}!important;font-size:${rs.size}px!important;line-height:${rs.lh}!important;${ff ? `font-family:${ff}!important;` : ''}-webkit-text-size-adjust:none}
#ahos-wrap{position:absolute;top:${padY}px;left:${padX}px;width:${colW}px;height:${H - padY * 2}px;column-width:${colW}px;column-gap:${padX * 2}px;column-fill:auto;direction:${ch.dir};text-align:start;word-wrap:break-word;overflow-wrap:break-word}
#ahos-wrap *{box-sizing:border-box;max-width:100%!important;color:${th.fg}!important;background-color:transparent!important;${override}}
#ahos-wrap p,#ahos-wrap li,#ahos-wrap div,#ahos-wrap span{font-size:inherit!important;line-height:inherit!important}
#ahos-wrap p{margin:0 0 .85em;orphans:2;widows:2}
#ahos-wrap h1,#ahos-wrap h2,#ahos-wrap h3,#ahos-wrap h4{line-height:1.3!important;break-after:avoid;margin:1.1em 0 .6em}
#ahos-wrap img,#ahos-wrap svg,#ahos-wrap image{max-width:100%!important;max-height:${H - padY * 2 - 8}px!important;height:auto!important;object-fit:contain;display:block;margin:.6em auto;break-inside:avoid}
#ahos-wrap a{text-decoration:none}
::selection{background:${th.fg}33}
</style></head><body><div id="ahos-wrap">${ch.body}</div></body></html>`;
  }

  function setFrame(html) {
    return new Promise((res) => { frame.onload = () => res(); frame.srcdoc = html; });
  }

  const sc = () => frame.contentDocument?.scrollingElement;
  function scrollToPage(p, smooth) {
    const s = sc();
    if (!s) return;
    s.style.scrollBehavior = smooth ? 'smooth' : 'auto';
    s.scrollTo({ left: (rtl ? -1 : 1) * p * W, behavior: smooth ? 'smooth' : 'auto' });
  }

  async function showChapter(index, where = 0) {
    if (busy || !book) return;
    busy = true;
    try {
      index = clamp(index, 0, book.spine.length - 1);
      const ch = await book.chapter(index);
      if (destroyed) return;
      rtl = ch.dir === 'rtl';
      const r = stage.getBoundingClientRect();
      W = Math.floor(r.width); H = Math.floor(r.height);
      frame.style.opacity = '0';
      await setFrame(buildDoc(ch));
      const d = frame.contentDocument;
      await Promise.race([Promise.all([...d.images].map((im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()))), new Promise((res) => setTimeout(res, 2500))]);
      ci = index;
      const s = sc();
      pages = Math.max(1, Math.ceil((s.scrollWidth - 2) / W));
      if (where === 'end') page = pages - 1;
      else if (typeof where === 'object' && where.frag) page = fragPage(d, where.frag);
      else if (typeof where === 'object') page = clamp(Math.round(where.r * pages), 0, pages - 1);
      else page = clamp(where, 0, pages - 1);
      scrollToPage(page, false);
      frame.style.opacity = '1';
      report();
    } catch (e) {
      console.warn(e);
      toast(t('chapterFailed'));
    } finally { busy = false; }
  }

  function fragPage(d, frag) {
    const el = d.getElementById(frag) || d.querySelector(`[name="${CSS.escape(frag)}"]`);
    if (!el) return 0;
    const s = d.scrollingElement; s.scrollLeft = 0;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    return clamp(rtl ? (cx >= 0 ? 0 : Math.ceil(-cx / W)) : Math.floor(cx / W), 0, pages - 1);
  }

  /* ---------- navigation ---------- */
  function next() {
    if (busy) return;
    if (page < pages - 1) { page++; scrollToPage(page, true); report(); }
    else if (ci < book.spine.length - 1) showChapter(ci + 1, 0);
    else toast(t('endOfBook'));
  }
  function prev() {
    if (busy) return;
    if (page > 0) { page--; scrollToPage(page, true); report(); }
    else if (ci > 0) showChapter(ci - 1, 'end');
  }

  const overall = () => {
    const sp = book.spine[ci];
    return clamp(book.offsets[ci] + ((page + 1) / pages) * (sp.size / book.totalSize), 0, 1);
  };
  const save = debounce(() => { if (book) saveProgress(id, overall() >= 0.995 ? 1 : overall(), { c: ci, r: page / pages }); }, 800);
  function report() {
    const f = overall();
    slider.value = Math.round(f * 1000);
    info.textContent = `${t('chapterOf', { a: ci + 1, b: book.spine.length })} · ${ltr(Math.round(f * 100) + '%')}`;
    save();
  }

  slider.addEventListener('change', () => {
    const f = Number(slider.value) / 1000;
    let c = book.offsets.findIndex((o, i) => f < (book.offsets[i + 1] ?? 1.0001));
    if (c < 0) c = book.spine.length - 1;
    const span = (book.offsets[c + 1] ?? 1) - book.offsets[c];
    showChapter(c, { r: span ? clamp((f - book.offsets[c]) / span, 0, 0.999) : 0 });
  });

  /* ---------- gestures ---------- */
  let sx = 0, sy = 0, st = 0;
  tap.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; st = performance.now(); });
  tap.addEventListener('pointerup', (e) => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    const forward = (leftSide) => (rtl ? leftSide : !leftSide);
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      // swipe: moving finger toward the page edge = next page
      const towardLeft = dx < 0;
      (forward(towardLeft) ? next : prev)();
      return;
    }
    if (Math.hypot(dx, dy) < 10 && performance.now() - st < 400) {
      const r = tap.getBoundingClientRect();
      const rel = (e.clientX - r.left) / r.width;
      if (rel < 0.3) (forward(true) ? next : prev)();
      else if (rel > 0.7) (forward(false) ? next : prev)();
      else root.classList.toggle('chrome-off');
    }
  });
  tap.addEventListener('wheel', (e) => { e.preventDefault(); if (Math.abs(e.deltaY) < 8) return; (e.deltaY > 0 ? next : prev)(); }, { passive: false });
  const onKey = (e) => {
    if (e.key === 'ArrowRight') (rtl ? prev : next)();
    else if (e.key === 'ArrowLeft') (rtl ? next : prev)();
    else if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowUp' || e.key === 'PageUp') prev();
    else if (e.key === 'Escape') V.close();
  };
  document.addEventListener('keydown', onKey);

  /* ---------- sheets ---------- */
  function tocSheet() {
    const s = openSheet({ title: t('contents'), tall: true });
    if (!book.toc.length) { s.body.append(h('div', { class: 'pick-empty' }, t('noOutline'))); return; }
    for (const e of book.toc) {
      const idx = book.chapterIndexForHref(e.href);
      s.body.append(h('button', { class: 'toc-row' + (idx === ci ? ' cur' : ''), dir: 'auto', style: { paddingInlineStart: 16 + e.level * 16 + 'px' },
        onClick: () => { s.close(); const frag = (e.href || '').includes('#') ? e.href.split('#')[1] : ''; if (idx >= 0) setTimeout(() => showChapter(idx, frag ? { frag } : 0), 120); } }, e.label || '—'));
    }
  }

  function settingsSheet() {
    const s = openSheet({ title: t('readerSettings') });
    const apply = debounce(async () => {
      setSetting('reader', { ...rs });
      applyShell();
      const r = page / pages;
      await showChapter(ci, { r });
    }, 220);
    const sizeLabel = h('b', null, String(rs.size));
    const stepper = h('div', { class: 'stepper' },
      h('button', { class: 'btn ghost', 'aria-label': 'A-', onClick: () => { rs.size = clamp(rs.size - 1, 12, 36); sizeLabel.textContent = rs.size; apply(); } }, 'A−'),
      sizeLabel,
      h('button', { class: 'btn ghost', 'aria-label': 'A+', onClick: () => { rs.size = clamp(rs.size + 1, 12, 36); sizeLabel.textContent = rs.size; apply(); } }, 'A+'));
    const seg = (items, key) => {
      const el = h('div', { class: 'seg' });
      const draw = () => el.replaceChildren(...items.map(([v, label]) => h('button', { class: 'seg-b' + (rs[key] === v ? ' on' : ''), onClick: () => { rs[key] = v; draw(); apply(); } }, label)));
      draw();
      return el;
    };
    const themes = h('div', { class: 'ep-themes' }, Object.entries(THEMES).map(([k, th]) =>
      h('button', { class: 'ep-theme' + (rs.theme === k ? ' on' : ''), style: { background: th.bg, color: th.fg }, 'aria-label': t(th.name), onClick: (e) => { rs.theme = k; themes.querySelectorAll('.ep-theme').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); apply(); } }, 'Aa')));
    s.body.append(
      h('div', { class: 'set-row' }, h('span', null, t('fontSize')), stepper),
      h('div', { class: 'set-row' }, h('span', null, t('theme')), themes),
      h('div', { class: 'set-row' }, h('span', null, t('font')), seg([['serif', t('fontSerif')], ['sans', t('fontSans')], ['book', t('fontBook')]], 'font')),
      h('div', { class: 'set-row' }, h('span', null, t('lineSpacing')), seg([[1.5, '1.5'], [1.75, '1.75'], [2, '2.0'], [2.25, '2.25']], 'lh')));
  }

  /* ---------- open ---------- */
  try {
    const blob = await getBlob(id);
    if (!blob) throw new Error('missing');
    book = await parseEpub(blob);
    if (destroyed) { book.destroy(); return; }
    rtl = book.dir === 'rtl';
    bottom.dir = rtl ? 'rtl' : 'ltr';
    title.textContent = book.title || title.textContent;
    loader.remove();
    const p = item.progress?.pos;
    await new Promise((r) => requestAnimationFrame(r));
    await showChapter(p && typeof p.c === 'number' ? p.c : 0, p && typeof p.r === 'number' ? { r: p.r } : 0);
  } catch (e) {
    console.warn(e);
    loader.replaceChildren(h('div', { class: 've-ic', html: ic('info') }), h('p', null, t('cannotOpenEpub')), h('button', { class: 'btn ghost', onClick: () => V.close() }, t('back')));
  }

  let rz;
  const onResize = () => { clearTimeout(rz); rz = setTimeout(() => { if (book) showChapter(ci, { r: page / pages }); }, 250); };
  window.addEventListener('resize', onResize);

  function cleanup() {
    destroyed = true;
    save.flush?.();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    book?.destroy();
  }
}
