// Talks to the access server (a Cloudflare Worker). Used only when this build has a server address.
import { getAppInfo } from './updater.js';
import { nameKey } from './namekey.js';

export class ApiError extends Error {
  constructor(code, status = 0, extra = {}) { super(code); this.code = code; this.status = status; Object.assign(this, extra); }
}

export const serverUrl = () => String(getAppInfo().server || '').trim().replace(/\/+$/, '');
/** The gate only exists when the build points at a server (https, or plain http on this machine for tests). */
export const gateEnabled = () => /^https:\/\/[^\s/]+/i.test(serverUrl()) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(serverUrl());
/** Problems that mean "can't reach the server" rather than "the server said no". */
export const isNetworkError = (e) => !!e && ['offline', 'timeout', 'server_error', 'db_missing'].includes(e.code);

export async function api(path, body, { token, timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeout);
  let r;
  try {
    r = await fetch(serverUrl() + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal, cache: 'no-store',
    });
  } catch (e) {
    throw new ApiError(e && e.name === 'AbortError' ? 'timeout' : 'offline');
  } finally { clearTimeout(to); }
  let data = null;
  try { data = await r.json(); } catch { /* not JSON */ }
  if (!r.ok || !data || data.ok === false) throw new ApiError((data && data.error) || 'server_error', r.status, { retry: data && data.retry });
  return data;
}

/* ---------------- passwords ---------------- */
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** What leaves the phone is never the password itself, only this slow, salted fingerprint of it. */
export async function derive(password, name, kind = 'main') {
  if (!crypto?.subtle) throw new ApiError('no_crypto');
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const salt = enc.encode((kind === 'backup' ? 'ahos1b|' : 'ahos1|') + nameKey(name));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, key, 256));
}

/* ---------------- signed tokens ---------------- */
const unb64u = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const b = atob(s), a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a;
};

/** Checks a token against the server's public key. Works offline. Returns its contents or null. */
export async function verifyToken(token, pubJwk) {
  try {
    if (!token || !pubJwk) return null;
    const [body, sig] = String(token).split('.');
    if (!body || !sig) return null;
    const key = await crypto.subtle.importKey('jwk', pubJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64u(sig), enc.encode(body));
    return ok ? JSON.parse(new TextDecoder().decode(unb64u(body))) : null;
  } catch { return null; }
}
