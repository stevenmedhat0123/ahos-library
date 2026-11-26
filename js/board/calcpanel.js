// The calculator inside the Board: the whole calculator (all its tabs) in a window that floats over the page – drag it by its title, resize it
// by the corner – and two buttons that put the latest answer (or the whole calculation) on the page as text.
// It is the same calculator as the section: one history, the same memory and settings (calc/state.js is shared).
import { h } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { toast } from '../ui.js';
import { loadCalc } from '../calc/state.js';
import { itemsText } from '../calc/fmt.js';

const KEY = 'ahos.board.calcbox';
const HEAD = 44, MINW = 290, MINH = 470;

const readBox = () => { try { const b = JSON.parse(localStorage.getItem(KEY) || 'null'); return b && Number.isFinite(b.w) && Number.isFinite(b.h) ? b : null; } catch { return null; } };
const saveBox = (b) => { try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* ignore */ } };

/** the text a calculation leaves on the board: "12×3+4 = 40" or just "40" */
export function calcText(entry, withSum) {
  if (!entry) return '';
  const res = String(entry.t || '').trim();
  if (!res) return '';
  if (!withSum) return res;
  let sum = '';
  try { sum = itemsText(entry.e || []).trim(); } catch { sum = ''; }
  return sum ? sum + ' = ' + res : res;
}

/**
 * @param root      the board's root element (the panel is placed inside it)
 * @param area      () => { left, top, right, bottom, W, H } the room the panel may use (inside the toolbars)
 * @param onText    (string) => void  puts a line of text on the page
 */
export function createCalcPanel({ root, area, onText }) {
  let el = null, body = null, box = null, shown = false, loaded = false, focused = false;
  const api = {
    get isOpen() { return shown; },
    toggle() { shown ? close() : open(); },
    open, close, place,
  };

  function defaults() {
    const a = area(), w = Math.min(a.W - 16, a.W >= 700 ? 400 : 350), hgt = Math.min(a.H - a.top - a.bottom - 16, a.W >= 700 ? 640 : 560);
    return { x: Math.max(8, (a.W - w) / 2), y: a.top + 52, w: Math.max(MINW, w), h: Math.max(MINH, Math.min(hgt, a.H - a.top - a.bottom - 60)) };   // (clear of the instrument bar)
  }
  function clamp(b) {
    const a = area();
    const w = Math.max(Math.min(MINW, a.W - 8), Math.min(b.w, a.W - 8)), hh = Math.max(Math.min(MINH, a.H - 8), Math.min(b.h, a.H - 8));
    return { w, h: hh, x: Math.max(4, Math.min(b.x, a.W - w - 4)), y: Math.max(a.top > 0 ? 4 : 0, Math.min(b.y, a.H - hh - 4)) };
  }
  function place() {
    if (!el) return;
    box = clamp(box || defaults());
    el.style.width = box.w + 'px'; el.style.height = box.h + 'px';
    el.style.transform = `translate3d(${box.x}px,${box.y}px,0)`;
  }

  async function build() {
    const insertBtn = (withSum) => {
      const label = t(withSum ? 'bd_calcSum' : 'bd_calcRes');
      return h('button', { class: 'bd-calcbtn', type: 'button', title: t(withSum ? 'bd_calcSumLong' : 'bd_calcResLong'), 'aria-label': t(withSum ? 'bd_calcSumLong' : 'bd_calcResLong'), onClick: () => put(withSum) }, h('span', { html: ic('plus') }), label);
    };
    const head = h('div', { class: 'bd-calch', dir: document.documentElement.dir }, h('span', { class: 'bd-calct' }, h('span', { html: ic('calc') }), t('bd_calc')), insertBtn(false), insertBtn(true),
      h('button', { class: 'bd-calcx', type: 'button', 'aria-label': t('close'), title: t('close'), onClick: close }, h('span', { html: ic('close') })));
    body = h('div', { class: 'bd-calcb' });
    const grip = h('div', { class: 'bd-calcg', role: 'separator', 'aria-label': t('dr_resize') }, h('i'));
    el = h('div', { class: 'bd-calcp bd-ui' }, head, body, grip);
    el.style.height = '0';
    root.append(el);
    head.addEventListener('pointerdown', drag);
    grip.addEventListener('pointerdown', resize);
    el.addEventListener('pointerdown', () => { focused = true; }, true);
    document.addEventListener('pointerdown', (e) => { if (el && !el.contains(e.target)) focused = false; }, true);
    head.style.height = HEAD + 'px';
  }

  async function open_() {
    if (!el) await build();
    if (!loaded) {
      loaded = true;
      const { renderCalc } = await import('../views/calc.js');
      // keys go to the calculator only while you are working in its window (the board has its own shortcuts)
      body.append(await renderCalc({}, { keys: () => focused }));
    }
    el.classList.add('on'); shown = true; place();
    requestAnimationFrame(() => { place(); window.dispatchEvent(new Event('resize')); });
  }
  function open() { return open_(); }
  function close() { if (!el) return; el.classList.remove('on'); shown = false; focused = false; }

  function put(withSum) {
    const e = loadCalc().hist[0];
    const s = calcText(e, withSum);
    if (!s) { toast(t('bd_calcNone')); return; }
    onText(s);
    toast(t('bd_calcPut'));
  }

  function drag(e) {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const b0 = { ...box }, sx = e.clientX, sy = e.clientY, head = e.currentTarget;
    try { head.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    const mv = (ev) => { box = clamp({ ...b0, x: b0.x + ev.clientX - sx, y: b0.y + ev.clientY - sy }); place(); };
    const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); saveBox(box); };
    head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
  }
  function resize(e) {
    e.preventDefault(); e.stopPropagation();
    const b0 = { ...box }, sx = e.clientX, sy = e.clientY, g = e.currentTarget;
    try { g.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    const mv = (ev) => { box = clamp({ ...b0, w: b0.w + ev.clientX - sx, h: b0.h + ev.clientY - sy }); place(); };
    const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); saveBox(box); };
    g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
  }

  box = readBox() ? { x: 0, y: 0, ...readBox() } : null;
  if (box && !Number.isFinite(box.x)) box = null;
  return api;
}
