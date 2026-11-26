// Subtitle tracks and cues: the data model and every edit that works on it (no screen code here, so it is easy to test).
//
//   track = { id, name, lang, v: 2, style: {…defaults}, cues: [cue…], updated }
//   cue   = { id, start, end, text, style?: { size, color, bg, bgOp, ol, olc, shadow, b, i, u, font, op, an, pos: {x, y} | null, fade } }
//
// Times are seconds (milliseconds kept). Sizes are a percentage of the video picture's height, positions a percentage of its width/height,
// so a subtitle looks the same on the preview, full screen and any other screen. `an` is the ASS/numpad alignment (1–3 bottom, 4–6 middle,
// 7–9 top; 1/4/7 left, 2/5/8 centre, 3/6/9 right). `pos` is where that anchor point sits; null = the default place for `an`.
import { uid } from '../util.js';

export const FONTS = ['sans', 'serif', 'mono', 'hand'];
export const DEFAULT_STYLE = Object.freeze({ size: 5.2, color: '#ffffff', bg: '#000000', bgOp: 0.55, ol: 0, olc: '#000000', shadow: true, b: false, i: false, u: false, font: 'sans', op: 1, an: 2, pos: null, fade: 0 });
const MIN_LEN = 0.1;

export const round3 = (n) => Math.round(n * 1000) / 1000;
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** A new empty track. */
export const newTrack = (name = '', lang = '') => ({ id: uid(), name, lang, v: 2, style: {}, cues: [], updated: Date.now() });

/** The picture-and-position style of one cue: built-in defaults < the track's defaults < the cue's own settings. */
export function resolveStyle(cue, track, base = null) {
  const s = { ...DEFAULT_STYLE, ...(base || {}), ...((track && track.style) || {}), ...((cue && cue.style) || {}) };
  if (!(s.an >= 1 && s.an <= 9)) s.an = 2;
  return s;
}

/** Keeps only sane values, sorts by start time. Safe to call on anything that came from a file or from an older version. */
export function normalizeCue(c) {
  const start = Math.max(0, round3(num(c.start, 0)));
  const end = Math.max(start + MIN_LEN, round3(num(c.end, start + 2)));
  const out = { id: c.id || uid(), start, end, text: String(c.text == null ? '' : c.text).replace(/\r\n?/g, '\n') };
  if (c.style && typeof c.style === 'object' && Object.keys(c.style).length) out.style = cleanStyle(c.style);
  return out;
}
export function cleanStyle(st) {
  const o = {};
  const put = (k, v) => { if (v !== undefined) o[k] = v; };
  if ('size' in st) put('size', Math.min(30, Math.max(1.5, num(st.size, DEFAULT_STYLE.size))));
  if ('color' in st) put('color', /^#[0-9a-f]{6}$/i.test(st.color) ? st.color.toLowerCase() : DEFAULT_STYLE.color);
  if ('bg' in st) put('bg', /^#[0-9a-f]{6}$/i.test(st.bg) ? st.bg.toLowerCase() : DEFAULT_STYLE.bg);
  if ('bgOp' in st) put('bgOp', Math.min(1, Math.max(0, num(st.bgOp, DEFAULT_STYLE.bgOp))));
  if ('ol' in st) put('ol', Math.min(14, Math.max(0, num(st.ol, 0))));
  if ('olc' in st) put('olc', /^#[0-9a-f]{6}$/i.test(st.olc) ? st.olc.toLowerCase() : '#000000');
  for (const k of ['shadow', 'b', 'i', 'u']) if (k in st) put(k, !!st[k]);
  if ('font' in st) put('font', FONTS.includes(st.font) ? st.font : 'sans');
  if ('op' in st) put('op', Math.min(1, Math.max(0.1, num(st.op, 1))));
  if ('an' in st) put('an', Math.min(9, Math.max(1, Math.round(num(st.an, 2)))));
  if ('fade' in st) put('fade', Math.min(1000, Math.max(0, Math.round(num(st.fade, 0)))));
  if ('pos' in st) put('pos', st.pos && Number.isFinite(+st.pos.x) && Number.isFinite(+st.pos.y) ? { x: Math.min(100, Math.max(0, round3(+st.pos.x))), y: Math.min(100, Math.max(0, round3(+st.pos.y))) } : null);
  return o;
}
export function normalizeTrack(tr) {
  const cues = (tr.cues || []).map(normalizeCue).sort((a, b) => a.start - b.start || a.end - b.end);
  return { id: tr.id || uid(), name: tr.name || '', lang: tr.lang || '', v: 2, style: cleanStyle(tr.style || {}), cues, updated: tr.updated || Date.now() };
}
export const sortCues = (cues) => cues.sort((a, b) => a.start - b.start || a.end - b.end);

/** A new cue at `at`, `len` seconds long, trimmed so it does not run into the next one. */
export function makeCue(cues, at, len = 2, text = '') {
  const start = Math.max(0, round3(at));
  const next = cues.filter((c) => c.start > start).sort((a, b) => a.start - b.start)[0];
  let end = start + len;
  if (next && next.start - start >= 0.3) end = Math.min(end, next.start);
  return { id: uid(), start, end: round3(Math.max(end, start + MIN_LEN)), text };
}

/** Splits a cue at time `t` (text split at `caret` if given). Returns [first, second] or null when `t` is not inside the cue. */
export function splitCue(cue, t, caret = -1) {
  if (!(t > cue.start + 0.05 && t < cue.end - 0.05)) return null;
  const text = cue.text || '';
  let a = text, b = '';
  if (caret > 0 && caret < text.length) { a = text.slice(0, caret).trimEnd(); b = text.slice(caret).trimStart(); }
  else {
    const lines = text.split('\n');
    if (lines.length > 1) { const m = Math.ceil(lines.length / 2); a = lines.slice(0, m).join('\n'); b = lines.slice(m).join('\n'); }
    else { const mid = Math.floor(text.length / 2); const cut = nearestSpace(text, mid); a = text.slice(0, cut).trimEnd(); b = text.slice(cut).trimStart(); }
  }
  const first = { ...cue, end: round3(t), text: a };
  const second = { ...cue, id: uid(), start: round3(t), text: b };
  if (cue.style) second.style = { ...cue.style };
  return [first, second];
}
function nearestSpace(s, i) {
  let l = i, r = i;
  while (l > 0 && s[l] !== ' ') l--;
  while (r < s.length && s[r] !== ' ') r++;
  if (s[l] !== ' ' && s[r] !== ' ') return i;
  if (s[l] !== ' ') return r;
  if (s[r] !== ' ') return l;
  return i - l <= r - i ? l : r;
}

/** One cue made of two (the first keeps its own style). */
export function mergeCues(a, b) {
  return { ...a, end: Math.max(a.end, b.end), text: [a.text, b.text].filter((x) => x && x.trim()).join('\n') };
}

/** Moves cues by `delta` seconds (all of them, or only those starting at/after `from`). Nothing goes below 0. */
export function shiftCues(cues, delta, from = -Infinity) {
  const picked = cues.filter((c) => c.start >= from - 1e-9);
  const floor = picked.length ? Math.min(...picked.map((c) => c.start)) : 0;
  const d = Math.max(delta, -floor);          // never push the first cue before 0 (that would squash its start)
  return cues.map((c) => (c.start >= from - 1e-9 ? { ...c, start: round3(c.start + d), end: round3(c.end + d) } : c));
}

/** Two-point sync: the cue starting at `a1` should start at `b1`, the one at `a2` at `b2`. Every time is stretched linearly to fit. */
export function syncCues(cues, a1, b1, a2, b2) {
  if (Math.abs(a2 - a1) < 0.05) return cues;
  const k = (b2 - b1) / (a2 - a1);
  const map = (t) => Math.max(0, round3(b1 + (t - a1) * k));
  return cues.map((c) => { const s = map(c.start); return { ...c, start: s, end: Math.max(s + MIN_LEN, map(c.end)) }; });
}

/** Reading speed: characters per second a viewer has to read (spaces count, line breaks do not). */
export const readingSpeed = (c) => { const len = (c.text || '').replace(/\n/g, '').length; const d = Math.max(0.05, c.end - c.start); return len / d; };

/** Gives every cue the time it needs to be read (`cps` characters per second, at least `min`, at most `max`), never running into the next cue. */
export function autoDurations(cues, { cps = 17, min = 1.2, max = 7 } = {}) {
  const sorted = sortCues(cues.map((c) => ({ ...c })));
  sorted.forEach((c, i) => {
    const want = Math.min(max, Math.max(min, (c.text || '').replace(/\n/g, '').length / cps));
    const next = sorted[i + 1];
    let end = c.start + want;
    if (next) end = Math.min(end, next.start - 0.04);
    c.end = round3(Math.max(c.start + MIN_LEN, end));
  });
  return sorted;
}

/** Plain lines of text -> cues, one after another from `from`, each as long as it takes to read. */
export function cuesFromLines(text, from = 0, { cps = 17, min = 1.2, max = 7, gap = 0.1 } = {}) {
  const lines = String(text || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  let t = from;
  for (const line of lines) {
    const len = Math.min(max, Math.max(min, line.length / cps));
    out.push({ id: uid(), start: round3(t), end: round3(t + len), text: line });
    t += len + gap;
  }
  return out;
}

/** Find & replace over every cue's text. Returns { cues, count }. */
export function replaceText(cues, find, repl, { matchCase = false } = {}) {
  if (!find) return { cues, count: 0 };
  const esc = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc, matchCase ? 'g' : 'gi');
  let count = 0;
  const out = cues.map((c) => {
    const hits = (c.text.match(re) || []).length;
    if (!hits) return c;
    count += hits;
    return { ...c, text: c.text.replace(re, () => repl) };
  });
  return { cues: out, count };
}

/** Problems worth a warning, per cue id: overlap · too short · too long · too fast to read · empty. */
export function checkCues(cues, { fastCps = 21, minLen = 0.5, maxLen = 8 } = {}) {
  const sorted = sortCues(cues.slice());
  const res = new Map();
  const add = (id, k) => { const a = res.get(id) || []; if (!a.includes(k)) a.push(k); res.set(id, a); };
  sorted.forEach((c, i) => {
    const d = c.end - c.start;
    if (!c.text.trim()) add(c.id, 'empty');
    if (d < minLen) add(c.id, 'short');
    if (d > maxLen) add(c.id, 'long');
    if (c.text.trim() && readingSpeed(c) > fastCps) add(c.id, 'fast');
    for (let j = i + 1; j < sorted.length && sorted[j].start < c.end - 0.001; j++) { add(c.id, 'overlap'); add(sorted[j].id, 'overlap'); }
  });
  return res;
}

/** The cues showing at time `t` (several when they overlap). `sorted` must be sorted by start; `maxLen` the longest cue length. */
export function activeAt(sorted, t, maxLen = 30) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m].start <= t) lo = m + 1; else hi = m; }
  const out = [];
  for (let i = lo - 1; i >= 0 && sorted[i].start > t - maxLen - 1; i--) if (sorted[i].end > t) out.push(sorted[i]);
  return out.reverse();
}

/** "1:02.345" / "01:02:03.450" ⇄ seconds. */
export function fmtTime(sec, ms = true) {
  const s = Math.max(0, sec || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s - h * 3600 - m * 60;
  const whole = Math.floor(r), frac = Math.round((r - whole) * 1000);
  const sec2 = String(whole + (frac === 1000 ? 1 : 0)).padStart(2, '0'), f = String(frac === 1000 ? 0 : frac).padStart(3, '0');
  return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${sec2}${ms ? '.' + f : ''}`;
}
export function parseTime(str) {
  const s = String(str || '').trim().replace(/[,٫]/g, '.').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (!s) return NaN;
  if (/^\d+(\.\d+)?$/.test(s)) return +s;
  const parts = s.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  return parts.reduce((acc, p) => acc * 60 + parseFloat(p), 0);
}
