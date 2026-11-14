// Covers and thumbnails: real previews when we can make them, generated contour art when we can't.
import { h, hashStr, rng, canvasToBlob, loadImage, stripExt, extOf, esc } from './util.js';
import { ic, kindIcon } from './icons.js';
import { onRemove, state, getBlob, updateItem } from './store.js';

/* ---------------- object URL cache for thumbnails ---------------- */
const urls = new Map();
export function thumbURL(item) {
  if (!item.thumb) return null;
  let u = urls.get(item.id);
  if (!u || u.blob !== item.thumb) {
    if (u) URL.revokeObjectURL(u.url);
    u = { blob: item.thumb, url: URL.createObjectURL(item.thumb) };
    urls.set(item.id, u);
  }
  return u.url;
}
onRemove((id) => { const u = urls.get(id); if (u) { URL.revokeObjectURL(u.url); urls.delete(id); } });

/* ---------------- generated art ---------------- */
const PAL = {
  video: { a: '#0f4a5c', b: '#0a1233', accent: '#3CCBBC' },
  image: { a: '#43286e', b: '#0a1233', accent: '#F0C96B' },
  book: { a: '#6a4a10', b: '#0a1233', accent: '#E7B94F' },
  audio: { a: '#24388f', b: '#0a1233', accent: '#9fb6ff' },
  file: { a: '#2d3770', b: '#0a1233', accent: '#98A2D0' },
  folder: { a: '#2d3770', b: '#0a1233', accent: '#98A2D0' },
};

function blobPath(r, cx, cy, rad, n = 10) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = rad * (1 + (r() - 0.5) * 0.55);
    pts.push([cx + Math.cos(a) * k * 1.4, cy + Math.sin(a) * k]);
  }
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d + 'Z';
}

export function genSVG(seedText, kind) {
  const seed = hashStr(seedText);
  const r = rng(seed);
  const pal = PAL[kind] || PAL.file;
  const cx = 50 + r() * 100, cy = 28 + r() * 70;
  let rings = '';
  for (let i = 0; i < 7; i++) {
    const rad = 7 + i * 11 + i * i * 0.9;
    rings += `<path d="${blobPath(r, cx, cy, rad)}" fill="none" stroke="${pal.accent}" stroke-opacity="${Math.max(0.1, 0.62 - i * 0.075).toFixed(2)}" stroke-width="${i % 3 === 0 ? 1.4 : 0.7}"/>`;
  }
  const id = 'g' + seed.toString(36);
  return `<svg viewBox="0 0 200 125" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal.a}"/><stop offset="1" stop-color="${pal.b}"/></linearGradient></defs><rect width="200" height="125" fill="url(#${id})"/>${rings}</svg>`;
}

function fillGen(wrap, item) {
  wrap.classList.add('gen');
  wrap.innerHTML = genSVG(item.id + item.name, item.kind);
  if (item.kind === 'book') {
    wrap.append(h('div', { class: 'gen-title', dir: 'auto' }, item.meta?.title || stripExt(item.name)));
  } else {
    wrap.append(h('div', { class: 'gen-ic', html: ic(kindIcon[item.kind] || 'file') }));
  }
  wrap.append(h('div', { class: 'gen-ext' }, (extOf(item.name) || item.kind).slice(0, 5)));
}

/** A cover element for an item: real thumbnail or generated art. */
export function coverEl(item) {
  const u = thumbURL(item);
  const wrap = h('div', { class: `cover k-${item.kind}` });
  if (u) {
    // No lazy loading and no fade-in dependency: a picture that exists is always visible.
    const im = h('img', { src: u, alt: '', decoding: 'async', draggable: 'false' });
    im.addEventListener('error', () => { im.remove(); fillGen(wrap, item); });
    wrap.append(im);
  } else fillGen(wrap, item);
  return wrap;
}

export function folderArt(f) {
  return genSVG('folder' + f.id + f.name, 'folder');
}

/* ---------------- thumbnails + metadata ---------------- */
const TW = 420;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const why = (code, e) => Object.assign(new Error(code), { why: code, cause: e });

function snapCanvas(source, sw, sh) {
  const scale = Math.min(1, TW / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale)); c.height = Math.max(1, Math.round(sh * scale));
  const x = c.getContext('2d');
  x.fillStyle = '#0b1233'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

async function drawToThumb(source, sw, sh) {
  return canvasToBlob(snapCanvas(source, sw, sh), 'image/jpeg', 0.74);
}

async function imageThumb(file) {
  const fin = (bmpOrImg, w, h2) => drawToThumb(bmpOrImg, w, h2);
  // 1) straight decode  2) decode at reduced size (huge photos on low-memory phones)  3) <img> element
  try {
    const bmp = await createImageBitmap(file);
    try { return { thumb: await fin(bmp, bmp.width, bmp.height), meta: { w: bmp.width, h: bmp.height } }; } finally { bmp.close?.(); }
  } catch { /* try the next way */ }
  try {
    const bmp = await createImageBitmap(file, { resizeWidth: TW, resizeQuality: 'medium' });
    try { return { thumb: await fin(bmp, bmp.width, bmp.height), meta: {} }; } finally { bmp.close?.(); }
  } catch { /* try the next way */ }
  const url = URL.createObjectURL(file);
  try {
    const im = await loadImage(url);
    return { thumb: await fin(im, im.naturalWidth || 300, im.naturalHeight || 300), meta: { w: im.naturalWidth, h: im.naturalHeight } };
  } catch (e) { throw why('decode', e); } finally { URL.revokeObjectURL(url); }
}

/** Resolves with the name of the first event that fires, or 'timeout'. */
function waitFor(el, events, ms) {
  return new Promise((resolve) => {
    let to;
    const fin = (r) => { clearTimeout(to); events.forEach((e) => el.removeEventListener(e, on)); resolve(r); };
    const on = (ev) => fin(ev.type);
    events.forEach((e) => el.addEventListener(e, on));
    to = setTimeout(() => fin('timeout'), Math.max(50, ms));
  });
}

async function seekTo(v, time, ms) {
  try {
    if (Math.abs(v.currentTime - time) < 0.02 && v.readyState >= 2) return true;
    const pending = waitFor(v, ['seeked', 'error'], ms);
    v.currentTime = time;
    if ((await pending) !== 'seeked') return false;
    if (v.readyState < 2) await waitFor(v, ['loadeddata', 'canplay'], 1500);
    return v.readyState >= 2;
  } catch { return false; }
}

/** How informative a frame is: black / flat frames score low. */
function frameStats(src) {
  try {
    const c = document.createElement('canvas'); c.width = 32; c.height = 18;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(src, 0, 0, 32, 18);
    const d = x.getImageData(0, 0, 32, 18).data;
    let sum = 0, sum2 = 0; const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; sum += l; sum2 += l * l; }
    const mean = sum / n;
    return { mean, sd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
  } catch { return { mean: 128, sd: 40 }; }
}

async function videoThumb(file) {
  const v = document.createElement('video');
  v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto';
  v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
  // attached to the page (but invisible): some phone WebViews never decode frames for detached videos
  Object.assign(v.style, { position: 'fixed', left: '-9999px', top: '0', width: '160px', height: '90px', opacity: '0', pointerEvents: 'none' });
  document.body.append(v);
  const url = URL.createObjectURL(file);
  const limit = Math.min(60000, 15000 + (file.size / 1e6) * 30);
  const t0 = Date.now();
  const left = () => limit - (Date.now() - t0);
  const meta = {};
  try {
    v.src = url;
    const r = await waitFor(v, ['loadedmetadata', 'error'], Math.min(left(), 20000));
    if (r === 'error') { meta.unsupported = true; throw why('decode'); }
    if (r === 'timeout') throw why('timeout');
    const d = v.duration;
    if (isFinite(d) && d > 0) meta.duration = d;
    if (v.videoWidth) { meta.w = v.videoWidth; meta.h = v.videoHeight; }
    if (v.readyState < 2) await waitFor(v, ['loadeddata', 'canplay', 'error'], Math.min(left(), 10000));

    const dur = meta.duration || 0;
    const raw = dur ? [Math.min(dur * 0.1, 30), dur * 0.3, dur * 0.5, Math.min(1.5, dur / 2), dur * 0.7] : [0.5, 0];
    const picks = [...new Set(raw.map((x) => Math.max(0, Math.min(x, dur ? dur - 0.15 : x)).toFixed(2)))].map(Number);
    let best = null;
    for (const tm of picks) {
      if (best && left() < 2000) break;
      if (left() < 600) break;
      if (!(await seekTo(v, tm, Math.min(7000, left())))) continue;
      if (!v.videoWidth) continue;
      meta.w = v.videoWidth; meta.h = v.videoHeight;
      const st = frameStats(v);
      const score = st.sd + (st.mean >= 10 && st.mean <= 245 ? 30 : 0);
      if (!best || score > best.score) best = { score, st, canvas: snapCanvas(v, v.videoWidth, v.videoHeight) };
      if (st.sd > 12 && st.mean >= 12 && st.mean <= 240) break; // a good frame, stop looking
    }
    if (!best) {
      // seeking gave nothing: let it play a moment and take whatever frame is on screen
      try {
        try { v.currentTime = 0; } catch { /* ignore */ }
        await v.play();
        const t1 = Date.now();
        while (Date.now() - t1 < Math.min(4500, Math.max(1200, left())) && !(v.currentTime > 0.3 && v.readyState >= 2)) await sleep(120);
        if (v.videoWidth && v.readyState >= 2) {
          meta.w = v.videoWidth; meta.h = v.videoHeight;
          best = { score: 0, st: frameStats(v), canvas: snapCanvas(v, v.videoWidth, v.videoHeight) };
        }
      } catch { /* autoplay refused */ }
      try { v.pause(); } catch { /* ignore */ }
    }
    if (!best) throw why(v.videoWidth ? 'noframe' : 'novideo');
    if (best.st.mean < 4 && best.st.sd < 3) throw why('blank'); // every frame we tried was pure black
    return { thumb: await canvasToBlob(best.canvas, 'image/jpeg', 0.74), meta };
  } catch (e) {
    if (e && e.why) { e.meta = meta; throw e; }
    throw Object.assign(why('error', e), { meta });
  } finally {
    try { v.pause(); } catch { /* ignore */ }
    v.removeAttribute('src'); try { v.load(); } catch { /* ignore */ }
    v.remove(); URL.revokeObjectURL(url);
  }
}

function audioMeta(file) {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    const url = URL.createObjectURL(file);
    const finish = (m) => { clearTimeout(to); URL.revokeObjectURL(url); a.removeAttribute('src'); resolve(m); };
    const to = setTimeout(() => finish({}), 5000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => finish({ duration: a.duration });
    a.onerror = () => finish({ unsupported: true });
    a.src = url;
  });
}

/** Minimal ID3v2 reader: title, artist and embedded cover art. */
async function id3(file) {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return {};
  const ver = head[3];
  const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
  const buf = new Uint8Array(await file.slice(10, 10 + Math.min(size, 6 * 1024 * 1024)).arrayBuffer());
  const out = {};
  let p = 0;
  const dec = (bytes, enc) => {
    try { return new TextDecoder(enc === 1 ? 'utf-16' : enc === 2 ? 'utf-16be' : enc === 3 ? 'utf-8' : 'windows-1252').decode(bytes).replace(/\0+$/g, '').replace(/^﻿/, ''); } catch { return ''; }
  };
  while (p + 10 < buf.length) {
    const id = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const fs = ver === 4 ? (buf[p + 4] << 21) | (buf[p + 5] << 14) | (buf[p + 6] << 7) | buf[p + 7] : (buf[p + 4] << 24) | (buf[p + 5] << 16) | (buf[p + 6] << 8) | buf[p + 7];
    const start = p + 10, end = start + fs;
    if (fs <= 0 || end > buf.length) break;
    const f = buf.subarray(start, end);
    if (id === 'TIT2') out.title = dec(f.subarray(1), f[0]);
    else if (id === 'TPE1') out.artist = dec(f.subarray(1), f[0]);
    else if (id === 'APIC' && !out.cover) {
      const enc = f[0];
      let i = 1;
      let mime = '';
      while (i < f.length && f[i] !== 0) mime += String.fromCharCode(f[i++]);
      i += 2; // null + picture type
      if (enc === 1 || enc === 2) { while (i + 1 < f.length && !(f[i] === 0 && f[i + 1] === 0)) i += 2; i += 2; }
      else { while (i < f.length && f[i] !== 0) i++; i += 1; }
      const img = f.subarray(i);
      if (img.length > 200) out.cover = new Blob([img], { type: /png/i.test(mime) ? 'image/png' : 'image/jpeg' });
    }
    p = end;
  }
  return out;
}

async function audioThumb(file, ext) {
  const meta = await audioMeta(file);
  let thumb = null;
  if (ext === 'mp3') {
    try {
      const tag = await id3(file);
      if (tag.title) meta.title = tag.title;
      if (tag.artist) meta.author = tag.artist;
      if (tag.cover) {
        const url = URL.createObjectURL(tag.cover);
        try { const im = await loadImage(url); thumb = await drawToThumb(im, im.naturalWidth, im.naturalHeight); } finally { URL.revokeObjectURL(url); }
      }
    } catch { /* tags are optional */ }
  }
  return { thumb, meta };
}

async function pdfThumb(file) {
  const { loadPdfjs, pdfParams } = await import('./pdf-loader.js');
  const pdfjs = await loadPdfjs();
  let blobUrl = '';
  let task;
  // Normal way: hand pdf.js the bytes. Huge files (or a phone that can't hold them in memory): let it read the blob in pieces.
  try {
    if (file.size > 220 * 1024 * 1024) throw new Error('big');
    task = pdfjs.getDocument(pdfParams(new Uint8Array(await file.arrayBuffer())));
  } catch {
    blobUrl = URL.createObjectURL(file);
    const p = pdfParams(undefined); delete p.data;
    task = pdfjs.getDocument({ ...p, url: blobUrl, disableAutoFetch: true, rangeChunkSize: 1 << 20 });
  }
  const cap = (promise, ms, code) => Promise.race([promise, sleep(ms).then(() => { throw why(code); })]);
  try {
    let doc;
    try { doc = await cap(task.promise, 30000, 'timeout'); } catch (e) {
      if (e?.name === 'PasswordException') throw why('password', e);
      if (e?.name === 'InvalidPDFException') throw why('invalid', e);
      throw e?.why ? e : why('pdfopen', e);
    }
    try {
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const scale = Math.min(360 / vp.width, 900 / vp.height);
      const c = document.createElement('canvas');
      const v2 = page.getViewport({ scale });
      c.width = Math.max(1, Math.round(v2.width)); c.height = Math.max(1, Math.round(v2.height));
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      try { await cap(page.render({ canvasContext: x, viewport: v2 }).promise, 25000, 'timeout'); } catch (e) { throw e?.why ? e : why('pdfrender', e); }
      let title = '';
      try { const info = await doc.getMetadata(); title = info?.info?.Title || ''; } catch { /* optional */ }
      return { thumb: await canvasToBlob(c, 'image/jpeg', 0.72), meta: { pages: doc.numPages, title: String(title).trim() } };
    } finally { try { await doc.destroy(); } catch { /* ignore */ } }
  } finally {
    try { await task.destroy(); } catch { /* ignore */ }
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }
}

async function epubThumb(file) {
  const { openEpub } = await import('./epub-core.js');
  const book = await openEpub(file);
  let thumb = null;
  try {
    const cb = await book.coverBlob();
    if (cb) {
      const url = URL.createObjectURL(cb);
      try { const im = await loadImage(url); thumb = await drawToThumb(im, im.naturalWidth, im.naturalHeight); } finally { URL.revokeObjectURL(url); }
    }
  } catch { /* no cover */ }
  const meta = { title: book.title, author: book.author, lang: book.lang, chapters: book.spine.length };
  book.destroy();
  return { thumb, meta };
}

export async function analyze(file, kind, ext) {
  try {
    if (kind === 'image') return await imageThumb(file);
    if (kind === 'video') return await videoThumb(file);
    if (kind === 'audio') return await audioThumb(file, ext);
    if (kind === 'book' && ext === 'pdf') return await pdfThumb(file);
    if (kind === 'book' && ext === 'board') return await (await import('./board/io.js')).boardThumb(file);
    if (kind === 'book' && ext === 'epub') return await epubThumb(file);
  } catch (e) {
    console.warn('preview failed for', file?.name, e?.why || e);
    const code = e?.why || (e?.name === 'NotReadableError' || e?.name === 'RangeError' ? 'memory' : 'error');
    return { thumb: null, meta: { ...(e?.meta || {}), thumbWhy: code } };
  }
  return { thumb: null, meta: {} };
}

/* ---------------- background preview filler ---------------- */
/** Should this item have a picture? (EPUB / MP3 only when they carry their own cover, tried at import) */
const wantsThumb = (it) => it.kind === 'image' || it.kind === 'video' || (it.kind === 'book' && (it.ext === 'pdf' || it.ext === 'board'));
const maybeThumb = (it) => wantsThumb(it) || (it.kind === 'book' && it.ext === 'epub') || (it.kind === 'audio' && it.ext === 'mp3');

/** Items that lack a picture, filtered to the ones worth another try. */
export function missingThumbs({ all = false } = {}) {
  return [...state.items.values()].filter((it) => !it.thumb && (all ? maybeThumb(it) : wantsThumb(it)));
}

let filling = false;
const idle = () => new Promise((r) => (window.requestIdleCallback ? window.requestIdleCallback(() => r(), { timeout: 1500 }) : setTimeout(r, 120)));

/**
 * Makes previews for items that have none, one at a time.
 *  force: ignore earlier failures and also try EPUB / MP3 covers (used by the "rebuild previews" button)
 */
export async function ensureThumbs({ force = false, onProgress } = {}) {
  if (filling) return { made: 0, failed: 0, busy: true };
  filling = true;
  let made = 0, failed = 0, changed = 0;
  try {
    const list = missingThumbs({ all: force }).filter((it) => force || (it.meta?.thumbTry || 0) < 2);
    for (let i = 0; i < list.length; i++) {
      const it = state.items.get(list[i].id);
      if (!it || it.thumb) continue;
      while (!force && (document.hidden || document.querySelector('.progress-card'))) await sleep(2000);
      await idle();
      onProgress?.(i, list.length, it);
      const blob = await getBlob(it.id).catch(() => null);
      if (!blob) { failed++; continue; }
      const { thumb, meta } = await analyze(new File([blob], it.name, { type: it.mime || blob.type }), it.kind, it.ext);
      const m = { ...(it.meta || {}), ...(meta || {}) };
      m.thumbTry = (it.meta?.thumbTry || 0) + 1;
      if (thumb) { delete m.thumbWhy; made++; } else { if (wantsThumb(it)) failed++; if (m.thumbWhy === 'password' || m.thumbWhy === 'invalid') m.thumbTry = 9; }
      updateItem(it.id, { thumb: thumb || null, meta: m }, { card: true });
      if (thumb) changed++;
    }
    onProgress?.(list.length, list.length, null);
  } finally {
    filling = false;
  }
  return { made, failed };
}

export { esc };
