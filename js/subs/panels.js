// The five tabs of the subtitle studio. Every function takes the studio controller `S` and returns the panel's element.
import { h } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { toast, confirmDialog, promptDialog, actionSheet } from '../ui.js';
import { fmtTime, parseTime, round3, resolveStyle, DEFAULT_STYLE, FONTS, checkCues, readingSpeed, shiftCues, syncCues, autoDurations, cuesFromLines, replaceText, cleanStyle, sortCues } from './model.js';
import { defaultAnchor } from './render.js';
import { FORMATS } from './format.js';

/* ------------------------------------------------------------------ small building blocks */
const card = (title, ...kids) => h('section', { class: 'ss-card' }, title ? h('h4', null, title) : null, ...kids);
const note = (txt) => h('p', { class: 'ss-note' }, txt);
const btn = (label, onClick, { icon = null, cls = '', title = '', disabled = false } = {}) =>
  h('button', { class: 'ss-btn ' + cls, type: 'button', onClick, title: title || null, 'aria-label': title || null, disabled: disabled || null }, icon ? h('span', { html: ic(icon) }) : null, label ? h('span', null, label) : null);

function seg(options, value, onPick, cls = '') {
  return h('div', { class: 'ss-seg ' + cls, role: 'group' }, options.map(([id, label, extra]) =>
    h('button', { type: 'button', class: id === value ? 'on' : '', 'aria-pressed': String(id === value), disabled: extra && extra.disabled ? true : null, onClick: () => onPick(id) }, label)));
}

/** A slider with its value shown beside it. onInput runs while dragging, onChange when released. */
function slider({ label, min, max, step, value, fmt = (v) => String(v), onInput, onChange, unit = '' }) {
  const out = h('output', { dir: 'ltr' }, fmt(value) + unit);
  const inp = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
  inp.addEventListener('input', () => { const v = parseFloat(inp.value); out.textContent = fmt(v) + unit; onInput && onInput(v); });
  inp.addEventListener('change', () => { onChange && onChange(parseFloat(inp.value)); });
  const set = (v) => { inp.value = v; out.textContent = fmt(v) + unit; };
  const row = h('label', { class: 'ss-slider' }, h('span', null, label), inp, out);
  row.set = set;
  return row;
}

const SWATCHES = ['#ffffff', '#ffe066', '#7cf2c0', '#7fdbff', '#ffa94d', '#ff8fab', '#ff5c5c', '#c4b5fd', '#9ca3af', '#000000'];
function swatches(value, onPick, list = SWATCHES, label = '') {
  const norm = String(value || '').toLowerCase();
  const custom = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(norm) ? norm : '#ffffff', 'aria-label': t('sub_customColor') });
  custom.addEventListener('input', () => onPick(custom.value.toLowerCase(), false));
  custom.addEventListener('change', () => onPick(custom.value.toLowerCase(), true));
  return h('div', { class: 'ss-sw', role: 'group', 'aria-label': label || null },
    list.map((c) => h('button', { type: 'button', class: 'sw' + (c === norm ? ' on' : ''), style: { background: c }, 'aria-label': c, onClick: () => onPick(c, true) })),
    h('label', { class: 'sw custom' + (list.includes(norm) ? '' : ' on'), style: { '--c': norm } }, custom, h('span', { html: ic('plus') })));
}

const toggle = (label, on, onChange) => {
  const b = h('button', { type: 'button', class: 'switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on), 'aria-label': label });
  b.addEventListener('click', () => { const v = !b.classList.contains('on'); b.classList.toggle('on', v); b.setAttribute('aria-checked', String(v)); onChange(v); });
  return h('div', { class: 'ss-sw-row' }, h('span', null, label), b);
};

const timeBox = (value, onSet, label) => {
  const inp = h('input', { class: 'ss-time', type: 'text', inputmode: 'decimal', dir: 'ltr', value: fmtTime(value), 'aria-label': label, autocomplete: 'off', spellcheck: 'false' });
  const commit = () => { const v = parseTime(inp.value); if (Number.isFinite(v)) onSet(round3(Math.max(0, v))); else inp.value = fmtTime(value); };
  inp.addEventListener('change', commit);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
  inp.addEventListener('focus', () => inp.select());
  return inp;
};

const WARN_KEYS = { empty: 'sub_w_empty', short: 'sub_w_short', long: 'sub_w_long', fast: 'sub_w_fast', overlap: 'sub_w_overlap' };
const warnText = (list) => list.map((k) => t(WARN_KEYS[k])).join(' · ');

/* ------------------------------------------------------------------ 1 · the list */
export function panelCues(S) {
  const tr = S.tr(), cues = tr.cues;
  const root = h('div', { class: 'ss-p ss-cues' });
  const warn = S.warnings();
  const issues = cues.filter((c) => warn.has(c.id));
  const head = h('div', { class: 'ss-cues-head' },
    h('b', null, t('sub_count', { n: cues.length })),
    issues.length ? h('button', { class: 'ss-chip warn' + (S.issuesOnly ? ' on' : ''), type: 'button', onClick: () => { S.issuesOnly = !S.issuesOnly; S.refresh({ lane: false }); } }, h('span', { html: ic('info') }), t('sub_issues', { n: issues.length })) : null,
    issues.length ? btn(t('sub_nextIssue'), () => S.nextIssue(), { cls: 'sm ghost' }) : null);
  root.append(head);
  if (!cues.length) {
    root.append(h('div', { class: 'ss-empty' }, h('span', { class: 'ss-empty-ic', html: ic('cc') }), h('b', null, t('sub_emptyTitle')), h('p', null, t('sub_emptySub')),
      btn(t('sub_addHere'), () => S.addCue(), { icon: 'plus', cls: 'primary' }),
      btn(t('sub_pasteLines'), () => S.go('tools', 'paste'), { icon: 'edit', cls: 'ghost' }),
      btn(t('sub_importFile'), () => S.importFile(), { icon: 'upload', cls: 'ghost' })));
    return root;
  }
  const list = S.issuesOnly ? issues : cues;
  const PAGE = 120;
  let from = S.listFrom;
  const selIdx = S.sel ? list.findIndex((c) => c.id === S.sel) : -1;
  if (selIdx >= 0 && (selIdx < from || selIdx >= from + PAGE)) from = Math.max(0, selIdx - 30);
  if (from > list.length - 1) from = Math.max(0, list.length - PAGE);
  S.listFrom = from;
  const to = Math.min(list.length, from + PAGE);
  const box = h('div', { class: 'ss-list', role: 'list' });
  if (from > 0) box.append(btn(t('sub_earlier', { n: from }), () => { S.listFrom = Math.max(0, from - PAGE); S.refresh({ lane: false }); }, { cls: 'ghost wide' }));
  const index = new Map(cues.map((c, i) => [c.id, i + 1]));
  for (let i = from; i < to; i++) {
    const c = list[i];
    const w = warn.get(c.id);
    box.append(h('div', { class: 'ss-row' + (c.id === S.sel ? ' sel' : '') + (w ? ' warn' : ''), role: 'listitem', dataset: { id: c.id } },
      h('button', { class: 'ss-row-main', type: 'button', onClick: () => { if (S.sel === c.id) S.go('text'); else S.select(c.id, { seek: true }); } },
        h('span', { class: 'n' }, String(index.get(c.id))),
        h('span', { class: 'body' },
          h('span', { class: 'tm', dir: 'ltr' }, `${fmtTime(c.start)} → ${fmtTime(c.end)}`),
          h('span', { class: 'tx', dir: 'auto' }, c.text.trim() ? c.text : t('sub_emptyText')),
          w ? h('span', { class: 'wr' }, warnText(w)) : null)),
      h('button', { class: 'ss-row-edit', type: 'button', 'aria-label': t('sub_edit'), onClick: () => { S.select(c.id, { seek: true }); S.go('text'); }, html: ic('edit') })));
  }
  if (to < list.length) box.append(btn(t('sub_more', { n: list.length - to }), () => { S.listFrom = from + PAGE; S.refresh({ lane: false }); }, { cls: 'ghost wide' }));
  root.append(box);
  return root;
}

/* ------------------------------------------------------------------ 2 · the text and the timing of one subtitle */
export function panelText(S) {
  const root = h('div', { class: 'ss-p ss-edit' });
  const c = S.cue();
  if (!c) {
    root.append(h('div', { class: 'ss-empty' }, h('span', { class: 'ss-empty-ic', html: ic('edit') }), h('b', null, t('sub_noneSel')), h('p', null, t('sub_noneSelSub')),
      btn(t('sub_addHere'), () => S.addCue(), { icon: 'plus', cls: 'primary' })));
    return root;
  }
  const idx = S.cues().findIndex((x) => x.id === c.id);
  const total = S.cues().length;
  root.append(h('div', { class: 'ss-edit-head' },
    btn('', () => S.step(-1), { icon: 'chevron', cls: 'icon flip', title: t('sub_prevCue'), disabled: idx <= 0 }),
    h('b', { dir: 'auto' }, t('sub_nOfM', { n: idx + 1, m: total })),
    btn('', () => S.step(1), { icon: 'chevron', cls: 'icon', title: t('sub_nextCue'), disabled: idx >= total - 1 })));

  // the text
  const ta = h('textarea', { class: 'ss-ta', rows: 4, dir: 'auto', placeholder: t('sub_textPh'), 'aria-label': t('sub_text'), spellcheck: 'true' });
  ta.value = c.text;
  ta.addEventListener('input', () => S.editCue(c.id, { text: ta.value }, 'text:' + c.id, { panel: false }));
  S.textarea = ta;
  const ins = (s) => { const a = ta.selectionStart, b = ta.selectionEnd; ta.setRangeText(s, a, b, 'end'); ta.dispatchEvent(new Event('input')); ta.focus(); };
  root.append(card(null, ta,
    h('div', { class: 'ss-quick' },
      h('button', { type: 'button', onClick: () => ins('\n'), title: t('sub_lineBreak') }, '⏎'),
      h('button', { type: 'button', onClick: () => ins('♪ ') }, '♪'),
      h('button', { type: 'button', onClick: () => ins('- ') }, '–'),
      h('button', { type: 'button', onClick: () => ins('…') }, '…'),
      h('button', { type: 'button', onClick: () => { ta.value = ta.value.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim(); ta.dispatchEvent(new Event('input')); }, title: t('sub_tidy') }, h('span', { html: ic('wand') })),
      h('button', { type: 'button', onClick: () => { ta.value = ta.value.replace(/\n+/g, ' ').trim(); ta.dispatchEvent(new Event('input')); }, title: t('sub_oneLine') }, h('span', { html: ic('alignL') })))));

  // the timing
  const stepIds = [0.01, 0.05, 0.1, 0.5, 1];
  const step = S.stepSize;
  const stepBar = h('div', { class: 'ss-steps' }, h('span', null, t('sub_step')), seg(stepIds.map((s) => [s, String(s)]), step, (s) => { S.stepSize = s; S.refresh({ lane: false }); }));
  const pairRow = (label, key, val) => h('div', { class: 'ss-trow' },
    h('span', { class: 'lb' }, label),
    btn('−', () => S.setTimes(key === 'start' ? { start: c.start - S.stepSize } : { end: c.end - S.stepSize }), { cls: 'icon', title: t('sub_earlierBy', { n: S.stepSize }) }),
    timeBox(val, (v) => S.setTimes({ [key]: v }), label),
    btn('+', () => S.setTimes(key === 'start' ? { start: c.start + S.stepSize } : { end: c.end + S.stepSize }), { cls: 'icon', title: t('sub_laterBy', { n: S.stepSize }) }),
    btn('', () => S.setTimes({ [key]: S.now() }), { icon: 'flag', cls: 'icon accent', title: t('sub_toPlayhead') }));
  const dur = c.end - c.start;
  const cps = readingSpeed(c);
  const w = S.warnings().get(c.id);
  root.append(card(t('sub_timing'), stepBar,
    pairRow(t('sub_start'), 'start', c.start), pairRow(t('sub_end'), 'end', c.end),
    h('div', { class: 'ss-trow move' }, h('span', { class: 'lb' }, t('sub_moveAll')),
      btn('−', () => S.moveCue(-S.stepSize), { cls: 'icon' }), h('span', { class: 'ss-dur', dir: 'ltr' }, `${dur.toFixed(2)}s`), btn('+', () => S.moveCue(S.stepSize), { cls: 'icon' }),
      btn('', () => S.moveCue(S.now() - c.start), { icon: 'flag', cls: 'icon accent', title: t('sub_startAtPlayhead') })),
    h('p', { class: 'ss-meta' + (w ? ' warn' : ''), dir: 'ltr' }, `${Math.round(cps)} ${t('sub_cps')}`, w ? ' · ' : '', w ? warnText(w) : '')));

  // actions
  root.append(card(t('sub_actions'), h('div', { class: 'ss-actions' },
    btn(t('sub_playCue'), () => S.playCue(c, false), { icon: 'play' }),
    btn(t('sub_loopCue'), () => S.playCue(c, true), { icon: 'repeat', cls: S.looping ? 'on' : '' }),
    btn(t('sub_split'), () => S.splitSel(ta.selectionStart), { icon: 'scissors' }),
    btn(t('sub_mergeNext'), () => S.mergeNext(), { icon: 'merge', disabled: idx >= total - 1 }),
    btn(t('sub_duplicate'), () => S.dupSel(), { icon: 'copy' }),
    btn(t('sub_delete'), () => S.delSel(), { icon: 'trash', cls: 'danger' }))));
  return root;
}

/* ------------------------------------------------------------------ 3 · the look */
function scopeBar(S) {
  const cue = S.cue();
  return h('div', { class: 'ss-scope' }, seg([['cue', t('sub_scopeCue'), { disabled: !cue }], ['track', t('sub_scopeTrack')]], S.scopeNow(), (v) => { S.scope = v; S.refresh({ lane: false }); }),
    note(S.scopeNow() === 'cue' ? t('sub_scopeCueHint') : t('sub_scopeTrackHint')));
}

export function panelStyle(S) {
  const root = h('div', { class: 'ss-p ss-style' });
  const c = S.cue();
  root.append(scopeBar(S));
  const s = S.styleNow();
  const set = (patch, key, commit = true) => S.setStyle(patch, key, { panel: false, commit });
  const redraw = () => S.refresh({ lane: false });

  const sizeRow = slider({ label: t('sub_size'), min: 2, max: 14, step: 0.1, value: s.size, fmt: (v) => v.toFixed(1), unit: '%', onInput: (v) => set({ size: v }, 'size'), onChange: redraw });
  const presets = [['S', 3.6], ['M', 5.2], ['L', 7], ['XL', 9]];
  root.append(card(t('sub_size'), sizeRow, h('div', { class: 'ss-chips' }, presets.map(([l, v]) => h('button', { type: 'button', class: 'ss-chip' + (Math.abs(s.size - v) < 0.05 ? ' on' : ''), onClick: () => { set({ size: v }, 'size:p'); redraw(); } }, l)))));

  root.append(card(t('sub_color'), swatches(s.color, (v, fin) => { set({ color: v }, 'color'); if (fin) redraw(); })));

  const bgPresets = [['none', t('sub_bgNone'), 0], ['soft', t('sub_bgSoft'), 0.35], ['mid', t('sub_bgMid'), 0.6], ['solid', t('sub_bgSolid'), 1]];
  const bgNow = s.bgOp <= 0 ? 'none' : (bgPresets.find((p) => p[0] !== 'none' && Math.abs(p[2] - s.bgOp) < 0.03) || [''])[0];
  const bgOpacity = slider({ label: t('sub_bgOpacity'), min: 0, max: 100, step: 1, value: Math.round(s.bgOp * 100), unit: '%', onInput: (v) => set({ bgOp: v / 100 }, 'bgop'), onChange: redraw });
  root.append(card(t('sub_box'),
    seg(bgPresets.map(([id, l]) => [id, l]), bgNow, (id) => { const p = bgPresets.find((x) => x[0] === id); set({ bgOp: p[2] }, 'bgop:p'); redraw(); }),
    bgOpacity,
    s.bgOp > 0 ? swatches(s.bg, (v, fin) => { set({ bg: v }, 'bg'); if (fin) redraw(); }, ['#000000', '#1f2937', '#0b1b4d', '#3b0764', '#7f1d1d', '#14532d', '#ffffff', '#fde68a'], t('sub_boxColor')) : null));

  const outlineRow = slider({ label: t('sub_outline'), min: 0, max: 12, step: 0.5, value: s.ol, fmt: (v) => v.toFixed(1), onInput: (v) => set({ ol: v }, 'ol'), onChange: redraw });
  root.append(card(t('sub_outlineShadow'), outlineRow,
    s.ol > 0 ? swatches(s.olc, (v, fin) => { set({ olc: v }, 'olc'); if (fin) redraw(); }, ['#000000', '#ffffff', '#1f2937', '#b91c1c', '#1d4ed8', '#f59e0b'], t('sub_outlineColor')) : null,
    toggle(t('sub_shadow'), !!s.shadow, (v) => { set({ shadow: v }, 'shadow:' + v); redraw(); })));

  const fontLabels = { sans: t('sub_fontSans'), serif: t('sub_fontSerif'), mono: t('sub_fontMono'), hand: t('sub_fontHand') };
  root.append(card(t('sub_font'),
    h('div', { class: 'ss-fonts' }, FONTS.map((f) => h('button', { type: 'button', class: 'ss-font f-' + f + (s.font === f ? ' on' : ''), onClick: () => { set({ font: f }, 'font:' + f); redraw(); } }, h('b', null, 'Aa أب'), h('small', null, fontLabels[f])))),
    h('div', { class: 'ss-biu' },
      h('button', { type: 'button', class: 'b' + (s.b ? ' on' : ''), 'aria-pressed': String(!!s.b), onClick: () => { set({ b: !s.b }, 'b:' + !s.b); redraw(); } }, 'B'),
      h('button', { type: 'button', class: 'i' + (s.i ? ' on' : ''), 'aria-pressed': String(!!s.i), onClick: () => { set({ i: !s.i }, 'i:' + !s.i); redraw(); } }, 'I'),
      h('button', { type: 'button', class: 'u' + (s.u ? ' on' : ''), 'aria-pressed': String(!!s.u), onClick: () => { set({ u: !s.u }, 'u:' + !s.u); redraw(); } }, 'U'))));

  root.append(card(t('sub_more2'),
    slider({ label: t('sub_opacity'), min: 10, max: 100, step: 1, value: Math.round(s.op * 100), unit: '%', onInput: (v) => set({ op: v / 100 }, 'op'), onChange: redraw }),
    slider({ label: t('sub_fade'), min: 0, max: 1000, step: 50, value: s.fade, unit: ' ms', onInput: (v) => set({ fade: v }, 'fade'), onChange: redraw })));

  const STYLE_KEYS = ['size', 'color', 'bg', 'bgOp', 'ol', 'olc', 'shadow', 'b', 'i', 'u', 'font', 'op', 'fade'];
  const acts = [];
  if (S.scopeNow() === 'cue' && c) {
    acts.push(btn(t('sub_applyAll'), () => S.applyLook(STYLE_KEYS, 'all'), { icon: 'copy' }), btn(t('sub_applyAfter'), () => S.applyLook(STYLE_KEYS, 'after'), { icon: 'next' }),
      btn(t('sub_resetCue'), () => S.resetLook(STYLE_KEYS, 'cue'), { icon: 'tmReset', cls: 'ghost' }));
  } else acts.push(btn(t('sub_clearOwn'), () => S.resetLook(STYLE_KEYS, 'allcues'), { icon: 'wand', cls: 'ghost' }), btn(t('sub_resetTrack'), () => S.resetLook(STYLE_KEYS, 'track'), { icon: 'tmReset', cls: 'ghost' }));
  root.append(card(null, h('div', { class: 'ss-actions' }, acts)));
  return root;
}

/* ------------------------------------------------------------------ 4 · where it sits */
export function panelPosition(S) {
  const root = h('div', { class: 'ss-p ss-pos' });
  root.append(scopeBar(S));
  const s = S.styleNow();
  const redraw = () => S.refresh({ lane: false });
  const custom = !!s.pos;

  // 3 × 3 grid: the corner/edge the subtitle hangs from
  const grid = h('div', { class: 'ss-grid9', role: 'group', 'aria-label': t('sub_align') });
  [7, 8, 9, 4, 5, 6, 1, 2, 3].forEach((an) => grid.append(h('button', { type: 'button', class: 'g' + (s.an === an ? ' on' : ''), 'aria-label': `${t('sub_align')} ${an}`, 'aria-pressed': String(s.an === an), onClick: () => { S.setStyle({ an }, 'an', { panel: false, commit: true }); redraw(); } }, h('i'))));
  root.append(card(t('sub_align'), h('div', { class: 'ss-gridwrap' }, grid, h('div', { class: 'ss-gridtx' }, note(t('sub_alignHint')), h('b', { class: 'ss-an', dir: 'ltr' }, ['↙ ⬇ ↘', '⬅ ⬤ ➡', '↖ ⬆ ↗'][Math.floor((s.an - 1) / 3)].split(' ')[(s.an - 1) % 3])))));

  const anchor = s.pos || defaultAnchor(s.an);
  const xRow = slider({ label: t('sub_posX'), min: 0, max: 100, step: 0.5, value: anchor.x, unit: '%', onInput: (v) => S.setPos({ x: v }, 'px'), onChange: redraw });
  const yRow = slider({ label: t('sub_posY'), min: 0, max: 100, step: 0.5, value: anchor.y, unit: '%', onInput: (v) => S.setPos({ y: v }, 'py'), onChange: redraw });
  const nudge = (dx, dy) => S.setPos({ x: anchor.x + dx * S.nudge, y: anchor.y + dy * S.nudge }, 'nudge', { redraw: true });
  const pad = h('div', { class: 'ss-nudge' },
    h('span'), btn('', () => nudge(0, -1), { icon: 'arrowUp', cls: 'icon', title: t('sub_up') }), h('span'),
    btn('', () => nudge(-1, 0), { icon: 'arrowLeft', cls: 'icon', title: t('sub_left') }), btn('', () => S.setStyle({ pos: null }, 'pos', { panel: true, commit: true }), { icon: 'crosshair', cls: 'icon', title: t('sub_auto') }), btn('', () => nudge(1, 0), { icon: 'arrowRight', cls: 'icon', title: t('sub_right') }),
    h('span'), btn('', () => nudge(0, 1), { icon: 'arrowDown', cls: 'icon', title: t('sub_down') }), h('span'));
  root.append(card(t('sub_exact'),
    toggle(t('sub_customPos'), custom, (v) => { S.setStyle({ pos: v ? { x: round3(anchor.x), y: round3(anchor.y) } : null }, 'pos', { panel: true, commit: true }); }),
    custom ? h('div', null, xRow, yRow, h('div', { class: 'ss-steps' }, h('span', null, t('sub_step')), seg([[0.5, '0.5%'], [2, '2%'], [5, '5%']], S.nudge, (v) => { S.nudge = v; redraw(); })), pad) : note(t('sub_autoPosHint')),
    toggle(t('sub_snap'), S.snap, (v) => { S.snap = v; }),
    note(t('sub_dragHint'))));

  const POS_KEYS = ['an', 'pos'];
  const acts = [];
  if (S.scopeNow() === 'cue' && S.cue()) {
    acts.push(btn(t('sub_applyAll'), () => S.applyLook(POS_KEYS, 'all'), { icon: 'copy' }), btn(t('sub_applyAfter'), () => S.applyLook(POS_KEYS, 'after'), { icon: 'next' }), btn(t('sub_resetPos'), () => S.resetLook(POS_KEYS, 'cue'), { icon: 'tmReset', cls: 'ghost' }));
  } else acts.push(btn(t('sub_clearOwnPos'), () => S.resetLook(POS_KEYS, 'allcues'), { icon: 'wand', cls: 'ghost' }), btn(t('sub_resetPos'), () => S.resetLook(POS_KEYS, 'track'), { icon: 'tmReset', cls: 'ghost' }));
  root.append(card(null, h('div', { class: 'ss-actions' }, acts)));
  return root;
}

/* ------------------------------------------------------------------ 5 · tools: timing, text, files */
export function panelTools(S) {
  const root = h('div', { class: 'ss-p ss-tools' });
  const cues = S.cues();

  /* shift */
  const shiftIn = h('input', { class: 'ss-time', type: 'text', inputmode: 'decimal', dir: 'ltr', value: S.shiftBy, 'aria-label': t('sub_shiftBy'), autocomplete: 'off' });
  shiftIn.addEventListener('input', () => { S.shiftBy = shiftIn.value; });
  const delta = () => { const v = parseFloat(String(shiftIn.value).replace(',', '.').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))); return Number.isFinite(v) ? v : NaN; };
  const doShift = (from) => { const d = delta(); if (!Number.isFinite(d) || !d) { toast(t('sub_numNeeded')); return; } S.editCues((cs) => shiftCues(cs, d, from), 'shift'); toast(t('sub_shifted', { n: (d > 0 ? '+' : '') + d })); };
  const chips = [-5, -1, -0.5, -0.1, 0.1, 0.5, 1, 5].map((v) => h('button', { type: 'button', class: 'ss-chip', onClick: () => { shiftIn.value = String(v); S.shiftBy = String(v); } }, (v > 0 ? '+' : '') + v));
  root.append(card(t('sub_tShift'), note(t('sub_tShiftHint')),
    h('div', { class: 'ss-trow' }, h('span', { class: 'lb' }, t('sub_seconds')), shiftIn), h('div', { class: 'ss-chips' }, chips),
    h('div', { class: 'ss-actions' }, btn(t('sub_shiftAll'), () => doShift(-Infinity), { icon: 'next', disabled: !cues.length }), btn(t('sub_shiftFrom'), () => { const c = S.cue(); if (!c) { toast(t('sub_selectFirst')); return; } doShift(c.start); }, { icon: 'next', cls: 'ghost', disabled: !cues.length }))));

  /* two-point sync */
  const p1 = S.syncPts[0], p2 = S.syncPts[1];
  const ptRow = (n, p) => h('div', { class: 'ss-sync-pt' + (p ? ' set' : '') }, h('span', { class: 'n' }, String(n)),
    h('span', { class: 'tx', dir: 'ltr' }, p ? `${fmtTime(p.a)} → ${fmtTime(p.b)}` : t('sub_syncUnset')),
    btn(p ? t('sub_syncRedo') : t('sub_syncSet'), () => { const c = S.cue(); if (!c) { toast(t('sub_selectFirst')); return; } S.syncPts[n - 1] = { a: c.start, b: S.now() }; S.refresh({ lane: false }); }, { cls: 'sm' }));
  root.append(card(t('sub_tSync'), note(t('sub_tSyncHint')), ptRow(1, p1), ptRow(2, p2),
    h('div', { class: 'ss-actions' },
      btn(t('sub_syncApply'), () => { if (!p1 || !p2 || Math.abs(p2.a - p1.a) < 0.5) { toast(t('sub_syncNeed')); return; } S.editCues((cs) => syncCues(cs, p1.a, p1.b, p2.a, p2.b), 'sync'); S.syncPts = [null, null]; toast(t('sub_synced')); S.refresh({ lane: false }); }, { icon: 'swap', cls: 'primary', disabled: !(p1 && p2) }),
      btn(t('sub_syncClear'), () => { S.syncPts = [null, null]; S.refresh({ lane: false }); }, { cls: 'ghost', disabled: !(p1 || p2) }))));

  /* reading time */
  const cpsRow = slider({ label: t('sub_cpsLabel'), min: 8, max: 30, step: 1, value: S.cps, fmt: (v) => String(v), onInput: (v) => { S.cps = v; } });
  root.append(card(t('sub_tAuto'), note(t('sub_tAutoHint')), cpsRow,
    h('div', { class: 'ss-actions' }, btn(t('sub_autoApply'), () => { S.editCues((cs) => autoDurations(cs, { cps: S.cps }), 'auto'); toast(t('sub_done')); }, { icon: 'wand', disabled: !cues.length }),
      btn(t('sub_fixOverlaps'), () => S.fixOverlaps(), { icon: 'merge', cls: 'ghost', disabled: !cues.length }),
      btn(t('sub_dropEmpty'), () => S.dropEmpty(), { icon: 'trash', cls: 'ghost', disabled: !cues.length }))));

  /* find & replace */
  const fi = h('input', { class: 'field', type: 'text', dir: 'auto', placeholder: t('sub_find'), value: S.findText, 'aria-label': t('sub_find'), autocomplete: 'off' });
  const ri = h('input', { class: 'field', type: 'text', dir: 'auto', placeholder: t('sub_replaceWith'), value: S.replText, 'aria-label': t('sub_replaceWith'), autocomplete: 'off' });
  fi.addEventListener('input', () => { S.findText = fi.value; }); ri.addEventListener('input', () => { S.replText = ri.value; });
  root.append(card(t('sub_tFind'), fi, ri, toggle(t('sub_matchCase'), S.matchCase, (v) => { S.matchCase = v; }),
    h('div', { class: 'ss-actions' },
      btn(t('sub_findNext'), () => S.findNext(), { icon: 'search', disabled: !cues.length }),
      btn(t('sub_replaceAll'), () => { if (!fi.value) { toast(t('sub_findNeeded')); return; } let n = 0; S.editCues((cs) => { const r = replaceText(cs, fi.value, ri.value, { matchCase: S.matchCase }); n = r.count; return r.cues; }, 'replace'); toast(t('sub_replacedN', { n })); }, { icon: 'swap', cls: 'primary', disabled: !cues.length }))));

  /* paste text */
  const pa = h('textarea', { class: 'ss-ta', rows: 5, dir: 'auto', placeholder: t('sub_pastePh'), 'aria-label': t('sub_pasteLines') });
  pa.id = 'ss-paste';
  root.append(card(t('sub_pasteLines'), note(t('sub_pasteHint')), pa,
    h('div', { class: 'ss-actions' }, btn(t('sub_pasteAdd'), () => {
      const text = pa.value.trim();
      if (!text) { toast(t('sub_pasteNeeded')); return; }
      const made = cuesFromLines(text, S.now(), { cps: S.cps });
      S.editCues((cs) => sortCues([...cs, ...made]), 'paste');
      S.select(made[0].id, { seek: true });
      pa.value = ''; toast(t('sub_addedN', { n: made.length }));
    }, { icon: 'plus', cls: 'primary' }))));

  /* files */
  const fmt = S.exportFmt;
  root.append(card(t('sub_tFiles'), note(t('sub_filesHint')),
    seg(FORMATS.map((f) => [f, f.toUpperCase()]), fmt, (f) => { S.exportFmt = f; S.refresh({ lane: false }); }),
    note(t('sub_fmt_' + fmt)),
    h('div', { class: 'ss-actions' },
      btn(t('sub_saveFile'), () => S.exportFile(), { icon: 'share', cls: 'primary', disabled: !cues.length }),
      btn(t('sub_saveLibrary'), () => S.saveToLibrary(), { icon: 'folder', disabled: !cues.length }),
      btn(t('sub_importFile'), () => S.importFile(), { icon: 'upload', cls: 'ghost' }))));

  /* the track itself */
  const tr = S.tr();
  root.append(card(t('sub_tTrack'),
    h('div', { class: 'ss-actions' },
      btn(t('sub_rename'), () => S.renameTrack(), { icon: 'edit' }),
      btn(t('sub_dupTrack'), () => S.dupTrack(), { icon: 'copy' }),
      btn(t('sub_newTrack'), () => S.newTrack(), { icon: 'plus' }),
      btn(t('sub_clearAll'), () => S.clearCues(), { icon: 'trash', cls: 'danger', disabled: !cues.length }),
      btn(t('sub_deleteTrack'), () => S.deleteTrack(), { icon: 'trash', cls: 'danger' })),
    h('p', { class: 'ss-meta' }, `${tr.name} · ${t('sub_count', { n: cues.length })}`)));
  return root;
}

export { checkCues, DEFAULT_STYLE, resolveStyle, cleanStyle, confirmDialog, promptDialog, actionSheet };
