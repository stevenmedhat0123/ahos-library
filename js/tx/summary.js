// An offline summary of a transcript: it picks the sentences that carry the most (frequent, not-everywhere words; the opening; no repeats),
// keeps them in the order they were said, and also gives short key points and the main words. Arabic and English (also mixed), no internet,
// no model to download: it reads text and counts. A cloud summary (engines.js) can replace it when the person asks for a better one.
import { detectLang, normalize, stem, words } from './lang.js';

const END = /(?<=[.!?؟…۔])\s+|\n+/;

/** Sentences of a transcript. Text without punctuation (speech-to-text often has none) falls back to the timed pieces, else to chunks of ~20 words. */
export function splitSentences(text, segs) {
  const clean = String(text || '').replace(/[ \t ]+/g, ' ').trim();
  if (!clean) return [];
  let parts = clean.split(END).map((s) => s.trim()).filter(Boolean);
  const wc = (s) => s.split(/\s+/).length;
  const longest = parts.reduce((m, s) => Math.max(m, wc(s)), 0);
  if (longest > 60) {
    if (Array.isArray(segs) && segs.length > 2) parts = segs.map((g) => String(g.t || '').trim()).filter(Boolean);
    else parts = parts.flatMap((p) => {
      if (wc(p) <= 60) return [p];
      const w = p.split(/\s+/), out = [];
      for (let i = 0; i < w.length; i += 20) out.push(w.slice(i, i + 20).join(' '));
      return out;
    });
  }
  // a tiny fragment belongs to the sentence after it
  const merged = [];
  for (let i = 0; i < parts.length; i++) {
    let s = parts[i];
    while (wc(s) < 4 && i + 1 < parts.length) s += ' ' + parts[++i];
    merged.push(s);
  }
  return merged;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const LENGTHS = { short: { r: 0.1, min: 2, max: 4 }, medium: { r: 0.2, min: 3, max: 8 }, long: { r: 0.35, min: 4, max: 14 } };

/** A word as it is shown: a single "and" (\u0648) stuck to the front is taken off when what is left is the same word. */
const plain = (w, k) => (w.startsWith('\u0648') && w.length > 4 && stem(normalize(w.slice(1))) === k ? w.slice(1) : w);

/** Cosine of two sets of stems. */
function sim(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / Math.sqrt(a.size * b.size);
}

/** Picks `k` indexes: the best score, then each next one the best score that does not repeat what is already chosen (lambda = how much the score matters). */
function mmr(scores, sets, k, lambda) {
  const chosen = [];
  const left = new Set(scores.map((_, i) => i));
  while (chosen.length < k && left.size) {
    let best = -1, bv = -Infinity;
    for (const i of left) {
      let rep = 0;
      for (const j of chosen) rep = Math.max(rep, sim(sets[i], sets[j]));
      const v = lambda * scores[i] - (1 - lambda) * rep;
      if (v > bv) { bv = v; best = i; }
    }
    chosen.push(best); left.delete(best);
  }
  return chosen;
}

const LEAD = /^(?:و|ف|ثم|لكن|بس|يعني|طيب|طب|and|so|then|but|well|okay|ok)\s+/i;
/** A sentence as a bullet: no leading "and / so / then", cut at a word before ~130 characters. */
function asPoint(s, max = 130) {
  let x = s.replace(LEAD, '').replace(/[.؟!?…]+$/, '').trim();
  if (x.length > max) {
    const cut = x.slice(0, max);
    const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('،'), cut.lastIndexOf(','));
    x = (at > max * 0.5 ? cut.slice(0, at) : cut).trim() + '…';
  }
  return x;
}

/**
 * summarize(text, { segs, length: 'short' | 'medium' | 'long' })
 *   -> { lang, summary, sentences (the chosen ones, in order), points, keywords, title, stats: { sentences, words } }
 */
export function summarize(text, { segs = null, length = 'medium' } = {}) {
  const lang = detectLang(text);
  const sents = splitSentences(text, segs);
  const total = (String(text || '').match(/\S+/g) || []).length;
  const empty = { lang, summary: '', sentences: [], points: [], keywords: [], title: '', stats: { sentences: 0, words: 0 } };
  if (!sents.length) return empty;

  const W = sents.map((s) => words(s));
  const sets = W.map((ws) => new Set(ws.map((x) => x.k)));
  const N = sents.length;

  // how often each stem is said, and in how many sentences
  const tf = new Map(), df = new Map(), surface = new Map();
  W.forEach((ws, i) => {
    for (const { w, k } of ws) {
      tf.set(k, (tf.get(k) || 0) + 1);
      const m = surface.get(k) || new Map(); m.set(w, (m.get(w) || 0) + 1); surface.set(k, m);
    }
    for (const k of sets[i]) df.set(k, (df.get(k) || 0) + 1);
  });
  const weight = new Map();
  for (const [k, f] of tf) weight.set(k, Math.sqrt(f) * Math.log(1 + N / (df.get(k) || 1)));

  // keywords: the heaviest stems said more than once (or the heaviest at all in a very short text)
  const minTf = total > 80 ? 2 : 1;
  const keywords = [...weight.entries()].filter(([k]) => (tf.get(k) || 0) >= minTf && k.length >= 3).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => {
    const forms = [...surface.get(k).entries()].sort((a, b) => b[1] - a[1]);
    return plain(forms[0][0], k);
  });

  // score of a sentence: the weight of what it says, per root-of-its-length, a lift for the opening, no lift for fragments or run-ons
  const raw = sets.map((set, i) => {
    let sc = 0;
    for (const k of set) sc += weight.get(k) || 0;
    const n = Math.max(W[i].length, 1);
    sc /= Math.pow(n, 0.6);
    const wordsIn = sents[i].split(/\s+/).length;
    if (wordsIn < 5) sc *= 0.55;
    if (wordsIn > 45) sc *= 0.75;
    return sc;
  });
  const top = Math.max(...raw, 1e-9);
  const scores = raw.map((v, i) => v / top + (i === 0 ? 0.18 : i === 1 ? 0.06 : 0) + (i === N - 1 && N > 4 ? 0.04 : 0));

  const cfg = LENGTHS[length] || LENGTHS.medium;
  const k = N <= cfg.min ? N : clamp(Math.round(N * cfg.r), cfg.min, cfg.max);
  const pick = (N <= 3 ? sents.map((_, i) => i) : mmr(scores, sets, k, 0.7)).sort((a, b) => a - b);
  const sentences = pick.map((i) => sents[i]);

  const pk = clamp(Math.round(N * 0.15), 3, 7);
  const pointIdx = (N <= 3 ? sents.map((_, i) => i) : mmr(scores, sets, Math.min(pk, N), 0.5)).sort((a, b) => a - b);
  const points = pointIdx.map((i) => asPoint(sents[i]));

  const title = keywords.length >= 2 ? keywords.slice(0, 3).join(' – ') : asPoint(sents[0], 48);
  return { lang, summary: sentences.join(' '), sentences, points, keywords, title, stats: { sentences: N, words: total } };
}

/** For tests and tooling: the normal form of a word the way the summariser sees it. */
export const spell = normalize;
