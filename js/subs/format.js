// Subtitle files: reading (SRT, WebVTT, ASS/SSA) and writing (SRT, WebVTT, ASS).
// SRT keeps the text and bold/italic/underline/colour; WebVTT adds the position; ASS keeps everything (size, colours, outline, box, position, fade).
import { DEFAULT_STYLE, resolveStyle, normalizeTrack, normalizeCue, round3, fmtTime } from './model.js';
import { uid } from '../util.js';

export const FORMATS = ['srt', 'vtt', 'ass'];
const HEX = (n) => '#' + n.toString(16).padStart(6, '0');
const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

/** What kind of subtitle text is this? */
export function detectFormat(text, name = '') {
  const t = String(text || '').replace(/^﻿/, '');
  if (/^WEBVTT/.test(t)) return 'vtt';
  if (/^\s*\[Script Info\]/i.test(t) || /^\s*\[V4\+? Styles\]/im.test(t)) return 'ass';
  if (/\.vtt$/i.test(name)) return 'vtt';
  if (/\.(ass|ssa)$/i.test(name)) return 'ass';
  return 'srt';
}

/** Any subtitle text -> a normal track (name taken from the file name). */
export function parseSubs(text, fileName = '') {
  const fmt = detectFormat(text, fileName);
  const body = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const raw = fmt === 'vtt' ? parseVttText(body) : fmt === 'ass' ? parseAssText(body) : parseSrtText(body);
  const tr = normalizeTrack({ id: uid(), name: String(fileName || '').replace(/\.[^.]+$/, ''), cues: raw.cues, style: raw.style || {} });
  tr.format = fmt;
  return tr;
}

/* ----------------------------------------------------------------- times */
const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const toSec = (h, m, s, f) => (+(h || 0)) * 3600 + (+m) * 60 + (+s) + (+String(f).padEnd(3, '0')) / 1000;
const parseStamp = (s) => { const m = TIME.exec(s); return m ? toSec(m[1], m[2], m[3], m[4]) : NaN; };

/* ----------------------------------------------------------------- SRT */
/** <b> <i> <u> <font color> that wrap the whole text become the cue's style; every other tag is dropped. */
function htmlToStyle(text) {
  const style = {};
  let t = text;
  const an = /\{\\an([1-9])\}/.exec(t);
  if (an) { style.an = +an[1]; }
  t = t.replace(/\{\\[^}]*\}/g, '');
  const whole = (tag) => new RegExp(`^<${tag}(?:\\s[^>]*)?>([\\s\\S]*)</${tag}>$`, 'i');
  for (let guard = 0; guard < 4; guard++) {
    const s = t.trim();
    let m;
    if ((m = whole('b').exec(s))) { style.b = true; t = m[1]; } else if ((m = whole('i').exec(s))) { style.i = true; t = m[1]; } else if ((m = whole('u').exec(s))) { style.u = true; t = m[1]; } else if ((m = /^<font[^>]*color\s*=\s*["']?(#[0-9a-f]{6}|#[0-9a-f]{3}|[a-z]+)["']?[^>]*>([\s\S]*)<\/font>$/i.exec(s))) {
      const c = cssColor(m[1]); if (c) style.color = c; t = m[2];
    } else break;
  }
  t = ent(t.replace(/<[^>]+>/g, ''));
  return { text: t.replace(/[ \t]+\n/g, '\n').trim(), style };
}
const NAMED = { white: '#ffffff', black: '#000000', red: '#ff0000', yellow: '#ffff00', lime: '#00ff00', green: '#008000', cyan: '#00ffff', aqua: '#00ffff', blue: '#0000ff', magenta: '#ff00ff', orange: '#ffa500', gray: '#808080', grey: '#808080' };
function cssColor(c) {
  const s = String(c).toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map((x) => x + x).join('');
  return NAMED[s] || null;
}

function parseSrtText(body) {
  const cues = [];
  for (const block of body.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const start = parseStamp(a), end = parseStamp(b);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const { text, style } = htmlToStyle(lines.slice(ti + 1).join('\n'));
    const cue = { id: uid(), start, end, text };
    if (Object.keys(style).length) cue.style = style;
    cues.push(cue);
  }
  return { cues };
}

/* ----------------------------------------------------------------- WebVTT */
function parseVttText(body) {
  const cues = [];
  const blocks = body.replace(/^WEBVTT[^\n]*\n?/, '').split(/\n{2,}/);
  for (const block of blocks) {
    if (/^(NOTE|STYLE|REGION)\b/.test(block.trim())) continue;
    const lines = block.split('\n');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const m = /^\s*(\S+)\s*-->\s*(\S+)(.*)$/.exec(lines[ti]);
    if (!m) continue;
    const start = parseStampVtt(m[1]), end = parseStampVtt(m[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const st = {};
    let x = null, y = null, lineAlign = 'start', align = 'center';
    for (const kv of m[3].trim().split(/\s+/).filter(Boolean)) {
      const [k, v] = kv.split(':');
      if (k === 'position' && /%$/.test(v)) x = parseFloat(v);
      else if (k === 'line' && /%/.test(v)) y = parseFloat(v);
      else if (k === 'line-align') lineAlign = v.split(',')[0];
      else if (k === 'align') align = v;
    }
    const col = align === 'start' || align === 'left' ? 0 : align === 'end' || align === 'right' ? 2 : 1;
    if (x != null || y != null) {
      const row = y == null ? 2 : lineAlign === 'end' ? 0 : lineAlign === 'center' ? 1 : (y <= 33 ? 2 : y <= 66 ? 1 : 0);   // vertical anchor: top=2 row of numpad groups
      const base = [1, 4, 7][row === 2 ? 2 : row === 1 ? 1 : 0];                                                              // 1 bottom, 4 middle, 7 top
      st.an = base + col;
      st.pos = { x: x ?? (col === 0 ? 5 : col === 2 ? 95 : 50), y: y ?? 90 };
    } else if (col !== 1) st.an = (col === 0 ? 1 : 3);
    const raw = lines.slice(ti + 1).join('\n').replace(/<\d{1,2}:\d{2}(?::\d{2})?\.\d{3}>/g, '').replace(/<v[^>]*>/gi, '').replace(/<\/v>/gi, '');
    const parsed = htmlToStyle(raw.replace(/<c(?:\.[^>]*)?>/gi, '').replace(/<\/c>/gi, ''));
    const cue = { id: uid(), start, end, text: parsed.text };
    const style = { ...parsed.style, ...st };
    if (Object.keys(style).length) cue.style = style;
    cues.push(cue);
  }
  return { cues };
}
function parseStampVtt(s) { const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})\.(\d{1,3})$/.exec(s); return m ? toSec(m[1], m[2], m[3], m[4]) : NaN; }

/* ----------------------------------------------------------------- ASS */
const assColor = (s) => {
  const m = /&?H?([0-9a-f]{2})?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})&?$/i.exec(String(s).trim().replace(/^&H/i, '&H'));
  if (!m) return null;
  const hex = String(s).replace(/[&Hh]/g, '').padStart(8, '0').slice(-8);   // AABBGGRR
  return { color: '#' + hex.slice(6, 8) + hex.slice(4, 6) + hex.slice(2, 4), alpha: parseInt(hex.slice(0, 2), 16) };
};
const fontKind = (n) => { const f = String(n || '').toLowerCase(); return /courier|mono|consolas/.test(f) ? 'mono' : /times|serif|georgia|amiri|naskh/.test(f) && !/sans/.test(f) ? 'serif' : /comic|script|hand|cursive/.test(f) ? 'hand' : 'sans'; };

function parseAssText(body) {
  const lines = body.split('\n');
  let section = '', resX = 384, resY = 288;
  let styleFmt = [], evFmt = [];
  const styles = new Map();
  const events = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) { section = sec[1].toLowerCase(); continue; }
    const idx = line.indexOf(':');
    const key = line.slice(0, idx).trim().toLowerCase(), val = line.slice(idx + 1).trim();
    if (section === 'script info') { if (key === 'playresx') resX = +val || resX; else if (key === 'playresy') resY = +val || resY; }
    else if (section.includes('styles')) {
      if (key === 'format') styleFmt = val.split(',').map((x) => x.trim().toLowerCase());
      else if (key === 'style') { const f = val.split(','); const o = {}; styleFmt.forEach((k, i) => { o[k] = (f[i] || '').trim(); }); styles.set(o.name, o); }
    } else if (section === 'events') {
      if (key === 'format') evFmt = val.split(',').map((x) => x.trim().toLowerCase());
      else if (key === 'dialogue') {
        const n = evFmt.length || 10;
        const f = []; let rest = val;
        for (let i = 0; i < n - 1; i++) { const c = rest.indexOf(','); if (c < 0) break; f.push(rest.slice(0, c)); rest = rest.slice(c + 1); }
        f.push(rest);
        const o = {}; (evFmt.length ? evFmt : ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']).forEach((k, i) => { o[k] = f[i]; });
        events.push(o);
      }
    }
  }
  const stStyle = (s) => {
    const o = {};
    if (!s) return o;
    if (+s.fontsize) o.size = (+s.fontsize / resY) * 100;
    const pc = assColor(s.primarycolour); if (pc) { o.color = pc.color; if (pc.alpha) o.op = 1 - pc.alpha / 255; }
    const oc = assColor(s.outlinecolour); if (oc) o.olc = oc.color;
    const bc = assColor(s.backcolour);
    o.b = s.bold === '-1' || s.bold === '1'; o.i = s.italic === '-1' || s.italic === '1'; o.u = s.underline === '-1' || s.underline === '1';
    o.font = fontKind(s.fontname);
    if (+s.borderstyle === 3 && bc) { o.bg = bc.color; o.bgOp = 1 - bc.alpha / 255; o.ol = 0; }
    else { o.bgOp = 0; o.ol = +s.outline && +s.fontsize ? Math.min(14, (+s.outline / +s.fontsize) * 100) : 0; o.shadow = +s.shadow > 0; }
    if (+s.alignment >= 1 && +s.alignment <= 9) o.an = +s.alignment;
    return o;
  };
  const cues = [];
  for (const e of events) {
    const start = parseStamp(String(e.start || '').replace('.', ',') + '0'.repeat(0)), end = parseStamp(String(e.end || '').replace('.', ','));
    const s2 = (s) => { const m = /^(\d+):(\d{2}):(\d{2})\.(\d{1,2})$/.exec(String(s).trim()); return m ? toSec(m[1], m[2], m[3], String(m[4]).padEnd(2, '0') + '0') : NaN; };
    const a = s2(e.start), b = s2(e.end);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    void start; void end;
    const st = stStyle(styles.get(e.style));
    let text = String(e.text || '');
    const over = {};
    text.replace(/\{([^}]*)\}/g, (_, tags) => {
      const t = (re) => { const m = re.exec(tags); return m ? m[1] : null; };
      const an = t(/\\an([1-9])/); if (an) over.an = +an;
      const pos = /\\pos\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(tags); if (pos) over.pos = { x: (+pos[1] / resX) * 100, y: (+pos[2] / resY) * 100 };
      const fs = t(/\\fs([\d.]+)/); if (fs) over.size = (+fs / resY) * 100;
      const c1 = t(/\\1?c(&H[0-9a-f]+&?)/i); if (c1) { const c = assColor(c1); if (c) over.color = c.color; }
      const c3 = t(/\\3c(&H[0-9a-f]+&?)/i); if (c3) { const c = assColor(c3); if (c) over.olc = c.color; }
      const bord = t(/\\bord([\d.]+)/); if (bord) over.ol = Math.min(14, (+bord / ((over.size || st.size || 5) / 100 * resY)) * 100);
      const b = t(/\\b(\d)/); if (b != null) over.b = b !== '0';
      const it = t(/\\i(\d)/); if (it != null) over.i = it !== '0';
      const u = t(/\\u(\d)/); if (u != null) over.u = u !== '0';
      const fn = t(/\\fn([^\\}]+)/); if (fn) over.font = fontKind(fn);
      const fad = /\\fad\(\s*(\d+)\s*,/.exec(tags); if (fad) over.fade = +fad[1];
      return '';
    });
    text = text.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\\h/g, ' ').trim();
    const style = { ...st, ...over };
    cues.push({ id: uid(), start: a, end: b, text, ...(Object.keys(style).length ? { style } : {}) });
  }
  // the most common style of the file becomes the track default, so cues only keep what differs
  const keyOf = (c) => JSON.stringify({ ...c.style, pos: undefined });
  const count = new Map();
  cues.forEach((c) => count.set(keyOf(c), (count.get(keyOf(c)) || 0) + 1));
  let best = null, n = 0;
  count.forEach((v, k) => { if (v > n) { n = v; best = k; } });
  const style = best ? JSON.parse(best) : {};
  delete style.pos;
  cues.forEach((c) => {
    if (!c.style) return;
    const own = { ...c.style };
    for (const k of Object.keys(style)) if (JSON.stringify(own[k]) === JSON.stringify(style[k])) delete own[k];
    if (Object.keys(own).length) c.style = own; else delete c.style;
  });
  return { cues, style };
}

/* ----------------------------------------------------------------- writing */
const stampSrt = (t) => fmtTime(t).replace(/^(\d+):(\d{2}):(\d{2})\.(\d{3})$/, (_, h, m, s, f) => `${h.padStart(2, '0')}:${m}:${s},${f}`).replace(/^(\d+):(\d{2})\.(\d{3})$/, (_, m, s, f) => `00:${m.padStart(2, '0')}:${s},${f}`);
const stampVtt = (t) => stampSrt(t).replace(',', '.');
const stampAss = (t) => { const s = Math.max(0, t), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s - h * 3600 - m * 60; const cs = Math.min(99, Math.round((r % 1) * 100)); return `${h}:${String(m).padStart(2, '0')}:${String(Math.floor(r)).padStart(2, '0')}.${String(cs).padStart(2, '0')}`; };
const escTag = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toSrt(track) {
  const cues = track.cues.slice().sort((a, b) => a.start - b.start);
  return cues.map((c, i) => {
    const s = resolveStyle(c, track);
    let text = escTag(c.text);
    if (s.color !== DEFAULT_STYLE.color) text = `<font color="${s.color}">${text}</font>`;
    if (s.u) text = `<u>${text}</u>`; if (s.i) text = `<i>${text}</i>`; if (s.b) text = `<b>${text}</b>`;
    if (s.an !== 2) text = `{\\an${s.an}}${text}`;
    return `${i + 1}\n${stampSrt(c.start)} --> ${stampSrt(c.end)}\n${text}\n`;
  }).join('\n');
}

export function toVtt(track) {
  const d = resolveStyle(null, track);
  const out = ['WEBVTT', ''];
  const colors = new Map();
  const classOf = (c) => { if (!colors.has(c)) colors.set(c, 'c' + (colors.size + 1)); return colors.get(c); };
  const body = track.cues.slice().sort((a, b) => a.start - b.start).map((c, i) => {
    const s = resolveStyle(c, track);
    let text = escTag(c.text);
    if (s.color !== d.color || (c.style && c.style.color)) text = `<c.${classOf(s.color)}>${text}</c>`;
    if (s.u) text = `<u>${text}</u>`; if (s.i) text = `<i>${text}</i>`; if (s.b) text = `<b>${text}</b>`;
    const col = (s.an - 1) % 3, row = Math.floor((s.an - 1) / 3);            // col 0 left, 1 centre, 2 right · row 0 bottom, 1 middle, 2 top
    const align = col === 0 ? 'start' : col === 2 ? 'end' : 'center';
    let set = ` align:${align}`;
    if (s.pos) set = ` line:${round3(s.pos.y)}% position:${round3(s.pos.x)}% line-align:${row === 2 ? 'start' : row === 1 ? 'center' : 'end'}${set}`;
    else if (row === 2) set = ` line:5%${set}`;
    else if (row === 1) set = ` line:50% line-align:center${set}`;
    return `${i + 1}\n${stampVtt(c.start)} --> ${stampVtt(c.end)}${set}\n${text}\n`;
  });
  const css = [`::cue { color: ${d.color}; background-color: ${rgba(d.bg, d.bgOp)}; font-size: ${round3(d.size * 4.2)}%; }`, ...[...colors].map(([c, k]) => `::cue(.${k}) { color: ${c}; }`)];
  out.push('STYLE', ...css, '', body.join('\n'));
  return out.join('\n');
}
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${round3(a)})`; };

const FONT_NAME = { sans: 'Arial', serif: 'Times New Roman', mono: 'Courier New', hand: 'Comic Sans MS' };
const assBgr = (hex, alpha = 0) => { const n = parseInt(hex.slice(1), 16); const r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255; const h2 = (v) => v.toString(16).toUpperCase().padStart(2, '0'); return `&H${h2(alpha)}${h2(b)}${h2(g)}${h2(r)}`; };
const bgrTag = (hex) => assBgr(hex).replace(/^&H00/, '&H') + '&';

/** ASS keeps the whole look: one style per distinct combination, and per-cue tags for the position, size and fade. */
export function toAss(track, W = 1920, H = 1080) {
  const styles = new Map();
  const styleName = (s) => {
    const key = JSON.stringify([s.font, s.size, s.color, s.bg, s.bgOp, s.ol, s.olc, s.b, s.i, s.u, s.shadow, s.op]);
    if (!styles.has(key)) styles.set(key, { name: 'S' + (styles.size + 1), s });
    return styles.get(key).name;
  };
  const events = track.cues.slice().sort((a, b) => a.start - b.start).map((c) => {
    const s = resolveStyle(c, track);
    const name = styleName(s);
    let tags = `\\an${s.an}`;
    if (s.pos) tags += `\\pos(${Math.round((s.pos.x / 100) * W)},${Math.round((s.pos.y / 100) * H)})`;
    if (s.fade) tags += `\\fad(${s.fade},0)`;
    const text = c.text.replace(/\n/g, '\\N');
    return `Dialogue: 0,${stampAss(c.start)},${stampAss(c.end)},${name},,0,0,0,,{${tags}}${text}`;
  });
  const marginH = Math.round(W * 0.04), marginV = Math.round(H * 0.06);
  const styleLines = [...styles.values()].map(({ name, s }) => {
    const fs = Math.round((s.size / 100) * H);
    const box = s.bgOp > 0;
    const outline = box ? 0 : Math.round((s.ol / 100) * fs * 10) / 10;
    const back = assBgr(box ? s.bg : '#000000', Math.round((box ? 1 - s.bgOp : 0.6) * 255));
    return `Style: ${name},${FONT_NAME[s.font] || 'Arial'},${fs},${assBgr(s.color, Math.round((1 - s.op) * 255))},&H000000FF,${assBgr(s.olc)},${back},${s.b ? -1 : 0},${s.i ? -1 : 0},${s.u ? -1 : 0},0,100,100,0,0,${box ? 3 : 1},${box ? 6 : outline},${!box && s.shadow ? 2 : 0},2,${marginH},${marginH},${marginV},1`;
  });
  return ['[Script Info]', `Title: ${track.name || 'AHOS subtitles'}`, 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...(styleLines.length ? styleLines : [`Style: S1,Arial,${Math.round(DEFAULT_STYLE.size / 100 * H)},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,3,6,0,2,${marginH},${marginH},${marginV},1`]), '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...events, ''].join('\n');
}

/** Writes the track in the chosen format. Returns { name, mime, text }. */
export function serialize(track, fmt) {
  const base = (track.name || 'subtitles').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'subtitles';
  if (fmt === 'vtt') return { name: base + '.vtt', mime: 'text/vtt', text: toVtt(track) };
  if (fmt === 'ass') return { name: base + '.ass', mime: 'text/x-ssa', text: toAss(track) };
  return { name: base + '.srt', mime: 'application/x-subrip', text: toSrt(track) };
}

/** A track as stored on a video: v2 tracks as they are, old {name, vtt} entries read from their WebVTT text. */
export function ensureTrack(sub) {
  if (sub && Array.isArray(sub.cues)) return normalizeTrack(sub);
  const tr = parseSubs(sub && sub.vtt ? sub.vtt : 'WEBVTT\n', (sub && sub.name) || '');
  tr.name = (sub && sub.name) || tr.name;
  tr.id = (sub && sub.id) || uid();
  return tr;
}
export { normalizeCue };
