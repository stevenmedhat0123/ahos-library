// The door: who are you (owner or user), sign-in / sign-up, subscription code, and the "locked" screens.
// Shown over the whole app. Nothing here exists unless the build has a server address (see auth.js).
import { h, fmtDate } from '../util.js';
import { ic } from '../icons.js';
import { mark } from '../brand.js';
import { t, lang, setLang } from '../i18n.js';
import { setSetting } from '../store.js';
import { toast, pushLayer } from '../ui.js';
import { exitApp } from '../native.js';
import { validName } from '../namekey.js';
import {
  gateEnabled, access, loadSession, onAccess, startWatch, refresh, serverInfo, isNetworkError, daysLeft, timeNow, isForever,
  ownerClaim, ownerLogin, ownerRecover, userRegister, userLogin, redeem, logout, sessionInfo,
} from '../auth.js';

let el = null; // the overlay while it is up
let body = null;
let layer = null;
let ctxRef = null;
let seq = 0;
let exitArmed = false;
let granted = false;
const waiting = [];
const trail = []; // screens we can go back to

/** Runs fn once the person is allowed in (immediately when there is no gate). */
export function whenGranted(fn) { if (granted) fn(); else waiting.push(fn); }

/* ---------------- small building blocks ---------------- */
export const errText = (e) => {
  const code = (e && e.code) || 'generic';
  if (code === 'locked') return t('g_err_locked', { min: Math.max(1, Math.ceil((e.retry || 60) / 60)) });
  const key = 'g_err_' + code;
  const s = t(key);
  return s === key ? t('g_err_generic') : s;
};

function field({ label, type = 'text', hint, auto = 'off', mode, forceLtr = false, value = '', cls = '' }) {
  const input = h('input', { class: 'field ' + cls, type, autocomplete: auto, autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', inputmode: mode, dir: forceLtr || type === 'password' ? 'ltr' : 'auto', value, maxlength: 200 });
  let control = input;
  if (type === 'password') {
    const eye = h('button', { type: 'button', class: 'g-eye', 'aria-label': t('g_show'), html: ic('eye'), onClick: () => { input.type = input.type === 'password' ? 'text' : 'password'; input.focus(); } });
    control = h('div', { class: 'g-pw' }, input, eye);
  }
  const wrap = h('label', { class: 'g-f' }, h('span', null, label), control, hint ? h('small', null, hint) : null);
  return { wrap, input };
}

function form(children, onSubmit, submitLabel, { danger = false } = {}) {
  const err = h('div', { class: 'gate-err', role: 'alert' });
  const btn = h('button', { class: 'btn primary lg', type: 'submit' }, submitLabel);
  const f = h('form', { class: 'g-form', novalidate: true, onSubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true; btn.textContent = t('g_wait');
    try { await onSubmit((m) => { err.textContent = m; }); } catch (x) { err.textContent = errText(x); } finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = submitLabel; } }
  } }, children, err, btn);
  void danger;
  return f;
}

function page({ title, sub, back = false, markIcon = true }, ...rest) {
  return h('div', { class: 'gate-card' },
    markIcon ? h('div', { class: 'gate-mark', html: mark() }) : null,
    h('h1', null, title),
    sub ? h('p', { class: 'gate-sub' }, sub) : null,
    ...rest,
    back ? h('div', { class: 'g-links' }, h('button', { class: 'g-link', type: 'button', onClick: () => goBack() }, t('g_back'))) : null);
}

function show(node) { body.replaceChildren(node); el.scrollTop = 0; }

/* ---------------- navigation ---------------- */
const S = {};
function go(name, params = {}, { push = true } = {}) {
  if (!el) return;
  if (push) trail.push({ name: cur.name, params: cur.params });
  cur = { name, params };
  const my = ++seq;
  const r = S[name](params, my);
  if (r && typeof r.then === 'function') { show(loading()); r.then((n) => { if (my === seq && n) show(n); }); } else show(r);
}
let cur = { name: 'welcome', params: {} };
function goBack() {
  const p = trail.pop();
  if (p) go(p.name, p.params, { push: false }); else go('welcome', {}, { push: false });
}
const loading = () => h('div', { class: 'gate-card' }, h('div', { class: 'g-spin' }), h('p', { class: 'gate-sub' }, t('g_connecting')));

/* ---------------- screens ---------------- */
S.welcome = () => page({ title: t('g_welcome'), sub: t('g_who') },
  h('div', { class: 'g-choices' },
    h('button', { class: 'g-choice', type: 'button', onClick: () => go('owner') },
      h('span', { class: 'g-ci', html: ic('shield') }), h('b', null, t('g_iAmOwner')), h('small', null, t('g_iAmOwnerSub'))),
    h('button', { class: 'g-choice', type: 'button', onClick: () => go('user', { mode: 'login' }) },
      h('span', { class: 'g-ci', html: ic('unlock') }), h('b', null, t('g_iAmUser')), h('small', null, t('g_iAmUserSub')))),
  h('p', { class: 'gate-note' }, t('g_filesStay')));

S.owner = async (p, my) => {
  try {
    const info = await serverInfo();
    if (my !== seq) return null;
    return info.ownerExists ? S.ownerLogin({}) : S.claim({ info });
  } catch (e) {
    return page({ title: t('g_ownerTitle'), back: true },
      h('div', { class: 'gate-err' }, errText(e)),
      h('button', { class: 'btn ghost', type: 'button', onClick: () => go('owner', {}, { push: false }) }, t('g_retry')));
  }
};

S.claim = ({ info }) => {
  const name = field({ label: t('g_fullName'), hint: t('g_fullNameHint'), auto: 'name' });
  const pw = field({ label: t('g_ownerPw'), type: 'password', auto: 'new-password' });
  const pw2 = field({ label: t('g_pwAgain'), type: 'password', auto: 'new-password' });
  const bpw = field({ label: t('g_backupPw'), type: 'password', hint: t('g_backupPwHint'), auto: 'off' });
  const bpw2 = field({ label: t('g_backupPwAgain'), type: 'password', auto: 'off' });
  const setup = field({ label: t('g_setupKey'), type: 'password', hint: t('g_setupKeyHint'), auto: 'off', forceLtr: true });
  const f = form([name.wrap, pw.wrap, pw2.wrap, bpw.wrap, bpw2.wrap, setup.wrap], async (say) => {
    if (!validName(name.input.value)) return say(t('g_err_bad_name'));
    if (pw.input.value.length < 8) return say(t('g_pwShort', { n: 8 }));
    if (pw.input.value !== pw2.input.value) return say(t('g_pwMismatch'));
    if (bpw.input.value.length < 8) return say(t('g_pwShort', { n: 8 }));
    if (bpw.input.value === pw.input.value) return say(t('g_backupSame'));
    if (bpw.input.value !== bpw2.input.value) return say(t('g_pwMismatch'));
    if (!setup.input.value.trim()) return say(t('g_setupNeeded'));
    await ownerClaim({ name: name.input.value, pw: pw.input.value, bpw: bpw.input.value, setup: setup.input.value.trim() });
  }, t('g_createOwner'));
  return page({ title: t('g_claimTitle'), sub: t('g_claimSub'), back: true },
    info && info.setupReady === false ? h('div', { class: 'gate-err' }, t('g_err_setup_disabled')) : null, f,
    h('p', { class: 'gate-note' }, t('g_writeDown')));
};

S.ownerLogin = () => {
  const name = field({ label: t('g_fullName'), auto: 'name' });
  const pw = field({ label: t('g_password'), type: 'password', auto: 'current-password' });
  const f = form([name.wrap, pw.wrap], async (say) => {
    if (!validName(name.input.value)) return say(t('g_err_bad_name'));
    if (!pw.input.value) return say(t('g_pwNeeded'));
    await ownerLogin({ name: name.input.value, pw: pw.input.value });
  }, t('g_signIn'));
  return page({ title: t('g_ownerTitle'), sub: t('g_ownerSub'), back: true }, f,
    h('div', { class: 'g-links' }, h('button', { class: 'g-link', type: 'button', onClick: () => go('recover') }, t('g_forgot'))));
};

S.recover = () => {
  const name = field({ label: t('g_fullName'), auto: 'name' });
  const bpw = field({ label: t('g_backupPw'), type: 'password', auto: 'off' });
  const pw = field({ label: t('g_newPw'), type: 'password', auto: 'new-password' });
  const pw2 = field({ label: t('g_pwAgain'), type: 'password', auto: 'new-password' });
  const f = form([name.wrap, bpw.wrap, pw.wrap, pw2.wrap], async (say) => {
    if (!validName(name.input.value)) return say(t('g_err_bad_name'));
    if (!bpw.input.value) return say(t('g_pwNeeded'));
    if (pw.input.value.length < 8) return say(t('g_pwShort', { n: 8 }));
    if (pw.input.value !== pw2.input.value) return say(t('g_pwMismatch'));
    await ownerRecover({ name: name.input.value, bpw: bpw.input.value, pw: pw.input.value });
    toast(t('g_pwChanged'));
  }, t('g_resetPw'));
  return page({ title: t('g_recoverTitle'), sub: t('g_recoverSub'), back: true }, f);
};

S.user = ({ mode = 'login', name: keep = '' } = {}) => {
  const reg = mode === 'register';
  const name = field({ label: t('g_fullName'), hint: reg ? t('g_fullNameHint') : null, auto: 'name', value: keep });
  const pw = field({ label: t('g_password'), type: 'password', auto: reg ? 'new-password' : 'current-password' });
  const pw2 = reg ? field({ label: t('g_pwAgain'), type: 'password', auto: 'new-password' }) : null;
  const f = form([name.wrap, pw.wrap, pw2 && pw2.wrap], async (say) => {
    if (!validName(name.input.value)) return say(t('g_err_bad_name'));
    if (!pw.input.value) return say(t('g_pwNeeded'));
    if (reg) {
      if (pw.input.value.length < 6) return say(t('g_pwShort', { n: 6 }));
      if (pw.input.value !== pw2.input.value) return say(t('g_pwMismatch'));
      await userRegister({ name: name.input.value, pw: pw.input.value });
    } else await userLogin({ name: name.input.value, pw: pw.input.value });
  }, reg ? t('g_createAccount') : t('g_signIn'));
  return page({ title: reg ? t('g_newAccount') : t('g_userTitle'), sub: reg ? t('g_newAccountSub') : t('g_userSub'), back: true }, f,
    reg ? h('p', { class: 'gate-note' }, t('g_privacy')) : null,
    h('div', { class: 'g-links' }, h('button', { class: 'g-link', type: 'button', onClick: () => go('user', { mode: reg ? 'login' : 'register', name: name.input.value }, { push: false }) }, reg ? t('g_haveAccount') : t('g_noAccount'))));
};

S.redeem = () => {
  const a = access();
  const code = field({ label: t('g_code'), forceLtr: true, mode: 'text', cls: 'g-code', auto: 'off' });
  const status = h('div', { class: 'gate-err' });
  const f = form([code.wrap], async (say) => {
    if (!code.input.value.trim()) return say(t('g_codeNeeded'));
    const end = await redeem(code.input.value);
    toast(isForever(end) ? t('g_validForever') : t('g_validUntil', { date: fmtDate(end, lang()) }));
  }, t('g_activate'));
  const check = h('button', { class: 'btn ghost', type: 'button', onClick: async () => {
    status.textContent = '';
    check.disabled = true;
    const r = await refresh();
    check.disabled = false;
    if (r.offline) status.textContent = t('g_err_offline');
    else if (!access().ok) status.textContent = t('g_stillNone');
  } }, t('g_checkAgain'));
  return page({
    title: t('g_codeTitle'),
    sub: a.state === 'expired' ? t('g_expiredSub', { name: a.name, date: fmtDate(a.end, lang()) }) : t('g_noCodeSub', { name: a.name }),
  }, f, check, status,
  h('div', { class: 'g-links' }, h('button', { class: 'g-link', type: 'button', onClick: () => logout() }, t('g_signOut'))));
};

S.locked = () => {
  const a = access();
  const why = a.state;
  const info = sessionInfo();
  const actions = [];
  if (why === 'blocked') {
    const status = h('div', { class: 'gate-err' });
    actions.push(h('button', { class: 'btn ghost', type: 'button', onClick: async () => { status.textContent = ''; const r = await refresh(); if (r.offline) status.textContent = t('g_err_offline'); else if (!access().ok) status.textContent = t('g_stillBlocked'); } }, t('g_checkAgain')), status);
  }
  actions.push(h('button', { class: 'btn primary', type: 'button', onClick: () => {
    const n = info?.name || a.name || '';
    const wasOwner = info?.role === 'owner';
    logout();
    if (wasOwner) go('ownerLogin', {}, { push: false }); else go('user', { mode: 'login', name: n }, { push: false });
  } }, why === 'blocked' ? t('g_signOut') : t('g_signInAgain')));
  return page({ title: t('g_lock_' + why), sub: t('g_lock_' + why + '_sub'), markIcon: true }, ...actions);
};

const screenFor = (a) => (a.state === 'out' ? 'welcome' : a.state === 'nocode' || a.state === 'expired' ? 'redeem' : 'locked');

/* ---------------- overlay ---------------- */
function langButton() {
  const other = lang() === 'ar' ? 'en' : 'ar';
  return h('button', { class: 'g-lang', type: 'button', 'aria-label': t('language'), onClick: () => {
    setLang(other); setSetting('lang', other); ctxRef?.applyAppearance?.();
    rebuildTop(); go(cur.name, cur.params, { push: false });
  } }, h('span', { html: ic('globe') }), other === 'en' ? 'English' : 'العربية');
}
let top = null;
function rebuildTop() { top.replaceChildren(langButton()); }

function armBack() {
  if (layer && !layer.closed) return;
  layer = pushLayer(() => {
    layer = null;
    if (!el) return;
    if (trail.length) goBack();
    else if (cur.name !== 'welcome' && access().state === 'out') go('welcome', {}, { push: false });
    else if (exitArmed) exitApp();
    else { exitArmed = true; toast(t('pressBackAgain')); setTimeout(() => { exitArmed = false; }, 2200); }
    armBack();
  });
}

function openGate(a) {
  if (!el) {
    top = h('div', { class: 'gate-top' });
    body = h('div', { class: 'gate-body' });
    el = h('div', { class: 'gate', role: 'dialog', 'aria-modal': 'true' }, top, body);
    document.body.append(el);
    rebuildTop();
    armBack();
  }
  trail.length = 0;
  cur = { name: 'welcome', params: {} };
  go(screenFor(a), {}, { push: false });
}

function closeGate() {
  if (!el) return;
  const n = el; el = null; body = null;
  n.classList.add('out');
  setTimeout(() => n.remove(), 250);
  if (layer) { const l = layer; layer = null; l.close(); }
}

function lockApp() {
  document.querySelectorAll('video, audio').forEach((m) => { try { m.pause(); } catch { /* ignore */ } });
}

function onAccessChange(a) {
  if (a.ok) {
    const signedIn = !!el; // the gate was showing, so somebody just signed in
    closeGate();
    ctxRef?.rerender?.(); // owner-only buttons depend on who is signed in
    if (signedIn && a.state === 'owner') import('./owner.js').then((m) => m.openOwnerPanel()).catch((e) => console.warn('owner panel', e));
    if (!granted) { granted = true; waiting.splice(0).forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } }); }
    return;
  }
  lockApp();
  if (!el) openGate(a);
  else go(screenFor(a), {}, { push: false });
}

/** Once a day, when a subscription has 3 days or less left, says so (a small message, never a block). */
const REMIND_KEY = 'ahos.remind';
export function expiryReminder() {
  try {
    const a = access();
    if (!gateEnabled() || a.state !== 'user' || !a.end || isForever(a.end)) return;
    const n = daysLeft(a.end);
    if (n < 1 || n > 3) return;
    const day = new Date(timeNow()).toLocaleDateString('en-CA');
    if (localStorage.getItem(REMIND_KEY) === day) return;
    localStorage.setItem(REMIND_KEY, day);
    toast(t('acc_soon', { n }), { ms: 8000 });
  } catch { /* a reminder must never break the app */ }
}
let remindersOn = false;
export function startReminders() {
  if (remindersOn) return;
  remindersOn = true;
  setTimeout(expiryReminder, 2500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) expiryReminder(); });
}

const grantAll = () => { granted = true; waiting.splice(0).forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } }); };

/** Call once at start-up (after the app shell exists). If anything goes wrong here, the door stays shut rather than open. */
export async function initGate(ctx) {
  ctxRef = ctx;
  if (!gateEnabled()) { grantAll(); return { off: true }; }
  try {
    const a = await loadSession();
    onAccess(onAccessChange);
    startWatch();
    if (a.ok) { grantAll(); refresh(); } else { lockApp(); openGate(a); }
    return { off: false, ok: a.ok };
  } catch (e) {
    console.warn('gate', e);
    try { onAccess(onAccessChange); lockApp(); openGate({ ok: false, state: 'out' }); } catch (e2) { console.warn('gate fallback', e2); }
    return { off: false, ok: false };
  }
}

export { isNetworkError };
