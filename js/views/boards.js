// The Board and Daily-note sections.
//  Notes:  today's date as a card (write / open today's note, how many days in a row you wrote), a strip of the last 14 days (a dot = you wrote that day),
//          a search box and the rest grouped by month.
//  Boards: the board you worked on last, big, with Open / New; the rest below with a search box.
import { h } from '../util.js';
import { ic } from '../icons.js';
import { t, lang } from '../i18n.js';
import { visibleItems } from '../store.js';
import { isBoard, dayKey } from '../board/io.js';
import { toast } from '../ui.js';
import { loadCss } from '../lazycss.js';
import { thumbURL } from '../covers.js';
import { itemCard, wireCards, emptyState, subLine, displayName } from './shared.js';

function grid(list, ctx) {
  const g = h('div', { class: 'grid' }, list.map((i) => itemCard(i, { mode: 'grid' })));
  wireCards(g, { open: (id) => ctx.openItem(id, list.map((i) => i.id)), more: (id) => ctx.itemMenu?.(id), selecting: () => false });
  return g;
}
const byRecent = (a, b) => (b.opened || b.added || 0) - (a.opened || a.added || 0);
const locale = () => (lang() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');
const fmt = (d, o) => { try { return new Intl.DateTimeFormat(locale(), o).format(d); } catch { return String(d); } };
const parseDay = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addBtn = (notes) => h('button', { class: 'btn ghost', type: 'button', onClick: async () => { const m = await import('../boardadd.js'); m.boardAddSheet({ notes }); } }, h('span', { html: ic('upload') }), t('bda_btn'));
const matches = (i, q) => !q || displayName(i).toLowerCase().includes(q.toLowerCase());

/** a search box that calls onInput(text) as you type */
function searchBox(placeholder, onInput) {
  const input = h('input', { type: 'search', placeholder, 'aria-label': placeholder, enterkeyhint: 'search', dir: 'auto' });
  input.addEventListener('input', () => onInput(input.value.trim()));
  return h('label', { class: 'nt-q' }, h('span', { html: ic('search') }), input);
}

/** consecutive days with a note, counting back from today (or from yesterday while today is still empty) */
export function streakOf(days, today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export async function renderBoards(ctx, def) {
  await loadCss('css/notes.css');
  const boards = visibleItems().filter((i) => isBoard(i) && !i.meta?.note).sort(byRecent);
  const root = h('div', { class: 'nt bd-sec', style: def ? { '--g1': def.g[0], '--g2': def.g[1] } : null });
  const newBtn = h('button', { class: 'btn primary', type: 'button', onClick: () => ctx.newBoard() }, h('span', { html: ic('plus') }), t('bd_new'));
  if (!boards.length) {
    root.append(h('section', { class: 'nt-hero bd-new-hero' },
      h('div', { class: 'nt-cal', html: ic('bdPen') }),
      h('div', { class: 'nt-hero-tx' }, h('h2', null, t('hub_noBoards')), h('p', { class: 'nt-streak' }, t('hub_noBoardsSub')), h('div', { class: 'sec-actions' }, newBtn, addBtn(false)))));
    return root;
  }
  const last = boards[0];
  const hero = h('section', { class: 'nt-hero bd-hero' },
    h('div', { class: 'bdh-card' }, itemCard(last, { mode: 'grid' })),
    h('div', { class: 'nt-hero-tx' },
      h('span', { class: 'bdh-label' }, t('bdl_continue')),
      h('b', { class: 'bdh-nm', dir: 'auto' }, displayName(last)),
      h('span', { class: 'bdh-sub' }, subLine(last)),
      h('div', { class: 'sec-actions' },
        h('button', { class: 'btn primary', type: 'button', onClick: () => ctx.openItem(last.id, boards.map((i) => i.id)) }, h('span', { html: ic('bdPen') }), t('open')),
        h('button', { class: 'btn ghost', type: 'button', onClick: () => ctx.newBoard() }, h('span', { html: ic('plus') }), t('bd_new')),
        addBtn(false))));
  wireCards(hero, { open: (id) => ctx.openItem(id, boards.map((i) => i.id)), more: (id) => ctx.itemMenu?.(id), selecting: () => false });
  root.append(hero);
  const rest = boards.slice(1);
  if (rest.length) {
    const head = h('div', { class: 'nt-month' }, t('bdl_all'), h('span', null, t('nItems', { n: boards.length })));
    const holder = h('div');
    const draw = (q) => {
      const list = rest.filter((i) => matches(i, q));
      holder.replaceChildren(list.length ? grid(list, ctx) : h('div', { class: 'nt-none' }, t('nt_noMatch')));
    };
    draw('');
    root.append(head);
    if (rest.length > 5) root.append(searchBox(t('bdl_search'), draw));
    root.append(holder);
  }
  return root;
}

/* ---------- the Notes list (rows like a notes app: pinned first, then by month; press and hold to select) ---------- */
const nsel = { on: false, ids: new Set(), root: null, filter: 'all', q: '', timer: 0 };
const stampOf = (i) => i.meta?.edited || i.added || 0;
const noteTitle = (i) => (i.meta?.text ? (i.meta.title || (i.meta.snippet || '').slice(0, 48) || displayName(i)) : displayName(i));
const noteSub = (i) => {
  if (i.meta?.text) return i.meta.title ? i.meta.snippet || '' : (i.meta.snippet || '').slice(48);
  return t('nPages', { n: i.meta?.pages || 1 });
};
const shortWhen = (ms) => { const d = new Date(ms), y = new Date().getFullYear() === d.getFullYear(); return fmt(d, y ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }); };

function noteRow(n, ctx, order) {
  const text = !!n.meta?.text;
  const th = !text && n.thumb ? thumbURL(n) : null;
  const sub = noteSub(n);
  const badges = [];
  if (n.pin) badges.push(h('span', { class: 'nt-bd pin', title: t('nt_pinned'), html: ic('pin') }));
  if (text && n.meta.todoTotal) badges.push(h('span', { class: 'nt-bd', title: t('tn_checklist') }, h('span', { html: ic('checkAll') }), `${n.meta.todoDone || 0}/${n.meta.todoTotal}`));
  if (text && n.meta.draw) badges.push(h('span', { class: 'nt-bd', title: t('tn_drawing'), html: ic('penLine') }));
  const row = h('div', { class: 'nt-row' + (text ? ' is-text' : ' is-hand'), role: 'button', tabindex: '0', dataset: { id: n.id, kind: text ? 'text' : 'hand' }, 'aria-label': noteTitle(n) },
    h('div', { class: 'nt-rt' },
      h('b', { class: 'nt-rn', dir: 'auto' }, noteTitle(n)),
      h('div', { class: 'nt-rs' }, h('span', { class: 'nt-rk', html: ic(text ? 'textNote' : 'bdPen') }), h('time', null, shortWhen(stampOf(n))), sub ? h('span', { class: 'nt-rsn', dir: 'auto' }, sub) : null, ...badges)),
    th ? h('img', { class: 'nt-th', src: th, alt: '', draggable: false }) : null,
    h('span', { class: 'nt-ck', 'aria-hidden': 'true', html: ic('check') }));
  let hold = 0, sx = 0, sy = 0, fired = false;
  const clear = () => { clearTimeout(hold); hold = 0; };
  row.addEventListener('pointerdown', (e) => { if (e.button) return; fired = false; sx = e.clientX; sy = e.clientY; clear(); hold = setTimeout(() => { fired = true; hold = 0; navigator.vibrate?.(12); pickRow(n.id, true); }, 480); });
  row.addEventListener('pointermove', (e) => { if (hold && Math.hypot(e.clientX - sx, e.clientY - sy) > 9) clear(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) row.addEventListener(ev, clear);
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!fired) { fired = true; pickRow(n.id, true); } });
  row.addEventListener('click', () => { if (fired) { fired = false; return; } if (nsel.on) pickRow(n.id, false); else ctx.openItem(n.id, order); });
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } });
  return row;
}

let paintSel = () => {};
function pickRow(id, enter) {
  if (enter && !nsel.on) { nsel.on = true; nsel.ids.clear(); watchSel(); }
  if (!nsel.on) return;
  if (nsel.ids.has(id) && !enter) nsel.ids.delete(id); else nsel.ids.add(id);
  paintSel();
}
/** the selection ends when the section is left (a screen redraw keeps it: the new page takes over) */
function watchSel() {
  clearInterval(nsel.timer);
  nsel.timer = setInterval(() => {
    if (!nsel.on) { clearInterval(nsel.timer); return; }
    if (nsel.root && !nsel.root.isConnected) { const r = nsel.root; setTimeout(() => { if (nsel.root === r && !r.isConnected) { nsel.on = false; nsel.ids.clear(); clearInterval(nsel.timer); } }, 700); }
  }, 500);
}

export async function renderNotes(ctx, def) {
  await loadCss('css/notes.css');
  const all = () => visibleItems().filter((i) => isBoard(i) && i.meta?.note);
  const notes = all().sort((a, b) => (b.pin || 0) - (a.pin || 0) || stampOf(b) - stampOf(a));
  const todayKey = dayKey();
  const byDay = new Map();
  for (const n of notes) { const k = n.meta.noteDay || dayKey(new Date(n.added || Date.now())); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(n); }
  const today = byDay.get(todayKey)?.[0];
  const streak = streakOf(byDay);
  const now = new Date();
  const root = h('div', { class: 'nt nt-sec', style: def ? { '--g1': def.g[0], '--g2': def.g[1] } : null });
  nsel.root = root; if (nsel.on) watchSel();
  for (const id of [...nsel.ids]) if (!notes.some((n) => n.id === id)) nsel.ids.delete(id);

  root.append(h('section', { class: 'nt-hero' },
    h('div', { class: 'nt-cal' }, h('small', null, fmt(now, { weekday: 'long' })), h('b', null, now.getDate()), h('small', null, fmt(now, { month: 'short', year: 'numeric' }))),
    h('div', { class: 'nt-hero-tx' },
      h('h2', null, today ? t('nt_todayDone') : t('nt_todayNone')),
      h('p', { class: 'nt-streak' + (streak ? ' hot' : '') }, h('span', { html: ic('sparkle') }), streak ? t('nt_streak', { n: streak }) : t('nt_streak0')),
      h('div', { class: 'sec-actions' },
        h('button', { class: 'btn primary', type: 'button', onClick: () => ctx.openTodayNote() }, h('span', { html: ic('daily') }), today ? t('hub_openToday') : t('hub_startToday')),
        addBtn(true)))));

  // the last 14 days, today first
  const strip = h('div', { class: 'nt-strip', role: 'list', 'aria-label': t('nt_last14') });
  for (let k = 0; k < 14; k++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - k);
    const key = dayKey(d), list = byDay.get(key) || [];
    strip.append(h('button', {
      class: 'nt-day' + (list.length ? ' has' : '') + (k === 0 ? ' today' : ''), type: 'button', role: 'listitem', dataset: { day: key },
      'aria-label': fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }) + (list.length ? ' · ' + t('nItems', { n: list.length }) : ''),
      onClick: () => { if (list.length) ctx.openItem(list[0].id, list.map((i) => i.id)); else if (k === 0) ctx.openTodayNote(); else toast(t('nt_noDay')); },
    }, h('small', null, fmt(d, { weekday: 'short' })), h('b', null, d.getDate()), h('i')));
  }
  root.append(strip);

  const fab = h('button', { class: 'nt-fab', type: 'button', 'aria-label': t('note_new'), title: t('note_new'), onClick: () => ctx.newNote(), html: ic('plus') });
  if (!notes.length) { root.append(emptyState({ icon: 'daily', title: t('hub_noNotes'), text: t('hub_noNotesSub') }), fab); return root; }

  /* filters + search */
  const nText = notes.filter((n) => n.meta?.text).length, nHand = notes.length - nText;
  const chips = h('div', { class: 'nt-chips', role: 'group', 'aria-label': t('nt_filter') });
  const chip = (k, label, n) => h('button', { class: 'nt-chip', type: 'button', dataset: { f: k }, 'aria-pressed': String(nsel.filter === k), onClick: () => { nsel.filter = k; for (const c of chips.children) { const on = c.dataset.f === k; c.setAttribute('aria-pressed', String(on)); c.classList.toggle('on', on); } draw(); } }, label, h('small', null, String(n)));
  chips.append(chip('all', t('nt_all'), notes.length), chip('text', t('nt_text'), nText), chip('hand', t('nt_hand'), nHand));
  for (const c of chips.children) c.classList.toggle('on', c.dataset.f === nsel.filter);
  const sb = searchBox(t('nt_search'), (q) => { nsel.q = q; draw(); });
  if (nsel.q) sb.querySelector('input').value = nsel.q;
  root.append(chips, sb);

  const holder = h('div', { class: 'nt-groups' });
  const matchesNote = (i, q) => !q || (noteTitle(i) + ' ' + (i.meta?.snippet || '')).toLowerCase().includes(q.toLowerCase());
  const order = () => notes.map((n) => n.id);
  function draw() {
    const list = notes.filter((i) => (nsel.filter === 'all' || (nsel.filter === 'text') === !!i.meta?.text) && matchesNote(i, nsel.q));
    if (!list.length) { holder.replaceChildren(h('div', { class: 'nt-none' }, t('nt_noMatch'))); return; }
    const pinned = list.filter((i) => i.pin);
    const rest = list.filter((i) => !i.pin);
    const groups = [];
    const box = (arr) => h('div', { class: 'nt-list' }, arr.map((n) => noteRow(n, ctx, order())));
    if (pinned.length) groups.push(h('div', { class: 'nt-month nt-gh' }, t('nt_pinnedH'), h('span', null, String(pinned.length))), box(pinned));
    const months = new Map();
    for (const n of rest) {
      const d = new Date(stampOf(n)), k = d.getFullYear() * 100 + d.getMonth();
      if (!months.has(k)) months.set(k, { d, list: [] });
      months.get(k).list.push(n);
    }
    for (const m of months.values()) groups.push(h('div', { class: 'nt-month nt-gh' }, fmt(m.d, { month: 'long', year: 'numeric' }), h('span', null, String(m.list.length))), box(m.list));
    holder.replaceChildren(...groups);
    paintSel();
  }

  /* selection bar */
  const selTitle = h('b', { class: 'nt-seln' });
  const selTop = h('div', { class: 'nt-seltop' },
    h('button', { class: 'nt-selb', type: 'button', onClick: () => endSel() }, t('cancel')), selTitle,
    h('button', { class: 'nt-selb', type: 'button', onClick: () => { const vis = [...holder.querySelectorAll('.nt-row')].map((r) => r.dataset.id); const every = vis.every((id) => nsel.ids.has(id)); if (every) nsel.ids.clear(); else vis.forEach((id) => nsel.ids.add(id)); paintSel(); } }, t('nt_selAll')));
  const act = (icon, label, fn, cls = '') => h('button', { class: 'nt-act ' + cls, type: 'button', onClick: fn }, h('span', { html: ic(icon) }), h('small', null, label));
  const pinAct = act('pin', t('nt_pin'), async () => {
    const ids = [...nsel.ids]; if (!ids.length) return;
    const items = ids.map((id) => ctx && visibleItems().find((i) => i.id === id)).filter(Boolean);
    const allPinned = items.every((i) => i.pin);
    const { updateItem } = await import('../store.js');
    items.forEach((i, k) => updateItem(i.id, { pin: allPinned ? 0 : Date.now() + k }, { silent: k < items.length - 1 }));
    toast(allPinned ? t('nt_unpinned') : t('nt_pinned')); endSel();
  });
  const selBar = h('div', { class: 'nt-selbar bd-ui' },
    act('move', t('moveTo'), async () => { const ids = [...nsel.ids]; if (!ids.length) return; const { moveItemsDialog } = await import('../actions.js'); if (await moveItemsDialog(ids)) endSel(); }),
    pinAct,
    act('trash', t('delete'), async () => { const ids = [...nsel.ids]; if (!ids.length) return; const { deleteItems } = await import('../actions.js'); if (await deleteItems(ids)) endSel(); }, 'danger'));
  function endSel() { nsel.on = false; nsel.ids.clear(); clearInterval(nsel.timer); paintSel(); }
  paintSel = () => {
    root.classList.toggle('selecting', nsel.on);
    for (const r of holder.querySelectorAll('.nt-row')) r.classList.toggle('sel', nsel.ids.has(r.dataset.id));
    selTitle.textContent = nsel.ids.size ? t('nt_nSelected', { n: nsel.ids.size }) : t('nt_selectNotes');
    const items = [...nsel.ids].map((id) => notes.find((i) => i.id === id)).filter(Boolean);
    const allPinned = items.length && items.every((i) => i.pin);
    pinAct.querySelector('small').textContent = allPinned ? t('nt_unpin') : t('nt_pin');
    selBar.classList.toggle('empty', !nsel.ids.size);
  };
  draw();
  root.append(selTop, holder, fab, selBar);
  paintSel();
  return root;
}
