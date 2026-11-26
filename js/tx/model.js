// What a transcription is: the text, the timed pieces (segments) it came from, where it came from (voice / video / photo), and its summary.
// It lives on the media item itself (item.tx), so the text and the sound / picture are one thing that has one name.
import { summarize, splitSentences } from './summary.js';

export const TX_VERSION = 1;
export const SOURCES = ['voice', 'video', 'photo'];           // what was turned into text
/** The kind of library item a source is made from. */
export const KIND_OF = { voice: 'audio', video: 'video', photo: 'image' };
export const SOURCE_OF = { audio: 'voice', video: 'video', image: 'photo' };

export const wordCount = (text) => (String(text || '').match(/\S+/g) || []).length;

/** 83.4 -> "1:23", 3725 -> "1:02:05" */
export function clock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

/** Timed pieces from engine output (start / end in seconds): sorted, no negatives, never ending before they start, no empty ones. */
export function cleanSegs(segs, duration = 0) {
  const out = [];
  for (const g of Array.isArray(segs) ? segs : []) {
    const t = String(g && g.t != null ? g.t : '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    let s = Number(g.s), e = Number(g.e);
    if (!Number.isFinite(s) || s < 0) s = 0;
    if (!Number.isFinite(e) || e < s) e = s;
    if (duration > 0) { s = Math.min(s, duration); e = Math.min(e, duration); }
    out.push({ s: Math.round(s * 100) / 100, e: Math.round(e * 100) / 100, t });
  }
  out.sort((a, b) => a.s - b.s);
  // a piece that stops where the next one starts, with nothing in between
  for (let i = 0; i < out.length - 1; i++) if (out[i].e > out[i + 1].s) out[i].e = out[i + 1].s;
  return out;
}

/** Text with no timing (typed, pasted, photographed): spread over the duration by how long each sentence is, so it can still be followed along. */
export function segsFromText(text, duration = 0) {
  const sents = splitSentences(text);
  if (!sents.length) return [];
  const total = sents.reduce((a, s) => a + s.length, 0) || 1;
  let at = 0;
  return sents.map((t) => {
    const len = duration > 0 ? (duration * t.length) / total : 0;
    const g = { s: Math.round(at * 100) / 100, e: Math.round((at + len) * 100) / 100, t };
    at += len;
    return g;
  });
}

export const textFromSegs = (segs) => (segs || []).map((g) => g.t).join(' ').replace(/\s+/g, ' ').trim();

/** Index of the piece being said at second `t` (the last one that has started), -1 before the first. */
export function segAt(segs, t) {
  let lo = 0, hi = (segs || []).length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].s <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** A new transcription record. `segs` may be empty (then they are made from the text). */
export function newTx({ text = '', segs = [], lang = '', engine = 'manual', src = 'voice', dur = 0, summary = true } = {}) {
  let g = cleanSegs(segs, dur);
  const body = String(text || '').trim() || textFromSegs(g);
  if (!g.length && body) g = segsFromText(body, dur);
  const tx = { v: TX_VERSION, text: body, segs: g, lang: lang || '', engine, src, dur: Math.round(dur * 10) / 10, at: Date.now(), sum: null };
  if (summary && body) tx.sum = makeSummary(tx);
  return tx;
}

/** The offline summary of a transcription, in the shape that is stored: { summary, points, keywords, title, length, by, at }. */
export function makeSummary(tx, length = 'medium') {
  const r = summarize(tx.text, { segs: tx.segs, length });
  return { summary: r.summary, points: r.points, keywords: r.keywords, title: r.title, length, by: 'local', at: Date.now(), lang: r.lang };
}

const stamp = (sec, comma) => {
  const ms = Math.round((Number(sec) || 0) * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  const two = (n) => String(n).padStart(2, '0');
  return `${two(h)}:${two(m)}:${two(s)}${comma ? ',' : '.'}${String(r).padStart(3, '0')}`;
};
/** Subtitle files: every piece with its time (a piece with no length gets a few seconds so a player can show it). */
export function toSrt(segs) {
  return (segs || []).map((g, i) => `${i + 1}\n${stamp(g.s, true)} --> ${stamp(g.e > g.s ? g.e : g.s + 3, true)}\n${g.t}\n`).join('\n');
}
export function toVtt(segs) {
  return 'WEBVTT\n\n' + (segs || []).map((g) => `${stamp(g.s, false)} --> ${stamp(g.e > g.s ? g.e : g.s + 3, false)}\n${g.t}\n`).join('\n');
}

/** A readable text file: the name, the summary and key points, then the full text. */
export function toMarkdown(name, tx, labels = {}) {
  const L = { summary: 'Summary', points: 'Key points', text: 'Full text', ...labels };
  const out = [`# ${name}`, ''];
  if (tx.sum && tx.sum.summary) out.push(`## ${L.summary}`, '', tx.sum.summary, '');
  if (tx.sum && tx.sum.points && tx.sum.points.length) out.push(`## ${L.points}`, '', ...tx.sum.points.map((p) => `- ${p}`), '');
  out.push(`## ${L.text}`, '', tx.text, '');
  return out.join('\n');
}
