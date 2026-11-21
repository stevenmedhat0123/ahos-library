// AHOS Calc – the Base-N pane: type in DEC / HEX / BIN / OCT, use and / or / xor / xnor / Not / Neg, and see the answer in all four bases at
// once (32-bit two's complement, like a programmer's calculator).
import { h } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { toast } from '../ui.js';
import { Editor } from './editor.js';
import { drawSlot } from './display.js';
import { evaluate, makeCtx } from './expr.js';
import { baseStr, BASE_NAMES, BASE_DIGITS } from './base.js';
import { attachKeyFx } from './keyfx.js';

const LOGIC = new Set(['and', 'or', 'xor', 'xnor']);
const OPS = new Set(['+', '-', '×', '÷']);
const K = (l, v, c = '', k = 'i') => ({ l, v, c, k });
// 6 columns × 6 rows; `=` takes the bottom-right 2 × 2 block and Ans the two cells above it
const PAD = [
  K('(', '('), K(')', ')'), K('Not', 'Not(', 'fn'), K('Neg', 'Neg(', 'fn'), K('and', 'and', 'lg'), K('or', 'or', 'lg'),
  K('A', 'A', 'dg'), K('B', 'B', 'dg'), K('C', 'C', 'dg'), K('÷', '÷', 'ok'), K('xor', 'xor', 'lg'), K('xnor', 'xnor', 'lg'),
  K('D', 'D', 'dg'), K('E', 'E', 'dg'), K('F', 'F', 'dg'), K('×', '×', 'ok'), K('', 'del', 'dl', 'a'), K('AC', 'ac', 'ac', 'a'),
  K('7', '7', 'dg'), K('8', '8', 'dg'), K('9', '9', 'dg'), K('−', '-', 'ok'), K('Ans', 'Ans', 'fn wide2'),
  K('4', '4', 'dg'), K('5', '5', 'dg'), K('6', '6', 'dg'), K('+', '+', 'ok'), K('=', 'eq', 'eq tall2', 'a'),
  K('1', '1', 'dg'), K('2', '2', 'dg'), K('3', '3', 'dg'), K('0', '0', 'dg'),
];

const group4 = (s) => s.replace(/\B(?=(?:[01]{4})+$)/g, ' ');
const fmt = (v, base) => { const s = baseStr(v, base); if (base === 2) return group4(s.padStart(Math.ceil(s.length / 4) * 4, '0')); if (base === 16 && s.length > 4) return s.replace(/\B(?=(?:[0-9A-F]{4})+$)/g, ' '); return s; };

export function basePane() {
  const ed = new Editor();
  const reg = new WeakMap();
  const cx = makeCtx({ base: 10 });
  let base = 10;
  let fresh = false;
  let val = null;                     // the last good value (a number)

  const exprEl = h('div', { class: 'cs-expr cb-expr', dir: 'ltr' });
  const cells = {};
  const grid = h('div', { class: 'cb-grid', dir: 'ltr' }, [16, 10, 8, 2].map((b) => {
    const num = h('span', { class: 'cb-val' }, '—');
    cells[b] = num;
    return h('button', { class: 'cb-cell', type: 'button', dataset: { b: String(b) }, onClick: () => setBase(b) }, h('b', null, BASE_NAMES[b]), num);
  }));
  const err = h('div', { class: 'cb-err' });
  const copyBtn = h('button', { class: 'cs-ib', type: 'button', 'aria-label': t('calc_copy'), onClick: async () => { if (val == null) return; try { await navigator.clipboard.writeText(baseStr(val, base)); toast(t('calc_copied')); } catch { toast(t('calc_copyFail')); } }, html: ic('copy') });
  const top = h('div', { class: 'cs-top' }, h('span', { class: 'cs-chip' }, t('calc_t_base')), h('span', { class: 'sp' }),
    h('button', { class: 'cs-ib', type: 'button', onClick: () => { if (ed.undo()) { fresh = false; edited(); } }, 'aria-label': t('calc_undo'), html: ic('undo') }),
    h('button', { class: 'cs-ib', type: 'button', 'aria-label': '◀', onClick: () => { fresh = false; ed.left(); paintExpr(); }, html: ic('back') }),
    h('button', { class: 'cs-ib', type: 'button', 'aria-label': '▶', onClick: () => { fresh = false; ed.right(); paintExpr(); }, html: ic('chev') }), copyBtn);
  const disp = h('div', { class: 'cs-disp cb-disp' }, top, exprEl, err, grid);

  const paintBases = () => {
    [...grid.children].forEach((c) => c.classList.toggle('on', c.dataset.b === String(base)));
    pad.querySelectorAll('.dg').forEach((b) => { const d = b.__def.v; b.disabled = !BASE_DIGITS[base].includes(d); });
  };
  function fit() {
    for (const s of [34, 28, 24, 20, 17]) { exprEl.style.fontSize = s + 'px'; if (exprEl.scrollWidth <= exprEl.clientWidth + 1) break; }
    const caret = exprEl.querySelector('.caret');
    if (caret && exprEl.scrollWidth > exprEl.clientWidth) { const x = caret.offsetLeft; if (x > exprEl.scrollLeft + exprEl.clientWidth - 24) exprEl.scrollLeft = x - exprEl.clientWidth + 24; else if (x < exprEl.scrollLeft + 12) exprEl.scrollLeft = Math.max(0, x - 12); } else exprEl.scrollLeft = 0;
  }
  const paintExpr = () => { exprEl.replaceChildren(drawSlot(ed.items, ed.cur, reg, 'sl rt')); fit(); };
  function show(v) {
    val = v;
    for (const b of [16, 10, 8, 2]) cells[b].textContent = v == null ? '—' : fmt(v, b);
  }
  function compute(final) {
    err.textContent = ''; err.classList.remove('on');
    if (ed.isEmpty) { show(null); return; }
    try {
      cx.base = base;
      const r = evaluate(ed.items, cx);
      if (typeof r.value !== 'number') throw new Error('type');
      show(r.value);
      if (final) { cx.ans = r.value; fresh = true; }
    } catch (e) {
      show(null);
      if (final) { err.textContent = t('calc_err_' + (e && ['math', 'syntax', 'arg'].includes(e.code) ? e.code : 'math')); err.classList.add('on'); }
    }
  }
  const edited = () => { paintExpr(); compute(false); };
  function begin(cont) { if (!fresh) return; fresh = false; ed.clear(); if (cont) ed.insert('Ans'); }
  function ins(v) {
    begin(OPS.has(v) || LOGIC.has(v));
    if (OPS.has(v) || LOGIC.has(v)) ed.op(v); else ed.insert(v);
    edited();
  }
  function setBase(b) { base = b; cx.base = b; paintBases(); compute(false); }
  function run(d) {
    try { navigator.vibrate && navigator.vibrate(5); } catch { /* ignore */ }
    if (d.k === 'a') { if (d.v === 'del') { fresh = false; ed.backspace(); edited(); } else if (d.v === 'ac') { ed.clear(); fresh = false; show(null); err.textContent = ''; paintExpr(); } else if (d.v === 'eq') compute(true); return; }
    ins(d.v);
  }

  const pad = h('div', { class: 'cs-pad cb-pad', dir: 'ltr' }, PAD.map((d) => {
    const b = h('button', { class: 'ck ' + (d.c || ''), type: 'button' });
    if (d.v === 'del') b.innerHTML = ic('backspace'); else b.textContent = d.l;
    b.__def = d; return b;
  }));
  let rep = 0; let repT = 0;
  pad.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.ck'); if (!b || b.disabled || e.button) return;
    e.preventDefault(); b.classList.add('pr'); run(b.__def);
    if (b.__def.v === 'del') { clearTimeout(repT); repT = setTimeout(() => { rep = setInterval(() => run(b.__def), 62); }, 420); }
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => pad.addEventListener(ev, () => { clearTimeout(repT); clearInterval(rep); pad.querySelectorAll('.pr').forEach((x) => x.classList.remove('pr')); }));
  pad.addEventListener('click', (e) => { if (e.detail === 0) { const b = e.target.closest('.ck'); if (b && !b.disabled) run(b.__def); } });
  attachKeyFx(pad);

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key;
    if (/^[0-9a-fA-F]$/.test(k)) { const d = k.toUpperCase(); if (BASE_DIGITS[base].includes(d)) ins(d); else return false; }
    else if (k === '+') ins('+'); else if (k === '-') ins('-'); else if (k === '*') ins('×'); else if (k === '/') ins('÷');
    else if (k === '(' || k === ')') ins(k);
    else if (k === 'Enter' || k === '=') compute(true);
    else if (k === 'Backspace') { fresh = false; ed.backspace(); edited(); }
    else if (k === 'Escape') { ed.clear(); show(null); paintExpr(); }
    else return false;
    e.preventDefault(); return true;
  }

  const el = h('div', { class: 'cs cb' }, disp, pad);
  paintExpr(); paintBases();
  return { el, onKey, refit: fit };
}
