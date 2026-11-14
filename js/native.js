// Thin wrappers around Capacitor (Android app) with safe web fallbacks.
// The app is plain JS with no bundler, so plugins are reached through the native bridge at runtime.
import { isNative, extOf } from './util.js';

const cap = () => window.Capacitor;

const proxies = new Map();
/** The JS proxy of a native plugin: ready-made for official ones, registered on first use for our own. */
function pluginProxy(name) {
  const c = cap();
  if (!c) return null;
  if (c.Plugins && c.Plugins[name]) return c.Plugins[name];
  if (proxies.has(name)) return proxies.get(name);
  let p = null;
  try { if (typeof c.registerPlugin === 'function') p = c.registerPlugin(name); } catch { p = null; }
  proxies.set(name, p);
  return p;
}

async function call(plugin, method, opts) {
  const c = cap();
  if (!c) throw new Error('Capacitor missing');
  const p = pluginProxy(plugin);
  if (p && typeof p[method] === 'function') return p[method](opts);
  if (typeof c.nativePromise === 'function') return c.nativePromise(plugin, method, opts || {});
  throw new Error(`Plugin ${plugin} unavailable`);
}

export async function onHardwareBack(handler) {
  if (!isNative()) return;
  try {
    const c = cap();
    const app = c.Plugins && c.Plugins.App;
    if (app && typeof app.addListener === 'function') await app.addListener('backButton', handler);
    else if (typeof c.nativeCallback === 'function') c.nativeCallback('App', 'addListener', { eventName: 'backButton' }, handler);
  } catch (e) { console.warn('back button hook failed', e); }
}

export const exitApp = () => call('App', 'exitApp').catch(() => {});

/** Opens a link in the phone's browser (used for downloading updates). */
export async function openExternal(url) {
  if (isNative()) {
    try { await call('App', 'openUrl', { url }); return; } catch { /* fall back below */ }
  }
  window.open(url, '_blank', 'noopener');
}

/** The "Full screen" setting: no status bar / navigation bar in the whole app (they show for a moment on a swipe from the edge, then hide again). */
let appFull = false;
let barsHidden = null;
async function bars(hide) {
  if (barsHidden === hide) return;
  barsHidden = hide;
  if (!isNative()) {
    try {
      if (hide && !document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
      else if (!hide && document.fullscreenElement === document.documentElement) await document.exitFullscreen?.();
    } catch { /* the browser asks for a tap first */ }
    return;
  }
  if (pluginThere('AhosShare')) { try { await call('AhosShare', 'setImmersive', { on: hide }); return; } catch { /* older build: use the generic plugins below */ } }
  try { await call('SystemBars', hide ? 'hide' : 'show', {}); return; } catch { /* older Capacitor, try the StatusBar plugin */ }
  try { await call('StatusBar', hide ? 'hide' : 'show'); } catch { /* optional */ }
}
/** Hides the bars for the video player (on = true); the app-wide full-screen setting keeps them hidden after the player closes. */
export async function immersive(on) { if (!isNative() && !appFull) return; return bars(!!on || appFull); }
/** Turns the app-wide full-screen setting on / off. */
export function setFullscreenSetting(on) { on = !!on; if (on === appFull && barsHidden !== null) return; appFull = on; barsHidden = null; return on || isNative() ? bars(on) : undefined; }
/** Hides the bars again after the system showed them (coming back to the app, a dialog, the keyboard...). */
export function reapplyFullscreen() { if (appFull) { barsHidden = null; return bars(true); } }

export async function lockOrientation(mode) {
  // mode: 'landscape' | 'portrait' | null (unlock)
  try {
    if (isNative()) {
      if (mode) await call('ScreenOrientation', 'lock', { orientation: mode });
      else await call('ScreenOrientation', 'unlock');
      return;
    }
    if (screen.orientation?.lock) {
      if (mode) await screen.orientation.lock(mode); else screen.orientation.unlock();
    }
  } catch { /* not supported or not in fullscreen */ }
}

let wake = null;
/** Keeps the screen on while a video plays (native flag on Android, Wake Lock API elsewhere). */
export async function keepAwake(on) {
  if (isNative() && playbackAvailable()) { call('AhosPlayback', 'keepScreenOn', { on: !!on }).catch(() => {}); return; }
  try {
    if (on) { if (!wake && navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); }
    else if (wake) { await wake.release(); wake = null; }
  } catch { wake = null; }
}

/* ---------------- background playback (native notification + foreground service) ---------------- */
export function playbackAvailable() {
  try {
    const c = cap();
    if (!c || !isNative()) return false;
    return typeof c.isPluginAvailable === 'function' ? c.isPluginAvailable('AhosPlayback') : !!(c.Plugins && c.Plugins.AhosPlayback);
  } catch { return false; }
}

/** Subscribes once to an event of our native plugin ('action' from the notification, 'download' from the updater). */
const hooked = new Set();
async function hookEvent(name, fire) {
  if (hooked.has(name) || !playbackAvailable()) return;
  hooked.add(name);
  try {
    const p = pluginProxy('AhosPlayback');
    if (p && typeof p.addListener === 'function') await p.addListener(name, fire);
    else if (typeof cap().nativeCallback === 'function') cap().nativeCallback('AhosPlayback', 'addListener', { eventName: name }, fire);
  } catch (e) { console.warn(name + ' hook failed', e); hooked.delete(name); }
}

let mediaHandler = null;
const fireMedia = (e) => { try { mediaHandler && mediaHandler(e); } catch (err) { console.warn(err); } };
/** handler receives {action: 'play'|'pause'|'next'|'prev'|'stop'|'seek', position?: seconds} */
export function setMediaHandler(fn) { mediaHandler = fn; if (fn) hookEvent('action', fireMedia); }
export function mediaNotify(info) {
  if (!playbackAvailable()) return;
  call('AhosPlayback', 'update', {
    title: info.title || '', artist: info.artist || '', playing: !!info.playing,
    speed: info.speed || 1, positionMs: Math.max(0, Math.round((info.position || 0) * 1000)), durationMs: Math.max(0, Math.round((info.duration || 0) * 1000)),
    hasPrev: !!info.hasPrev, hasNext: !!info.hasNext,
  }).catch(() => {});
}
export function mediaStop() { if (playbackAvailable()) call('AhosPlayback', 'stop', {}).catch(() => {}); }
/** Android 13+ asks before showing the player notification. */
export function askNotifyPermission() { if (playbackAvailable()) call('AhosPlayback', 'requestNotifyPermission', {}).catch(() => {}); }

/** Notification state: {enabled, needsAsk} (needsAsk = Android 13+ has not been asked yet). Null when there is no native part. */
export async function notificationState() {
  if (!playbackAvailable()) return null;
  try { return await call('AhosPlayback', 'notificationState', {}); } catch { return null; }
}
export function openNotificationSettings() { if (playbackAvailable()) call('AhosPlayback', 'openNotificationSettings', {}).catch(() => {}); }

/* ---------------- in-app update: native download with progress, then the system installer ---------------- */
export const updaterAvailable = () => playbackAvailable();
let dlHandler = null;
/** handler receives {state: 'start'|'progress'|'done'|'error'|'cancelled', bytes, total, speed, name, path?, error?} */
export function onDownloadEvent(fn) { dlHandler = fn; if (fn) hookEvent('download', (e) => { try { dlHandler && dlHandler(e); } catch (err) { console.warn(err); } }); }
export const downloadApk = (url, name) => call('AhosPlayback', 'downloadApk', { url, name });
export const cancelDownload = () => call('AhosPlayback', 'cancelDownload', {}).catch(() => {});
/** probe = only check the permission, never open Android's settings. Resolves {ok} or {ok:false, needsPermission:true} (Android sent the user to "allow installs from this app") or {ok:false, error}. */
export const installApk = (path, probe = false) => call('AhosPlayback', 'installApk', { path, probe });

/* ---------------- folders and Google Drive (optional native layer "AhosFolder") ---------------- */
export function folderPickerAvailable() {
  try {
    const c = cap();
    return !!(c && isNative() && typeof c.isPluginAvailable === 'function' && c.isPluginAvailable('AhosFolder'));
  } catch { return false; }
}
/** Opens Android's folder picker. Resolves {cancelled, uri, name}. drive = start on Google Drive when the phone has it. */
export const folderPick = (drive = false) => call('AhosFolder', 'pickFolder', { drive });
/** Lists every file inside a picked folder: {files: [{u, p, n, s, m, d}], dirs, bytes, skipped, truncated}. */
export const folderScan = (uri) => call('AhosFolder', 'scan', { uri });
/** Android's file picker with many files at once. Resolves {cancelled, files: [{u, p, n, s, m, d}]}. */
export const folderPickFiles = (drive = false) => call('AhosFolder', 'pickFiles', { drive });
/** Progress while a folder is being listed: fn({files, dirs}). Returns a function that stops listening. */
export function onFolderScan(fn) {
  let handle = null, off = false;
  try {
    const p = pluginProxy('AhosFolder');
    const r = p && typeof p.addListener === 'function' ? p.addListener('scan', fn) : null;
    Promise.resolve(r).then((hd) => { handle = hd; if (off) hd?.remove?.(); }).catch(() => {});
  } catch { /* no progress then */ }
  return () => { off = true; try { handle?.remove?.(); } catch { /* ignore */ } };
}
/** The address the page can fetch() a picked file from (Capacitor serves content:// addresses under /_capacitor_content_/). */
export function contentUrl(uri) {
  try { const c = cap(); if (c && typeof c.convertFileSrc === 'function') return c.convertFileSrc(uri); } catch { /* use the fallback */ }
  return `${location.origin}/_capacitor_content_/${String(uri).replace(/^content:\/\//, '')}`;
}

/* ---------------- export / share ---------------- */
const CHUNK = 3 * 1024 * 1024; // multiple of 3 so base64 chunks concatenate cleanly

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

/* ---------------- Share / Open with, and phone storage (optional native layer "AhosShare") ---------------- */
const pluginThere = (name) => {
  try { const c = cap(); return !!(c && isNative() && typeof c.isPluginAvailable === 'function' && c.isPluginAvailable(name)); } catch { return false; }
};
export const shareAvailable = () => pluginThere('AhosShare');
/** What other apps handed to this app since the last call: {items: [{u, n, m, s}], text, action: 'send' | 'view' | ''}. */
export const takeShared = () => call('AhosShare', 'getShared');
/** fn() runs when something is shared / opened with the app while it is already running. */
export function onShared(fn) {
  try {
    const p = pluginProxy('AhosShare');
    const r = p && typeof p.addListener === 'function' ? p.addListener('shared', fn) : null;
    Promise.resolve(r).catch(() => {});
  } catch { /* the page then only sees what was shared at start-up */ }
}
/** Room left on the phone's storage: {free, total} in bytes, or null when unknown. */
export async function phoneDisk() {
  if (!shareAvailable()) return null;
  try { const d = await call('AhosShare', 'diskInfo', {}); return d && d.free >= 0 ? { free: d.free, total: d.total } : null; } catch { return null; }
}

/* Phone storage: library files kept as real files on the phone (app folder), so the app is not limited to its own web storage. */
const PHONE_DIR = 'ahos-files';
const DIRS = { E: 'EXTERNAL', D: 'DATA' };
let phoneRoot = '';   // 'E' (app folder on the phone's main storage) or 'D' (app-private), whichever works
export function phoneFilesAvailable() { return pluginThere('Filesystem') || !!(cap()?.Plugins?.Filesystem && isNative()); }
async function pickRoot() {
  if (phoneRoot) return phoneRoot;
  for (const code of ['E', 'D']) {
    try { await call('Filesystem', 'mkdir', { path: PHONE_DIR, directory: DIRS[code], recursive: true }); phoneRoot = code; return code; }
    catch (e) {
      if (/exist/i.test(String(e?.message || e))) { phoneRoot = code; return code; }
    }
  }
  throw new Error('Phone storage is not available');
}
const parsePf = (pf) => { const i = String(pf).indexOf('/'); return { dir: DIRS[pf.slice(0, i)] || 'DATA', name: pf.slice(i + 1) }; };
const phonePath = (name) => `${PHONE_DIR}/${name}`;

/** Writes a blob as a file on the phone. Resolves the file's address ("E/<name>") to keep on the item. */
export async function phoneWrite(id, ext, blob, onProgress) {
  const code = await pickRoot();
  const e = String(ext || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  const name = String(id).replace(/[^A-Za-z0-9_-]/g, '_') + (e ? '.' + e : '');
  const path = phonePath(name), directory = DIRS[code];
  let off = 0, first = true;
  try {
    while (off < blob.size || first) {
      const data = await blobToBase64(blob.slice(off, off + CHUNK));
      if (first) await call('Filesystem', 'writeFile', { path, directory, data, recursive: true });
      else await call('Filesystem', 'appendFile', { path, directory, data });
      first = false;
      off += CHUNK;
      onProgress?.(Math.min(1, off / (blob.size || 1)));
    }
    const st = await call('Filesystem', 'stat', { path, directory });
    if (typeof st?.size === 'number' && st.size !== blob.size) throw Object.assign(new Error('The file was not written completely'), { name: 'QuotaExceededError' });
  } catch (err) {
    try { await call('Filesystem', 'deleteFile', { path, directory }); } catch { /* nothing was written */ }
    throw err;
  }
  return `${code}/${name}`;
}
/** A web address the page can stream the file from (video / audio play straight from the phone, nothing is loaded into memory). */
export async function phoneUrl(pf) {
  const { dir, name } = parsePf(pf);
  const { uri } = await call('Filesystem', 'getUri', { path: phonePath(name), directory: dir });
  return contentUrl(uri);
}
/** The file as a Blob, or null when it is gone. */
export async function phoneRead(pf, mime) {
  try {
    const r = await fetch(await phoneUrl(pf));
    if (!r.ok) return null;
    const b = await r.blob();
    return mime && (!b.type || b.type === 'application/octet-stream') ? new Blob([b], { type: mime }) : b;
  } catch { return null; }
}
export async function phoneRemove(pf) {
  try { const { dir, name } = parsePf(pf); await call('Filesystem', 'deleteFile', { path: phonePath(name), directory: dir }); } catch { /* already gone */ }
}
export async function phoneSize(pf) {
  try { const { dir, name } = parsePf(pf); const st = await call('Filesystem', 'stat', { path: phonePath(name), directory: dir }); return typeof st?.size === 'number' ? st.size : -1; } catch { return -1; }
}

const safeName = (n) => n.replace(/[\\/:*?"<>|]+/g, '_');

/** Opens the system share sheet (Android) or downloads the file (browser). */
export async function exportBlob(name, blob, onProgress) {
  if (isNative()) {
    const dir = 'ahos-export';
    const path = `${dir}/${safeName(name)}`;
    try { await call('Filesystem', 'mkdir', { path: dir, directory: 'CACHE', recursive: true }); } catch { /* exists */ }
    let off = 0, first = true;
    while (off < blob.size || first) {
      const data = await blobToBase64(blob.slice(off, off + CHUNK));
      if (first) await call('Filesystem', 'writeFile', { path, directory: 'CACHE', data, recursive: true });
      else await call('Filesystem', 'appendFile', { path, directory: 'CACHE', data });
      first = false;
      off += CHUNK;
      onProgress?.(Math.min(1, off / (blob.size || 1)));
    }
    const { uri } = await call('Filesystem', 'getUri', { path, directory: 'CACHE' });
    await call('Share', 'share', { title: name, dialogTitle: name, url: uri });
    return;
  }
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  onProgress?.(1);
}

/** Shares a short text (system share sheet). Resolves false when nothing could be opened. */
export async function shareText(text) {
  try {
    if (isNative()) { await call('Share', 'share', { text, dialogTitle: 'AHOS Library' }); return true; }
    if (navigator.share) { await navigator.share({ text }); return true; }
  } catch (e) { if (e && e.name === 'AbortError') return true; }
  return false;
}

/** Copies text to the clipboard. */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

export { extOf };
