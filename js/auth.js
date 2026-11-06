// Who is using the app and whether they may. Everything here is inert unless the build has a server address.
// The session is a token signed by the server; the app checks the signature offline, so a valid
// subscription keeps working without internet until it ends.
import { api, derive, verifyToken, gateEnabled, isNetworkError, ApiError } from './server.js';

const K = { auth: 'ahos.auth', dev: 'ahos.dev', pub: 'ahos.pub', seen: 'ahos.seen', lock: 'ahos.lock' };
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const getJSON = (k) => { try { return JSON.parse(ls.get(k) || 'null'); } catch { return null; } };

export { gateEnabled, ApiError, isNetworkError };

/** A random id for this phone, used so an account is only active on one phone at a time. */
export function deviceId() {
  let d = ls.get(K.dev);
  if (!d || d.length < 16) {
    d = [...crypto.getRandomValues(new Uint8Array(12))].map((x) => x.toString(16).padStart(2, '0')).join('');
    ls.set(K.dev, d);
  }
  return d;
}

/** The current time, but never earlier than the latest time this phone has seen (turning the clock back gains nothing). */
let lastWrite = 0;
export function timeNow() {
  const n = Date.now();
  const m = Number(ls.get(K.seen)) || 0;
  if (n > m) {
    if (n - lastWrite > 15000) { ls.set(K.seen, String(n)); lastWrite = n; }
    return n;
  }
  return m;
}

const DAY = 86400000;
const FOREVER_MS = Date.UTC(2900, 0, 1);
/** A subscription with no end date (the server stores it as the year 3000). */
export const isForever = (end) => Number(end) >= FOREVER_MS;
/** Whole days left until `end`, rounded up (0 once it is over). */
export function daysLeft(end) { return Math.max(0, Math.ceil((Number(end) - timeNow()) / DAY)); }

let sess = null; // { role, token }
let pay = null; // what the verified token says
let lockWhy = ''; // blocked | device_changed | session_ended | no_account
const listeners = new Set();
let lastKey = '';

export function access() {
  if (!gateEnabled()) return { ok: true, state: 'off' };
  if (lockWhy) return { ok: false, state: lockWhy, name: pay?.n || '' };
  if (!sess || !pay) return { ok: false, state: 'out' };
  const now = timeNow();
  if (pay.exp <= now) return { ok: false, state: 'out' };
  if (pay.r === 'owner') return { ok: true, state: 'owner', name: pay.n };
  if (pay.end > now) return { ok: true, state: 'user', name: pay.n, end: pay.end };
  return { ok: false, state: pay.end ? 'expired' : 'nocode', name: pay.n, end: pay.end };
}
export const isOwner = () => !!sess && pay?.r === 'owner' && !lockWhy;
export const sessionInfo = () => (sess && pay ? { role: pay.r, name: pay.n, end: pay.end || 0 } : null);

function emitChange(force = false) {
  const a = access();
  const key = `${a.ok}|${a.state}`;
  if (!force && key === lastKey) return;
  lastKey = key;
  listeners.forEach((fn) => { try { fn(a); } catch (e) { console.warn(e); } });
}
export function onAccess(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function setLock(why) { lockWhy = why; ls.set(K.lock, why); emitChange(); }
function clearSession() { sess = null; pay = null; ls.del(K.auth); }

/** Reads the saved session and checks its signature. Call once at start-up. */
export async function loadSession() {
  lockWhy = ls.get(K.lock) || '';
  sess = null; pay = null;
  const a = getJSON(K.auth);
  if (a && a.token) {
    const p = await verifyToken(a.token, getJSON(K.pub));
    if (p && (!p.d || p.d === deviceId() || p.r === 'owner')) { sess = { role: p.r, token: a.token }; pay = p; } else ls.del(K.auth);
  }
  lastKey = '';
  const acc = access();
  lastKey = `${acc.ok}|${acc.state}`;
  return acc;
}

async function fetchPub() {
  const info = await api('/api/info');
  ls.set(K.pub, JSON.stringify(info.pub));
  return info;
}
export const serverInfo = () => api('/api/info');

async function adopt(r) {
  const p = await verifyToken(r.token, getJSON(K.pub));
  if (!p) throw new ApiError('bad_token');
  sess = { role: p.r, token: r.token }; pay = p;
  ls.set(K.auth, JSON.stringify({ token: r.token }));
  if (r.now) { ls.set(K.seen, String(r.now)); lastWrite = Date.now(); } // the server's clock is the truth when we can reach it
  lockWhy = ''; ls.del(K.lock);
  emitChange();
  return p;
}

/* ---------------- sign-in flows ---------------- */
export async function ownerClaim({ name, pw, bpw, setup }) {
  const a = await derive(pw, name), b = await derive(bpw, name, 'backup');
  await fetchPub();
  await adopt(await api('/api/owner/claim', { name, pw: a, bpw: b, setup }));
}
export async function ownerLogin({ name, pw }) {
  const a = await derive(pw, name);
  await fetchPub();
  await adopt(await api('/api/owner/login', { name, pw: a }));
}
export async function ownerRecover({ name, bpw, pw }) {
  const b = await derive(bpw, name, 'backup'), a = await derive(pw, name);
  await fetchPub();
  await adopt(await api('/api/owner/recover', { name, bpw: b, pw: a }));
}
export async function userRegister({ name, pw }) {
  const a = await derive(pw, name);
  await fetchPub();
  await adopt(await api('/api/user/register', { name, pw: a, dev: deviceId() }));
}
export async function userLogin({ name, pw }) {
  const a = await derive(pw, name);
  await fetchPub();
  await adopt(await api('/api/user/login', { name, pw: a, dev: deviceId() }));
}
/** Uses a subscription code. Returns the new end time. */
export async function redeem(code) {
  if (!sess) throw new ApiError('bad_token');
  const r = await api('/api/user/redeem', { code: String(code || '').trim(), dev: deviceId() }, { token: sess.token });
  await adopt(r);
  return r.end;
}
export async function changePassword(cur, next) {
  if (!sess || !pay) throw new ApiError('bad_token');
  const c = await derive(cur, pay.n), n = await derive(next, pay.n);
  const r = pay.r === 'owner'
    ? await api('/api/owner/password', { cur: c, next: n }, { token: sess.token })
    : await api('/api/user/password', { cur: c, next: n, dev: deviceId() }, { token: sess.token });
  await adopt(r);
}
export async function changeBackup(cur, next) {
  if (!sess || !pay || pay.r !== 'owner') throw new ApiError('bad_token');
  await api('/api/owner/backup', { cur: await derive(cur, pay.n, 'backup'), next: await derive(next, pay.n, 'backup') }, { token: sess.token });
}
export function logout() {
  clearSession();
  lockWhy = ''; ls.del(K.lock);
  emitChange();
}

/** Owner-only calls (codes, members). */
export async function admin(path, body = {}) {
  if (!sess || pay?.r !== 'owner') throw new ApiError('bad_token');
  try { return await api('/api/admin/' + path, body, { token: sess.token }); } catch (e) {
    if (e && e.code === 'bad_token') setLock('session_ended');
    throw e;
  }
}

/* ---------------- background upkeep ---------------- */
let lastTry = 0;
/** Asks the server how things stand (new end date, blocked, moved to another phone). Silent when offline. */
export async function refresh() {
  if (!gateEnabled() || !sess) return { skipped: true };
  lastTry = Date.now();
  try {
    if (sess.role === 'owner') await api('/api/owner/check', {}, { token: sess.token });
    else await adopt(await api('/api/user/status', { dev: deviceId() }, { token: sess.token }));
    return { ok: true };
  } catch (e) {
    if (isNetworkError(e)) return { offline: true };
    if (e.code === 'blocked' || e.code === 'device_changed' || e.code === 'no_account') { setLock(e.code); return { locked: e.code }; }
    if (e.code === 'bad_token' || e.code === 'session_ended') { setLock('session_ended'); return { locked: 'session_ended' }; }
    return { error: e.code };
  }
}

let timer = 0, slow = 0, visHook = null;
export function startWatch() {
  stopWatch();
  timer = setInterval(() => emitChange(), 20000);
  slow = setInterval(() => { if (!document.hidden) refresh(); }, 3 * 3600 * 1000);
  visHook = () => { if (!document.hidden) { emitChange(); if (Date.now() - lastTry > 30 * 60 * 1000) refresh(); } };
  document.addEventListener('visibilitychange', visHook);
}
export function stopWatch() {
  clearInterval(timer); clearInterval(slow);
  if (visHook) document.removeEventListener('visibilitychange', visHook);
  visHook = null;
}
