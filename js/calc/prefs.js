// AHOS Calc – how the calculator looks and where its keys sit (the layout, the arrow keys, the colours). Kept apart from the maths state in
// state.js so a colour change never touches a calculation. Every open calculator listens for the 'ahos-calc-ui' event and redraws.

const KEY = 'ahos.calc.ui';
export const THEMES = ['aurora', 'casio', 'midnight', 'sunset', 'forest', 'rose', 'mono', 'paper'];
export const SWATCH = {              // [keys, accent, screen] – the little preview dots in the picker
  aurora: ['#2a3550', '#22D3EE', '#17304a'], casio: ['#1c1c1e', '#78c13a', '#a9b99b'], midnight: ['#1b2440', '#7c9cff', '#0f1730'],
  sunset: ['#3a2230', '#ff8a4c', '#2b1a28'], forest: ['#1d3328', '#4ade80', '#12261d'], rose: ['#3a2038', '#f472b6', '#2a1830'],
  mono: ['#2b2b2e', '#e5e5ea', '#1a1a1c'], paper: ['#e8e2d3', '#c2410c', '#f7f3ea'],
};
const DEF = { layout: 'casio', dpad: 'mid', theme: 'aurora', custom: {}, flash: true, vib: true, snd: false };
const HEX = /^#[0-9a-f]{6}$/i;
export const CUSTOM_DEFAULTS = { fn: '#1f2a44', num: '#2b3a5e', op: '#3b4f82', acc: '#22d3ee', disp: '#0f1730' };

export function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null') || {};
    const p = { ...DEF };
    if (raw.layout === 'own' || raw.layout === 'casio') p.layout = raw.layout;
    if (['mid', 'top', 'bottom'].includes(raw.dpad)) p.dpad = raw.dpad;
    if (raw.theme === 'custom' || THEMES.includes(raw.theme)) p.theme = raw.theme;
    p.custom = {};
    if (raw.custom && typeof raw.custom === 'object') for (const k of ['fn', 'num', 'op', 'acc', 'disp']) if (HEX.test(raw.custom[k] || '')) p.custom[k] = raw.custom[k];
    for (const k of ['flash', 'vib', 'snd']) if (typeof raw[k] === 'boolean') p[k] = raw[k];
    return p;
  } catch { return { ...DEF }; }
}

export function savePrefs(patch) {
  const p = { ...loadPrefs(), ...patch };
  if (patch.custom) p.custom = { ...loadPrefs().custom, ...patch.custom };
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage full or blocked: the choice lasts until the screen closes */ }
  try { window.dispatchEvent(new CustomEvent('ahos-calc-ui', { detail: p })); } catch { /* ignore */ }
  return p;
}

const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (hex) => { const [r, g, b] = rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** readable text colour for a background */
export const onColor = (hex) => (lum(hex) > 0.42 ? '#14161c' : '#ffffff');
const mix = (a, b, k) => { const x = rgb(a), y = rgb(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join(''); };

/** puts the theme on the calculator's root element (custom colours become CSS variables; a preset is just a data attribute) */
export function applyPrefs(root, p = loadPrefs()) {
  root.dataset.cth = p.theme;
  root.dataset.layout = p.layout;
  root.dataset.dpad = p.dpad;
  root.dataset.flash = p.flash ? '1' : '0';
  const vars = ['--ck-fn', '--ck-fn-t', '--ck-num', '--ck-num-t', '--ck-op', '--ck-op-t', '--ck-a1', '--ck-a2', '--ck-a-t', '--cd-bg', '--cd-t', '--cd-o', '--cd-f', '--ck-flash', '--ck-ctl', '--ck-ctl-t'];
  vars.forEach((v) => root.style.removeProperty(v));
  if (p.theme !== 'custom') return;
  const c = { ...CUSTOM_DEFAULTS, ...p.custom };
  const set = (k, v) => root.style.setProperty(k, v);
  set('--ck-fn', c.fn); set('--ck-fn-t', onColor(c.fn));
  set('--ck-ctl', mix(c.fn, onColor(c.fn) === '#ffffff' ? '#ffffff' : '#000000', 0.12)); set('--ck-ctl-t', onColor(c.fn));
  set('--ck-num', c.num); set('--ck-num-t', onColor(c.num));
  set('--ck-op', c.op); set('--ck-op-t', onColor(c.op));
  set('--ck-a1', c.acc); set('--ck-a2', mix(c.acc, '#000000', 0.3)); set('--ck-a-t', onColor(c.acc));
  set('--cd-bg', c.disp); set('--cd-t', onColor(c.disp)); set('--cd-o', c.acc); set('--cd-f', mix(c.acc, onColor(c.disp), 0.4));
  set('--ck-flash', onColor(c.num) === '#ffffff' ? 'rgba(255,255,255,.3)' : 'rgba(0,0,0,.18)');
}
