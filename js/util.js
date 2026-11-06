// Small helpers shared by every module. No dependencies.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/** Hyperscript: h('div', {class:'x', onClick: fn}, child, 'text') */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return el;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function debounce(fn, ms = 120) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}

export function throttle(fn, ms = 250) {
  let last = 0, t;
  return (...a) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...a); }
    else { clearTimeout(t); t = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (now - last)); }
  };
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Wrap numbers+units in a left-to-right isolate so "1.4 MB" never flips inside Arabic text.
export const ltr = (s) => '\u2066' + s + '\u2069';

export function fmtBytes(n) {
  if (!n) return ltr('0 B');
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return ltr((v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i]);
}

export function fmtDur(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  const p = (x) => String(x).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}

export function fmtDate(ts, lang = 'en') {
  try {
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(ts);
  } catch { return new Date(ts).toLocaleDateString(); }
}

export function fmtNum(n, lang = 'en') {
  try { return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en').format(n); } catch { return String(n); }
}

/* ---------- file kinds ---------- */
const EXT = {
  video: 'mp4 m4v webm mkv mov 3gp 3g2 avi ogv mpg mpeg wmv flv',
  audio: 'mp3 m4a aac wav ogg oga opus flac weba amr mid',
  image: 'jpg jpeg png gif webp avif bmp svg ico jfif heic heif tif tiff',
  book: 'pdf epub txt md board',
};
const EXT_MAP = new Map();
for (const [k, v] of Object.entries(EXT)) v.split(' ').forEach((e) => EXT_MAP.set(e, k));

export function extOf(name) {
  const m = /\.([^./\\]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function kindOf(file) {
  const ext = extOf(file.name);
  if (EXT_MAP.has(ext)) return EXT_MAP.get(ext);
  const mt = file.type || '';
  if (mt.startsWith('video/')) return 'video';
  if (mt.startsWith('audio/')) return 'audio';
  if (mt.startsWith('image/')) return 'image';
  if (mt === 'application/pdf' || mt === 'application/epub+zip' || mt === 'text/plain') return 'book';
  return 'file';
}

export function stripExt(name) { return (name || '').replace(/\.[^./\\]+$/, ''); }

/* ---------- seeded randomness ---------- */
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- blobs / canvas ---------- */
export const canvasToBlob = (c, type = 'image/jpeg', q = 0.74) => new Promise((res) => c.toBlob((b) => res(b), type, q));

export function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('image failed'));
    im.src = src;
  });
}

/** Read a Blob as text trying UTF-8, falling back to windows-1256 for Arabic files. */
export async function readText(blob) {
  const buf = await blob.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { try { return new TextDecoder('windows-1256').decode(buf); } catch { return new TextDecoder().decode(buf); } }
}

export function isTouch() { return matchMedia('(pointer: coarse)').matches; }
export const isAndroid = () => /Android/i.test(navigator.userAgent);
export const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

export async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SubRip -> WebVTT (already-WebVTT text is returned untouched). */
export function toVtt(text) {
  if (/^\uFEFF?WEBVTT/.test(text)) return text;
  return 'WEBVTT\n\n' + text.replace(/\r+/g, '').replace(/^\uFEFF/, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2').trim() + '\n';
}
