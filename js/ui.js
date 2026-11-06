// UI primitives: back-stack navigation, toasts, bottom sheets and dialogs.
import { h } from './util.js';
import { ic } from './icons.js';
import { t } from './i18n.js';

/* ---------------- back stack ---------------- */
const layers = [];
let viewBack = null;
let exitArmed = false;

export function pushLayer(destroy) {
  const l = {
    closed: false,
    close() {
      if (l.closed) return;
      l.closed = true;
      const i = layers.indexOf(l);
      if (i >= 0) layers.splice(i, 1);
      destroy();
    },
  };
  layers.push(l);
  return l;
}
export const layerCount = () => layers.length;
export const setViewBack = (fn) => { viewBack = fn; };

export function handleBack() {
  const top = layers[layers.length - 1];
  if (top) { top.close(); return true; }
  return viewBack ? !!viewBack() : false;
}

function armExit() {
  exitArmed = true;
  toast(t('pressBackAgain'));
  setTimeout(() => { exitArmed = false; }, 2200);
}

export function initNav() {
  history.replaceState({ a: 0 }, '');
  history.pushState({ a: 1 }, '');
  window.addEventListener('popstate', () => {
    if (handleBack()) { history.pushState({ a: 1 }, ''); return; }
    if (!exitArmed) { history.pushState({ a: 1 }, ''); armExit(); }
    // second press falls through and leaves the page
  });
}

/** Called by the native (Android) hardware back button. */
export function nativeBack(exitFn) {
  if (handleBack()) return;
  if (exitArmed) { exitFn(); return; }
  armExit();
}

/* ---------------- toast ---------------- */
let toastTimer;
export function toast(msg, { action, onAction, ms = 2800 } = {}) {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(host); }
  host.replaceChildren();
  const el = h('div', { class: 'toast' }, h('span', null, msg));
  if (action) el.append(h('button', { class: 'toast-act', onClick: () => { onAction?.(); el.remove(); } }, action));
  host.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 250); }, ms);
}

/** A persistent progress card (used while importing / exporting). */
export function progressCard(title) {
  const bar = h('i');
  const sub = h('span', { class: 'pc-sub' });
  const el = h('div', { class: 'progress-card' }, h('b', null, title), sub, h('div', { class: 'pc-bar' }, bar));
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  return {
    update(text, frac) { sub.textContent = text; if (frac != null) bar.style.width = Math.round(frac * 100) + '%'; },
    done() { el.classList.remove('in'); setTimeout(() => el.remove(), 300); },
  };
}

/* ---------------- sheets ---------------- */
export function openSheet({ title, onClose, tall = false, className = '' } = {}) {
  const scrim = h('div', { class: 'scrim' });
  const grab = h('div', { class: 'grab' });
  const head = title ? h('div', { class: 'sheet-title' }, title) : null;
  const body = h('div', { class: 'sheet-body' });
  const sheet = h('div', { class: `sheet ${tall ? 'tall' : ''} ${className}`, role: 'dialog', 'aria-modal': 'true' }, grab, head, body);
  const layer = h('div', { class: 'layer' }, scrim, sheet);
  document.body.append(layer);
  requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('in')));
  const L = pushLayer(() => {
    layer.classList.remove('in');
    setTimeout(() => layer.remove(), 280);
    onClose?.();
  });
  scrim.addEventListener('click', () => L.close());

  // drag the handle down to dismiss
  let sy = 0, dy = 0, dragging = false;
  const down = (e) => { dragging = true; sy = e.clientY; dy = 0; sheet.style.transition = 'none'; e.currentTarget.setPointerCapture(e.pointerId); };
  const move = (e) => { if (!dragging) return; dy = Math.max(0, e.clientY - sy); sheet.style.transform = `translateY(${dy}px)`; };
  const up = () => {
    if (!dragging) return; dragging = false; sheet.style.transition = '';
    if (dy > 90) L.close(); else sheet.style.transform = '';
  };
  [grab, head].filter(Boolean).forEach((el) => { el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); });

  return { el: sheet, body, close: () => L.close() };
}

export function actionSheet(title, actions) {
  const s = openSheet({ title });
  actions.filter(Boolean).forEach((a) => {
    s.body.append(
      h('button', {
        class: 'act' + (a.danger ? ' danger' : ''),
        onClick: () => { s.close(); if (a.onClick) setTimeout(a.onClick, 60); },
      },
      a.icon ? h('span', { class: 'act-ic', html: ic(a.icon) }) : null,
      h('span', { class: 'act-label' }, a.label),
      a.hint ? h('span', { class: 'act-hint' }, a.hint) : null,
      a.checked ? h('span', { class: 'act-check', html: ic('check') }) : null),
    );
  });
  return s;
}

/* ---------------- dialogs ---------------- */
function dialog(nodes, onDismiss) {
  const scrim = h('div', { class: 'scrim' });
  const box = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, nodes);
  const layer = h('div', { class: 'layer dlg' }, scrim, box);
  document.body.append(layer);
  requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('in')));
  const L = pushLayer(() => {
    layer.classList.remove('in');
    setTimeout(() => layer.remove(), 220);
    onDismiss?.();
  });
  scrim.addEventListener('click', () => L.close());
  return { L, box };
}

export function confirmDialog({ title, message, ok = t('ok'), danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v) => { if (!answered) { answered = true; resolve(v); } };
    const d = dialog([
      h('h3', null, title),
      message ? h('p', null, message) : null,
      h('div', { class: 'dlg-actions' },
        h('button', { class: 'btn ghost', onClick: () => d.L.close() }, t('cancel')),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onClick: () => { answer(true); d.L.close(); } }, ok)),
    ], () => answer(false));
  });
}

export function promptDialog({ title, message, value = '', placeholder = '', ok = t('save'), type = 'text', inputmode, allowEmpty = false, maxlength = 120 }) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v) => { if (!answered) { answered = true; resolve(v); } };
    const input = h('input', { class: 'field', type, value, placeholder, maxlength, inputmode, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const submit = () => {
      const v = input.value.trim();
      if (!v && !allowEmpty) { input.focus(); return; }
      answer(v); d.L.close();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    const d = dialog([
      h('h3', null, title),
      message ? h('p', null, message) : null,
      input,
      h('div', { class: 'dlg-actions' },
        h('button', { class: 'btn ghost', onClick: () => d.L.close() }, t('cancel')),
        h('button', { class: 'btn primary', onClick: submit }, ok)),
    ], () => answer(null));
    setTimeout(() => { input.focus(); input.select?.(); }, 120);
  });
}

export function infoDialog({ title, rows }) {
  const list = h('dl', { class: 'kv' }, rows.filter(Boolean).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
  const d = dialog([h('h3', null, title), list, h('div', { class: 'dlg-actions' }, h('button', { class: 'btn primary', onClick: () => d.L.close() }, t('ok')))]);
}
