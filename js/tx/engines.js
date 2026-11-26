// The ways a sound, a video or a photo becomes text. Three engines, one door (runEngine):
//   cloud   the access server listens with a large Whisper model (members and the owner, needs the internet) – the best for Arabic and long files
//   device  Whisper running on the phone (transformers.js); the engine and the model are downloaded once (tiny ~40 MB, base ~80 MB, small ~250 MB)
//   ocr     Tesseract on the phone for photos / scans of text (Arabic + English); the engine and the language data are downloaded once
// Nothing here can be checked against real speech in the test sandbox (no network, no model): the tests drive the same code path with
// globalThis.__ahosTxMock, and the first real run on a phone is the real test. Errors are reported with a code the screen turns into a sentence.
import { decodeMono16k, wavPiece, cutPoints } from './audio.js';
import { cleanSegs, textFromSegs, segsFromText } from './model.js';
import { gateEnabled, access, txCall } from '../auth.js';

export const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.1.0';
export const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';
export const MODELS = { fast: 'Xenova/whisper-tiny', balanced: 'Xenova/whisper-base', best: 'Xenova/whisper-small' };
export const MODEL_MB = { fast: 40, balanced: 80, best: 250 };
export const QUALITIES = ['fast', 'balanced', 'best'];
/** Languages the person can pick for speech ('' = let the engine find out). */
export const LANGS = ['', 'ar', 'en', 'fr', 'de', 'es', 'tr', 'it', 'ru'];

const err = (code, extra) => Object.assign(new Error(code), { code, ...(extra || {}) });
const aborted = (sig) => { if (sig && sig.aborted) throw err('cancelled'); };
const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/* ------------------------------------------------------------------ what can run now */
let cloudMemo = null;
/** What the server says about transcription: { ok, ai (the server has Workers AI), left (seconds of speech left today, -1 = no limit) }. */
export async function cloudInfo(force = false) {
  if (!force && cloudMemo && Date.now() - cloudMemo.at < 60000) return cloudMemo.v;
  let v = { ok: false, ai: false, left: 0, why: 'no_server' };
  try {
    if (gateEnabled() && access().ok) { const r = await txCall('info', {}, 12000); v = { ok: true, ai: !!r.ai, left: Number(r.left), why: r.ai ? '' : 'no_ai' }; }
  } catch (e) { v = { ok: false, ai: false, left: 0, why: (e && e.code) || 'offline' }; }
  cloudMemo = { at: Date.now(), v };
  return v;
}

/** Which models are already on the phone (so the screen can say "ready" or "will download 80 MB"). */
export async function cachedQualities() {
  const have = new Set();
  try {
    if (typeof caches === 'undefined') return have;
    for (const name of await caches.keys()) {
      const c = await caches.open(name);
      for (const req of await c.keys()) for (const q of QUALITIES) if (req.url.includes(MODELS[q]) && /\.onnx/.test(req.url)) have.add(q);
    }
  } catch { /* no cache API */ }
  return have;
}

/** Engines that make sense for a source, best first: [{ id, ok, why }]. */
export async function enginesFor(src) {
  if (globalThis.__ahosTxMock) return src === 'photo' ? [{ id: 'ocr', ok: true }] : [{ id: 'cloud', ok: true }, { id: 'device', ok: true }];
  if (src === 'photo') return [{ id: 'ocr', ok: online(), why: online() ? '' : 'offline' }];
  const c = await cloudInfo();
  return [
    { id: 'cloud', ok: c.ok && c.ai && online(), why: !online() ? 'offline' : c.why, left: c.left },
    { id: 'device', ok: true, why: '' },
  ];
}

/* ------------------------------------------------------------------ cloud */
const toBase64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(err('read'));
  r.readAsDataURL(blob);
});

async function runCloud({ blob, lang, onProgress, signal }) {
  onProgress({ phase: 'prepare', pct: 0 });
  const { pcm, rate, dur } = await decodeMono16k(blob);
  const pts = cutPoints(pcm, rate, dur, 120);
  const segs = [];
  let found = lang || '';
  for (let i = 0; i + 1 < pts.length; i++) {
    aborted(signal);
    const piece = wavPiece(pcm, rate, pts[i], pts[i + 1]);
    let r;
    try { r = await txCall('stt', { audio: await toBase64(piece), lang: lang || '', secs: Math.ceil(pts[i + 1] - pts[i]) }, 180000); } catch (e) {
      if (e && e.code === 'timeout') throw err('timeout');
      throw err((e && e.code) || 'server_error', { retry: e && e.retry });
    }
    for (const g of r.segments || []) segs.push({ s: pts[i] + Number(g.s || 0), e: pts[i] + Number(g.e || g.s || 0), t: g.t });
    if (!r.segments || !r.segments.length) if (r.text) segs.push({ s: pts[i], e: pts[i + 1], t: r.text });
    if (r.lang && !found) found = r.lang;
    onProgress({ phase: 'transcribe', pct: (i + 1) / (pts.length - 1) });
  }
  const clean = cleanSegs(segs, dur);
  return { text: textFromSegs(clean), segs: clean, lang: found, dur };
}

/* ------------------------------------------------------------------ on the phone: Whisper */
let tf = null;
const pipes = new Map();
async function loadWhisper(quality, onProgress) {
  if (pipes.has(quality)) return pipes.get(quality);
  if (!online() && !(await cachedQualities()).has(quality)) throw err('offline');
  try {
    onProgress({ phase: 'engine', pct: 0 });
    tf = tf || await import(/* @vite-ignore */ TF_URL);
    tf.env.allowLocalModels = false;
    const files = new Map();
    const p = tf.pipeline('automatic-speech-recognition', MODELS[quality], {
      progress_callback: (x) => {
        if (!x || !x.file) return;
        if (x.status === 'progress' && x.total) files.set(x.file, { l: x.loaded || 0, t: x.total });
        let l = 0, t = 0;
        for (const f of files.values()) { l += f.l; t += f.t; }
        if (t) onProgress({ phase: 'model', pct: Math.min(1, l / t), mb: Math.round(t / 1048576) });
      },
    });
    pipes.set(quality, p);
    p.catch(() => pipes.delete(quality));
    return await p;
  } catch (e) {
    pipes.delete(quality);
    throw err(online() ? 'engine_failed' : 'offline', { detail: String(e && e.message || e).slice(0, 160) });
  }
}

async function runDevice({ blob, lang, quality = 'balanced', onProgress, signal }) {
  onProgress({ phase: 'prepare', pct: 0 });
  const { pcm, rate, dur } = await decodeMono16k(blob);
  const asr = await loadWhisper(quality, onProgress);
  const pts = cutPoints(pcm, rate, dur, 60);
  const segs = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    aborted(signal);
    const a = Math.floor(pts[i] * rate), b = Math.floor(pts[i + 1] * rate);
    let out;
    try { out = await asr(pcm.subarray(a, b), { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, language: lang || undefined, task: 'transcribe' }); } catch (e) {
      throw err('engine_failed', { detail: String(e && e.message || e).slice(0, 160) });
    }
    const chunks = Array.isArray(out && out.chunks) && out.chunks.length ? out.chunks : (out && out.text ? [{ timestamp: [0, pts[i + 1] - pts[i]], text: out.text }] : []);
    for (const c of chunks) {
      const s = Number(c.timestamp && c.timestamp[0]) || 0;
      const e = c.timestamp && c.timestamp[1] != null ? Number(c.timestamp[1]) : pts[i + 1] - pts[i];
      segs.push({ s: pts[i] + s, e: pts[i] + e, t: c.text });
    }
    onProgress({ phase: 'transcribe', pct: (i + 1) / (pts.length - 1) });
  }
  const clean = cleanSegs(segs, dur);
  return { text: textFromSegs(clean), segs: clean, lang: lang || '', dur };
}

/* ------------------------------------------------------------------ on the phone: reading a photo */
/** The picture a bit friendlier for the reader: not tiny, not huge, grey and with the contrast stretched. */
async function prepImage(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const big = Math.max(bmp.width, bmp.height);
    const k = big < 1200 ? Math.min(2.5, 1600 / big) : big > 3200 ? 3200 / big : 1;
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, w, h);
    const im = g.getImageData(0, 0, w, h), d = im.data;
    let lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0; d[i] = y; if (y < lo) lo = y; if (y > hi) hi = y; }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span)); d[i] = d[i + 1] = d[i + 2] = v; }
    g.putImageData(im, 0, 0);
    return await new Promise((res) => cv.toBlob((b) => res(b || blob), 'image/png'));
  } catch { return blob; }
}

async function runOcr({ blob, lang, onProgress, signal }) {
  if (!online()) throw err('offline');
  let T;
  try { const m = await import(/* @vite-ignore */ TESS_URL); T = m.default && m.default.createWorker ? m.default : m; } catch (e) { throw err('engine_failed', { detail: String(e && e.message || e).slice(0, 160) }); }
  aborted(signal);
  const langs = lang === 'en' ? ['eng'] : lang === 'ar' ? ['ara', 'eng'] : ['ara', 'eng'];
  onProgress({ phase: 'prepare', pct: 0 });
  const img = await prepImage(blob);
  let worker;
  try {
    worker = await T.createWorker(langs, 1, { logger: (m) => { if (m && typeof m.progress === 'number') onProgress({ phase: /load|init/i.test(m.status || '') ? 'model' : 'transcribe', pct: m.progress }); } });
    aborted(signal);
    const { data } = await worker.recognize(img);
    const text = String(data && data.text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) throw err('no_text');
    return { text, segs: segsFromText(text, 0), lang: /[؀-ۿ]/.test(text) ? 'ar' : 'en', dur: 0 };
  } catch (e) {
    if (e && e.code) throw e;
    throw err('engine_failed', { detail: String(e && e.message || e).slice(0, 160) });
  } finally { try { if (worker) await worker.terminate(); } catch { /* gone */ } }
}

/* ------------------------------------------------------------------ the door */
/**
 * runEngine({ engine: 'cloud' | 'device' | 'ocr', blob, lang, quality, onProgress({ phase, pct, mb }), signal })
 *   -> { text, segs [{ s, e, t }], lang, dur }
 * Throws Error with .code: offline, cancelled, decode, too_long, empty, no_text, engine_failed, timeout, no_ai, quota, bad_token, server_error…
 */
export async function runEngine(opts) {
  const o = { lang: '', quality: 'balanced', onProgress: () => {}, ...opts };
  if (globalThis.__ahosTxMock) return globalThis.__ahosTxMock(o);
  if (o.engine === 'cloud') return runCloud(o);
  if (o.engine === 'ocr') return runOcr(o);
  return runDevice(o);
}

/** An engine's error as a key of the language file (tx_err_*), whatever the code. */
export const errKey = (e) => {
  const c = e && e.code;
  return ['offline', 'cancelled', 'decode', 'too_long', 'empty', 'no_text', 'engine_failed', 'timeout', 'no_ai', 'quota', 'bad_token', 'session_ended', 'blocked'].includes(c) ? 'tx_err_' + c : 'tx_err_other';
};

/** The cloud summary (a better one than the offline one), or null when the server cannot make it right now. */
export async function cloudSummary(text, lang, length = 'medium') {
  try {
    const r = await txCall('summary', { text: String(text).slice(0, 24000), lang: lang || '', length }, 60000);
    if (r && r.summary) return { summary: String(r.summary), points: Array.isArray(r.points) ? r.points.map(String).slice(0, 10) : [], title: String(r.title || '') };
  } catch { /* the offline one stays */ }
  return null;
}
