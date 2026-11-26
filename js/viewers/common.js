// Shared bits for full-screen viewers.
import { h } from '../util.js';
import { ic } from '../icons.js';
import { pushLayer } from '../ui.js';
import { updateItem } from '../store.js';
import { setPaused } from '../bg.js';

let open = 0;

/** Creates a full-screen overlay registered with the back stack. */
export function mountViewer(cls, { onClose } = {}) {
  const el = h('div', { class: `viewer ${cls}` });
  document.body.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  open++;
  document.documentElement.classList.add('viewer-open');
  setPaused(true);
  const L = pushLayer(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 240);
    open--;
    if (open <= 0) { open = 0; document.documentElement.classList.remove('viewer-open'); setPaused(false); }
    try { onClose?.(); } catch (e) { console.error(e); }
  });
  return { el, close: () => L.close(), layer: L };
}

export function touchOpened(id) { updateItem(id, { opened: Date.now() }, { silent: true }); }

/** Saves reading / watching progress without re-rendering the library. */
export function saveProgress(id, f, pos) {
  if (!isFinite(f)) return;
  updateItem(id, { progress: { f: Math.max(0, Math.min(1, f)), pos, at: Date.now() } }, { silent: true });
}

export function barBtn(icon, label, onClick, cls = '') {
  return h('button', { class: `vbtn ${cls}`, 'aria-label': label, title: label, onClick, html: ic(icon) });
}
