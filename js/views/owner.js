// Owner panel: subscription codes, the member list, and the owner's own account.
// Only reachable after the owner signs in (auth.js checks the signed token; the server checks it again on every call).
import { h, fmtDate } from '../util.js';
import { ic } from '../icons.js';
import { t, lang } from '../i18n.js';
import { toast, pushLayer, confirmDialog, promptDialog, openSheet } from '../ui.js';
import { admin, isOwner, sessionInfo, changePassword, changeBackup, logout, daysLeft, isForever } from '../auth.js';
import { serverUrl, derive } from '../server.js';
import { shareText, copyText } from '../native.js';
import { errText } from './gate.js';

const UNITS = ['day', 'week', 'month', 'year']; // the only four lengths; "permanent" is a separate switch
const DAYS_MAX = 365, DAY_QUICK = [1, 2, 3, 5, 10, 15];
let open = null; // { root, layer }

/* ---------------- helpers ---------------- */
function randomCode() {
  const up = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lo = 'abcdefghijkmnpqrstuvwxyz', dg = '23456789', sy = '#@$%&*+=?!';
  const rnd = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const pick = (s) => s[rnd(s.length)];
  const chars = [pick(up), pick(lo), pick(dg), pick(sy), pick(sy)];
  const pool = up + lo + dg;
  while (chars.length < 14) chars.push(pick(pool));
  for (let i = chars.length - 1; i > 0; i--) { const j = rnd(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

const when = (ts) => fmtDate(ts, lang());
const fail = (e) => toast(errText(e));

/** A row of filter chips with live counts. `items` = [[id, label, count]]. */
function filterChips(items, current, onPick) {
  return h('div', { class: 'chips', role: 'tablist' }, items.map(([id, label, n]) =>
    h('button', { type: 'button', role: 'tab', 'aria-selected': String(current === id), class: 'chip' + (current === id ? ' on' : ''), onClick: () => onPick(id) }, `${label} · ${n}`)));
}
const SOON_DAYS = 7; // "ending soon" for the owner's list
/** A code with max 0 has no limit on uses. */
const codeState = (c) => (c.revoked ? 'revoked' : c.max > 0 && c.used >= c.max ? 'used' : 'active');

async function copy(text) { toast((await copyText(text)) ? t('o_copied') : t('o_copyFail')); }

/** [-] 12 [+]: tap the buttons or type the number. Always stays inside min..max. */
function stepper({ value = 1, min = 1, max = 365, label, onChange }) {
  const width = String(max).length;
  const input = h('input', { class: 'field', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: width, value: String(value), dir: 'ltr', autocomplete: 'off', 'aria-label': label || '' });
  const clamp = (n) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
  const get = () => clamp(parseInt(input.value, 10));
  const set = (n) => { input.value = String(clamp(n)); onChange?.(get()); };
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, width);
    if (digits !== input.value) input.value = digits;
    onChange?.(get());
  });
  input.addEventListener('blur', () => { input.value = String(get()); onChange?.(get()); });
  const btn = (text, d, aria) => h('button', { type: 'button', class: 'op-stepb', 'aria-label': aria, onClick: () => set(get() + d) }, text);
  return { el: h('div', { class: 'op-step', dir: 'ltr' }, btn('\u2212', -1, t('o_less')), input, btn('+', 1, t('o_more'))), get, set };
}

/** Two or four big buttons in one row: [[value, label], ...]. */
function tiles(options, current, onPick, extra = '') {
  return h('div', { class: 'op-tiles ' + extra, role: 'radiogroup' }, options.map(([v, label]) =>
    h('button', { type: 'button', class: 'op-tile' + (current === v ? ' on' : ''), role: 'radio', 'aria-checked': String(current === v), onClick: () => onPick(v) }, label)));
}

/**
 * Subscription length: Day / Week / Month / Year (one of each), a days counter that appears only for "Day",
 * and a separate "Permanent" switch. get() gives what the server wants: { amount, unit }.
 */
function durationPicker(label = t('o_duration')) {
  let unit = 'month', forever = false;
  const tilesHost = h('div');
  const quick = h('div', { class: 'op-quick' });
  const days = stepper({ value: 3, min: 1, max: DAYS_MAX, label: t('o_howManyDays'), onChange: () => paintQuick() });
  const daysBox = h('div', { class: 'op-days' }, h('span', { class: 'op-sub' }, t('o_howManyDays')), days.el, quick, h('small', null, t('o_daysHint', { max: DAYS_MAX })));
  const sw = h('span', { class: 'switch' });
  const perm = h('button', { type: 'button', class: 'op-perm', role: 'switch', onClick: () => { forever = !forever; paint(); } },
    h('span', { class: 'op-perm-tx' }, h('b', null, t('o_permanent')), h('small', null, t('o_permanentSub'))), sw);
  // The quick buttons are built once and only re-coloured: replacing them while a finger is on one (the number box
  // loses focus first, which repaints) would swallow the tap.
  const quickBtns = DAY_QUICK.map((n) => h('button', { type: 'button', class: 'op-q', onClick: () => days.set(n) }, String(n)));
  quick.append(...quickBtns);
  function paintQuick() {
    const cur = days.get();
    quickBtns.forEach((b, i) => b.classList.toggle('on', DAY_QUICK[i] === cur));
  }
  function paint() {
    tilesHost.replaceChildren(tiles(UNITS.map((u) => [u, t('u_' + u)]), forever ? null : unit, (u) => { unit = u; forever = false; paint(); }, forever ? 'dim' : ''));
    daysBox.hidden = forever || unit !== 'day';
    sw.classList.toggle('on', forever);
    perm.setAttribute('aria-checked', String(forever));
  }
  paint(); paintQuick();
  const el = h('div', { class: 'g-f' }, h('span', null, label), tilesHost, daysBox, perm, h('small', null, t('o_durHint')));
  return { el, get: () => (forever ? { amount: 1, unit: 'forever' } : unit === 'day' ? { amount: days.get(), unit: 'day' } : { amount: 1, unit }) };
}

/** How many people can use a code: a number, or no limit at all (the server stores 0 for that). */
function usesPicker() {
  let inf = false;
  const n = stepper({ value: 1, min: 1, max: 100000, label: t('o_uses') });
  const host = h('div');
  const paint = () => { host.replaceChildren(tiles([['n', t('o_usesN')], ['inf', t('o_usesInf')]], inf ? 'inf' : 'n', (v) => { inf = v === 'inf'; paint(); }, 'two')); n.el.hidden = inf; };
  paint();
  return { el: h('div', { class: 'g-f' }, h('span', null, t('o_uses')), host, n.el, h('small', null, t('o_usesHint'))), get: () => (inf ? 0 : n.get()) };
}

function loader(host, load, render, quiet = false) {
  if (!quiet) host.replaceChildren(h('div', { class: 'g-spin' }));
  return load().then((data) => { render(data); }).catch((e) => {
    if (quiet) return; // keep what is on screen when a background refresh fails
    host.replaceChildren(h('div', { class: 'op-fail' }, h('p', null, errText(e)),
      h('button', { class: 'btn ghost sm', onClick: () => loader(host, load, render) }, t('g_retry'))));
  });
}

/* ---------------- codes ---------------- */
function codesTab() {
  const root = h('div', { class: 'op-tab' });
  const listHost = h('div', { class: 'op-list' });

  const codeIn = h('input', { class: 'field g-code', type: 'text', dir: 'ltr', placeholder: t('o_codePh'), 'aria-label': t('o_codeText'), autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', maxlength: 64 });
  const rndBtn = h('button', { class: 'btn ghost sm op-rnd', type: 'button', onClick: () => { codeIn.value = randomCode(); } }, h('span', { html: ic('sparkle') }), t('o_random'));
  const dur = durationPicker();
  const uses = usesPicker();
  const note = h('input', { class: 'field', type: 'text', maxlength: 120, placeholder: t('o_notePh') });
  const made = h('div', { class: 'op-made' });
  const submit = h('button', { class: 'btn primary lg', type: 'submit' }, t('o_create'));

  const form = h('form', { class: 'op-card op-new', novalidate: true, onSubmit: async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      const r = await admin('code/create', { code: codeIn.value.trim(), ...dur.get(), max: uses.get(), note: note.value.trim() });
      codeIn.value = ''; note.value = '';
      showMade(r.code);
      load();
    } catch (x) { fail(x); } finally { submit.disabled = false; }
  } },
  h('h3', null, t('o_newCode')),
  h('div', { class: 'g-f' }, h('span', null, t('o_codeText')), codeIn, rndBtn, h('small', null, t('o_codeHint'))),
  dur.el,
  uses.el,
  h('label', { class: 'g-f' }, h('span', null, t('o_note')), note),
  submit);

  function showMade(code) {
    made.replaceChildren(h('div', { class: 'op-card op-made-in' },
      h('b', null, t('o_created')),
      h('code', { class: 'op-code big', dir: 'ltr' }, code),
      h('div', { class: 'op-actions' },
        h('button', { class: 'btn primary sm', onClick: () => copy(code) }, t('o_copy')),
        h('button', { class: 'btn ghost sm', onClick: async () => { if (!(await shareText(t('o_shareText', { code })))) copy(code); } }, t('o_share')))));
  }

  function card(c) {
    const st = codeState(c);
    return h('div', { class: 'op-card ' + st },
      h('div', { class: 'op-row' }, h('code', { class: 'op-code', dir: 'ltr' }, c.code), h('span', { class: 'op-badge ' + st }, t('o_st_' + st))),
      h('div', { class: 'op-meta' }, `${c.unit === 'forever' ? t('o_forever') : t('dur', { n: c.amount, unit: c.unit })} · ${c.max === 0 ? t('o_usesLineInf', { used: c.used }) : t('o_usesLine', { used: c.used, max: c.max })}`),
      c.note ? h('div', { class: 'op-meta' }, c.note) : null,
      c.by.length ? h('div', { class: 'op-by' }, h('small', null, t('o_usedBy')), c.by.map((b) => h('span', { class: 'op-chip' }, `${b.name} · ${when(b.at)}`))) : null,
      h('div', { class: 'op-actions' },
        h('button', { class: 'btn ghost sm', onClick: () => copy(c.code) }, t('o_copy')),
        h('button', { class: 'btn ghost sm', onClick: async () => {
          if (!c.revoked && !(await confirmDialog({ title: t('o_revokeQ'), message: t('o_revokeMsg'), ok: t('o_revoke'), danger: true }))) return;
          try { await admin('code/revoke', { code: c.code, revoked: !c.revoked }); load(); } catch (x) { fail(x); }
        } }, c.revoked ? t('o_restore') : t('o_revoke')),
        h('button', { class: 'btn ghost sm danger-t', onClick: async () => {
          if (!(await confirmDialog({ title: t('o_deleteCodeQ'), message: t('o_deleteCodeMsg'), ok: t('delete'), danger: true }))) return;
          try { await admin('code/delete', { code: c.code }); load(); } catch (x) { fail(x); }
        } }, t('delete'))));
  }

  let codes = [], codeFilter = 'all';
  const filterHost = h('div');
  const paintCodes = () => {
    const n = (st) => codes.filter((c) => codeState(c) === st).length;
    filterHost.replaceChildren(codes.length ? filterChips([['all', t('o_f_all'), codes.length], ['active', t('o_f_codes_active'), n('active')], ['used', t('o_f_codes_used'), n('used')], ['revoked', t('o_f_codes_revoked'), n('revoked')]], codeFilter, (id) => { codeFilter = id; paintCodes(); }) : '');
    const shown = codes.filter((c) => codeFilter === 'all' || codeState(c) === codeFilter);
    listHost.replaceChildren(...(shown.length ? shown.map(card) : [h('p', { class: 'op-empty' }, codes.length ? t('noResults') : t('o_noCodes'))]));
  };
  function load(quiet = false) {
    return loader(listHost, () => admin('codes'), (r) => { codes = r.codes; paintCodes(); }, quiet);
  }
  root.append(form, made, filterHost, listHost);
  load();
  root.refresh = () => load(true);
  return root;
}

/* ---------------- members ---------------- */
function memberState(m) {
  const now = Date.now();
  if (m.blocked) return { st: 'blocked', text: t('o_m_blocked') };
  if (m.end > now && isForever(m.end)) return { st: 'active', soon: false, forever: true, n: Infinity, text: t('o_m_forever') };
  if (m.end > now) {
    const n = daysLeft(m.end);
    return { st: 'active', soon: n <= SOON_DAYS, n, text: `${t('o_m_active', { date: when(m.end) })} · ${t('o_left', { n })}` };
  }
  if (m.end > 0) return { st: 'used', text: t('o_m_expired', { date: when(m.end) }) };
  return { st: 'none', text: t('o_m_none') };
}
/** Active first (soonest to end on top), then ended (latest first), then no subscription, then blocked. */
function sortMembers(list) {
  const now = Date.now();
  const rank = (m) => (m.blocked ? 3 : m.end > now ? 0 : m.end > 0 ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b)
    || (rank(a) === 0 ? a.end - b.end : rank(a) === 1 ? b.end - a.end : rank(a) === 2 ? b.created - a.created : a.name.localeCompare(b.name)));
}
const MEMBER_FILTERS = {
  all: () => true,
  active: (m, s) => s.st === 'active',
  soon: (m, s) => s.st === 'active' && s.soon,
  ended: (m, s) => s.st === 'used' || s.st === 'none',
  blocked: (m, s) => s.st === 'blocked',
};

function membersTab() {
  const root = h('div', { class: 'op-tab' });
  const search = h('input', { class: 'field', type: 'search', placeholder: t('o_search'), autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search', 'aria-label': t('o_search') });
  const searchBox = h('div', { class: 'op-search' }, h('span', { class: 'op-search-ic', html: ic('search') }), search);
  const summary = h('div', { class: 'op-summary' });
  const listHost = h('div', { class: 'op-list' });
  let members = [];

  let filter = 'all';
  const filterHost = h('div');
  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const withState = members.map((m) => [m, memberState(m)]);
    const count = (id) => withState.filter(([m, s]) => MEMBER_FILTERS[id](m, s)).length;
    const active = count('active');
    summary.textContent = t('o_membersCount', { n: members.length, active });
    filterHost.replaceChildren(members.length ? filterChips([['all', t('o_f_all'), members.length], ['active', t('o_f_active'), active], ['soon', t('o_f_soon'), count('soon')], ['ended', t('o_f_ended'), count('ended')], ['blocked', t('o_f_blocked'), count('blocked')]], filter, (id) => { filter = id; paint(); }) : '');
    const byId = new Map(withState.map(([m, s]) => [m.id, s]));
    const shown = sortMembers(withState.filter(([m, s]) => MEMBER_FILTERS[filter](m, s) && (!q || m.name.toLowerCase().includes(q))).map(([m]) => m));
    listHost.replaceChildren(...(shown.length ? shown.map((m) => {
      const s = byId.get(m.id);
      const badge = s.st === 'active' ? (s.soon ? ['soon', t('o_st_soon')] : ['active', t('o_st_active')]) : s.st === 'blocked' ? ['blocked', t('o_m_blocked')] : s.st === 'used' ? ['used', t('o_st_ended')] : ['none', t('o_st_none')];
      return h('button', { class: 'op-card op-member ' + s.st, type: 'button', onClick: () => manage(m) },
        h('div', { class: 'op-row' }, h('b', { class: 'op-name', dir: 'auto' }, m.name), h('span', { class: 'op-badge ' + badge[0] }, badge[1])),
        h('div', { class: 'op-meta' }, s.text),
        h('div', { class: 'op-meta faint' }, `${t('o_seen')}: ${m.seen ? when(m.seen) : '—'}`));
    }) : [h('p', { class: 'op-empty' }, members.length ? t('noResults') : t('o_noMembers'))]));
  };
  search.addEventListener('input', paint);

  function load(quiet = false) {
    return loader(listHost, () => admin('members'), (r) => { members = r.members; paint(); }, quiet);
  }

  function manage(m) {
    const s = memberState(m);
    const sheet = openSheet({ title: m.name, tall: true, className: 'op-sheet' });
    const done = (msg) => { sheet.close(); if (msg) toast(msg); load(); };
    const dur = durationPicker(t('o_extend'));
    const act = (icon, label, fn, danger = false) => h('button', { class: 'act' + (danger ? ' danger' : ''), onClick: fn }, h('span', { class: 'act-ic', html: ic(icon) }), h('span', { class: 'act-label' }, label));
    sheet.body.append(
      h('div', { class: 'op-meta' }, s.text),
      h('div', { class: 'op-meta faint' }, `${t('o_joined')}: ${when(m.created)} · ${t('o_seen')}: ${m.seen ? when(m.seen) : '—'}`),
      m.codes.length ? h('div', { class: 'op-by' }, h('small', null, t('o_codesUsed', { n: m.codes.length })), m.codes.slice(0, 8).map((c) => h('span', { class: 'op-chip', dir: 'ltr' }, `${c.code} · ${when(c.at)}`))) : null,
      h('div', { class: 'op-extend' }, dur.el,
        h('button', { class: 'btn primary', onClick: async () => {
          try { const r = await admin('member/extend', { id: m.id, ...dur.get() }); done(isForever(r.end) ? t('o_extendedForever') : t('o_extended', { date: when(r.end) })); } catch (x) { fail(x); }
        } }, t('o_extendBtn'))),
      m.end > Date.now() ? act('clock', t('o_endNow'), async () => {
        if (!(await confirmDialog({ title: t('o_endNow'), message: t('o_endMsg', { name: m.name }), ok: t('o_endNow'), danger: true }))) return;
        try { await admin('member/end', { id: m.id }); done(t('o_ended')); } catch (x) { fail(x); }
      }) : null,
      act(m.blocked ? 'unlock' : 'lock', m.blocked ? t('o_unblock') : t('o_block'), async () => {
        try { await admin('member/block', { id: m.id, blocked: !m.blocked }); done(m.blocked ? t('o_unblocked') : t('o_blocked')); } catch (x) { fail(x); }
      }),
      act('edit', t('o_setPw'), async () => {
        const pw = await promptDialog({ title: t('o_setPw'), message: t('o_setPwMsg'), type: 'text', ok: t('save'), maxlength: 100 });
        if (!pw) return;
        if (pw.length < 6) { toast(t('g_pwShort', { n: 6 })); return; }
        try { await admin('member/password', { id: m.id, pw: await derive(pw, m.name) }); done(t('o_pwSet')); } catch (x) { fail(x); }
      }),
      act('trash', t('o_deleteMember'), async () => {
        if (!(await confirmDialog({ title: t('o_deleteMemberQ', { name: m.name }), message: t('o_deleteMemberMsg'), ok: t('delete'), danger: true }))) return;
        try { await admin('member/delete', { id: m.id }); done(t('o_deleted')); } catch (x) { fail(x); }
      }, true));
  }

  root.append(searchBox, summary, filterHost, listHost);
  load();
  root.refresh = () => load(true);
  return root;
}

/* ---------------- owner account ---------------- */
function accountTab() {
  const me = sessionInfo();
  const askTwo = async (title, curMsg, nextMsg, min) => {
    const cur = await promptDialog({ title, message: curMsg, type: 'password', ok: t('next'), maxlength: 200 });
    if (!cur) return null;
    const next = await promptDialog({ title, message: nextMsg, type: 'password', ok: t('save'), maxlength: 200 });
    if (!next) return null;
    if (next.length < min) { toast(t('g_pwShort', { n: min })); return null; }
    return { cur, next };
  };
  const row = (icon, title, sub, onClick, danger = false) => h('button', { class: 'row tap' + (danger ? ' danger' : ''), onClick },
    h('span', { class: 'row-ic', html: ic(icon) }), h('span', { class: 'row-tx' }, h('b', null, title), sub ? h('small', null, sub) : null));
  return h('div', { class: 'op-tab' },
    h('div', { class: 'op-card' }, h('b', { dir: 'auto' }, me?.name || ''), h('div', { class: 'op-meta' }, t('acc_owner'))),
    h('div', { class: 'group-body' },
      row('lock', t('o_changeMain'), null, async () => {
        const r = await askTwo(t('o_changeMain'), t('acc_curPw'), t('g_newPw'), 8);
        if (!r) return;
        try { await changePassword(r.cur, r.next); toast(t('g_pwChanged')); } catch (x) { fail(x); }
      }),
      row('shield', t('o_changeBackup'), t('o_changeBackupSub'), async () => {
        const r = await askTwo(t('o_changeBackup'), t('o_curBackup'), t('o_newBackup'), 8);
        if (!r) return;
        try { await changeBackup(r.cur, r.next); toast(t('o_backupChanged')); } catch (x) { fail(x); }
      }),
      row('upload', t('g_signOut'), null, async () => {
        if (await confirmDialog({ title: t('g_signOut'), message: t('acc_signOutMsg'), ok: t('g_signOut'), danger: true })) { closeOwnerPanel(); logout(); }
      }, true)),
    h('p', { class: 'gate-note' }, t('o_server'), ' ', h('span', { dir: 'ltr' }, serverUrl())));
}

/* ---------------- shell ---------------- */
export function closeOwnerPanel() {
  if (!open) return;
  const { root, layer } = open;
  open = null;
  root.classList.remove('in');
  setTimeout(() => root.remove(), 250);
  if (layer && !layer.closed) layer.close();
}

export function openOwnerPanel({ tab = 'codes' } = {}) {
  if (!isOwner() || open) return;
  const body = h('div', { class: 'op-body' });
  const tabs = [['codes', t('o_tabCodes'), codesTab], ['members', t('o_tabMembers'), membersTab], ['account', t('o_tabAccount'), accountTab]];
  const bar = h('div', { class: 'op-tabs', role: 'tablist' });
  const cache = new Map();
  const select = (id) => {
    bar.querySelectorAll('button').forEach((b) => { const on = b.dataset.tab === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    if (!cache.has(id)) cache.set(id, tabs.find((x) => x[0] === id)[2]());
    else cache.get(id).refresh?.(); // coming back to a tab: show what changed meanwhile
    body.replaceChildren(cache.get(id));
    body.scrollTop = 0;
  };
  tabs.forEach(([id, label]) => bar.append(h('button', { class: 'op-tab-b', role: 'tab', dataset: { tab: id }, onClick: () => select(id) }, label)));
  const root = h('div', { class: 'opanel', role: 'dialog', 'aria-modal': 'true' },
    h('header', { class: 'op-top' },
      h('h1', null, t('o_title')),
      h('button', { class: 'icon-btn', 'aria-label': t('o_close'), html: ic('close'), onClick: () => closeOwnerPanel() })),
    bar, body);
  document.body.append(root);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('in')));
  const layer = pushLayer(() => { open = null; root.classList.remove('in'); setTimeout(() => root.remove(), 250); });
  open = { root, layer };
  select(tab);
}

export const ownerPanelOpen = () => !!open;
