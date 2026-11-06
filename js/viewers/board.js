// Whiteboard viewer: toolbar, options, selection bar, media playback on the board, pages, export, presentation.
import { h, stripExt, fmtDur, canvasToBlob } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { state, updateItem } from '../store.js';
import { toast, actionSheet, confirmDialog, promptDialog, progressCard, pushLayer } from '../ui.js';
import { exportBlob } from '../native.js';
import { importFiles } from '../import.js';
import { mountViewer, touchOpened } from './common.js';
import { BoardCanvas, clipboardCount } from '../board/canvas.js';
import { createAssets, refOf, resolveRef } from '../board/assets.js';
import { loadDoc, makeSaver, exportPng, exportPdf, isBoard } from '../board/io.js';
import { insertPage, newPage } from '../board/doc.js';
import { isDark, inkFor } from '../board/render.js';
import { isObj } from '../board/geom.js';
import { PALETTE, HL_PALETTE, colorSheet, styleSheet, pagesSheet, pickItem, settingsSheet } from '../board/sheets.js';

const SHAPES = [['line', 'bdLine'], ['arrow', 'bdArrow'], ['rect', 'bdRect'], ['ellipse', 'bdEllipse'], ['tri', 'bdTri'], ['diamond', 'bdDiamond']];
const TOOLS = [['pen', 'bdPen', 'bd_pen'], ['hl', 'bdMarker', 'bd_hl'], ['eraser', 'bdEraser', 'bd_eraser'], ['shape', 'bdShapes', 'bd_shapes'], ['text', 'bdText', 'bd_text'], ['select', 'bdSelect', 'bd_select']];
const NOTE_COLORS = ['#fde68a', '#fbcfe8', '#bfdbfe', '#bbf7d0', '#e9d5ff'];
const QUICK = ['#14161c', '#ef4444', '#f97316', '#22c55e', '#3b82f6', '#8b5cf6'];
const PREF_KEY = 'ahos.board.prefs';

const defaults = () => ({
  tool: 'pen', pen: { c: '#14161c', w: 3 }, hl: { c: '#fde047', w: 16 }, eraser: { mode: 'part', size: 34 },
  shape: { kind: 'rect', c: '#3b82f6', w: 3, f: false }, text: { c: '#14161c', size: 28, bold: false, bg: null }, laser: { c: '#ef4444' },
  penOnly: false, assist: 'off', snap: false,
});
function loadPrefs() {
  const d = defaults();
  try {
    const s = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    for (const k of Object.keys(d)) if (s[k] != null) d[k] = typeof d[k] === 'object' && !Array.isArray(d[k]) ? { ...d[k], ...s[k] } : s[k];
  } catch { /* defaults */ }
  d.tool = 'pen';
  return d;
}

export async function openBoard(id) {
  const item = state.items.get(id);
  if (!item) return;
  touchOpened(id);
  let canvas = null, assets = null, saver = null, doc = null, destroyed = false;
  const prefs = loadPrefs();
  const savePrefs = () => { try { const { tool, ...rest } = prefs; localStorage.setItem(PREF_KEY, JSON.stringify(rest)); } catch { /* storage unavailable */ } };

  const V = mountViewer('bdv', { onClose: cleanup });
  const root = V.el;
  root.append(h('div', { class: 'viewer-loading' }, h('div', { class: 'spinner' }), h('span', null, t('bd_opening'))));
  try { doc = await loadDoc(id); } catch (e) { console.error(e); toast(t('bd_failed')); V.close(); return; }
  if (destroyed) return;
  root.replaceChildren();

  assets = createAssets(() => canvas?.invalidate());
  saver = makeSaver(id, doc, assets);
  doc.onChange(() => { saver.schedule(); refreshChrome(); });

  /* ---------- skeleton ---------- */
  const stage = h('div', { class: 'bd-stage' });
  const vidBox = h('div', { class: 'bd-vid' });
  stage.append(vidBox);
  const titleEl = h('button', { class: 'bd-title', dir: 'auto', onClick: renameBoard }, stripExt(item.name));
  const undoBtn = h('button', { class: 'vbtn', 'aria-label': t('bd_undo'), html: ic('bdUndo'), onClick: () => canvas.doc.undo() });
  const redoBtn = h('button', { class: 'vbtn', 'aria-label': t('bd_redo'), html: ic('bdRedo'), onClick: () => canvas.doc.redo() });
  const top = h('div', { class: 'bd-top', dir: document.documentElement.dir },
    h('button', { class: 'vbtn', 'aria-label': t('back'), onClick: () => V.close(), html: ic('back', 'flip-rtl') }),
    titleEl, undoBtn, redoBtn,
    h('button', { class: 'vbtn', 'aria-label': t('bd_pages'), onClick: () => openPages(), html: ic('bdPages') }),
    h('button', { class: 'vbtn', 'aria-label': t('more'), onClick: () => moreMenu(), html: ic('more') }));
  const opts = h('div', { class: 'bd-opts' });
  const tools = h('div', { class: 'bd-tools' });
  const dock = h('div', { class: 'bd-dock' }, opts, tools);
  const pillLabel = h('button', { class: 'pn', onClick: () => openPages() }, '1 / 1');
  const pill = h('div', { class: 'bd-pill' },
    h('button', { class: 'vbtn', 'aria-label': t('previous'), onClick: () => goPage(-1), html: ic('back') }), pillLabel,
    h('button', { class: 'vbtn', 'aria-label': t('next'), onClick: () => goPage(1), html: ic('chev') }),
    h('button', { class: 'vbtn', 'aria-label': t('bd_addPage'), onClick: () => addPage(), html: ic('plus') }));
  const fitBtn = h('button', { class: 'vbtn', 'aria-label': t('bd_fit'), onClick: () => canvas.fitView(), html: ic('fit') });
  const zoom = h('div', { class: 'bd-zoom' }, fitBtn);
  const selbar = h('div', { class: 'bd-selbar', style: { display: 'none' } });
  const mbar = h('div', { class: 'bd-mbar', style: { display: 'none' } });
  const pbar = h('div', { class: 'bd-pbar' });
  root.append(stage, top, pill, zoom, dock, selbar, mbar, pbar);

  canvas = new BoardCanvas({ doc, stage, assets, prefs });

  /* ---------- helpers ---------- */
  function onAnyUp() { setTimeout(() => { selbar.style.visibility = ''; updateSelBar(); }, 0); }
  function onVis() { if (document.hidden) saver.flush(); }
  function goPage(d) { canvas.setPage(canvas.doc.cur + d); }
  function addPage() {
    const p = doc.page;
    doc.edit((pages) => insertPage(pages, doc.cur + 1, newPage(p.w, p.h)), null, doc.cur + 1);
    toast(t('bd_pageAdded'));
  }
  function showHintOnce() {
    try { if (localStorage.getItem('ahos.board.hint')) return; localStorage.setItem('ahos.board.hint', '1'); } catch { return; }
    const el = h('div', { class: 'bd-hint' }, t('bd_hint'));
    root.append(el);
    setTimeout(() => el.remove(), 4700);
  }
  function adaptInk() {
    const dark = canvas.isDarkPaper();
    const fix = (o, k = 'c') => { if (dark && o[k] === '#14161c') o[k] = '#ffffff'; else if (!dark && o[k] === '#ffffff') o[k] = '#14161c'; };
    fix(prefs.pen); fix(prefs.text); if (!prefs.text.bg) fix(prefs.text);
  }
  function layout() {
    const tb = top.offsetHeight, db = dock.offsetHeight;
    canvas.setInsets(tb, db);
    pill.style.bottom = (db + 10) + 'px';
    zoom.style.bottom = (db + 10) + 'px';
  }
  function refreshChrome() {
    undoBtn.classList.toggle('off', !doc.canUndo);
    redoBtn.classList.toggle('off', !doc.canRedo);
    pillLabel.textContent = `${doc.cur + 1} / ${doc.pages.length}`;
  }
  async function renameBoard() {
    const v = await promptDialog({ title: t('bd_boardRename'), value: stripExt(item.name) });
    if (!v) return;
    updateItem(id, { name: v.replace(/\.board$/i, '') + '.board' });
    titleEl.textContent = v.replace(/\.board$/i, '');
  }

  /* ---------- tools + options ---------- */
  function buildTools() {
    tools.replaceChildren(
      ...TOOLS.map(([k, icon, label]) => h('button', { class: 'bd-tool', dataset: { tool: k }, 'aria-label': t(label), title: t(label), onClick: () => { if (prefs.tool === k) { dock.classList.toggle('min'); layout(); } else { dock.classList.remove('min'); layout(); canvas.setTool(k); } }, html: ic(icon) })),
      h('button', { class: 'bd-tool', 'aria-label': t('bd_insert'), title: t('bd_insert'), onClick: () => insertSheet(), html: ic('plus') }));
    markTools();
  }
  function markTools() { tools.querySelectorAll('.bd-tool[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === prefs.tool)); }

  function swatches(cur, onPick, palette = QUICK, { bg } = {}) {
    const list = palette.slice();
    const extra = cur && !list.some((c) => c.toLowerCase() === cur.toLowerCase()) ? [cur] : [];
    const dark = canvas.isDarkPaper();
    const mapc = (c) => (dark && c === '#14161c' ? '#ffffff' : c);
    return [
      ...list.map((c0) => { const c = mapc(c0); return h('button', { class: 'bd-sw' + (cur && cur.toLowerCase() === c.toLowerCase() ? ' on' : ''), style: { background: c }, 'aria-label': c, onClick: () => { onPick(c); savePrefs(); renderOpts(); } }); }),
      ...extra.map((c) => h('button', { class: 'bd-sw on', style: { background: c }, 'aria-label': c })),
      h('button', { class: 'bd-sw rainbow', 'aria-label': t('bd_color'), onClick: () => colorSheet({ current: cur, palette: bg ? NOTE_COLORS : (prefs.tool === 'hl' ? HL_PALETTE.concat(PALETTE) : PALETTE), onPick: (c) => { onPick(c); savePrefs(); renderOpts(); } }) }),
    ];
  }
  function slider(min, max, step, value, onInput, label) {
    const r = h('input', { class: 'bd-sz', type: 'range', min, max, step, value, 'aria-label': label, dir: 'ltr' });
    r.addEventListener('input', () => onInput(Number(r.value)));
    r.addEventListener('change', () => { savePrefs(); renderOpts(); });
    return r;
  }
  const dotPreview = (px, color) => h('span', { class: 'bd-dot' }, h('i', { style: { width: Math.max(3, Math.min(28, px)) + 'px', height: Math.max(3, Math.min(28, px)) + 'px', background: color || '#fff' } }));
  const obtn = (icon, label, fn, cls = '', text = true) => h('button', { class: 'bd-ob ' + cls, 'aria-label': label, onClick: fn }, icon ? h('span', { html: ic(icon) }) : null, text ? label : null);

  function renderOpts() {
    if (!canvas) return;
    const tool = prefs.tool;
    const kids = [];
    if (tool === 'pen' || tool === 'hl') {
      const o = prefs[tool];
      kids.push(...swatches(o.c, (c) => { o.c = c; }, tool === 'hl' ? HL_PALETTE : QUICK), h('span', { class: 'bd-sep' }),
        slider(tool === 'hl' ? 8 : 0.8, tool === 'hl' ? 40 : 14, tool === 'hl' ? 1 : 0.2, o.w, (v) => { o.w = v; }, t('bd_size')),
        dotPreview(o.w * (canvas.view.s || 1), o.c));
    } else if (tool === 'eraser') {
      kids.push(
        obtn('', t('bd_erasePart'), () => { prefs.eraser.mode = 'part'; savePrefs(); renderOpts(); }, prefs.eraser.mode === 'part' ? 'on' : ''),
        obtn('', t('bd_eraseStroke'), () => { prefs.eraser.mode = 'stroke'; savePrefs(); renderOpts(); }, prefs.eraser.mode === 'stroke' ? 'on' : ''),
        h('span', { class: 'bd-sep' }),
        slider(12, 120, 2, prefs.eraser.size, (v) => { prefs.eraser.size = v; }, t('bd_eraseSize')),
        dotPreview(prefs.eraser.size / 3, '#cbd5e1'),
        obtn('trash', t('bd_clearPage'), clearPage, 'danger'));
    } else if (tool === 'shape') {
      const o = prefs.shape;
      kids.push(...SHAPES.map(([k, icon]) => h('button', { class: 'bd-ob' + (o.kind === k ? ' on' : ''), 'aria-label': t('bd_shape_' + k), onClick: () => { o.kind = k; savePrefs(); renderOpts(); }, html: ic(icon) })),
        obtn('bdFill', t('bd_fill'), () => { o.f = !o.f; savePrefs(); renderOpts(); }, o.f ? 'on' : '', false),
        h('span', { class: 'bd-sep' }), ...swatches(o.c, (c) => { o.c = c; }), h('span', { class: 'bd-sep' }),
        slider(1, 14, 0.5, o.w, (v) => { o.w = v; }, t('bd_size')));
    } else if (tool === 'text') {
      const o = prefs.text;
      kids.push(slider(14, 96, 1, o.size, (v) => { o.size = v; }, t('bd_size')),
        obtn('bdBold', t('bd_bold'), () => { o.bold = !o.bold; savePrefs(); renderOpts(); }, o.bold ? 'on' : '', false),
        h('span', { class: 'bd-sep' }), ...swatches(o.c, (c) => { o.c = c; }), h('span', { class: 'bd-sep' }),
        h('button', { class: 'bd-sw' + (!o.bg ? ' on' : ''), style: { background: 'transparent' }, 'aria-label': t('bd_text'), onClick: () => { o.bg = null; savePrefs(); renderOpts(); } }),
        ...NOTE_COLORS.map((c) => h('button', { class: 'bd-sw' + (o.bg === c ? ' on' : ''), style: { background: c }, 'aria-label': t('bd_noteColor'), onClick: () => { o.bg = c; o.c = '#1f2937'; savePrefs(); renderOpts(); } })));
    } else if (tool === 'select') {
      kids.push(obtn('bdSelect', t('bd_selectAll'), () => canvas.selectAll()), obtn('bdCopy', clipboardCount() ? `${t('bd_paste')} (${clipboardCount()})` : t('bd_paste'), () => { if (canvas.paste()) toast(t('bd_pasted')); }, clipboardCount() ? '' : 'off'),
        canvas.sel.size ? null : h('span', { style: { fontSize: '12.5px', opacity: 0.7, whiteSpace: 'nowrap' } }, t('bd_selectHint')));
    } else if (tool === 'laser') {
      kids.push(...swatches(prefs.laser.c, (c) => { prefs.laser.c = c; }, ['#ef4444', '#22c55e', '#3b82f6', '#facc15', '#ffffff']), h('span', { style: { fontSize: '12.5px', opacity: 0.7 } }, t('bd_laserHint')));
    }
    opts.replaceChildren(...kids.filter(Boolean));
    requestAnimationFrame(layout);
  }
  async function clearPage() {
    if (!doc.page.strokes.length) return;
    if (!(await confirmDialog({ title: t('bd_clearPage'), message: t('bd_clearQ'), ok: t('delete'), danger: true }))) return;
    canvas.sel.clear();
    doc.edit((pages) => pages.map((p, i) => (i === doc.cur ? { ...p, strokes: [] } : p)));
  }

  /* ---------- selection bar ---------- */
  let posRaf = 0;
  function schedulePos() { if (posRaf) return; posRaf = requestAnimationFrame(() => { posRaf = 0; positionMedia(); updateSelBar(); }); }
  function updateSelBar() {
    const sel = canvas.selected();
    const box = canvas.selectionScreen();
    if (!sel.length || !box || (canvas.op && ['move', 'scale', 'marquee'].includes(canvas.op.type))) { selbar.style.display = 'none'; return; }
    const one = sel.length === 1 ? sel[0] : null;
    const kids = [];
    if (one?.t === 'media') kids.push(obtn('play', t('bd_play'), () => playMedia(one), '', true));
    if (one && (one.t === 'pdfp' || one.t === 'img')) kids.push(obtn('book', t('bd_openFile'), () => openFile(one), '', false));
    if (one?.t === 'text') kids.push(obtn('edit', t('bd_edit'), () => editText(one), '', false));
    kids.push(obtn('bdCopy', t('bd_copy'), () => { canvas.copySelection(); toast(t('bd_copied')); }, '', false),
      obtn('copy', t('bd_duplicate'), () => canvas.duplicateSelection(), '', false));
    if (sel.some((s) => !isObj(s))) kids.push(obtn('bdPalette', t('bd_color'), () => colorSheet({ current: one?.c, onPick: (c) => canvas.applyToSelection({ c }) }), '', false));
    kids.push(obtn('bdFront', t('bd_front'), () => canvas.reorder(true), '', false), obtn('bdBack', t('bd_back'), () => canvas.reorder(false), '', false), obtn('trash', t('bd_delete'), () => canvas.deleteSelection(), 'danger', false));
    selbar.replaceChildren(...kids);
    selbar.style.display = 'flex';
    const w = selbar.offsetWidth, hgt = selbar.offsetHeight;
    let x = (box[0] + box[2]) / 2 - w / 2, y = box[1] - hgt - 12;
    const minY = top.offsetHeight + 8, maxY = canvas.H - dock.offsetHeight - 70 - hgt; // keep clear of the page pill
    if (y < minY) y = box[3] + 14;
    if (y > maxY) y = minY;
    x = Math.max(8, Math.min(canvas.W - w - 8, x));
    selbar.style.left = x + 'px'; selbar.style.top = y + 'px';
  }

  /* ---------- text editor ---------- */
  let editor = null;
  function editText(stroke, x, y, over = {}) {
    commitEditor();
    const base = stroke ? { ...stroke } : { c: over.c || prefs.text.c, size: over.size || prefs.text.size, bold: over.bold ?? prefs.text.bold, bg: over.bg !== undefined ? over.bg : prefs.text.bg, x, y, s: '' };
    const wx = stroke ? stroke.x : x, wy = stroke ? stroke.y : y;
    const [sx, sy] = canvas.toScreen(wx, wy);
    const s = canvas.view.s;
    const worldW = stroke ? stroke.bw : (over.bw || 0);
    const width = Math.max(140, worldW ? worldW * s : Math.min(300, canvas.W - sx - 10));
    const ta = h('textarea', { rows: 1, dir: 'auto', placeholder: t('bd_textPh'), spellcheck: 'false' });
    ta.value = base.s || '';
    const px = Math.max(15, base.size * s);
    Object.assign(ta.style, { fontSize: px + 'px', width: width + 'px', color: base.c, fontWeight: base.bold ? '700' : '400', background: base.bg || 'rgba(255,255,255,.08)', padding: (base.bg ? 10 : 3) * s + 'px' });
    const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    ta.addEventListener('input', grow);
    const done = obtn('check', t('bd_done'), () => commitEditor(), 'on');
    const acts = h('div', { class: 'acts' }, done, stroke ? obtn('trash', t('bd_delete'), () => { ta.value = ''; commitEditor(); }, 'danger', false) : null);
    const box = h('div', { class: 'bd-text', style: { left: Math.max(6, Math.min(canvas.W - width - 6, sx)) + 'px', top: Math.max(top.offsetHeight + 4, sy) + 'px' } }, ta, acts);
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    stage.append(box);
    editor = { box, ta, base, stroke, over, done: false };
    // the phone's back button closes the text box first (and keeps the text), not the whole board
    editor.layer = pushLayer(() => commitEditor());
    grow();
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 60);
    // keep the box above the keyboard
    if (sy > canvas.H * 0.4) { canvas.view.y -= sy - canvas.H * 0.3; canvas.afterView(); box.style.top = canvas.H * 0.3 + 'px'; }
  }
  function commitEditor() {
    const ed = editor;
    if (!ed || ed.done) return;
    ed.done = true;
    editor = null;
    const text = ed.ta.value;
    ed.box.remove();
    try { ed.layer?.close(); } catch { /* already closed */ }
    canvas.commitText(ed.stroke, { ...ed.base, s: text, bw: ed.over?.bw });
    updateSelBar();
  }

  /* ---------- insert ---------- */
  function insertSheet() {
    actionSheet(t('bd_insert'), [
      { icon: 'bdPdf', label: t('bd_insertPdf'), hint: t('bd_fromLib'), onClick: () => insertPdf() },
      { icon: 'image', label: t('bd_insertImage'), hint: t('bd_fromLib'), onClick: () => insertImage() },
      { icon: 'video', label: t('bd_insertVideo'), hint: t('bd_fromLib'), onClick: () => insertMedia('video') },
      { icon: 'audio', label: t('bd_insertAudio'), hint: t('bd_fromLib'), onClick: () => insertMedia('audio') },
      { icon: 'bdNote', label: t('bd_insertNote'), onClick: () => insertNote() },
      { icon: 'bdText', label: t('bd_insertText'), onClick: () => { canvas.setTool('text'); const [cx, cy] = canvas.viewCenter(); editText(null, cx - 60, cy - 20); } },
      { icon: 'bdBlank', label: t('bd_insertPage'), onClick: () => addPage() },
    ]);
  }
  function insertNote() {
    canvas.setTool('text');
    const [cx, cy] = canvas.viewCenter();
    editText(null, cx - 95, cy - 70, { bg: NOTE_COLORS[0], c: '#1f2937', size: 20, bw: 190 });
  }
  const isPdf = (it) => it.kind === 'book' && it.ext === 'pdf';
  async function insertPdf() {
    const it = await pickItem({ title: t('bd_pickPdf'), filter: isPdf, accept: '.pdf,application/pdf', folderId: item.folderId });
    if (!it) return;
    const ref = refOf(it);
    let info;
    try { toast(t('opening')); info = await assets.pdfInfo(ref); } catch (e) { console.warn(e); toast(t('viewerFailed')); return; }
    actionSheet(stripExt(it.name), [
      { icon: 'bdPages', label: t('bd_pdfAsPages'), hint: t('bd_pdfAsPagesSub', { n: info.n }), onClick: () => pdfAsPages(ref, info) },
      { icon: 'bdPdf', label: t('bd_pdfOne'), hint: t('bd_pdfOneSub'), onClick: () => pdfOne(ref, info) },
      { icon: 'book', label: t('bd_pdfRead'), onClick: () => openItemById(it.id) },
    ]);
  }
  function pdfAsPages(ref, info) {
    const pages = [];
    for (let n = 1; n <= info.n; n++) pages.push(newPage(info.w, info.h, { bg: { ref, page: n } }));
    const onlyBlank = doc.pages.length === 1 && !doc.page.strokes.length && !doc.page.bg;
    const at = doc.cur;
    doc.edit((all) => (onlyBlank ? pages : [...all.slice(0, at + 1), ...pages, ...all.slice(at + 1)]), null, onlyBlank ? 0 : at + 1);
    toast(t('bd_pagesAdded', { n: info.n }));
  }
  async function pdfOne(ref, info) {
    let n = 1;
    if (info.n > 1) {
      const v = await promptDialog({ title: t('bd_pdfPageNo'), value: '1', type: 'number', inputmode: 'numeric', ok: t('ok'), message: `1 – ${info.n}` });
      if (!v) return;
      n = Math.max(1, Math.min(info.n, parseInt(v, 10) || 1));
    }
    const size = await assets.pdfPageSize(ref, n);
    canvas.setTool('select');
    canvas.placeObject({ t: 'pdfp', ref, page: n, w: size.w, h: size.h });
  }
  async function insertImage() {
    const it = await pickItem({ title: t('bd_pickImage'), filter: (x) => x.kind === 'image', accept: 'image/*', folderId: item.folderId });
    if (!it) return;
    const ref = refOf(it);
    const b = await assets.imageAsync(ref);
    if (!b) { toast(t('viewerFailed')); return; }
    canvas.setTool('select');
    canvas.placeObject({ t: 'img', ref, w: b.w, h: b.h });
  }
  async function insertMedia(kind) {
    const it = await pickItem({ title: t(kind === 'video' ? 'bd_pickVideo' : 'bd_pickAudio'), filter: (x) => x.kind === kind, accept: kind === 'video' ? 'video/*' : 'audio/*', folderId: item.folderId });
    if (!it) return;
    canvas.setTool('select');
    canvas.placeObject({ t: 'media', kind, ref: refOf(it), title: stripExt(it.meta?.title || it.name), w: kind === 'video' ? 360 : 320, h: kind === 'video' ? 203 : 96 }, { fitW: 300 });
  }
  async function openItemById(itemId) {
    stopMedia();
    const { openItem } = await import('./index.js');
    openItem(itemId);
  }
  function openFile(stroke) {
    const it = resolveRef(stroke.ref);
    if (!it) { toast(t('bd_mediaMissing')); return; }
    openItemById(it.id);
  }

  /* ---------- media playing on the board ---------- */
  let media = null;
  const mPlay = h('button', { class: 'vbtn', html: ic('pause') });
  const mSeek = h('input', { type: 'range', min: 0, max: 1000, value: 0, step: 1, 'aria-label': t('seek') });
  const mTime = h('span', { class: 'tm' }, '0:00');
  const mSpeed = h('button', { class: 'sp' }, '1×');
  const mFull = h('button', { class: 'vbtn', 'aria-label': t('bd_openPlayer'), html: ic('pip') });
  const mClose = h('button', { class: 'vbtn', 'aria-label': t('cancel'), html: ic('close') });
  mbar.append(mPlay, mTime, mSeek, mSpeed, mFull, mClose);
  const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
  mPlay.addEventListener('click', () => { if (!media) return; if (media.el.paused) media.el.play().catch(() => {}); else media.el.pause(); });
  mClose.addEventListener('click', () => stopMedia());
  mSpeed.addEventListener('click', () => { if (!media) return; const i = (SPEEDS.indexOf(media.el.playbackRate) + 1) % SPEEDS.length; media.el.playbackRate = SPEEDS[i]; mSpeed.textContent = SPEEDS[i] + '×'; });
  mFull.addEventListener('click', () => { if (!media) return; const r = resolveRef(media.stroke.ref); const t0 = media.el.currentTime; stopMedia(); if (r) { updateItem(r.id, { progress: { f: 0, pos: t0, at: Date.now() } }, { silent: true }); openItemById(r.id); } });
  let seeking = false;
  mSeek.addEventListener('input', () => { seeking = true; if (media && isFinite(media.el.duration)) media.el.currentTime = (mSeek.value / 1000) * media.el.duration; });
  mSeek.addEventListener('change', () => { seeking = false; });

  async function playMedia(stroke) {
    if (media && media.stroke === stroke) { if (media.el.paused) media.el.play().catch(() => {}); return; }
    stopMedia();
    if (assets.missing(stroke.ref)) { toast(t('bd_mediaMissing')); return; }
    const url = await assets.mediaURL(stroke.ref);
    if (!url || destroyed) { toast(t('bd_mediaMissing')); return; }
    const video = stroke.kind === 'video';
    const el = video ? h('video', { src: url, playsinline: '', preload: 'auto' }) : new Audio(url);
    media = { stroke, el };
    if (video) { vidBox.replaceChildren(el); vidBox.style.display = 'block'; canvas.setActiveMedia(stroke); }
    el.addEventListener('timeupdate', () => {
      const d = el.duration;
      mTime.textContent = `${fmtDur(el.currentTime)}${isFinite(d) ? ' / ' + fmtDur(d) : ''}`;
      if (!seeking && isFinite(d) && d > 0) mSeek.value = Math.round((el.currentTime / d) * 1000);
    });
    el.addEventListener('play', () => { mPlay.innerHTML = ic('pause'); });
    el.addEventListener('pause', () => { mPlay.innerHTML = ic('play'); });
    el.addEventListener('ended', () => { mPlay.innerHTML = ic('play'); });
    mSpeed.textContent = '1×';
    mPlay.innerHTML = ic('pause');
    mbar.style.display = 'flex';
    positionMedia();
    el.play().catch(() => { mPlay.innerHTML = ic('play'); });
  }
  function stopMedia() {
    if (!media) return;
    try { media.el.pause(); media.el.removeAttribute('src'); media.el.load?.(); } catch { /* already gone */ }
    media = null;
    vidBox.style.display = 'none'; vidBox.replaceChildren();
    mbar.style.display = 'none';
    canvas?.setActiveMedia(null);
    assets.releaseMedia();
  }
  function positionMedia() {
    if (!media) return;
    const st = media.stroke, onPage = doc.page.strokes.includes(st);
    if (!onPage) {
      if (st.kind === 'video') { vidBox.style.display = 'none'; mbar.style.display = 'none'; return; }
      mbar.style.display = 'flex';
      mbar.style.left = Math.max(8, (canvas.W - mbar.offsetWidth) / 2) + 'px'; mbar.style.top = (top.offsetHeight + 8) + 'px';
      return;
    }
    const s = canvas.view.s, [x, y] = canvas.toScreen(st.x, st.y);
    if (st.kind === 'video') {
      vidBox.style.display = 'block';
      vidBox.style.width = st.w + 'px'; vidBox.style.height = st.h + 'px';
      vidBox.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    }
    mbar.style.display = 'flex';
    const w = Math.min(canvas.W - 16, Math.max(340, Math.min(st.w * s, 440)));
    mbar.style.width = w + 'px';
    const barH = mbar.offsetHeight || 48;
    let by = y + st.h * s + 8;
    if (by + barH > canvas.H - dock.offsetHeight) by = y + st.h * s - barH - 6;
    by = Math.max(top.offsetHeight + 4, Math.min(canvas.H - dock.offsetHeight - barH - 4, by));
    mbar.style.left = Math.max(8, Math.min(canvas.W - w - 8, x + (st.w * s - w) / 2)) + 'px';
    mbar.style.top = by + 'px';
  }
  function onPageChange() { if (media) positionMedia(); updateSelBar(); }

  /* ---------- pages, style, settings ---------- */
  function openPages() { commitEditor(); pagesSheet({ doc, canvas, assets }); }
  const hasPdf = () => doc.pages.some((p) => p.bg);

  /* ---------- more menu, export, presentation ---------- */
  function moreMenu() {
    commitEditor();
    const src = doc.src && resolveRef(doc.src);
    actionSheet(stripExt(item.name), [
      { icon: 'bdPages', label: t('bd_pages'), hint: `${doc.pages.length}`, onClick: () => openPages() },
      { icon: 'bdBlank', label: t('bd_style'), onClick: () => styleSheet({ doc, canvas, hasPdf: hasPdf() }) },
      { icon: 'bdPresent', label: t('bd_present'), onClick: () => enterPresent() },
      { icon: 'share', label: t('bd_export'), onClick: () => exportSheet() },
      { icon: 'settings', label: t('bd_settings'), onClick: () => settingsSheet({ prefs, save: savePrefs, hasPdf: hasPdf(), doc, canvas }) },
      src ? { icon: 'book', label: t('bd_openPdfSrc'), onClick: () => openItemById(src.id) } : null,
      { icon: 'edit', label: t('rename'), onClick: renameBoard },
      { icon: 'trash', label: t('bd_clearPage'), danger: true, onClick: clearPage },
    ]);
  }
  function exportSheet() {
    actionSheet(t('bd_export'), [
      { icon: 'image', label: t('bd_expPng'), onClick: () => doExport('png') },
      { icon: 'bdPdf', label: t('bd_expPdfPage'), onClick: () => doExport('pdfPage') },
      doc.pages.length > 1 ? { icon: 'bdPages', label: t('bd_expPdfAll'), onClick: () => doExport('pdfAll') } : null,
      { icon: 'download', label: t('bd_expSave'), hint: t('bd_expNote'), onClick: () => doExport('save') },
    ]);
  }
  async function doExport(kind) {
    commitEditor();
    const card = progressCard(t('bd_exporting'));
    const base = stripExt(item.name);
    try {
      if (kind === 'png') {
        const blob = await exportPng(doc, doc.cur, assets);
        await exportBlob(`${base}-${doc.cur + 1}.png`, blob);
      } else {
        const idx = kind === 'pdfPage' ? [doc.cur] : doc.pages.map((_, i) => i);
        const blob = await exportPdf(doc, idx, assets, (f) => card.update(`${Math.round(f * 100)}%`, f));
        if (kind === 'save') {
          card.update(t('bd_importing'), 1);
          await importFiles([new File([blob], `${base}.pdf`, { type: 'application/pdf' })], item.folderId, { quiet: true });
          toast(t('bd_savedToLib'));
        } else await exportBlob(kind === 'pdfPage' ? `${base}-${doc.cur + 1}.pdf` : `${base}.pdf`, blob);
      }
    } catch (e) { console.warn('board export', e); toast(t('exportFailed')); } finally { card.done(); }
  }

  let present = null;
  function enterPresent() {
    if (present) return;
    commitEditor(); canvas.clearSelection();
    present = { tool: prefs.tool, layer: pushLayer(() => { present = null; leavePresent(); }) };
    root.classList.add('present');
    buildPBar();
    canvas.setInsets(0, 0);
    canvas.setTool('laser');
    canvas.fitView();
    markP();
  }
  function leavePresent() {
    root.classList.remove('present');
    canvas.setInsets(top.offsetHeight, dock.offsetHeight);
    canvas.setTool(['laser'].includes(prefs.tool) ? 'pen' : prefs.tool);
    canvas.fitView();
  }
  const pnum = h('span', { class: 'pn' }, '');
  function buildPBar() {
    const b = (icon, label, fn, key) => h('button', { class: 'vbtn', 'aria-label': label, dataset: key ? { p: key } : {}, onClick: fn, html: ic(icon) });
    pbar.replaceChildren(
      b('back', t('previous'), () => goPage(-1)), pnum, b('chev', t('next'), () => goPage(1)), h('span', { class: 'bd-sep' }),
      b('bdLaser', t('bd_laser'), () => { canvas.setTool('laser'); markP(); }, 'laser'),
      b('bdPen', t('bd_pen'), () => { canvas.setTool('pen'); markP(); }, 'pen'),
      b('bdEraser', t('bd_eraser'), () => { canvas.setTool('eraser'); markP(); }, 'eraser'),
      b('bdUndo', t('bd_undo'), () => doc.undo()), h('span', { class: 'bd-sep' }),
      b('close', t('bd_presentExit'), () => present?.layer.close()));
    markP();
  }
  function markP() { pbar.querySelectorAll('[data-p]').forEach((e) => e.classList.toggle('on', e.dataset.p === prefs.tool)); pnum.textContent = `${doc.cur + 1}/${doc.pages.length}`; }
  doc.onChange(() => { if (present) markP(); });

  /* ---------- keyboard (computers) ---------- */
  function onKey(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || destroyed) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doc.redo() : doc.undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doc.redo(); }
    else if (mod && e.key.toLowerCase() === 'c') { canvas.copySelection(); }
    else if (mod && e.key.toLowerCase() === 'v') { canvas.paste(); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); canvas.duplicateSelection(); }
    else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); canvas.setTool('select'); canvas.selectAll(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { canvas.deleteSelection(); }
    else if (e.key === 'PageDown') goPage(1);
    else if (e.key === 'PageUp') goPage(-1);
    else if (['1', '2', '3', '4', '5', '6'].includes(e.key) && !mod) canvas.setTool(TOOLS[Number(e.key) - 1][0]);
    else if (e.key === 'Escape') { canvas.clearSelection(); }
  }

  /* ---------- start ---------- */
  root.__bd = { doc, canvas, assets, prefs };
  adaptInk();
  buildTools();
  layout();
  if (doc.view && doc.view.page === doc.cur) canvas.restoreView(doc.view); else canvas.fitView();
  refreshChrome();
  renderOpts();
  showHintOnce();

  /* ---------- events from the canvas ---------- */
  canvas.on.tool = () => { markTools(); renderOpts(); updateSelBar(); };
  canvas.on.selection = () => { updateSelBar(); if (prefs.tool === 'select') renderOpts(); };
  canvas.on.history = () => refreshChrome();
  canvas.on.page = () => { refreshChrome(); onPageChange(); };
  canvas.on.view = () => { schedulePos(); };
  canvas.on.viewEnd = () => saver.viewChanged();
  canvas.on.text = ({ stroke, x, y }) => editText(stroke, x, y);
  canvas.on.media = ({ stroke }) => playMedia(stroke);
  canvas.on.openFile = ({ stroke }) => openFile(stroke);
  canvas.on.snapped = () => { try { navigator.vibrate?.(10); } catch { /* no vibration */ } };
  canvas.on.clip = () => renderOpts();
  stage.addEventListener('pointerdown', () => { selbar.style.visibility = 'hidden'; commitEditor(); }, true);
  window.addEventListener('pointerup', onAnyUp);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('keydown', onKey);
  window.addEventListener('pagehide', onVis);

  /* ---------- closing ---------- */
  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    try { commitEditor(); } catch { /* editor gone */ }
    window.removeEventListener('pointerup', onAnyUp);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pagehide', onVis);
    try { stopMedia(); } catch { /* ignore */ }
    const s = saver, a = assets, c = canvas;
    if (s) s.flush(true).finally(() => { a?.destroy(); });
    else a?.destroy();
    c?.destroy();
  }
}

export { isBoard };
