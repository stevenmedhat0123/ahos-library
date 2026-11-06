// In-app update check. The app is fully offline; this only runs when you ask or when a connection happens to exist.
// Releases are published by the GitHub workflow (see README). update.json is rewritten at build time.
import { state } from './store.js';
import { toast } from './ui.js';
import { t } from './i18n.js';
import { openExternal, updaterAvailable, onDownloadEvent, downloadApk, cancelDownload, installApk } from './native.js';

let info = { version: '0.1.0', build: 0, channel: 'beta', repo: '', server: '' };

export async function loadAppInfo() {
  try {
    const r = await fetch(new URL('../update.json', import.meta.url), { cache: 'no-store' });
    if (r.ok) info = { ...info, ...(await r.json()) };
  } catch { /* offline first run, use defaults */ }
  return info;
}
export const getAppInfo = () => info;
/** True for the copy published as a web page (Chrome): it updates itself, there is no APK to download. */
export const isWebBuild = () => !!info.web;

function parseBuild(tag) {
  const m = /(\d+)\s*$/.exec(tag || '');
  return m ? parseInt(m[1], 10) : 0;
}

export async function checkForUpdates({ manual = false } = {}) {
  if (!info.repo) return { status: 'norepo' };
  if (navigator.onLine === false) return { status: 'error', reason: 'offline' };
  const channel = state.settings.channel || info.channel || 'stable';
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch(`https://api.github.com/repos/${info.repo}/releases?per_page=20`, { headers: { Accept: 'application/vnd.github+json' }, signal: ctl.signal });
    clearTimeout(to);
    if (!r.ok) return { status: 'error', reason: String(r.status) };
    const list = await r.json();
    let best = null;
    for (const rel of list) {
      if (rel.draft) continue;
      if (channel === 'stable' && rel.prerelease) continue;
      const apk = (rel.assets || []).find((a) => /\.apk$/i.test(a.name));
      if (!apk) continue;
      const build = parseBuild(rel.tag_name);
      if (!best || build > best.build) best = { build, label: (rel.name || rel.tag_name), url: apk.browser_download_url, size: apk.size, notes: rel.body || '', prerelease: !!rel.prerelease };
    }
    try { localStorage.setItem('ahos.lastCheck', String(Date.now())); } catch { /* ignore */ }
    if (best && best.build > (info.build || 0)) return { status: 'available', release: best };
    return { status: 'latest' };
  } catch (e) {
    if (manual) console.warn('update check failed', e);
    return { status: 'error', reason: String(e && e.message || e) };
  }
}

/* ---------------- download + install (Android app) ---------------- */
/** One download at a time. state: idle | starting | downloading | ready | installing | error. */
export const dl = { state: 'idle', release: null, name: '', bytes: 0, total: 0, speed: 0, path: '', error: '', needsPermission: false };
const subs = new Set();
/** Calls fn(dl) on every change; returns the function that stops it. */
export function onDownloadChange(fn) { subs.add(fn); return () => subs.delete(fn); }
function setDl(patch) { Object.assign(dl, patch); subs.forEach((f) => { try { f(dl); } catch (e) { console.warn(e); } }); }

export const canDownloadInApp = () => updaterAvailable();
export const fileNameOf = (release) => {
  const m = /([^/?#]+\.apk)(?:[?#]|$)/i.exec(release && release.url || '');
  return m ? decodeURIComponent(m[1]) : 'AHOS-Library.apk';
};

let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  onDownloadEvent((e) => {
    const total = e.total > 0 ? e.total : (dl.release && dl.release.size) || 0;
    if (e.state === 'start') setDl({ state: 'downloading', name: e.name || dl.name, bytes: 0, total, speed: 0, error: '' });
    else if (e.state === 'progress') setDl({ state: 'downloading', bytes: e.bytes, total, speed: e.speed || 0 });
    else if (e.state === 'done') setDl({ state: 'ready', bytes: e.bytes, total: e.bytes, speed: 0, path: e.path || '', name: e.name || dl.name, error: '', needsPermission: false });
    else if (e.state === 'cancelled') setDl({ state: 'idle', bytes: 0, speed: 0 });
    else if (e.state === 'error') setDl({ state: 'error', error: String(e.error || ''), speed: 0 });
  });
}

/** Starts the download inside the app. Without the native part (browser build), opens the file in the phone's browser instead. */
export async function startDownload(release) {
  if (!updaterAvailable()) { openExternal(release.url); return 'external'; }
  hook();
  if (dl.state === 'downloading' || dl.state === 'starting') return 'running';
  setDl({ state: 'starting', release, name: fileNameOf(release), bytes: 0, total: release.size || 0, speed: 0, path: '', error: '', needsPermission: false });
  try { await downloadApk(release.url, fileNameOf(release)); } catch (e) { setDl({ state: 'error', error: String(e && e.message || e) }); }
  return 'started';
}
export function cancelDownloadNow() { cancelDownload(); }

/** Opens the system installer for the finished download. If Android still has to allow installs from this app, it opens that setting first. */
export async function installDownloaded(auto = false) {
  if (dl.state !== 'ready' && dl.state !== 'installing') return;
  try {
    const r = await installApk(dl.path, auto);
    if (r && r.ok) setDl({ state: 'installing', needsPermission: false, error: '' });
    else if (r && r.needsPermission) setDl({ state: 'ready', needsPermission: true, error: '' });
    else setDl({ state: 'ready', needsPermission: false, error: String((r && r.error) || 'install') });
  } catch (e) { setDl({ state: 'ready', error: String(e && e.message || e) }); }
}
// coming back from Android's "allow installs from this app" screen: carry on with the install by itself
document.addEventListener('visibilitychange', () => { if (!document.hidden && dl.state === 'ready' && dl.needsPermission) installDownloaded(true); });

/** Quiet background check: at most twice a day, only when online. */
export function autoCheck(onAvailable) {
  if (!info.repo || info.web) return;
  let last = 0;
  try { last = Number(localStorage.getItem('ahos.lastCheck') || 0); } catch { /* ignore */ }
  if (Date.now() - last < 12 * 3600 * 1000) return;
  setTimeout(async () => {
    const r = await checkForUpdates();
    if (r.status === 'available') {
      toast(t('updateAvailable', { v: r.release.label }), { action: t('view'), onAction: () => onAvailable(r.release), ms: 9000 });
    }
  }, 6000);
}
