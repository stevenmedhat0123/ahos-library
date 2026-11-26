// PDF reader: continuous scroll, lazy page rendering, pinch / button zoom, night mode, outline, resume.
import { h, clamp, debounce, stripExt } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { state, getBlob, setSetting } from '../store.js';
import { toast, openSheet, promptDialog } from '../ui.js';
import { mountViewer, touchOpened, saveProgress, barBtn } from './common.js';
import { loadPdfjs, pdfParams } from '../pdf-loader.js';
import { itemActions } from '../actions.js';
import { marksSheet } from '../marks.js';
import { createFlipBook } from './flipbook.js';
import { viewSheet, validView } from './bookviews.js';
import { createBookInk } from './bookink.js';
import { startBookCut, cutToBoard } from './bookcut.js';

export async function openPdf(id) {
  const item = state.items.get(id);
  if (!item) return;
  touchOpened(id);

  let doc = null, task = null;
  let zoom = 1;
  let curPage = 1;
  const sizes = new Map(); // page -> [w,h] at scale 1
  const pageEls = [];
  const rendered = new Map(); // n -> {task}
  const visible = new Set();
  let io = null;
  let destroyed = false;
  let book = null, bookOn = false, ink = null, writeOn = false;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const V = mountViewer('pdfv', { onClose: cleanup });
  const root = V.el;
  const scroller = h('div', { class: 'pdf-scroll' + (state.settings.pdfNight ? ' night' : '') });
  const pagesBox = h('div', { class: 'pdf-pages' });
  scroller.append(pagesBox);
  const loader = h('div', { class: 'viewer-loading' }, h('div', { class: 'spinner' }), h('span', null, t('opening')));
  const pill = h('button', { class: 'pdf-pill', onClick: () => gotoDialog() }, '–');
  const slider = h('input', { class: 'pdf-slider', type: 'range', min: 1, max: 1, value: 1, 'aria-label': t('page'), dir: 'ltr' });
  const nightBtn = barBtn('moon', t('nightMode'), () => { scroller.classList.toggle('night'); const on = scroller.classList.contains('night'); setSetting('pdfNight', on); nightBtn.classList.toggle('on', on); book?.setNight(on); });
  const bookBtn = barBtn('bookOpen', t('pdfBookMode'), () => setBookMode(!bookOn));
  nightBtn.classList.toggle('on', !!state.settings.pdfNight);
  const zoomOutBtn = barBtn('zoomOut', t('zoomOut'), () => (book ? book.zoomBy(1 / 1.4) : setZoom(zoom / 1.25)), 'zbtn'), zoomInBtn = barBtn('zoomIn', t('zoomIn'), () => (book ? book.zoomBy(1.4) : setZoom(zoom * 1.25)), 'zbtn');
  const top = h('div', { class: 'rv-top' },
    h('button', { class: 'vbtn', 'aria-label': t('back'), onClick: () => V.close(), html: ic('back', 'flip-rtl') }),
    h('div', { class: 'rv-title', dir: 'auto' }, item.meta?.title || item.name.replace(/\.pdf$/i, '')),
    bookBtn, barBtn('toc', t('outline'), () => outlineSheet()), nightBtn,
    barBtn('scissors', t('bk_cut'), () => startCut(), 'rv-cut'),
    barBtn('bdPen', t('bd_drawOnPdf'), () => drawOnPdf()),
    zoomOutBtn, zoomInBtn,
    barBtn('more', t('more'), () => itemActions(id, { afterDelete: () => V.close() })));
  async function drawOnPdf() {
    try {
      await ink?.flush();                                         // what was written in the book is in the board before the board opens
      const { openOrCreatePdfBoard } = await import('../board/io.js');
      const bid = await openOrCreatePdfBoard(item);
      await (await import('./board.js')).openBoard(bid);
      if (ink) {                                                  // back from the board: its writing shows in the book too
        const iv = setInterval(async () => {
          if (destroyed || !ink) { clearInterval(iv); return; }
          if (document.querySelector('.viewer.bdv')) return;
          clearInterval(iv);
          if (await ink.fresh()) book?.refreshAll();
        }, 500);
      }
    } catch (e) { console.error(e); toast(t('bd_failed')); }
  }
  /* ---------- cut a piece out of the book ---------- */
  let cut = null;
  /** where every page that is on show lies on the screen right now (the book's two pages, or the scrolled pages) */
  function pagesOnScreen() {
    const out = [];
    if (bookOn && book) {
      const ratio = vp1.width / vp1.height;
      for (const pg of bookHost.querySelectorAll('.fb-pg')) {
        const n = parseInt(String(pg.dataset.n || '0'), 10);
        if (pg.classList.contains('none') || !n || n > N) continue;
        const r = pg.getBoundingClientRect(), [w, hh] = sizeOf(n), a = w / hh;
        const fw = a >= ratio ? 1 : a / ratio, fh = a >= ratio ? ratio / a : 1;       // the page sits inside the book's frame (same rule as the writing layer)
        out.push({ n, x: r.left + ((1 - fw) / 2) * r.width, y: r.top + ((1 - fh) / 2) * r.height, w: fw * r.width, h: fh * r.height });
      }
    } else {
      for (const el of pageEls) {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight || r.width < 4) continue;
        out.push({ n: Number(el.dataset.page), x: r.left, y: r.top, w: r.width, h: r.height });
      }
    }
    return out;
  }
  async function startCut() {
    if (cut?.on || destroyed) return;
    if (writeOn) setWrite(false);
    // a tilted view cannot be measured like a flat page: the book stands up flat while the area is placed, then goes back to the view it had
    const view = (bookHost.querySelector('.fb')?.className.match(/\bbv-(\w+)/) || [])[1] || bs.view;
    const flat = bookOn && book && view !== 'classic';
    if (flat) { book.setView('classic'); await new Promise((r) => setTimeout(r, 700)); if (destroyed || !book) return; }
    const back = () => { if (flat && book && !destroyed) book.setView(view); };
    cut = startBookCut({
      host: root, pages: pagesOnScreen,
      onCancel: back,
      onTake: async (list) => {
        back();
        try {
          const base = item.meta?.title || stripExt(item.name);
          const bid = await cutToBoard({ item, list, sizeOf, title: `${base} · ${t('bk_pieceSuffix')}` });
          await (await import('./board.js')).openBoard(bid);
          toast(t('bk_cutDone'), { ms: 4200 });
        } catch (e) { console.error(e); toast(t('bd_failed')); }
      },
    });
  }
  const markBtn = barBtn('bookmark', t('bookmarks'), () => marksSheet(item, { getHere: () => ({ pos: curPage }), onGo: (m) => goto(Number(m.pos) || 1) }));
  const bottom = h('div', { class: 'rv-bot', dir: 'ltr' }, markBtn, slider, pill);
  const bookHost = h('div', { class: 'pdf-book' });
  const focusBtns = ['left', 'both', 'right'].map((f) => h('button', { class: 'fbc-b' + (f === 'both' ? ' on' : ''), type: 'button', 'aria-label': t('pbFocus_' + f), title: t('pbFocus_' + f), dataset: { f }, html: ic(f === 'left' ? 'focusL' : f === 'right' ? 'focusR' : 'focusB'), onClick: () => setFocus(f) }));
  const fitBtn = h('button', { class: 'fbc-b fbc-fit', type: 'button', hidden: true, 'aria-label': t('bi_fit'), title: t('bi_fit'), html: ic('fit'), onClick: () => book?.resetZoom() });
  const zoomBtn = h('button', { class: 'fbc-b fbc-zoom', type: 'button', 'aria-label': t('zoomIn'), title: t('zoomIn'), html: ic('zoomIn'), onClick: () => book?.zoomBy(1.6) });
  const cutBtn = h('button', { class: 'fbc-b fbc-cut', type: 'button', 'aria-label': t('bk_cut'), title: t('bk_cut'), html: ic('scissors'), onClick: () => startCut() });
  const writeBtn = h('button', { class: 'fbc-b fbc-write', type: 'button', 'aria-label': t('bi_write'), title: t('bi_write'), html: ic('bdPen'), onClick: () => setWrite(!writeOn) });
  const bookCtl = h('div', { class: 'pdf-bookctl', dir: 'ltr' }, focusBtns, h('button', { class: 'fbc-b', type: 'button', 'aria-label': t('bv_title'), title: t('bv_title'), html: ic('bookView'), onClick: () => pickView() }), h('button', { class: 'fbc-b', type: 'button', 'aria-label': t('pdfBookOpts'), title: t('pdfBookOpts'), html: ic('settings'), onClick: () => bookOptions() }), zoomBtn, fitBtn, cutBtn, writeBtn);
  root.append(scroller, bookHost, bookCtl, top, bottom, loader);

  // tap toggles chrome
  let tapStart = 0, tx0 = 0, ty0 = 0;
  scroller.addEventListener('pointerdown', (e) => { tapStart = performance.now(); tx0 = e.clientX; ty0 = e.clientY; });
  scroller.addEventListener('pointerup', (e) => { if (performance.now() - tapStart < 250 && Math.hypot(e.clientX - tx0, e.clientY - ty0) < 8) root.classList.toggle('chrome-off'); });

  try {
    const blob = await getBlob(id);
    if (!blob) throw new Error(t('fileMissing'));
    const pdfjs = await loadPdfjs();
    task = pdfjs.getDocument(pdfParams(new Uint8Array(await blob.arrayBuffer())));
    task.onPassword = (update, reason) => {
      promptDialog({ title: reason === 2 ? t('wrongPassword') : t('pdfPassword'), type: 'password', ok: t('open') }).then((p) => { if (p) update(p); else V.close(); });
    };
    doc = await task.promise;
  } catch (e) {
    console.warn(e);
    if (!destroyed) { loader.replaceChildren(h('div', { class: 've-ic', html: ic('info') }), h('p', null, t('cannotOpenPdf')), h('button', { class: 'btn ghost', onClick: () => V.close() }, t('back'))); }
    return;
  }
  if (destroyed) { try { task.destroy(); } catch { /* ignore */ } return; }

  const first = await doc.getPage(1);
  const vp1 = first.getViewport({ scale: 1 });
  sizes.set(1, [vp1.width, vp1.height]);
  const N = doc.numPages;
  slider.max = N;

  const PAD = 12;
  const baseScale = () => Math.max(0.2, (scroller.clientWidth - PAD * 2) / vp1.width);
  const sizeOf = (n) => sizes.get(n) || sizes.get(1);

  function layout() {
    const s = baseScale() * zoom;
    const maxW = Math.max(...[...sizes.values()].map((x) => x[0]));
    pagesBox.style.width = Math.max(scroller.clientWidth, Math.ceil(maxW * s + PAD * 2)) + 'px';
    pageEls.forEach((el, i) => {
      const [w, hh] = sizeOf(i + 1);
      el.style.width = Math.round(w * s) + 'px';
      el.style.height = Math.round(hh * s) + 'px';
    });
  }

  for (let n = 1; n <= N; n++) {
    const el = h('div', { class: 'pdf-page', dataset: { page: n } });
    pageEls.push(el); pagesBox.append(el);
  }
  layout();

  io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const n = Number(en.target.dataset.page);
      if (en.isIntersecting) { visible.add(n); renderPage(n); } else visible.delete(n);
    }
    evict();
  }, { root: scroller, rootMargin: '120% 0px' });
  pageEls.forEach((el) => io.observe(el));

  async function renderPage(n) {
    const el = pageEls[n - 1];
    const scale = baseScale() * zoom;
    const key = scale.toFixed(3);
    if (el.dataset.key === key && (rendered.has(n) || el.firstChild)) return;
    rendered.get(n)?.task?.cancel();
    try {
      const page = await doc.getPage(n);
      if (destroyed) return;
      const vp = page.getViewport({ scale });
      if (!sizes.has(n)) { sizes.set(n, [vp.width / scale, vp.height / scale]); }
      el.style.width = Math.round(vp.width) + 'px'; el.style.height = Math.round(vp.height) + 'px';
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = '100%'; canvas.style.height = '100%';
      const rt = page.render({ canvasContext: canvas.getContext('2d'), viewport: page.getViewport({ scale: scale * dpr }) });
      rendered.set(n, { task: rt });
      await rt.promise;
      if (destroyed) return;
      el.replaceChildren(canvas);
      el.dataset.key = key;
      el.classList.add('ready');
    } catch (e) {
      if (e && e.name === 'RenderingCancelledException') return;
      console.warn('render page', n, e);
    }
  }

  function evict() {
    if (rendered.size <= 9) return;
    const far = [...rendered.keys()].filter((n) => !visible.has(n)).sort((a, b) => Math.abs(b - curPage) - Math.abs(a - curPage));
    while (rendered.size > 9 && far.length) {
      const n = far.shift();
      rendered.get(n)?.task?.cancel(); rendered.delete(n);
      const el = pageEls[n - 1];
      el.replaceChildren(); delete el.dataset.key; el.classList.remove('ready');
    }
  }

  /* ---------- current page + progress ---------- */
  const persist = debounce(() => {
    const off = bookOn ? 0 : pageFraction();
    saveProgress(id, ((curPage - 1) + off) / Math.max(1, N), { p: curPage, off });
  }, 900);
  function pageFraction() {
    const el = pageEls[curPage - 1];
    return el ? clamp((scroller.scrollTop - el.offsetTop + PAD) / Math.max(1, el.offsetHeight), 0, 1) : 0;
  }
  function updateCurrent() {
    // the page under 40 % of the screen height, found by position (pages are stacked in order, so a binary search is enough);
    // it must not depend on which pages the observer has reported yet, or after a far jump the number shown lags one jump behind
    const mid = scroller.scrollTop + scroller.clientHeight * 0.4;
    let lo = 0, hi = pageEls.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pageEls[m].offsetTop <= mid) lo = m; else hi = m - 1; }
    const best = lo + 1;
    if (best !== curPage) curPage = best;
    pill.textContent = `${curPage} / ${N}`;
    slider.value = curPage;
    persist();
  }
  let ticking = false;
  scroller.addEventListener('scroll', () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { ticking = false; updateCurrent(); }); }, { passive: true });
  slider.addEventListener('input', () => { pill.textContent = `${slider.value} / ${N}`; });
  slider.addEventListener('change', () => goto(Number(slider.value)));
  slider.addEventListener('keydown', (e) => { if (bookOn && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) e.stopPropagation(); });

  function goto(n, off = 0) {
    n = clamp(n, 1, N);
    if (bookOn) { book?.goto(n, true); return; }
    const el = pageEls[n - 1];
    scroller.scrollTop = el.offsetTop - PAD + off * el.offsetHeight;
    curPage = n; updateCurrent();
  }
  async function gotoDialog() {
    const v = await promptDialog({ title: t('goToPage'), message: `1 – ${N}`, type: 'number', inputmode: 'numeric', value: String(curPage), ok: t('go') });
    const n = parseInt(v, 10);
    if (n) goto(n);
  }

  /* ---------- zoom ---------- */
  function setZoom(z, focus) {
    z = clamp(z, 0.6, 5);
    if (Math.abs(z - zoom) < 0.01) return;
    const cx = focus?.x ?? scroller.clientWidth / 2, cy = focus?.y ?? scroller.clientHeight / 2;
    const oldH = scroller.scrollHeight, oldW = scroller.scrollWidth;
    const ry = (scroller.scrollTop + cy) / oldH, rx = (scroller.scrollLeft + cx) / oldW;
    zoom = z;
    layout();
    scroller.scrollTop = ry * scroller.scrollHeight - cy;
    scroller.scrollLeft = rx * scroller.scrollWidth - cx;
    visible.forEach((n) => renderPage(n));
    updateCurrent();
  }
  // pinch (touch events so we can keep scrolling natively with one finger)
  let pz = null;
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  scroller.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const r = scroller.getBoundingClientRect();
      pz = { d: dist(e.touches[0], e.touches[1]), z: zoom, x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top, f: 1 };
    }
  }, { passive: true });
  scroller.addEventListener('touchmove', (e) => {
    if (pz && e.touches.length === 2) {
      if (e.cancelable) e.preventDefault();
      pz.f = dist(e.touches[0], e.touches[1]) / pz.d;
      pagesBox.style.transformOrigin = `${scroller.scrollLeft + pz.x}px ${scroller.scrollTop + pz.y}px`;
      pagesBox.style.transform = `scale(${clamp(pz.z * pz.f, 0.6, 5) / pz.z})`;
    }
  }, { passive: false });
  scroller.addEventListener('touchend', () => {
    if (pz) {
      const p = pz; pz = null;
      pagesBox.style.transform = ''; pagesBox.style.transformOrigin = '';
      setZoom(p.z * p.f, { x: p.x, y: p.y });
    }
  });
  scroller.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const r = scroller.getBoundingClientRect();
    setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), { x: e.clientX - r.left, y: e.clientY - r.top });
  }, { passive: false });

  let rz;
  const onResize = () => { clearTimeout(rz); rz = setTimeout(() => { layout(); visible.forEach((n) => renderPage(n)); }, 150); };
  window.addEventListener('resize', onResize);

  /* ---------- outline ---------- */
  async function resolveDest(dest) {
    try {
      const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
      if (!d) return null;
      const ref = d[0];
      return typeof ref === 'object' ? (await doc.getPageIndex(ref)) + 1 : ref + 1;
    } catch { return null; }
  }
  async function outlineSheet() {
    const out = await doc.getOutline().catch(() => null);
    if (!out || !out.length) { toast(t('noOutline')); return; }
    const s = openSheet({ title: t('outline'), tall: true });
    const walk = (nodes, lvl) => nodes.forEach((n) => {
      s.body.append(h('button', { class: 'toc-row', style: { paddingInlineStart: 16 + lvl * 16 + 'px' }, dir: 'auto', onClick: async () => { const p = await resolveDest(n.dest); s.close(); if (p) setTimeout(() => goto(p), 80); } }, n.title));
      if (n.items?.length) walk(n.items, lvl + 1);
    });
    walk(out, 0);
  }

  /* ---------- flip-book mode ---------- */
  const bs = { mode: state.settings.pdfBookMode === 'single' ? 'single' : 'spread', rtl: !!state.settings.pdfBookRtl, cover: state.settings.pdfBookCover !== false, view: validView(state.settings.pdfBookView), jump: state.settings.pdfJump === 'fan' ? 'fan' : 'instant' };
  function pickView() { if (book) viewSheet({ current: bs.view, onPick: (v) => { bs.view = v; setSetting('pdfBookView', v); book?.setView(v); } }); }
  const baseCache = new Map();                                   // the plain PDF pictures: writing on a page redraws only the ink, not the PDF
  async function getBase(n, w) {
    const k = n + ':' + w;
    if (baseCache.has(k)) { const v = baseCache.get(k); baseCache.delete(k); baseCache.set(k, v); return v; }
    const page = await doc.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    sizes.set(n, [v1.width, v1.height]);
    const vp = page.getViewport({ scale: w / v1.width });
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(vp.width)); cv.height = Math.max(1, Math.round(vp.height));
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    if (!destroyed) { baseCache.set(k, cv); while (baseCache.size > 3) baseCache.delete(baseCache.keys().next().value); }
    return cv;
  }
  async function getBitmap(n, w) {
    const base = await getBase(n, w);
    if (!ink) return base;
    await ink.ready;
    if (!ink || !ink.hasInk(n)) return base;
    const cv = document.createElement('canvas'); cv.width = base.width; cv.height = base.height;
    const c = cv.getContext('2d'); c.drawImage(base, 0, 0);
    ink.paintInk(c, n, cv.width);
    return cv;
  }
  function setBookMode(on) {
    if (on === bookOn || destroyed) return;
    bookOn = on;
    root.classList.toggle('bookmode', on); bookBtn.classList.toggle('on', on);
    if (on) {
      ink = createBookInk({ item, N, ratio: vp1.width / vp1.height, sizeOf: (n) => sizeOf(n), getBook: () => book,
        onPrev: () => book?.prev(), onNext: () => book?.next(), onBoard: () => drawOnPdf(), onDone: () => setWrite(false) });
      root.append(ink.bar);
      book = createFlipBook({ host: bookHost, N, ratio: vp1.width / vp1.height, page: curPage, rtl: bs.rtl, cover: bs.cover, backCover: bs.cover, mode: bs.mode, view: bs.view, jump: bs.jump, focus: 'both', night: scroller.classList.contains('night'), getBitmap,
        onInk: (ev) => ink?.onInk(ev),
        onZoom: (k) => { fitBtn.hidden = k < 1.02; },
        onPage: (n) => { curPage = n; pill.textContent = `${n} / ${N}`; slider.value = n; persist(); ink?.fresh().then((ch) => { if (ch) book?.refreshAll(); }); } });
      root.__book = book; root.__ink = ink;
      setFocusUi('both');
    } else {
      const p = curPage;
      setWrite(false);
      ink?.bar.remove(); ink?.destroy(); ink = null; root.__ink = null;
      baseCache.clear(); fitBtn.hidden = true;
      book?.destroy(); book = null; root.__book = null;
      requestAnimationFrame(() => goto(p));
    }
  }
  /** writing on the pages: one finger / the pen writes, two fingers still zoom and move the book */
  function setWrite(on) {
    on = !!on && !!book;
    if (on === writeOn) return;
    writeOn = on;
    root.classList.toggle('inking', on); writeBtn.classList.toggle('on', on);
    book?.setWrite(on);
    if (on) { ink?.ui(); toast(t('bi_hint')); }
  }
  function setFocusUi(f) { focusBtns.forEach((b) => b.classList.toggle('on', b.dataset.f === f)); bookCtl.classList.toggle('single', bs.mode === 'single'); }
  function setFocus(f) { if (!book) return; book.setFocus(f); setFocusUi(f); }
  function bookOptions() {
    if (!book) return;
    const sh = openSheet({ title: t('pdfBookOpts') });
    const seg = (opts, val, onPick) => h('div', { class: 'seg' }, opts.map(([v, label]) => h('button', { class: 'seg-b' + (val === v ? ' on' : ''), type: 'button', onClick: () => { onPick(v); sh.close(); } }, label)));
    const rowEl = (title, sub, ctl) => h('div', { class: 'row col' }, h('span', { class: 'row-tx' }, h('b', null, title), sub ? h('small', null, sub) : null), ctl);
    sh.body.append(
      rowEl(t('pdfBookLayout'), null, seg([['spread', t('pdfBookTwo')], ['single', t('pdfBookOne')]], bs.mode, (v) => { bs.mode = v; setSetting('pdfBookMode', v); book.setMode(v); setFocusUi('both'); })),
      rowEl(t('pdfBookDir'), t('pdfBookDirSub'), seg([[false, t('pdfBookLtr')], [true, t('pdfBookRtl')]], bs.rtl, (v) => { bs.rtl = v; setSetting('pdfBookRtl', v); book.setRtl(v); })),
      rowEl(t('bk_jump'), t('pdfJumpSub'), seg([['instant', t('pdfJumpNow')], ['fan', t('bk_jFan')]], bs.jump, (v) => { bs.jump = v; setSetting('pdfJump', v); book.setJump(v); })),
      rowEl(t('pdfBookCovers'), t('pdfBookCoversSub'), seg([[true, t('on')], [false, t('off')]], bs.cover, (v) => { bs.cover = v; setSetting('pdfBookCover', v); book.setCover(v); book.setBackCover(v); })),
      h('div', { class: 'row col' }, h('div', { class: 'chips' },
        h('button', { class: 'chip', type: 'button', onClick: () => { sh.close(); book?.gotoSpread(0, true); } }, t('pdfBookToStart')),
        h('button', { class: 'chip', type: 'button', onClick: () => { sh.close(); book?.gotoSpread(book.last, true); } }, t('pdfBookToEnd')))));
  }

  /* ---------- go ---------- */
  loader.remove();
  const resume = item.progress?.pos;
  updateCurrent();
  if (resume && resume.p > 1) { curPage = clamp(resume.p, 1, N); if (!state.settings.pdfBook) requestAnimationFrame(() => goto(resume.p, resume.off || 0)); }
  if (state.settings.pdfBook) setBookMode(true);
  setTimeout(() => root.classList.add('chrome-hint'), 50);

  const onKey = (e) => {
    if (cut?.on) return;
    if (bookOn) {
      if (e.key === 'ArrowRight') { bs.rtl ? book?.prev() : book?.next(); return; }
      if (e.key === 'ArrowLeft') { bs.rtl ? book?.next() : book?.prev(); return; }
      if (e.key === 'Escape') { if (writeOn) setWrite(false); else V.close(); return; }
      if (e.key === '+' || e.key === '=') { book?.zoomBy(1.3); return; }
      if (e.key === '-') { book?.zoomBy(1 / 1.3); return; }
      if (e.key === '0') { book?.resetZoom(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && writeOn) { e.preventDefault(); e.shiftKey ? ink?.redo() : ink?.undo(); return; }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'PageDown') scroller.scrollBy({ top: scroller.clientHeight * 0.85, behavior: 'smooth' });
    else if (e.key === 'ArrowUp' || e.key === 'PageUp') scroller.scrollBy({ top: -scroller.clientHeight * 0.85, behavior: 'smooth' });
    else if (e.key === 'Escape') V.close();
    else if (e.key === '+') setZoom(zoom * 1.2);
    else if (e.key === '-') setZoom(zoom / 1.2);
  };
  document.addEventListener('keydown', onKey);

  function cleanup() {
    destroyed = true;
    persist.flush?.();
    document.removeEventListener('keydown', onKey);
    cut?.close(); cut = null;
    ink?.destroy(); ink = null;
    book?.destroy(); book = null;
    window.removeEventListener('resize', onResize);
    io?.disconnect();
    rendered.forEach((r) => r.task?.cancel());
    try { task?.destroy(); } catch { /* ignore */ }
  }
}
