// Loads what a board refers to (pictures, PDF pages, video / audio covers) from the library, lightly:
// decoded pictures are downscaled and kept in a small cache, PDF pages are drawn one at a time at the size needed.
import { state, getBlob } from '../store.js';
import { loadPdfjs, pdfParams } from '../pdf-loader.js';
import { loadImage } from '../util.js';
import { promptDialog } from '../ui.js';
import { t } from '../i18n.js';

/** A library file is remembered by id, with name + size as a fallback (ids change when a backup is restored). */
export const refOf = (it) => ({ id: it.id, name: it.name, size: it.size });

export function resolveRef(ref) {
  if (!ref) return null;
  const a = state.items.get(ref.id);
  if (a && a.size === ref.size) return a;
  for (const it of state.items.values()) if (it.name === ref.name && it.size === ref.size) return it;
  return a || null;
}

const MAX_SIDE = 1400, PX_BUDGET = 24e6;
const closeSrc = (src) => { try { src?.close?.(); } catch { /* canvas */ } };

async function decode(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    return shrink(bmp, bmp.width, bmp.height, true);
  } catch {
    // SVG and odd formats: go through an <img>
    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImage(url);
      const w = img.naturalWidth || 800, h = img.naturalHeight || 600;
      return shrink(img, w, h, false);
    } finally { URL.revokeObjectURL(url); }
  }
}

function shrink(src, w, h, closable) {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  if (k === 1 && closable) return { src, w, h };
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  if (closable) closeSrc(src);
  return { src: c, w: c.width, h: c.height };
}

export function createAssets(onReady) {
  const imgs = new Map(); // item id -> {ready, src, w, h, px}
  const thumbs = new Map(); // item id -> {blob, ready, src, w, h}
  const pages = new Map(); // `${id}:${n}:${inv}` -> {ready, src, w, h, pxW, busy}
  const docs = new Map(); // item id -> Promise<pdf>
  const urls = new Map(); // item id -> blob url
  const queue = [];
  let running = false;
  let dead = false;
  const ready = () => { if (!dead) onReady?.(); };

  function trim() {
    let px = 0;
    for (const e of imgs.values()) if (e.ready) px += e.src.width * e.src.height;
    for (const [id, e] of imgs) {
      if (px <= PX_BUDGET && imgs.size <= 40) break;
      if (!e.ready) continue;
      px -= e.src.width * e.src.height;
      closeSrc(e.src); imgs.delete(id);
    }
  }

  const api = {
    missing: (ref) => !resolveRef(ref),

    image(ref) {
      const it = resolveRef(ref);
      if (!it) return null;
      let e = imgs.get(it.id);
      if (e) { imgs.delete(it.id); imgs.set(it.id, e); return e.ready ? e : null; }
      e = { ready: false };
      imgs.set(it.id, e);
      (async () => {
        try {
          const blob = await getBlob(it.id);
          if (!blob || dead) throw new Error('missing');
          Object.assign(e, await decode(blob), { ready: true });
          trim(); ready();
        } catch (err) { console.warn('board image', err); e.failed = true; }
      })();
      return null;
    },
    async imageAsync(ref) {
      for (let i = 0; i < 200; i++) { const b = api.image(ref); if (b) return b; if (imgs.get(resolveRef(ref)?.id)?.failed) return null; await new Promise((r) => setTimeout(r, 40)); }
      return null;
    },

    /** Cover picture of a video / audio file, for its card. */
    thumb(ref) {
      const it = resolveRef(ref);
      if (!it || !it.thumb) return null;
      let e = thumbs.get(it.id);
      if (e && e.blob !== it.thumb) { closeSrc(e.src); thumbs.delete(it.id); e = null; }
      if (e) return e.ready ? e : null;
      e = { blob: it.thumb, ready: false };
      thumbs.set(it.id, e);
      createImageBitmap(it.thumb).then((bmp) => { if (dead) { closeSrc(bmp); return; } Object.assign(e, { src: bmp, w: bmp.width, h: bmp.height, ready: true }); ready(); }).catch(() => {});
      return null;
    },

    async pdfDoc(ref) {
      const it = resolveRef(ref);
      if (!it) throw new Error('missing');
      let p = docs.get(it.id);
      if (!p) {
        p = (async () => {
          const blob = await getBlob(it.id);
          if (!blob) throw new Error('missing');
          const pdfjs = await loadPdfjs();
          const task = pdfjs.getDocument(pdfParams(new Uint8Array(await blob.arrayBuffer())));
          task.onPassword = (update, reason) => {
            promptDialog({ title: reason === 2 ? t('wrongPassword') : t('pdfPassword'), type: 'password', ok: t('open') }).then((pw) => { if (pw) update(pw); else task.destroy(); });
          };
          return task.promise;
        })();
        docs.set(it.id, p);
        p.catch(() => docs.delete(it.id));
        while (docs.size > 2) { const [k, v] = docs.entries().next().value; docs.delete(k); v.then((d) => d.destroy()).catch(() => {}); }
      }
      return p;
    },
    async pdfInfo(ref) {
      const doc = await api.pdfDoc(ref);
      const pg = await doc.getPage(1);
      const vp = pg.getViewport({ scale: 1 });
      return { n: doc.numPages, w: vp.width, h: vp.height };
    },

    async pdfPageSize(ref, n) {
      const doc = await api.pdfDoc(ref);
      const pg = await doc.getPage(Math.min(Math.max(1, n), doc.numPages));
      const vp = pg.getViewport({ scale: 1 });
      return { w: vp.width, h: vp.height, n: doc.numPages };
    },

    /** Best picture of a PDF page we have now (maybe sharper or softer than asked); asks for a sharper one in the background. */
    // `crop` = [l, t, r, b] (0..1): only that part of the page is drawn, at the sharpness the part itself needs; pxW is the width of the part
    pdfPage(ref, n, pxW, inv = false, crop = null, low = false) {
      const it = resolveRef(ref);
      if (!it) return null;
      const want = bucket(pxW);
      const key = `${it.id}:${n}:${inv ? 1 : 0}${crop ? ':' + crop.map((v) => v.toFixed(4)).join(',') : ''}`;
      const e = pages.get(key);
      if (e) { pages.delete(key); pages.set(key, e); }
      if (!e || (e.pxW < want && !e.busy)) schedule(it, ref, n, want, inv, key, crop, low);
      return e && e.ready ? e : null;
    },
    async pdfPageAsync(ref, n, pxW, inv = false, crop = null) {
      const it = resolveRef(ref);
      if (!it) return null;
      const want = bucket(pxW);
      const key = `${it.id}:${n}:${inv ? 1 : 0}${crop ? ':' + crop.map((v) => v.toFixed(4)).join(',') : ''}`;
      for (let i = 0; i < 400; i++) {
        const e = pages.get(key);
        if (e && e.ready && e.pxW >= want * 0.95) return e;
        if (!e || (!e.busy && e.pxW < want)) schedule(it, ref, n, want, inv, key, crop);
        if (e?.failed) return null;
        await new Promise((r) => setTimeout(r, 60));
      }
      return null;
    },

    mediaURL(ref) {
      const it = resolveRef(ref);
      if (!it) return Promise.resolve(null);
      if (urls.has(it.id)) return Promise.resolve(urls.get(it.id));
      return getBlob(it.id).then((b) => { if (!b) return null; const u = URL.createObjectURL(b); urls.set(it.id, u); return u; });
    },
    releaseMedia() { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); },

    onPdfSize: null,
    destroy() {
      dead = true;
      for (const e of imgs.values()) closeSrc(e.src);
      for (const e of thumbs.values()) closeSrc(e.src);
      imgs.clear(); thumbs.clear(); pages.clear(); queue.length = 0;
      for (const p of docs.values()) p.then((d) => d.destroy()).catch(() => {});
      docs.clear();
      api.releaseMedia();
    },
  };

  const bucket = (px) => { for (const b of [500, 800, 1100, 1500, 2000, 2600]) if (px <= b) return b; return 2600; };

  function schedule(it, ref, n, want, inv, key, crop, low = false) {
    let e = pages.get(key);
    if (!e) { e = { ready: false, pxW: 0, busy: true }; pages.set(key, e); } else e.busy = true;
    if (low) queue.unshift({ it, ref, n, want, inv, key, crop }); else queue.push({ it, ref, n, want, inv, key, crop });   // `low` (getting pages ready in advance) waits behind what is on screen
    pump();
  }
  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queue.length && !dead) {
        // newest request first: it is what the person is looking at
        const job = queue.pop();
        const e = pages.get(job.key);
        if (!e) continue;
        try {
          const doc = await api.pdfDoc(job.ref);
          const pg = await doc.getPage(job.n);
          const vp1 = pg.getViewport({ scale: 1 });
          const cr = job.crop || [0, 0, 1, 1];
          const k = job.want / (vp1.width * (cr[2] - cr[0]));     // `want` is the width of the part that is shown
          const vp = pg.getViewport({ scale: k, offsetX: -cr[0] * vp1.width * k, offsetY: -cr[1] * vp1.height * k });
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(vp1.width * k * (cr[2] - cr[0]))); c.height = Math.max(1, Math.round(vp1.height * k * (cr[3] - cr[1])));
          const cx = c.getContext('2d');
          cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
          await pg.render({ canvasContext: cx, viewport: vp }).promise;
          let out = c;
          if (job.inv) {
            out = document.createElement('canvas'); out.width = c.width; out.height = c.height;
            const ox = out.getContext('2d');
            ox.filter = 'invert(1) hue-rotate(180deg)';
            ox.drawImage(c, 0, 0);
          }
          if (dead) break;
          Object.assign(e, { src: out, w: out.width, h: out.height, pxW: job.want, ready: true, busy: false, pw: vp1.width, ph: vp1.height });
          if (!job.crop) api.onPdfSize?.(job.ref, job.n, vp1.width, vp1.height);
          // keep the pictures of pages within a memory budget (a big page at full sharpness is tens of megabytes)
          let px = 0; for (const v of pages.values()) px += (v.w || 0) * (v.h || 0);
          while ((pages.size > 24 || px > 70e6) && pages.size > 2) { const [k0, v0] = pages.entries().next().value; if (k0 === job.key) break; px -= (v0.w || 0) * (v0.h || 0); pages.delete(k0); }
          ready();
        } catch (err) {
          console.warn('board pdf page', err);
          e.busy = false; e.failed = !e.ready;
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally { running = false; }
  }

  return api;
}
