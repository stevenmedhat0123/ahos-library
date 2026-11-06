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

export async function immersive(on) {
  if (!isNative()) return;
  try { await call('SystemBars', on ? 'hide' : 'show', {}); return; } catch { /* older Capacitor, try the StatusBar plugin */ }
  try { await call('StatusBar', on ? 'hide' : 'show'); } catch { /* optional */ }
}

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
