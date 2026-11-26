// The notification centre (the bell on the Hub): messages are kept on the phone in a small inbox; the owner's broadcasts will land here too.
import { h } from './util.js';
import { ic } from './icons.js';
import { t, lang } from './i18n.js';
import { openSheet, pushLayer, toast, confirmDialog } from './ui.js';
import { state, setSetting } from './store.js';
import { gateEnabled, isOwner, admin } from './auth.js';
import { sfx } from './sound.js';

const KEY = 'ahos.inbox';
const MAX = 80;
const listeners = new Set();
let cache = null;

function load() {
  if (cache) return cache;
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); cache = Array.isArray(a) ? a.slice(0, MAX) : []; } catch { cache = []; }
  return cache;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* storage blocked: kept in memory for this session */ }
  listeners.forEach((f) => { try { f(); } catch { /* a listener must never break the others */ } });
}

export const inboxItems = () => load();
export const inboxUnread = () => load().reduce((n, m) => n + (m.read ? 0 : 1), 0);
/** Calls fn whenever the inbox changes; returns a function that stops it. */
export function onInbox(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Adds a message ({title, text, id?}); the same id twice is ignored, so a message fetched again never doubles. */
export function addInbox({ id, title = '', text = '', time = Date.now() }) {
  const a = load();
  const mid = id || `${time}-${Math.random().toString(36).slice(2, 7)}`;
  if (a.some((m) => m.id === mid)) return false;
  a.unshift({ id: mid, title, text, time, read: false });
  if (a.length > MAX) a.length = MAX;
  save();
  return true;
}
/** Removes one message from this phone's inbox. */
export function removeInbox(id) { const a = load(); const i = a.findIndex((m) => m.id === id); if (i >= 0) { a.splice(i, 1); save(); } }
export function markAllRead() { let ch = false; load().forEach((m) => { if (!m.read) { m.read = true; ch = true; } }); if (ch) save(); }
export function clearInbox() { cache = []; save(); }

const when = (ts) => new Date(ts).toLocaleString(lang() === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const ownerNow = () => { try { return gateEnabled() && isOwner(); } catch { return false; } };
let page = null;

/** The owner's composer: a title, the text, and whether it plays a sound on everybody's phone. Sends to the server, then keeps a copy in his own inbox. */
function composeBroadcast() {
  let sound = state.settings.broadcastSound !== false;
  const sheet = openSheet({ title: t('bell_new'), tall: true, onClose: () => { if (sound !== (state.settings.broadcastSound !== false)) setSetting('broadcastSound', sound); } });
  const title = h('input', { class: 'field', type: 'text', maxlength: 80, placeholder: t('bell_titlePh'), 'aria-label': t('bell_titlePh'), dir: 'auto' });
  const text = h('textarea', { class: 'field bell-text', rows: 5, maxlength: 1000, placeholder: t('bell_textPh'), 'aria-label': t('bell_textPh'), dir: 'auto' });
  const sw = h('button', { class: 'switch' + (sound ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': String(sound), 'aria-label': t('bell_sound'), onClick: () => { sound = !sound; sw.classList.toggle('on', sound); sw.setAttribute('aria-checked', String(sound)); } }, h('i'));
  const count = h('small', { class: 'bell-count' }, '0/1000');
  text.addEventListener('input', () => { count.textContent = `${text.value.length}/1000`; });
  const send = h('button', { class: 'btn primary lg', type: 'submit' }, h('span', { html: ic('send') }), t('bell_send'));
  const form = h('form', { class: 'bell-form', novalidate: true, onSubmit: async (e) => {
    e.preventDefault();
    if (!title.value.trim() && !text.value.trim()) { toast(t('bell_empty2')); title.focus(); return; }
    send.disabled = true;
    try {
      const r = await admin('announce', { title: title.value, text: text.value, sound });
      addInbox({ id: 'a:' + r.item.id, title: r.item.title, text: r.item.text, time: r.item.time, mine: true });
      markAllRead();                     // his own message is not "new" to him
      sfx('select'); toast(t('bell_sent')); sheet.close(); page?.repaint();
    } catch (x) { toast(t('bell_sendFail')); } finally { send.disabled = false; }
  } },
  h('p', { class: 'note' }, t('bell_newSub')),
  h('label', { class: 'g-f' }, h('span', null, t('bell_titleLbl')), title),
  h('label', { class: 'g-f' }, h('span', null, t('bell_textLbl')), text, count),
  h('div', { class: 'bell-sound' }, h('span', { class: 'bell-sound-tx' }, h('b', null, t('bell_sound')), h('small', null, t('bell_soundSub'))), sw),
  send);
  sheet.body.append(form);
  setTimeout(() => title.focus(), 250);
}

/** The Notifications screen: back arrow, the title, and (owner only) a "+" on the far side to write a notification for everybody.
 *  Opening it keeps the unread ones marked "new" while you read; they count as read once you leave. */
export function openInbox() {
  if (page) return page;
  const unreadIds = new Set(load().filter((m) => !m.read).map((m) => m.id));
  const list = h('div', { class: 'inbox' });
  const owner = ownerNow();
  const close = () => layer.close();
  const add = owner ? h('button', { class: 'icon-btn bell-add', type: 'button', 'aria-label': t('bell_new'), onClick: () => { sfx('open'); composeBroadcast(); }, html: ic('plus') }) : h('span', { class: 'bell-add-gap' });
  const root = h('div', { class: 'notif', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('bell_title') },
    h('header', { class: 'top notif-top' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('back'), onClick: () => { sfx('back'); close(); } }, h('span', { class: 'flip-rtl', html: ic('back') })),
      h('h1', { class: 'top-title' }, t('bell_title')),
      add),
    h('div', { class: 'notif-body' }, list));
  const paint = () => {
    const items = load().slice();
    const clear = items.length ? h('button', { class: 'btn ghost sm inbox-clear', type: 'button', onClick: async () => { if (await confirmDialog({ title: t('bell_clear'), message: t('bell_clearMsg'), ok: t('bell_clear'), danger: true })) { clearInbox(); paint(); } } }, t('bell_clear')) : null;
    list.replaceChildren(...(items.length
      ? [...items.map((m) => h('article', { class: 'inbox-item' + (unreadIds.has(m.id) ? ' new' : '') },
        h('div', { class: 'inbox-hd' },
          h('b', { dir: 'auto' }, m.title || t('bell_title')),
          unreadIds.has(m.id) ? h('span', { class: 'inbox-new' }, t('bell_newTag')) : null,
          h('small', null, when(m.time))),
        m.text ? h('p', { dir: 'auto' }, m.text) : null,
        owner && String(m.id).startsWith('a:') ? h('div', { class: 'inbox-act' },
          h('small', null, t('bell_toAll')),
          h('button', { class: 'btn ghost sm danger-t', type: 'button', onClick: async () => {
            if (!(await confirmDialog({ title: t('bell_delQ'), message: t('bell_delMsg'), ok: t('delete'), danger: true }))) return;
            try { await admin('announce/delete', { id: String(m.id).slice(2) }); removeInbox(m.id); paint(); } catch { toast(t('bell_sendFail')); }
          } }, t('delete'))) : null)), clear]
      : [h('div', { class: 'inbox-empty' }, h('span', { html: ic('bell') }), h('p', null, t('bell_empty')), owner ? h('p', { class: 'note' }, t('bell_emptyOwner')) : null)]));
  };
  paint();
  document.body.append(root);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('in')));
  const layer = pushLayer(() => { markAllRead(); page = null; root.classList.remove('in'); setTimeout(() => root.remove(), 260); });
  page = { root, repaint: paint, close };
  return page;
}
export const inboxOpen = () => !!page;
