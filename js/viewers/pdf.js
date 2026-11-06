// PDF reader: continuous scroll, lazy page rendering, pinch / button zoom, night mode, outline, resume.
import { h, clamp, debounce } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { state, getBlob, setSetting } from '../store.js';
import { toast, openSheet, promptDialog } from '../ui.js';
import { mountViewer, touchOpened, saveProgress, barBtn } from './common.js';
import { loadPdfjs, pdfParams } from '../pdf-loader.js';
import { itemActions } from '../actions.js';
import { marksSheet } from '../marks.js';

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
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const V = mountViewer('pdfv', { onClose: cleanup });
  const root = V.el;
  const scroller = h('div', { class: 'pdf-scroll' + (state.settings.pdfNight ? ' night' : '') });
  const pagesBox = h('div', { class: 'pdf-pages' });
  scroller.append(pagesBox);
  const loader = h('div', { class: 'viewer-loading' }, h('div', { class: 'spinner' }), h('span', null, t('opening')));
  const pill = h('button', { class: 'pdf-pill', onClick: () => gotoDialog() }, '–');
  const slider = h('input', { class: 'pdf-slider', type: 'range', min: 1, max: 1, value: 1, 'aria-label': t('page'), dir: 'ltr' });
  const nightBtn = barBtn('moon', t('nightMode'), () => { scroller.classList.toggle('night'); setSetting('pdfNight', scroller.classList.contains('night')); nightBtn.classList.toggle('on', scroller.classList.contains('night')); });
  nightBtn.classList.toggle('on', !!state.settings.pdfNight);
  const top = h('div', { class: 'rv-top' },
    h('button', { class: 'vbtn', 'aria-label': t('back'), onClick: () => V.close(), html: ic('back', 'flip-rtl') }),
    h('div', { class: 'rv-title', dir: 'auto' }, item.meta?.title || item.name.replace(/\.pdf$/i, '')),
    barBtn('toc', t('outline'), () => outlineSheet()), nightBtn,
    barBtn('bdPen', t('bd_drawOnPdf'), () => drawOnPdf()),
    barBtn('zoomOut', t('zoomOut'), () => setZoom(zoom / 1.25)), barBtn('zoomIn', t('zoomIn'), () => setZoom(zoom * 1.25)),
    barBtn('more', t('more'), () => itemActions(id, { afterDelete: () => V.close() })));
  async function drawOnPdf() {
    try {
      const { openOrCreatePdfBoard } = await import('../board/io.js');
      const bid = await openOrCreatePdfBoard(item);
      (await import('./board.js')).openBoard(bid);
    } catch (e) { console.error(e); toast(t('bd_failed')); }
  }
  const markBtn = barBtn('bookmark', t('bookmarks'), () => marksSheet(item, { getHere: () => ({ pos: curPage }), onGo: (m) => goto(Number(m.pos) || 1) }));
  const bottom = h('div', { class: 'rv-bot', dir: 'ltr' }, markBtn, slider, pill);
  root.append(scroller, top, bottom, loader);

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
    const off = pageFraction();
    saveProgress(id, ((curPage - 1) + off) / Math.max(1, N), { p: curPage, off });
  }, 900);
  function pageFraction() {
    const el = pageEls[curPage - 1];
    return el ? clamp((scroller.scrollTop - el.offsetTop + PAD) / Math.max(1, el.offsetHeight), 0, 1) : 0;
  }
  function updateCurrent() {
    const mid = scroller.scrollTop + scroller.clientHeight * 0.4;
    let best = curPage, bestD = Infinity;
    const cand = visible.size ? [...visible] : [curPage];
    for (const n of cand) {
      const el = pageEls[n - 1];
      const d = mid < el.offsetTop ? el.offsetTop - mid : mid > el.offsetTop + el.offsetHeight ? mid - el.offsetTop - el.offsetHeight : 0;
      if (d < bestD) { bestD = d; best = n; }
    }
    if (best !== curPage) curPage = best;
    pill.textContent = `${curPage} / ${N}`;
    slider.value = curPage;
    persist();
  }
  let ticking = false;
  scroller.addEventListener('scroll', () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { ticking = false; updateCurrent(); }); }, { passive: true });
  slider.addEventListener('input', () => { pill.textContent = `${slider.value} / ${N}`; });
  slider.addEventListener('change', () => goto(Number(slider.value)));

  function goto(n, off = 0) {
    n = clamp(n, 1, N);
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

  /* ---------- go ---------- */
  loader.remove();
  const resume = item.progress?.pos;
  updateCurrent();
  if (resume && resume.p > 1) requestAnimationFrame(() => goto(resume.p, resume.off || 0));
  setTimeout(() => root.classList.add('chrome-hint'), 50);

  const onKey = (e) => {
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
    window.removeEventListener('resize', onResize);
    io?.disconnect();
    rendered.forEach((r) => r.task?.cancel());
    try { task?.destroy(); } catch { /* ignore */ }
  }
}
