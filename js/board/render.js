// Drawing for the whiteboard: paper + patterns, strokes, shapes, text, placed objects. Used by the viewer, thumbnails and export.
import { outline, FREE } from './geom.js';

export const PAPERS = [
  { id: 'white', c: '#ffffff' }, { id: 'cream', c: '#fbf3df' }, { id: 'blue', c: '#e6f0fb' }, { id: 'mint', c: '#e5f5ea' },
  { id: 'gray', c: '#2b2f3a' }, { id: 'black', c: '#000000' }, { id: 'board', c: '#1f3d2c' },
];
export const PATTERNS = ['none', 'lines', 'grid', 'dots', 'graph', 'cornell'];
export const A4 = [595, 842];

export const lum = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};
export const isDark = (hex) => lum(hex) < 0.45;
export const inkFor = (paper) => (isDark(paper) ? '#ffffff' : '#14161c');

const FONT = '"Segoe UI", Roboto, "Noto Sans Arabic", "Noto Naskh Arabic", system-ui, sans-serif';
export const fontOf = (s) => `${s.bold ? '700 ' : ''}${s.size}px ${FONT}`;
const RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
const strongRtl = (str) => { for (const ch of str) { if (RTL.test(ch)) return true; if (/[A-Za-zÀ-ɏЀ-ӿ]/.test(ch)) return false; } return false; };

/* ---------------- text ---------------- */
const layouts = new WeakMap();
export const textPad = (s) => (s.bg ? 10 : 3);

/** Wraps the text to the box width. Returns { lines:[{t, rtl}], lh, h }. Cached per stroke. */
export function layoutText(ctx, s) {
  let l = layouts.get(s);
  if (l) return l;
  ctx.save();
  ctx.font = fontOf(s);
  const maxW = Math.max(10, s.bw - textPad(s) * 2);
  const lines = [];
  for (const para of String(s.s).split('\n')) {
    if (!para) { lines.push({ t: '', rtl: false }); continue; }
    const rtl = strongRtl(para);
    const words = para.split(/(\s+)/);
    let cur = '';
    for (const w of words) {
      const test = cur + w;
      if (cur && ctx.measureText(test).width > maxW) {
        lines.push({ t: cur.trimEnd(), rtl });
        cur = w.trimStart();
      } else cur = test;
      // a single word longer than the box: break it by characters
      while (ctx.measureText(cur).width > maxW && cur.length > 1) {
        let i = cur.length - 1;
        while (i > 1 && ctx.measureText(cur.slice(0, i)).width > maxW) i--;
        lines.push({ t: cur.slice(0, i), rtl });
        cur = cur.slice(i);
      }
    }
    lines.push({ t: cur.trimEnd(), rtl });
  }
  ctx.restore();
  const lh = s.size * 1.32;
  l = { lines, lh, h: lines.length * lh + textPad(s) * 2 };
  layouts.set(s, l);
  return l;
}

/** Natural width for new text: the longest line (up to maxW), so a short word doesn't get a huge box. */
export function naturalWidth(ctx, text, size, bold, bg, maxW) {
  ctx.save();
  ctx.font = fontOf({ size, bold });
  let w = 0;
  for (const line of String(text).split('\n')) w = Math.max(w, ctx.measureText(line).width);
  ctx.restore();
  return Math.min(maxW, Math.max(60, Math.ceil(w + textPad({ bg }) * 2 + 4)));
}

/** Returns the text stroke with its height recomputed for its width and content. */
export function refitText(ctx, s) {
  const probe = { ...s, bh: 0 };
  const l = layoutText(ctx, probe);
  const out = { ...s, bh: Math.ceil(l.h) };
  return out;
}

/* ---------------- paper ---------------- */
function patternColor(dark, a = 1) { return dark ? `rgba(255,255,255,${0.15 * a})` : `rgba(45,70,120,${0.17 * a})`; }

/**
 * Paints the paper (and its ruling) for the visible part of the page.
 * vp = { x, y, s, W, H } maps world -> css pixels; the context is already scaled to world units.
 */
export function drawPaper(ctx, page, paper, pattern, vp) {
  const dark = isDark(paper);
  const fixed = !!page.w;
  const x0 = fixed ? 0 : -vp.x / vp.s, y0 = fixed ? 0 : -vp.y / vp.s;
  const w = fixed ? page.w : vp.W / vp.s, h = fixed ? page.h : vp.H / vp.s;
  ctx.fillStyle = paper;
  ctx.fillRect(x0, y0, w, h);
  if (pattern === 'none' || !pattern) { outlinePage(ctx, page, dark, vp); return; }
  // visible part only
  const vx1 = Math.max(x0, -vp.x / vp.s), vy1 = Math.max(y0, -vp.y / vp.s);
  const vx2 = Math.min(x0 + w, (vp.W - vp.x) / vp.s), vy2 = Math.min(y0 + h, (vp.H - vp.y) / vp.s);
  if (vx2 <= vx1 || vy2 <= vy1) return;
  const px = 1 / vp.s;
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
  let sp = pattern === 'dots' ? 24 : pattern === 'grid' ? 24 : pattern === 'graph' ? 12 : 32;
  while (sp * vp.s < (pattern === 'graph' ? 5 : 8)) sp *= 2;
  const fromX = Math.floor(vx1 / sp) * sp, fromY = Math.floor(vy1 / sp) * sp;
  if (pattern === 'dots') {
    ctx.fillStyle = patternColor(dark, 1.7);
    const r = Math.max(1.1, 1.3 * px);
    ctx.beginPath();
    for (let y = fromY; y <= vy2; y += sp) for (let x = fromX; x <= vx2; x += sp) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); }
    ctx.fill();
  } else {
    ctx.lineWidth = Math.max(px, 0.8);
    ctx.strokeStyle = patternColor(dark);
    ctx.beginPath();
    if (pattern !== 'lines' && pattern !== 'cornell') for (let x = fromX; x <= vx2; x += sp) { ctx.moveTo(x, vy1); ctx.lineTo(x, vy2); }
    for (let y = fromY; y <= vy2; y += sp) { ctx.moveTo(vx1, y); ctx.lineTo(vx2, y); }
    ctx.stroke();
    if (pattern === 'graph') {
      const big = sp * 5;
      ctx.strokeStyle = patternColor(dark, 1.9); ctx.beginPath();
      for (let x = Math.floor(vx1 / big) * big; x <= vx2; x += big) { ctx.moveTo(x, vy1); ctx.lineTo(x, vy2); }
      for (let y = Math.floor(vy1 / big) * big; y <= vy2; y += big) { ctx.moveTo(vx1, y); ctx.lineTo(vx2, y); }
      ctx.stroke();
    }
    if ((pattern === 'lines' || pattern === 'cornell') && fixed) {
      ctx.strokeStyle = dark ? 'rgba(255,120,120,.4)' : 'rgba(220,60,60,.35)';
      ctx.beginPath();
      if (pattern === 'lines') { ctx.moveTo(56, 0); ctx.lineTo(56, h); }
      else { ctx.moveTo(150, 0); ctx.lineTo(150, h - 130); ctx.moveTo(0, h - 130); ctx.lineTo(w, h - 130); }
      ctx.stroke();
    }
  }
  ctx.restore();
  outlinePage(ctx, page, dark, vp);
}

function outlinePage(ctx, page, dark, vp) {
  if (!page.w) return;
  ctx.lineWidth = 1 / vp.s;
  ctx.strokeStyle = dark ? 'rgba(255,255,255,.28)' : 'rgba(0,0,0,.22)';
  ctx.strokeRect(0, 0, page.w, page.h);
}

/* ---------------- strokes ---------------- */
function smoothPath(ctx, p) {
  const n = p.length / 2;
  ctx.moveTo(p[0], p[1]);
  if (n === 2) { ctx.lineTo(p[2], p[3]); return; }
  for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(p[i * 2], p[i * 2 + 1], (p[i * 2] + p[i * 2 + 2]) / 2, (p[i * 2 + 1] + p[i * 2 + 3]) / 2);
  ctx.lineTo(p[(n - 1) * 2], p[(n - 1) * 2 + 1]);
}

function drawFree(ctx, s, env) {
  const p = s.pts, n = p.length / 2;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const hl = s.t === 'hl';
  if (hl) { ctx.globalAlpha = env.dark ? 0.5 : 0.42; if (!env.live && !env.dark) ctx.globalCompositeOperation = 'multiply'; }
  ctx.strokeStyle = ctx.fillStyle = s.c;
  let same = true;
  for (let i = 2; i < p.length; i += 2) if (Math.abs(p[i] - p[0]) > 0.05 || Math.abs(p[i + 1] - p[1]) > 0.05) { same = false; break; }
  if (n === 1 || same) {
    ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(s.w / 2, 0.4), 0, 6.2832); ctx.fill();
  } else if (s.pr && !hl) {
    for (let i = 0; i < n - 1; i++) {
      ctx.lineWidth = s.w * (0.4 + 1.2 * ((s.pr[i] + s.pr[i + 1]) / 2));
      ctx.beginPath(); ctx.moveTo(p[i * 2], p[i * 2 + 1]); ctx.lineTo(p[i * 2 + 2], p[i * 2 + 3]); ctx.stroke();
    }
  } else {
    ctx.lineWidth = s.w;
    ctx.beginPath(); smoothPath(ctx, p); ctx.stroke();
  }
}

function polyPath(ctx, pts, closed) {
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  if (closed) ctx.closePath();
}

function drawShape(ctx, s) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = s.w;
  ctx.strokeStyle = ctx.fillStyle = s.c;
  ctx.beginPath();
  if (s.t === 'ellipse') {
    const cx = (s.a[0] + s.b[0]) / 2, cy = (s.a[1] + s.b[1]) / 2;
    ctx.ellipse(cx, cy, Math.max(0.1, Math.abs(s.b[0] - s.a[0]) / 2), Math.max(0.1, Math.abs(s.b[1] - s.a[1]) / 2), 0, 0, 6.2832);
  } else {
    const o = outline(s);
    polyPath(ctx, o.pts, o.closed);
  }
  if (s.f && s.t !== 'line' && s.t !== 'arrow') { ctx.save(); ctx.globalAlpha = 0.22; ctx.fill(); ctx.restore(); }
  ctx.stroke();
  if (s.t === 'arrow') {
    const [x1, y1] = s.a, [x2, y2] = s.b;
    const ang = Math.atan2(y2 - y1, x2 - x1), hd = Math.max(10, s.w * 4.2);
    ctx.beginPath();
    ctx.moveTo(x2 - hd * Math.cos(ang - 0.5), y2 - hd * Math.sin(ang - 0.5)); ctx.lineTo(x2, y2); ctx.lineTo(x2 - hd * Math.cos(ang + 0.5), y2 - hd * Math.sin(ang + 0.5));
    ctx.stroke();
  }
}

function drawText(ctx, s) {
  const l = layoutText(ctx, s);
  const pad = textPad(s);
  if (s.bg) {
    ctx.fillStyle = s.bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(s.x, s.y, s.bw, s.bh, 5); else ctx.rect(s.x, s.y, s.bw, s.bh);
    ctx.fill();
  }
  ctx.font = fontOf(s);
  ctx.fillStyle = s.c;
  ctx.textBaseline = 'top';
  let y = s.y + pad + (s.size * 1.32 - s.size) / 2;
  for (const ln of l.lines) {
    ctx.direction = ln.rtl ? 'rtl' : 'ltr';
    ctx.textAlign = ln.rtl ? 'right' : 'left';
    ctx.fillText(ln.t, ln.rtl ? s.x + s.bw - pad : s.x + pad, y);
    y += l.lh;
  }
  ctx.direction = 'ltr'; ctx.textAlign = 'left';
}

const roundRect = (ctx, x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };

function placeholder(ctx, s, text, dark) {
  ctx.fillStyle = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
  ctx.fillRect(s.x, s.y, s.w, s.h);
  ctx.strokeStyle = dark ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.25)';
  ctx.lineWidth = 1; ctx.setLineDash([6, 5]); ctx.strokeRect(s.x, s.y, s.w, s.h); ctx.setLineDash([]);
  if (text) {
    ctx.fillStyle = dark ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.55)';
    ctx.font = `${Math.max(10, Math.min(18, s.w / 12))}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, s.x + s.w / 2, s.y + s.h / 2, s.w - 12);
    ctx.textAlign = 'left';
  }
}

function drawMedia(ctx, s, env) {
  const thumb = env.assets?.thumb(s.ref);
  const video = s.kind === 'video';
  roundRect(ctx, s.x, s.y, s.w, s.h, Math.min(14, s.h / 6));
  ctx.save();
  ctx.clip();
  if (thumb) {
    const k = Math.max(s.w / thumb.w, s.h / thumb.h);
    ctx.drawImage(thumb.src, s.x + (s.w - thumb.w * k) / 2, s.y + (s.h - thumb.h * k) / 2, thumb.w * k, thumb.h * k);
  } else {
    const g = ctx.createLinearGradient(s.x, s.y, s.x + s.w, s.y + s.h);
    if (video) { g.addColorStop(0, '#12485a'); g.addColorStop(1, '#0a1233'); } else { g.addColorStop(0, '#3a2c8a'); g.addColorStop(1, '#0f1640'); }
    ctx.fillStyle = g; ctx.fillRect(s.x, s.y, s.w, s.h);
  }
  const shade = ctx.createLinearGradient(0, s.y + s.h * 0.45, 0, s.y + s.h);
  shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,.72)');
  ctx.fillStyle = shade; ctx.fillRect(s.x, s.y, s.w, s.h);
  ctx.restore();
  // play button
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2 - Math.min(8, s.h * 0.05), r = Math.max(14, Math.min(s.w, s.h) * 0.17);
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(1.5, r * 0.08); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath();
  ctx.moveTo(cx - r * 0.28, cy - r * 0.42); ctx.lineTo(cx + r * 0.5, cy); ctx.lineTo(cx - r * 0.28, cy + r * 0.42); ctx.closePath(); ctx.fill();
  // title
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${Math.max(11, Math.min(17, s.h / 7))}px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  const title = s.title || '';
  const rtl = strongRtl(title);
  ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = rtl ? 'right' : 'left';
  ctx.fillText(title, rtl ? s.x + s.w - 10 : s.x + 10, s.y + s.h - 10, s.w - 20);
  ctx.direction = 'ltr'; ctx.textAlign = 'left';
  ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1;
  roundRect(ctx, s.x, s.y, s.w, s.h, Math.min(14, s.h / 6)); ctx.stroke();
}

/**
 * env = { dark, assets, live, hideMedia }
 * dark: is the paper dark (changes highlighter blending); live: drawing on a transparent overlay; hideMedia: media card being played.
 */
export function drawStroke(ctx, s, env) {
  ctx.save();
  try {
    switch (s.t) {
      case 'pen': case 'hl': drawFree(ctx, s, env); break;
      case 'text': drawText(ctx, s); break;
      case 'img': {
        const b = env.assets?.image(s.ref);
        if (b) ctx.drawImage(b.src, s.x, s.y, s.w, s.h); else placeholder(ctx, s, env.assets?.missing(s.ref) ? '⚠' : '…', env.dark);
        break;
      }
      case 'pdfp': {
        const b = env.assets?.pdfPage(s.ref, s.page, Math.ceil(s.w * (env.scale || 1) * (env.dpr || 1)), false);
        if (b) { ctx.fillStyle = '#fff'; ctx.fillRect(s.x, s.y, s.w, s.h); ctx.drawImage(b.src, s.x, s.y, s.w, s.h); ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1 / (env.scale || 1); ctx.strokeRect(s.x, s.y, s.w, s.h); } else placeholder(ctx, s, env.assets?.missing(s.ref) ? '⚠ PDF' : 'PDF …', env.dark);
        break;
      }
      case 'media': if (env.hideMedia !== s) drawMedia(ctx, s, env); break;
      default: drawShape(ctx, s);
    }
  } finally { ctx.restore(); }
}

export const isFreeStroke = FREE;
