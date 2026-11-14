// Whiteboard viewer: toolbar, options, selection bar, media playback on the board, pages, export, presentation.
import { h, stripExt, fmtDur, canvasToBlob } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { state, updateItem, removeItems } from '../store.js';
import { toast, actionSheet, confirmDialog, promptDialog, progressCard, pushLayer } from '../ui.js';
import { exportBlob } from '../native.js';
import { importFiles } from '../import.js';
import { mountViewer, touchOpened } from './common.js';
import { BoardCanvas, clipboardCount } from '../board/canvas.js';
import { createAssets, refOf, resolveRef } from '../board/assets.js';
import { loadDoc, makeSaver, exportPng, exportPdf, isBoard, parsePages, exportImagesZip, boardFileBlob, duplicateBoard } from '../board/io.js';
import { Doc, insertPage, newPage, blankData, DRAFT_PAPER, DRAFT_PATTERN, DRAFT_SIZE } from '../board/doc.js';
import { notePage } from '../board/note.js';
import { createBoardTimer } from '../board/timer.js';
import { isDark, inkFor, RB_D, RB_L, isRainbow, inkCss, inkSolid, inkName } from '../board/render.js';
import { isObj, canCrop, cropOf } from '../board/geom.js';
import { COVER_COLORS } from '../board/bookdraw.js';
import { PALETTE, HL_PALETTE, colorSheet, styleSheet, pagesSheet, pickItem, settingsSheet, pageSetupSheet, SIZES } from '../board/sheets.js';

const SHAPES = [['line', 'bdLine'], ['arrow', 'bdArrow'], ['rect', 'bdRect'], ['ellipse', 'bdEllipse'], ['tri', 'bdTri'], ['diamond', 'bdDiamond']];
const TOOLS = [['pen', 'bdPen', 'bd_pen'], ['hl', 'bdMarker', 'bd_hl'], ['hand', 'bdHand', 'bd_hand'], ['eraser', 'bdEraser', 'bd_eraser'], ['shape', 'bdShapes', 'bd_shapes'], ['text', 'bdText', 'bd_text'], ['select', 'bdSelect', 'bd_select']];
const DOCKS = ['bottom', 'top', 'left', 'right'];
const NOTE_COLORS = ['#fde68a', '#fbcfe8', '#bfdbfe', '#bbf7d0', '#e9d5ff'];
const QUICK = ['#14161c', '#ef4444', '#f97316', '#22c55e', '#3b82f6', RB_D, RB_L];
// bottled inks of the old days: blue-black, royal blue, turquoise, green, sepia, burgundy, violet, black
const INK_COLORS = ['#1b2a6b', '#1d4ed8', '#0e7490', '#15803d', '#7c2d12', '#be123c', '#6d28d9', '#111827'];
const NEON_COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#facc15', '#4ade80', '#fb923c', '#ffffff', '#60a5fa'];
const PENCIL_COLORS = ['#3b3f4a', '#1f2937', '#7c4a1d', '#b91c1c', '#1d4ed8', '#15803d', '#a16207', '#6d28d9'];
const NIBS = ['ball', 'ink', 'neon', 'pencil'];
const SYM_MODES = ['off', 'm2', 'm4', 'r6', 'r8', 'k12'];
const PREF_KEY = 'ahos.board.prefs';

const defaults = () => ({
  tool: 'pen', pen: { c: '#14161c', w: 3, k: 'ball' }, nibMem: { ball: { c: '#14161c', w: 3 }, ink: { c: '#1d4ed8', w: 4 }, neon: { c: '#22d3ee', w: 4 }, pencil: { c: '#3b3f4a', w: 3 } }, sym: 'off', hl: { c: '#fde047', w: 16 }, eraser: { mode: 'part', size: 34, shape: 'box' },
  shape: { kind: 'rect', c: '#3b82f6', w: 3, f: false }, text: { c: '#14161c', size: 28, bold: false, bg: null, auto: false }, laser: { c: '#ef4444' },
  penOnly: false, assist: 'off', smart: 'precise', smartV: 2, width: 'natural', snap: false, dock: 'bottom', draftClear: true, draftBox: null,
});
function loadPrefs() {
  const d = defaults();
  try {
    const s = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    for (const k of Object.keys(d)) if (s[k] != null) d[k] = typeof d[k] === 'object' && !Array.isArray(d[k]) ? { ...d[k], ...s[k] } : s[k];
  } catch { /* defaults */ }
  if (!DOCKS.includes(d.dock)) d.dock = 'bottom';
  if (!['off', 'precise', 'natural', 'smart', 'neat'].includes(d.smart)) d.smart = 'precise';
  if (d.smartV !== 2) { d.smart = 'precise'; d.smartV = 2; }   // 0.6.1: your own handwriting is the default; Smart / Neat are still one tap away
  if (!['natural', 'exact', 'screen'].includes(d.width)) d.width = 'natural';
  if (!NIBS.includes(d.pen.k)) d.pen.k = 'ball';
  if (!SYM_MODES.includes(d.sym)) d.sym = 'off';
  if (!['part', 'stroke', 'area'].includes(d.eraser.mode)) d.eraser.mode = 'part';
  if (!['box', 'free'].includes(d.eraser.shape)) d.eraser.shape = 'box';
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

  assets = createAssets(() => { canvas?.invalidate(); if (draft.canvas && draft.canvas !== canvas) draft.canvas.invalidate(); if (mainCanvas && mainCanvas !== canvas) mainCanvas.invalidate(); });
  saver = makeSaver(id, doc, assets);
  doc.onChange(() => { saver.schedule(); refreshChrome(); });

  /* ---------- skeleton ---------- */
  const stage = h('div', { class: 'bd-stage' });
  const vidBox = h('div', { class: 'bd-vid' });
  stage.append(vidBox);
  const titleTxt = h('span', { class: 'tt', dir: 'auto' }, stripExt(item.name));
  const saveEl = h('span', { class: 'sv' });
  const titleEl = h('button', { class: 'bd-title', onClick: renameBoard }, titleTxt, saveEl);
  const offSave = saver.onState((st) => { saveEl.textContent = st === 'saved' ? `✓ ${t('bd_saved')}` : `● ${t('bd_saving')}`; saveEl.classList.toggle('busy', st !== 'saved'); });
  const undoBtn = h('button', { class: 'bd-ur', 'aria-label': t('bd_undo'), title: t('bd_undo'), html: ic('bdUndo'), onClick: () => canvas.doc.undo() });
  const redoBtn = h('button', { class: 'bd-ur', 'aria-label': t('bd_redo'), title: t('bd_redo'), html: ic('bdRedo'), onClick: () => canvas.doc.redo() });
  const top = h('div', { class: 'bd-top', dir: document.documentElement.dir },
    h('button', { class: 'vbtn', 'aria-label': t('back'), onClick: () => V.close(), html: ic('back', 'flip-rtl') }),
    titleEl,
    h('button', { class: 'vbtn', 'aria-label': t('bd_pages'), onClick: () => openPages(), html: ic('bdPages') }),
    h('button', { class: 'vbtn', 'aria-label': t('more'), onClick: () => moreMenu(), html: ic('more') }));
  const opts = h('div', { class: 'bd-opts' });
  const tools = h('div', { class: 'bd-tools' });
  const grip = h('button', { class: 'bd-grip', 'aria-label': t('bd_dockMove'), title: t('bd_dockMove') }, h('i'));
  const colBtn = h('button', { class: 'bd-col', 'aria-label': t('bd_collapse'), title: t('bd_collapse'), html: ic('chevDown'), onClick: () => { dock.classList.toggle('min'); layout(); } });
  const dhead = h('div', { class: 'bd-dh' }, undoBtn, redoBtn, grip, colBtn);
  const dock = h('div', { class: 'bd-dock' }, h('div', { class: 'bd-strip' }, dhead, tools), opts);
  const pillLabel = h('button', { class: 'pn', onClick: () => openPages() }, '1 / 1');
  const pill = h('div', { class: 'bd-pill' },
    h('button', { class: 'vbtn', 'aria-label': t('previous'), onClick: () => goPage(-1), html: ic('back') }), pillLabel,
    h('button', { class: 'vbtn', 'aria-label': t('next'), onClick: () => goPage(1), html: ic('chev') }),
    h('button', { class: 'vbtn', 'aria-label': t('bd_addPage'), onClick: () => addPage(), html: ic('plus') }));
  const fitBtn = h('button', { class: 'vbtn', 'aria-label': t('bd_fit'), onClick: () => canvas.fitView(), html: ic('fit') });
  const draftBtn = h('button', { class: 'vbtn bd-draftbtn', 'aria-label': t('dr_title'), title: t('dr_title'), onClick: () => (draft.open ? hideDraft(false) : showDraft()), html: ic('bdDraft') });
  const zoom = h('div', { class: 'bd-zoom' }, draftBtn, fitBtn);
  const selbar = h('div', { class: 'bd-selbar', style: { display: 'none' } });
  const mbar = h('div', { class: 'bd-mbar', style: { display: 'none' } });
  const pbar = h('div', { class: 'bd-pbar' });
  root.append(stage, top, pill, zoom, dock, selbar, mbar, pbar);

  canvas = new BoardCanvas({ doc, stage, assets, prefs });
  const mainCanvas = canvas, mainDoc = doc;
  const timer = createBoardTimer({ host: root });
  const draft = { doc: null, canvas: null, open: false, layer: null, el: null, stage: null, head: null, fitted: false, syncT: 0, chip: null };

  /* ---------- helpers ---------- */
  function onAnyUp() { setTimeout(() => { selbar.style.visibility = ''; updateSelBar(); }, 0); }
  function onVis() { if (document.hidden) saver.flush(); }
  function goPage(d) { canvas.setPage(canvas.doc.cur + d); }
  function addPage() {
    const p = doc.page;
    doc.edit((pages) => insertPage(pages, doc.cur + 1, doc.note ? notePage(p.w, p.h) : newPage(p.w, p.h)), null, doc.cur + 1);
    toast(t('bd_pageAdded'));
  }
  function showHintOnce() {
    try { if (localStorage.getItem('ahos.board.hint')) return; localStorage.setItem('ahos.board.hint', '1'); } catch { return; }
    const el = h('div', { class: 'bd-hint' }, t('bd_hint'), h('br'), t('bd_dockHint'));
    root.append(el);
    setTimeout(() => el.remove(), 6700);
  }
  function adaptInk() {
    const dark = canvas.isDarkPaper();
    const fix = (o, k = 'c') => { if (dark && o[k] === '#14161c') o[k] = '#ffffff'; else if (!dark && o[k] === '#ffffff') o[k] = '#14161c'; };
    fix(prefs.pen); fix(prefs.text); if (!prefs.text.bg) fix(prefs.text);
  }
  /** Space taken by the toolbars (px), per edge. Side docks float over the page unless the screen is wide. */
  let ins = { top: 0, bottom: 0, left: 0, right: 0 };
  function applyDock() {
    const d = prefs.dock;
    dock.className = 'bd-dock dk-' + d + (dock.classList.contains('min') ? ' min' : '');
    colBtn.innerHTML = ic(d === 'top' ? 'chevDown' : d === 'bottom' ? 'chevDown' : d === 'left' ? 'back' : 'chev');
  }
  function layout() {
    if (!canvas) return;
    const d = prefs.dock, tb = top.offsetHeight, side = d === 'left' || d === 'right';
    dock.style.top = d === 'top' ? tb + 'px' : side ? (tb + 8) + 'px' : '';
    dock.style.maxHeight = side ? Math.max(160, canvas.H - tb - 20) + 'px' : '';
    const dw = dock.offsetWidth, dh = dock.offsetHeight, wide = canvas.W >= 700;
    ins = { top: tb + (d === 'top' ? dh : 0), bottom: d === 'bottom' ? dh : 0, left: d === 'left' && wide ? dw + 8 : 0, right: d === 'right' && wide ? dw + 8 : 0 };
    mainCanvas.setInsets(ins.top, ins.bottom, ins.left, ins.right);
    if (draft.open) placeDraft();
    const gap = ins.bottom ? (ins.bottom + 10) + 'px' : 'calc(10px + var(--safe-b))';
    pill.style.bottom = gap; zoom.style.bottom = gap;
    pill.style.left = (ins.left + (canvas.W - ins.left - ins.right) / 2) + 'px';
    zoom.style.left = zoom.style.right = ''; zoom.style.insetInlineEnd = '';
    if (side) { zoom.style.insetInlineEnd = 'auto'; zoom.style[d === 'right' ? 'left' : 'right'] = '10px'; }
  }
  function setDock(d) {
    if (!DOCKS.includes(d)) return;
    prefs.dock = d; savePrefs(); applyDock(); layout(); requestAnimationFrame(() => { layout(); canvas.fitView(); updateSelBar(); positionMedia(); });
  }
  /* drag the grip to an edge of the screen */
  function dragDock(e) {
    if (e.button > 0) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY; let zones = null, near = prefs.dock, moved = false;
    try { grip.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    const nearest = (x, y) => {
      const r = stage.getBoundingClientRect();
      const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height;
      const c = { left: fx, right: 1 - fx, top: fy * (r.height / r.width), bottom: (1 - fy) * (r.height / r.width) };
      return DOCKS.reduce((a, b) => (c[b] < c[a] ? b : a), 'bottom');
    };
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 10) return;
      if (!moved) {
        moved = true; dock.classList.add('moving');
        zones = h('div', { class: 'bd-zones' }, ...DOCKS.map((k) => h('div', { class: 'bd-zn ' + k, dataset: { z: k } }, h('span', { html: ic({ bottom: 'bdDock', top: 'bdDockTop', left: 'bdDockLeft', right: 'bdDockRight' }[k]) }), t('bd_dock_' + k))));
        root.append(zones);
      }
      near = nearest(ev.clientX, ev.clientY);
      zones.querySelectorAll('.bd-zn').forEach((z) => z.classList.toggle('on', z.dataset.z === near));
    };
    const up = (ev) => {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
      try { grip.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      dock.classList.remove('moving'); zones?.remove();
      if (moved && ev.type === 'pointerup' && near !== prefs.dock) setDock(near);
    };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  }
  grip.addEventListener('pointerdown', dragDock);
  function dockSheet() {
    actionSheet(t('bd_dockPos'), [
      { icon: 'bdDock', label: t('bd_dock_bottom'), hint: prefs.dock === 'bottom' ? '✓' : '', onClick: () => setDock('bottom') },
      { icon: 'bdDockTop', label: t('bd_dock_top'), hint: prefs.dock === 'top' ? '✓' : '', onClick: () => setDock('top') },
      { icon: 'bdDockLeft', label: t('bd_dock_left'), hint: prefs.dock === 'left' ? '✓' : '', onClick: () => setDock('left') },
      { icon: 'bdDockRight', label: t('bd_dock_right'), hint: prefs.dock === 'right' ? '✓' : '', onClick: () => setDock('right') },
    ]);
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
    titleTxt.textContent = v.replace(/\.board$/i, '');
  }

  /* ---------- tools + options ---------- */
  function buildTools() {
    tools.replaceChildren(
      ...TOOLS.map(([k, icon, label]) => h('button', { class: 'bd-tool', dataset: { tool: k }, 'aria-label': t(label), title: t(label), onClick: () => { if (prefs.tool === k) { dock.classList.toggle('min'); layout(); } else { dock.classList.remove('min'); layout(); canvas.setTool(k); } }, html: ic(icon) })),
      h('button', { class: 'bd-tool', 'aria-label': t('bd_insert'), title: t('bd_insert'), onClick: () => insertSheet(), html: ic('plus') }));
    markTools();
  }
  function markTools() { tools.querySelectorAll('.bd-tool[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === prefs.tool)); }

  function swatches(cur, onPick, palette = QUICK, { bg, noRainbow } = {}) {
    const list = palette.slice();
    const extra = cur && !list.some((c) => c.toLowerCase() === cur.toLowerCase()) ? [cur] : [];
    const dark = canvas.isDarkPaper();
    const mapc = (c) => (dark && c === '#14161c' ? '#ffffff' : c);
    return [
      ...list.map((c0) => { const c = mapc(c0); return h('button', { class: 'bd-sw' + (isRainbow(c) ? ' rb' : '') + (cur && cur.toLowerCase() === c.toLowerCase() ? ' on' : ''), style: { background: inkCss(c) }, 'aria-label': isRainbow(c) ? t(inkName(c)) : c, onClick: () => { onPick(c); savePrefs(); renderOpts(); } }); }),
      ...extra.map((c) => h('button', { class: 'bd-sw on' + (isRainbow(c) ? ' rb' : ''), style: { background: inkCss(c) }, 'aria-label': isRainbow(c) ? t(inkName(c)) : c })),
      h('button', { class: 'bd-sw custom', 'aria-label': t('bd_color'), html: ic('bdPalette'), onClick: () => colorSheet({ current: cur, rainbow: !bg && !noRainbow, palette: bg ? NOTE_COLORS : undefined, hl: prefs.tool === 'hl', onPick: (c) => { onPick(c); savePrefs(); renderOpts(); } }) }),
    ];
  }
  function slider(min, max, step, value, onInput, label) {
    const r = h('input', { class: 'bd-sz', type: 'range', min, max, step, value, 'aria-label': label, dir: 'ltr' });
    r.addEventListener('input', () => onInput(Number(r.value)));
    r.addEventListener('change', () => { savePrefs(); renderOpts(); });
    return r;
  }
  const dotPreview = (px, color) => h('span', { class: 'bd-dot' }, h('i', { style: { width: Math.max(3, Math.min(28, px)) + 'px', height: Math.max(3, Math.min(28, px)) + 'px', background: inkCss(color || '#fff') } }));
  const obtn = (icon, label, fn, cls = '', text = true) => h('button', { class: 'bd-ob ' + cls, 'aria-label': label, onClick: fn }, icon ? h('span', { html: ic(icon) }) : null, text ? label : null);

  let zoomUi = null;
  function updateZoomUi() {
    if (!zoomUi || prefs.tool !== 'hand') return;
    zoomUi.pct.textContent = canvas.zoomPct() + '%';
    if (document.activeElement !== zoomUi.rng) zoomUi.rng.value = Math.round(canvas.zoomFrac() * 1000);
  }
  function symSheet() {
    const set = (m) => () => { prefs.sym = m; canvas.setSym(m); savePrefs(); renderOpts(); };
    actionSheet(t('bd_sym'), SYM_MODES.map((m) => ({ icon: 'bdSym', label: t('bd_sym_' + m), hint: prefs.sym === m ? '✓' : '', onClick: set(m) })));
  }
  /** letter size that matches the pen nib: the nib's width in the board's own units, so a fat marker writes big letters and a fine pen small ones */
  function autoTextSize() { const w = canvas.penW ? canvas.penW(prefs.pen.w) : prefs.pen.w; return Math.max(14, Math.min(96, Math.round(w * 9.3))); }
  function renderOpts() {
    if (!canvas) return;
    zoomUi = null;
    const tool = prefs.tool;
    const kids = [];
    if (tool === 'pen' || tool === 'hl') {
      const o = prefs[tool];
      const nib = tool === 'pen' ? (NIBS.includes(o.k) ? o.k : 'ball') : null;
      if (tool === 'pen') {
        const setNib = (k) => {
          if (nib === k) return;
          prefs.nibMem[nib] = { c: o.c, w: o.w };
          const m = prefs.nibMem[k]; o.k = k; o.c = m.c; o.w = m.w;
          savePrefs(); renderOpts();
        };
        kids.push(obtn('', t('bd_nibBall'), () => setNib('ball'), nib === 'ball' ? 'on' : ''), obtn('bdNib', t('bd_nibInk'), () => setNib('ink'), nib === 'ink' ? 'on' : ''),
          obtn('bdGlow', t('bd_nibNeon'), () => setNib('neon'), nib === 'neon' ? 'on' : ''), obtn('bdPencil', t('bd_nibPencil'), () => setNib('pencil'), nib === 'pencil' ? 'on' : ''), h('span', { class: 'bd-sep' }));
      }
      kids.push(obtn('bdSym', t('bd_sym'), symSheet, prefs.sym !== 'off' ? 'on' : '', false), h('span', { class: 'bd-sep' }));
      const pal = tool === 'hl' ? HL_PALETTE : nib === 'ink' ? INK_COLORS : nib === 'neon' ? NEON_COLORS : nib === 'pencil' ? PENCIL_COLORS : QUICK;
      const solid = nib && nib !== 'ball';
      kids.push(...swatches(o.c, (c) => { o.c = c; }, pal, { noRainbow: solid }), h('span', { class: 'bd-sep' }),
        slider(tool === 'hl' ? 8 : solid ? 1.5 : 0.8, tool === 'hl' ? 40 : solid ? 12 : 14, tool === 'hl' ? 1 : 0.2, o.w, (v) => { o.w = v; }, t('bd_size')),
        dotPreview(o.w * (canvas.view.s || 1), o.c));
    } else if (tool === 'eraser') {
      const em = prefs.eraser.mode;
      kids.push(
        obtn('', t('bd_erasePart'), () => { prefs.eraser.mode = 'part'; savePrefs(); renderOpts(); }, em === 'part' ? 'on' : ''),
        obtn('', t('bd_eraseStroke'), () => { prefs.eraser.mode = 'stroke'; savePrefs(); renderOpts(); }, em === 'stroke' ? 'on' : ''),
        obtn('', t('bd_eraseArea'), () => { prefs.eraser.mode = 'area'; savePrefs(); renderOpts(); toast(t('bd_areaHint')); }, em === 'area' ? 'on' : ''),
        h('span', { class: 'bd-sep' }));
      if (em === 'area') {
        kids.push(
          obtn('', t('bd_areaBox'), () => { prefs.eraser.shape = 'box'; savePrefs(); renderOpts(); }, prefs.eraser.shape !== 'free' ? 'on' : ''),
          obtn('', t('bd_areaFree'), () => { prefs.eraser.shape = 'free'; savePrefs(); renderOpts(); }, prefs.eraser.shape === 'free' ? 'on' : ''));
      } else {
        kids.push(slider(12, 120, 2, prefs.eraser.size, (v) => { prefs.eraser.size = v; }, t('bd_eraseSize')), dotPreview(prefs.eraser.size / 3, '#cbd5e1'));
      }
      kids.push(obtn('trash', t('bd_clearPage'), clearPage, 'danger', false));
    } else if (tool === 'shape') {
      const o = prefs.shape;
      kids.push(...SHAPES.map(([k, icon]) => h('button', { class: 'bd-ob' + (o.kind === k ? ' on' : ''), 'aria-label': t('bd_shape_' + k), onClick: () => { o.kind = k; savePrefs(); renderOpts(); }, html: ic(icon) })),
        obtn('bdFill', t('bd_fill'), () => { o.f = !o.f; savePrefs(); renderOpts(); }, o.f ? 'on' : '', false),
        h('span', { class: 'bd-sep' }), ...swatches(o.c, (c) => { o.c = c; }), h('span', { class: 'bd-sep' }),
        slider(1, 14, 0.5, o.w, (v) => { o.w = v; }, t('bd_size')));
    } else if (tool === 'text') {
      const o = prefs.text;
      // size: by hand with the slider, or "Auto": the letters grow with the size of the pen nib (same as the line you write with)
      kids.push(obtn('', t('bd_autoSize'), () => { o.auto = !o.auto; savePrefs(); renderOpts(); }, o.auto ? 'on' : ''),
        o.auto ? slider(0.8, 14, 0.2, prefs.pen.w, (v) => { prefs.pen.w = v; }, t('bd_penSize')) : slider(14, 96, 1, o.size, (v) => { o.size = v; }, t('bd_size')),
        o.auto ? h('span', { class: 'bd-autoh' }, t('bd_autoNow', { n: autoTextSize() })) : null,
        obtn('bdBold', t('bd_bold'), () => { o.bold = !o.bold; savePrefs(); renderOpts(); }, o.bold ? 'on' : '', false),
        h('span', { class: 'bd-sep' }), ...swatches(o.c, (c) => { o.c = c; }), h('span', { class: 'bd-sep' }),
        // a sticky-note backing is one button; its colours only appear once it is on (the row stays short)
        obtn('bdNote', t('bd_noteColor'), () => { o.bg = o.bg ? null : NOTE_COLORS[0]; if (o.bg) o.c = '#1f2937'; savePrefs(); renderOpts(); }, o.bg ? 'on' : '', false),
        ...(o.bg ? NOTE_COLORS.map((c) => h('button', { class: 'bd-sw' + (o.bg === c ? ' on' : ''), style: { background: c }, 'aria-label': t('bd_noteColor'), onClick: () => { o.bg = c; o.c = '#1f2937'; savePrefs(); renderOpts(); } })) : []));
    } else if (tool === 'select') {
      kids.push(obtn('bdSelect', t('bd_selectAll'), () => canvas.selectAll()), obtn('bdCopy', clipboardCount() ? `${t('bd_paste')} (${clipboardCount()})` : t('bd_paste'), () => { if (canvas.paste()) toast(t('bd_pasted')); }, clipboardCount() ? '' : 'off'),
        canvas.sel.size ? null : h('span', { style: { fontSize: '12.5px', opacity: 0.7, whiteSpace: 'nowrap' } }, t('bd_selectHint')));
    } else if (tool === 'hand') {
      const rng = h('input', { class: 'bd-sz bd-zr', type: 'range', min: 0, max: 1000, step: 1, value: Math.round(canvas.zoomFrac() * 1000), 'aria-label': t('bd_zoom'), dir: 'ltr' });
      rng.addEventListener('input', () => canvas.setZoomFrac(Number(rng.value) / 1000));
      const pct = h('span', { class: 'bd-zp' }, canvas.zoomPct() + '%');
      zoomUi = { rng, pct };
      kids.push(
        h('button', { class: 'bd-ob', 'aria-label': t('bd_zoomOut'), onClick: () => canvas.zoomBy(1 / 1.35, ...canvas.centerPx()), html: ic('zoomOut') }),
        rng,
        h('button', { class: 'bd-ob', 'aria-label': t('bd_zoomIn'), onClick: () => canvas.zoomBy(1.35, ...canvas.centerPx()), html: ic('zoomIn') }),
        pct, h('span', { class: 'bd-sep' }),
        obtn('fit', t('bd_fitWidth'), () => canvas.fitView(), '', false),
        obtn('bdPages', t('bd_fitWhole'), () => canvas.fitWhole(), '', false));
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
  function cropBar() {
    const box = canvas.cropScreen();
    if (!box) return;
    const bg = canvas.crop.bg;
    selbar.replaceChildren(
      obtn('close', t('cancel'), () => canvas.cancelCrop(), '', true),
      obtn('fit', t('bd_cropReset'), () => canvas.cropReset(), '', true),
      obtn('check', bg ? t('bd_cropPiece') : t('bd_cropApply'), () => canvas.applyCrop(), 'on', true));
    selbar.style.display = 'flex';
    const w = selbar.offsetWidth, hgt = selbar.offsetHeight;
    let x = (box[0] + box[2]) / 2 - w / 2, y = box[3] + 16;
    const maxY = canvas.H - ins.bottom - 70 - hgt;
    if (y > maxY) y = Math.min(maxY, box[1] - hgt - 12);
    y = Math.max(ins.top + 8, Math.min(maxY, y));
    x = Math.max(ins.left + 8, Math.min(canvas.W - ins.right - w - 8, x));
    selbar.style.left = x + 'px'; selbar.style.top = y + 'px';
  }
  function updateSelBar() {
    if (canvas.crop) { cropBar(); return; }
    const sel = canvas.selected();
    const box = canvas.selectionScreen();
    if (!sel.length || !box || (canvas.op && ['move', 'scale', 'marquee'].includes(canvas.op.type))) { selbar.style.display = 'none'; return; }
    const one = sel.length === 1 ? sel[0] : null;
    const kids = [];
    if (one?.t === 'media') kids.push(obtn('play', t('bd_play'), () => playMedia(one), '', true));
    if (one && canCrop(one)) kids.push(obtn('bdCrop', t('bd_crop'), () => canvas.startCrop(one), '', false));
    if (one && (one.t === 'pdfp' || one.t === 'img')) kids.push(obtn('book', t('bd_openFile'), () => openFile(one), '', false));
    if (one?.t === 'book') kids.push(obtn('bookView', t('bk_view'), () => canvas.books.viewScene(one.id), '', false), obtn('settings', t('bk_settings'), () => canvas.books.openPanel(one.id), '', false));
    if (one?.t === 'text') kids.push(obtn('edit', t('bd_edit'), () => editText(one), '', false));
    kids.push(obtn('bdCopy', t('bd_copy'), () => { canvas.copySelection(); toast(t('bd_copied')); }, '', false),
      obtn('copy', t('bd_duplicate'), () => canvas.duplicateSelection(), '', false));
    if (sel.some((s) => !isObj(s))) kids.push(obtn('bdPalette', t('bd_color'), () => colorSheet({ current: one?.c, onPick: (c) => canvas.applyToSelection({ c }) }), '', false));
    kids.push(obtn('bdFront', t('bd_front'), () => canvas.reorder(true), '', false), obtn('bdBack', t('bd_back'), () => canvas.reorder(false), '', false), obtn('trash', t('bd_delete'), () => canvas.deleteSelection(), 'danger', false));
    selbar.replaceChildren(...kids);
    selbar.style.display = 'flex';
    const w = selbar.offsetWidth, hgt = selbar.offsetHeight;
    let x = (box[0] + box[2]) / 2 - w / 2, y = box[1] - hgt - 12;
    const minY = ins.top + 8, maxY = canvas.H - ins.bottom - 70 - hgt; // keep clear of the page pill
    if (y < minY) y = box[3] + 14;
    if (y > maxY) y = minY;
    x = Math.max(ins.left + 8, Math.min(canvas.W - ins.right - w - 8, x));
    selbar.style.left = x + 'px'; selbar.style.top = y + 'px';
  }

  /* ---------- text editor ---------- */
  let editor = null;
  function editText(stroke, x, y, over = {}) {
    commitEditor();
    const base = stroke ? { ...stroke } : { c: over.c || prefs.text.c, size: over.size || (prefs.text.auto ? autoTextSize() : prefs.text.size), bold: over.bold ?? prefs.text.bold, bg: over.bg !== undefined ? over.bg : prefs.text.bg, x, y, s: '' };
    const wx = stroke ? stroke.x : x, wy = stroke ? stroke.y : y;
    const [sx, sy] = canvas.toScreen(wx, wy);
    const s = canvas.view.s;
    const worldW = stroke ? stroke.bw : (over.bw || 0);
    const width = Math.max(140, worldW ? worldW * s : Math.min(300, canvas.W - sx - 10));
    const ta = h('textarea', { rows: 1, dir: 'auto', placeholder: t('bd_textPh'), spellcheck: 'false' });
    ta.value = base.s || '';
    const px = Math.max(15, base.size * s);
    Object.assign(ta.style, { fontSize: px + 'px', width: width + 'px', color: inkSolid(base.c), fontWeight: base.bold ? '700' : '400', background: base.bg || 'rgba(255,255,255,.08)', padding: (base.bg ? 10 : 3) * s + 'px' });
    const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    ta.addEventListener('input', grow);
    const done = obtn('check', t('bd_done'), () => commitEditor(), 'on');
    const acts = h('div', { class: 'acts' }, done, stroke ? obtn('trash', t('bd_delete'), () => { ta.value = ''; commitEditor(); }, 'danger', false) : null);
    const box = h('div', { class: 'bd-text', style: { left: Math.max(6, Math.min(canvas.W - width - 6, sx)) + 'px', top: Math.max(ins.top + 4, sy) + 'px' } }, ta, acts);
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
      draft.open ? null : { icon: 'video', label: t('bd_insertVideo'), hint: t('bd_fromLib'), onClick: () => insertMedia('video') },
      draft.open ? null : { icon: 'audio', label: t('bd_insertAudio'), hint: t('bd_fromLib'), onClick: () => insertMedia('audio') },
      { icon: 'bdNote', label: t('bd_insertNote'), onClick: () => insertNote() },
      { icon: 'bdText', label: t('bd_insertText'), onClick: () => { canvas.setTool('text'); const [cx, cy] = canvas.viewCenter(); editText(null, cx - 60, cy - 20); } },
      draft.open ? null : { icon: 'bdBlank', label: t('bd_insertPage'), onClick: () => addPage() },
    ].filter(Boolean));
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
      draft.open ? null : { icon: 'bdPages', label: t('bd_pdfAsPages'), hint: t('bd_pdfAsPagesSub', { n: info.n }), onClick: () => pdfAsPages(ref, info) },
      { icon: 'bookOpen', label: t('bd_pdfBook'), hint: t('bd_pdfBookSub'), onClick: () => pdfBook(ref, info) },
      { icon: 'bdPdf', label: t('bd_pdfOne'), hint: t('bd_pdfOneSub'), onClick: () => pdfOne(ref, info) },
      { icon: 'book', label: t('bd_pdfRead'), onClick: () => openItemById(it.id) },
    ].filter(Boolean));
  }
  function pdfAsPages(ref, info) {
    const pages = [];
    for (let n = 1; n <= info.n; n++) pages.push(newPage(info.w, info.h, { bg: { ref, page: n } }));
    const onlyBlank = doc.pages.length === 1 && !doc.page.strokes.length && !doc.page.bg;
    const at = doc.cur;
    doc.edit((all) => (onlyBlank ? pages : [...all.slice(0, at + 1), ...pages, ...all.slice(at + 1)]), null, onlyBlank ? 0 : at + 1);
    toast(t('bd_pagesAdded', { n: info.n }));
  }
  async function pdfBook(ref, info) {
    const size = await assets.pdfPageSize(ref, 1);
    const used = new Set(doc.page.strokes.filter((x) => x.t === 'book').map((x) => x.cc));
    const cc = COVER_COLORS.find((c) => !used.has(c)) || COVER_COLORS[0];
    canvas.placeBook({ ref, n: info.n, pr: size.w / size.h, cc });
    toast(t('bd_bookAdded'));
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
      mbar.style.left = Math.max(8, (canvas.W - mbar.offsetWidth) / 2) + 'px'; mbar.style.top = (ins.top + 8) + 'px';
      return;
    }
    const s = canvas.view.s, [x, y] = canvas.toScreen(st.x, st.y);
    if (st.kind === 'video') {
      vidBox.style.display = 'block';
      vidBox.style.width = st.w + 'px'; vidBox.style.height = st.h + 'px';
      vidBox.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
      // a cropped card: the video is laid out as the whole card and shifted so that only the kept part shows in the box
      const vid = vidBox.firstElementChild, cr = cropOf(st), cw = cr[2] - cr[0], ch = cr[3] - cr[1];
      if (vid) Object.assign(vid.style, { position: 'absolute', width: (100 / cw) + '%', height: (100 / ch) + '%', left: (-cr[0] / cw * 100) + '%', top: (-cr[1] / ch * 100) + '%' });
    }
    mbar.style.display = 'flex';
    const w = Math.min(canvas.W - 16, Math.max(340, Math.min(st.w * s, 440)));
    mbar.style.width = w + 'px';
    const barH = mbar.offsetHeight || 48;
    let by = y + st.h * s + 8;
    if (by + barH > canvas.H - ins.bottom) by = y + st.h * s - barH - 6;
    by = Math.max(ins.top + 4, Math.min(canvas.H - ins.bottom - barH - 4, by));
    mbar.style.left = Math.max(8, Math.min(canvas.W - w - 8, x + (st.w * s - w) / 2)) + 'px';
    mbar.style.top = by + 'px';
  }
  function onPageChange() { if (media) positionMedia(); updateSelBar(); }

  /* ---------- the draft: a loose sheet over the board ---------- */
  // A page of the size and colour you choose, floating above the board (the board stays visible and usable behind it). Drag the title bar to move it,
  // drag the corner to resize it, tap the colour dot for its colour / pattern / page size. What is written on it is kept inside the board file.
  const HEAD = 44;
  const draftHasInk = () => (draft.doc ? draft.doc.strokeCount() > 0 : !!(mainDoc.draft && mainDoc.draft.pages.some((p) => p.strokes.length)));
  const updateDraftBtn = () => draftBtn.classList.toggle('has', draftHasInk());
  function syncDraft(now = false) {
    clearTimeout(draft.syncT);
    const run = () => {
      if (!draft.doc) return;
      const pg = draft.doc.pages[0];
      const styled = draft.doc.paper !== DRAFT_PAPER || draft.doc.pattern !== DRAFT_PATTERN || (pg && (pg.w !== DRAFT_SIZE[0] || pg.h !== DRAFT_SIZE[1]));
      mainDoc.draft = (draft.doc.strokeCount() || styled) ? { paper: draft.doc.paper, pattern: draft.doc.pattern, pages: draft.doc.pages } : null;
      mainDoc.rev++; saver?.schedule(); updateDraftBtn();
    };
    if (now) run(); else draft.syncT = setTimeout(run, 350);
  }
  const rootBox = () => ({ W: root.clientWidth || 360, H: root.clientHeight || 640 });
  /** where the sheet sits when it has never been placed: the right side, below the top bar, the shape of its page */
  function draftBoxDefault(w0) {
    const { W, H } = rootBox(), pg = draft.doc.page, ratio = pg.w && pg.h ? pg.h / pg.w : 1.4;
    let w = w0 || Math.min(W - 20, Math.max(240, Math.min(W * (W < 600 ? 0.8 : 0.6), 480)));
    let hh = w * ratio + HEAD;
    const maxH = Math.max(200, H - ins.top - ins.bottom - 16);
    if (hh > maxH) { hh = maxH; w = Math.max(220, (hh - HEAD) / ratio); }
    return { x: Math.max(8, W - w - 12), y: ins.top + 8, w: Math.round(w), h: Math.round(hh) };
  }
  /** the sheet always stays between the top bar and the tool dock, so its title bar and its corner can be reached */
  const room = () => { const { W, H } = rootBox(); return { L: ins.left + 4, R: W - ins.right - 4, T: ins.top, B: H - ins.bottom - 4 }; };
  function clampBox(b) {
    const { L, R, T, B } = room();
    const w = Math.max(200, Math.min(R - L, b.w)), hh = Math.max(HEAD + 120, Math.min(B - T, b.h));
    return { x: Math.max(L, Math.min(R - w, b.x)), y: Math.max(T, Math.min(B - hh, b.y)), w, h: hh };
  }
  function placeDraft() {
    if (!draft.el) return;
    const b = clampBox(prefs.draftBox || draftBoxDefault());
    draft.el.style.width = b.w + 'px'; draft.el.style.height = b.h + 'px';
    draft.el.style.transform = `translate3d(${b.x}px,${b.y}px,0)`;
    draft.box = b;
  }
  const saveBox = () => { if (draft.box) { prefs.draftBox = { ...draft.box }; savePrefs(); } };
  function dragDraft(e) {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const b0 = { ...draft.box }, sx = e.clientX, sy = e.clientY;
    draft.head.setPointerCapture?.(e.pointerId);
    const mv = (ev) => { draft.box = clampBox({ ...b0, x: b0.x + ev.clientX - sx, y: b0.y + ev.clientY - sy }); draft.el.style.transform = `translate3d(${draft.box.x}px,${draft.box.y}px,0)`; };
    const up = () => { draft.head.removeEventListener('pointermove', mv); draft.head.removeEventListener('pointerup', up); draft.head.removeEventListener('pointercancel', up); saveBox(); };
    draft.head.addEventListener('pointermove', mv); draft.head.addEventListener('pointerup', up); draft.head.addEventListener('pointercancel', up);
  }
  function resizeDraft(e) {
    e.preventDefault(); e.stopPropagation();
    const b0 = { ...draft.box }, sx = e.clientX, sy = e.clientY, rtl = document.documentElement.dir === 'rtl';
    draft.grip.setPointerCapture?.(e.pointerId);
    const mv = (ev) => {
      const dx = (ev.clientX - sx) * (rtl ? -1 : 1);
      const { L, R, B } = room();                                         // the corner follows the finger, the opposite corner stays where it is
      const w = Math.max(200, Math.min(rtl ? b0.x + b0.w - L : R - b0.x, b0.w + dx)), hh = Math.max(HEAD + 120, Math.min(B - b0.y, b0.h + ev.clientY - sy));
      const nb = { x: rtl ? b0.x + b0.w - w : b0.x, y: b0.y, w, h: hh };
      draft.box = nb; draft.el.style.width = nb.w + 'px'; draft.el.style.height = nb.h + 'px'; draft.el.style.transform = `translate3d(${nb.x}px,${nb.y}px,0)`;
    };
    const up = () => { draft.grip.removeEventListener('pointermove', mv); draft.grip.removeEventListener('pointerup', up); draft.grip.removeEventListener('pointercancel', up); saveBox(); draft.canvas.resize(); draft.canvas.fitWhole(); };
    draft.grip.addEventListener('pointermove', mv); draft.grip.addEventListener('pointerup', up); draft.grip.addEventListener('pointercancel', up);
  }
  function openDraftSetup() {
    const pg = draft.doc.page, near = (a, b) => Math.abs(a - b) < 1.5;
    const known = SIZES.find((z) => (near(z.w, pg.w) && near(z.h, pg.h)) || (near(z.w, pg.h) && near(z.h, pg.w)));
    const cm = (v) => String(Math.round((v / 28.3465) * 100) / 100);
    const init = { paper: draft.doc.paper, pattern: draft.doc.pattern, ...(known ? { size: known.id, land: known.land ? !(pg.w > pg.h) : pg.w > pg.h } : { size: 'custom', unit: 'cm', cw: cm(pg.w), ch: cm(pg.h) }) };
    pageSetupSheet({ title: t('dr_setup'), cta: t('dr_apply'), init, allowEndless: false, onDone: ({ paper, pattern, size }) => applyDraftSetup(paper, pattern, size || DRAFT_SIZE) });
  }
  function applyDraftSetup(paper, pattern, size) {
    const d = draft.doc, pg = d.page, resized = size[0] !== pg.w || size[1] !== pg.h;
    d.paper = paper; d.pattern = pattern;
    d.quiet((pages) => pages.map((p) => ({ ...p, paper: undefined, pattern: undefined, w: size[0], h: size[1] })));
    d.changed('style');
    if (resized) {
      // the sheet keeps its width and takes the shape of the new page
      const b = draft.box || draftBoxDefault(), nb = draftBoxDefault(b.w);
      prefs.draftBox = clampBox({ ...nb, x: b.x, y: b.y }); savePrefs(); placeDraft();
      draft.canvas.resize(); draft.canvas.fitWhole();
    }
    draft.canvas.invalidate();
  }
  function buildDraft() {
    if (draft.el) return;
    const data = mainDoc.draft ? { paper: mainDoc.draft.paper, pattern: mainDoc.draft.pattern, night: false, cur: 0, view: null, src: null, pages: mainDoc.draft.pages }
      : blankData({ paper: DRAFT_PAPER, pattern: DRAFT_PATTERN, size: DRAFT_SIZE });
    draft.doc = new Doc(data);
    draft.stage = h('div', { class: 'bd-stage bd-dstage' });
    draft.col = h('button', { class: 'bd-dcol', type: 'button', 'aria-label': t('dr_setup'), title: t('dr_setup'), onClick: openDraftSetup }, h('i'));
    draft.chip = h('button', { class: 'bd-dclear', type: 'button', onClick: () => { prefs.draftClear = !prefs.draftClear; savePrefs(); paintDraftHead(); } });
    draft.title = h('span', { class: 'bd-dtitle' }, h('span', { html: ic('bdDraft') }), t('dr_title'));
    draft.hide = h('button', { class: 'bd-dhide', type: 'button', onClick: () => hideDraft(true) });
    draft.head = h('div', { class: 'bd-dhead', dir: document.documentElement.dir }, draft.title, draft.col, draft.chip, draft.hide);
    draft.grip = h('div', { class: 'bd-dgrip', role: 'separator', 'aria-label': t('dr_resize') }, h('i'));
    draft.el = h('div', { class: 'bd-draft' }, draft.head, draft.stage, draft.grip);
    root.insertBefore(draft.el, top);
    draft.head.style.height = HEAD + 'px';
    draft.head.addEventListener('pointerdown', dragDraft);
    draft.grip.addEventListener('pointerdown', resizeDraft);
    // the tools belong to the sheet while you work on it, and to the board when you touch the board
    draft.el.addEventListener('pointerdown', () => { if (draft.open && canvas !== draft.canvas) swapTo(draft.canvas, draft.doc); }, true);
    const prevPdfSize = assets.onPdfSize;                                // every canvas claims this callback; the draft has no PDF pages
    draft.canvas = new BoardCanvas({ doc: draft.doc, stage: draft.stage, assets, prefs });
    assets.onPdfSize = prevPdfSize;
    wire(draft.canvas, true);
    draft.canvas.setInsets(0, 0, 0, 0);
    draft.doc.onChange((kind) => { if (kind === 'style') { adaptInk(); paintDraftHead(); renderOpts(); } syncDraft(); refreshChrome(); });
    paintDraftHead();
    placeDraft();
  }
  function paintDraftHead() {
    if (!draft.chip) return;
    draft.col.firstChild.style.background = draft.doc.paper;
    draft.chip.classList.toggle('on', !!prefs.draftClear);
    draft.chip.textContent = prefs.draftClear ? t('dr_clearOn') : t('dr_clearOff');
    draft.hide.replaceChildren(h('span', { html: ic('close') }), prefs.draftClear ? t('dr_hideClear') : t('dr_hide'));
  }
  function swapTo(c, d) {
    canvas = c; doc = d;
    root.__bd = { doc: d, canvas: c, assets, prefs, mainDoc, mainCanvas, draft };
    root.classList.toggle('on-draft', !!draft.open && c === draft.canvas);
    adaptInk(); layout();
    canvas.setTool(prefs.tool === 'laser' ? 'pen' : prefs.tool); canvas.setSym?.(prefs.sym);
    markTools(); renderOpts(); refreshChrome(); updateSelBar(); canvas.invalidate();
  }
  function showDraft() {
    if (draft.open || destroyed || present) return;
    commitEditor(); canvas.clearSelection(); stopMedia();
    buildDraft();
    draft.open = true;
    root.classList.add('draft-open');
    placeDraft();
    requestAnimationFrame(() => { draft.el.classList.add('on'); draft.canvas.resize(); if (!draft.fitted) { draft.fitted = true; draft.canvas.fitWhole(); } });
    swapTo(draft.canvas, draft.doc);
    draft.layer = pushLayer(() => { if (draft.open) hideDraft(false); });   // the phone's back button hides it but keeps what is written
  }
  /** explicit = the Hide button: it clears the draft when "clear on hide" is on. The back button only hides. */
  function hideDraft(explicit) {
    if (!draft.open) return;
    commitEditor();
    draft.open = false;
    const l = draft.layer; draft.layer = null;
    try { l?.close(); } catch { /* already closed */ }
    draft.canvas.clearSelection();
    if (explicit && prefs.draftClear && draft.doc.strokeCount()) {
      draft.doc.edit((pages) => pages.map((p, i) => (i ? p : { ...newPage(p.w, p.h) })), null, 0);
      draft.doc.undoStack.length = 0; draft.doc.redoStack.length = 0;
    }
    draft.el.classList.remove('on'); root.classList.remove('draft-open', 'on-draft');
    swapTo(mainCanvas, mainDoc);
    syncDraft(true);
  }

  /* ---------- pages, style, settings ---------- */
  function openPages() { commitEditor(); pagesSheet({ doc, canvas, assets }); }
  const hasPdf = () => doc.pages.some((p) => p.bg);

  /* ---------- more menu, export, presentation ---------- */
  /** A page that has a PDF page as its background: cut a part of it out. The part becomes a piece on a new page, ready to enlarge or shrink. */
  function cropPdfPage() {
    const pg = doc.page;
    if (!pg.bg || !pg.w) return;
    canvas.setTool('select');
    canvas.startCrop({ t: 'pdfp', ref: pg.bg.ref, page: pg.bg.page, x: 0, y: 0, w: pg.w, h: pg.h }, { bg: true });
  }
  function cropToPage(obj) {
    const pg = doc.page, pw = pg.w || 595, ph = pg.h || 842, m = 20;
    const k = Math.min((pw - 2 * m) / obj.w, (ph - 2 * m) / obj.h);
    const w = Math.round(obj.w * k * 10) / 10, hh = Math.round(obj.h * k * 10) / 10;
    const piece = { ...obj, w, h: hh, x: Math.round(((pw - w) / 2) * 10) / 10, y: m };
    const at = doc.cur;
    doc.edit((all) => [...all.slice(0, at + 1), newPage(pw, ph, { strokes: [piece] }), ...all.slice(at + 1)], null, at + 1);
    toast(t('bd_cropPieceDone'));
  }
  function moreMenu() {
    commitEditor();
    const src = doc.src && resolveRef(doc.src);
    actionSheet(stripExt(item.name), [
      { section: t('bd_secPage') },
      { icon: 'bdPages', label: t('bd_pages'), hint: `${doc.pages.length}`, onClick: () => openPages() },
      { icon: 'bdBlank', label: t('bd_style'), onClick: () => styleSheet({ doc, canvas, hasPdf: hasPdf() }) },
      doc.page.bg ? { icon: 'bdCrop', label: t('bd_cropPdfPart'), hint: t('bd_cropPdfPartSub'), onClick: cropPdfPage } : null,
      { icon: 'trash', label: t('bd_clearPage'), danger: true, onClick: clearPage },
      { section: t('bd_secTools') },
      { icon: 'bdDraft', label: t('dr_title'), hint: t('dr_sub'), onClick: () => showDraft() },
      { icon: 'clock', label: t('tm_title'), hint: t('tm_sub'), onClick: () => timer.open() },
      { icon: 'bdPresent', label: t('bd_present'), onClick: () => enterPresent() },
      { section: t('bd_secSave') },
      { icon: 'download', label: t('bd_saveNow'), hint: t('bd_saveNowHint'), onClick: saveNow },
      { icon: 'share', label: t('bd_export'), onClick: () => exportSheet() },
      { section: t('bd_secBoard') },
      { icon: 'settings', label: t('bd_settings'), onClick: () => settingsSheet({ prefs, save: savePrefs, hasPdf: hasPdf(), doc, canvas }) },
      { icon: 'bdDock', label: t('bd_dockPos'), hint: t('bd_dock_' + prefs.dock), onClick: dockSheet },
      src ? { icon: 'book', label: t('bd_openPdfSrc'), onClick: () => openItemById(src.id) } : null,
      { icon: 'edit', label: t('rename'), onClick: renameBoard },
      { icon: 'bdCopy', label: t('bd_dup'), onClick: dupBoard },
      { icon: 'trash', label: t('bd_deleteBoard'), danger: true, onClick: deleteBoard },
    ]);
  }
  async function saveNow() {
    commitEditor();
    await saver.flush(true);
    toast(t('bd_savedToast'));
  }
  async function dupBoard() {
    commitEditor();
    await saver.flush(true);
    try { await duplicateBoard(item, doc); toast(t('bd_dupDone')); } catch (e) { console.warn('dup', e); toast(t('exportFailed')); }
  }
  async function deleteBoard() {
    commitEditor();
    if (!(await confirmDialog({ title: t('bd_deleteBoard'), message: t('bd_deleteBoardQ'), ok: t('delete'), danger: true }))) return;
    saver.cancel();
    try { await removeItems([id]); } catch (e) { console.warn('delete board', e); }
    toast(t('bd_deleted'));
    V.close();
  }
  function exportSheet() {
    actionSheet(t('bd_export'), [
      { icon: 'image', label: t('bd_expPng'), onClick: () => doExport('png') },
      { icon: 'bdPdf', label: t('bd_expPdfPage'), onClick: () => doExport('pdfPage') },
      doc.pages.length > 1 ? { icon: 'bdPages', label: t('bd_expPdfAll'), onClick: () => doExport('pdfAll') } : null,
      doc.pages.length > 1 ? { icon: 'bdPdf', label: t('bd_pagesWhich'), hint: 'PDF', onClick: () => doExport('pdfPick') } : null,
      { icon: 'image', label: t('bd_expImages'), onClick: () => doExport('zip') },
      { icon: 'download', label: t('bd_expSave'), hint: t('bd_expNote'), onClick: () => doExport('save') },
      { icon: 'share', label: t('bd_expFile'), hint: t('bd_expFileHint'), onClick: () => doExport('file') },
    ]);
  }
  async function askPages() {
    const n = doc.pages.length;
    const v = await promptDialog({ title: t('bd_pagesWhich'), value: n > 1 ? `1-${n}` : '1', placeholder: t('bd_pagesWhichHint') });
    if (v == null || v === '') return null;
    const idx = parsePages(v, n, doc.cur);
    if (!idx) { toast(t('bd_pagesInvalid')); return null; }
    return idx;
  }
  async function doExport(kind) {
    commitEditor();
    let picked = null;
    if (kind === 'pdfPick' || (kind === 'zip' && doc.pages.length > 1)) { picked = await askPages(); if (!picked) return; }
    const card = progressCard(t('bd_exporting'));
    const base = stripExt(item.name);
    try {
      if (kind === 'file') {
        await saver.flush(false);
        await exportBlob(`${base}.board`, boardFileBlob(doc));
      } else if (kind === 'zip') {
        const blob = await exportImagesZip(doc, picked || [0], assets, (f) => card.update(`${Math.round(f * 100)}%`, f));
        await exportBlob(`${base}.zip`, blob);
      } else if (kind === 'png') {
        const blob = await exportPng(doc, doc.cur, assets);
        await exportBlob(`${base}-${doc.cur + 1}.png`, blob);
      } else {
        const idx = kind === 'pdfPage' ? [doc.cur] : kind === 'pdfPick' ? picked : doc.pages.map((_, i) => i);
        const blob = await exportPdf(doc, idx, assets, (f) => card.update(`${Math.round(f * 100)}%`, f));
        if (kind === 'save') {
          card.update(t('bd_importing'), 1);
          await importFiles([new File([blob], `${base}.pdf`, { type: 'application/pdf' })], item.folderId, { quiet: true });
          toast(t('bd_savedToLib'));
        } else await exportBlob(kind === 'pdfPage' ? `${base}-${doc.cur + 1}.pdf` : kind === 'pdfPick' ? `${base}-${picked[0] + 1}-${picked[picked.length - 1] + 1}.pdf` : `${base}.pdf`, blob);
      }
    } catch (e) { console.warn('board export', e); toast(t('exportFailed')); } finally { card.done(); }
  }

  let present = null;
  function enterPresent() {
    if (present) return;
    if (draft.open) hideDraft(false);
    commitEditor(); canvas.clearSelection();
    present = { tool: prefs.tool, layer: pushLayer(() => { present = null; leavePresent(); }) };
    root.classList.add('present');
    buildPBar();
    mainCanvas.setInsets(0, 0);
    canvas.setTool('laser');
    canvas.fitView();
    markP();
  }
  function leavePresent() {
    root.classList.remove('present');
    mainCanvas.setInsets(ins.top, ins.bottom, ins.left, ins.right);
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
    else if (e.key === 'Escape') { if (draft.open) hideDraft(false); else canvas.clearSelection(); }
  }

  /* ---------- start ---------- */
  root.__bd = { doc, canvas, assets, prefs, mainDoc, mainCanvas, draft };
  adaptInk();
  buildTools();
  applyDock();
  layout();
  if (doc.view && doc.view.page === doc.cur) canvas.restoreView(doc.view); else canvas.fitView();
  refreshChrome();
  renderOpts();
  showHintOnce();

  /* ---------- events from the canvas ---------- */
  function wire(c, isDraft = false) {
    c.on.tool = () => { markTools(); renderOpts(); updateSelBar(); };
    c.on.selection = () => { updateSelBar(); if (prefs.tool === 'select') renderOpts(); };
    c.on.history = () => refreshChrome();
    c.on.page = () => { refreshChrome(); onPageChange(); };
    c.on.view = () => { schedulePos(); updateZoomUi(); };
    c.on.resize = () => { layout(); };
    if (!isDraft) c.on.viewEnd = () => saver.viewChanged();
    c.on.text = ({ stroke, x, y }) => editText(stroke, x, y);
    c.on.media = ({ stroke }) => playMedia(stroke);
    c.on.openFile = ({ stroke }) => openFile(stroke);
    c.on.bookHold = ({ id }) => { try { navigator.vibrate?.(12); } catch { /* no vibration */ } c.books.openPanel(id); };
    c.on.crop = ({ on }) => { if (on) { stopMedia(); toast(t('bd_cropHint')); } updateSelBar(); };
    c.on.cropmove = () => schedulePos();
    c.on.cropdone = ({ obj }) => cropToPage(obj);
    c.on.snapped = () => { try { navigator.vibrate?.(10); } catch { /* no vibration */ } };
    c.on.clip = () => renderOpts();
  }
  wire(canvas);
  updateDraftBtn();
  stage.addEventListener('pointerdown', () => { selbar.style.visibility = 'hidden'; commitEditor(); if (draft.open && canvas === draft.canvas) swapTo(mainCanvas, mainDoc); }, true);
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
    try { if (draft.open) hideDraft(false); syncDraft(true); } catch { /* ignore */ }
    try { timer.destroy(); } catch { /* ignore */ }
    const s = saver, a = assets, c = mainCanvas;
    try { offSave?.(); } catch { /* ignore */ }
    if (s) s.flush(true).finally(() => { a?.destroy(); });
    else a?.destroy();
    c?.destroy();
    try { draft.canvas?.destroy(); } catch { /* ignore */ }
  }
}

export { isBoard };
