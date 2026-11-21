// AHOS Calc – the Scientific pane: a live display (natural fractions, powers, roots), the result line with exact ⇄ decimal, history,
// memory variables, and one of two keypads – the Casio fx-991ES PLUS (key for key, with SHIFT / ALPHA and the arrow keys in the middle) or
// the pager of function keys. All the maths is in expr.js / fmt.js; this file is only the hands and eyes.
import { h } from '../util.js';
import { ic } from '../icons.js';
import { t, lang } from '../i18n.js';
import { toast, openSheet } from '../ui.js';
import { sfx } from '../sound.js';
import { Editor } from './editor.js';
import { drawSlot, drawItems, drawDesc } from './display.js';
import { evaluate, makeCtx, solveItems, itemsFromText } from './expr.js';
import { describe, decimalText, itemsText, DEFAULT_SETUP } from './fmt.js';
import { isC, isM, isV } from './core.js';
import { loadCalc, saveCalc } from './state.js';
import { engineData, saveData, matToStore, vecToStore } from './data.js';
import { CONSTS, CONVS } from './consts.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { themeControls, lookFields, mathFields } from './prefsui.js';
import { attachKeyFx } from './keyfx.js';
import { CZ_TOP, CZ_MID, CZ_NUM, HYP, ARROWS } from './casio.js';

const OPK = new Set(['+', '-', '×', '÷']);
const POSTK = new Set(['²', '³', '⁻¹', '!', '%', 'nPr', 'nCr', '∠', '°', 'ʳ', 'ᵍ']);
const VARS = ['A', 'B', 'C', 'D', 'E', 'F', 'X', 'Y', 'M'];
const buzz = () => { try { if (loadPrefs().vib) navigator.vibrate && navigator.vibrate(5); } catch { /* no vibration */ } };

/* ---------- my own keys (the pager layout) ---------- */
// k: i = insert an item · f = a function name · t = a template · a = an action · p = insert items then a power · l/h = label / html label
const K = (l, k, v, c = '', hh = null) => ({ l, k, v, c, h: hh });
const FR = '<i class="mf"><b></b><b></b></i>';
const PAGES = [
  { id: 'basic', keys: [
    K('', 't', 'frac', 'fk', FR), K('√▫', 't', 'sqrt', 'fk'), K('ⁿ√▫', 't', 'root', 'fk'), K('|▫|', 't', 'abs', 'fk'), K('', 'i', '⁻¹', 'fk', 'x<sup>−1</sup>'),
    K('log', 'f', 'log('), K('ln', 'f', 'ln('), K('', 'p', ['1', '0'], 'fk', '10<sup>x</sup>'), K('', 'p', ['e'], 'fk', 'e<sup>x</sup>'), K('', 't', 'logb', 'fk', 'log<sub>▫</sub>'),
    K('x!', 'i', '!'), K('π', 'i', 'π'), K('e', 'i', 'e'), K('%', 'i', '%'), K(',', 'i', ','),
  ] },
  { id: 'trig', keys: [
    K('sin', 'f', 'sin('), K('cos', 'f', 'cos('), K('tan', 'f', 'tan('), K('', 'f', 'asin(', 'fk', 'sin<sup>−1</sup>'), K('', 'f', 'acos(', 'fk', 'cos<sup>−1</sup>'),
    K('', 'f', 'atan(', 'fk', 'tan<sup>−1</sup>'), K('sinh', 'f', 'sinh('), K('cosh', 'f', 'cosh('), K('tanh', 'f', 'tanh('), K('°', 'i', '°'),
    K('asinh', 'f', 'asinh('), K('acosh', 'f', 'acosh('), K('atanh', 'f', 'atanh('), K('ʳ', 'i', 'ʳ'), K('ᵍ', 'i', 'ᵍ'),
  ] },
  { id: 'calc', keys: [
    K('∫', 't', 'int', 'fk'), K('', 't', 'der', 'fk', 'd/dx'), K('Σ', 't', 'sum', 'fk'), K('nPr', 'i', 'nPr'), K('nCr', 'i', 'nCr'),
    K('GCD', 'f', 'GCD('), K('LCM', 'f', 'LCM('), K('Int', 'f', 'Int('), K('Intg', 'f', 'Intg('), K('Rnd', 'f', 'Rnd('),
    K('Ran#', 'i', 'Ran#'), K('RanInt', 'f', 'RanInt('), K('Pol', 'f', 'Pol('), K('Rec', 'f', 'Rec('), K('Fact', 'f', 'Fact('),
  ] },
  { id: 'vars', keys: [
    K('A', 'i', 'A', 'vk'), K('B', 'i', 'B', 'vk'), K('C', 'i', 'C', 'vk'), K('D', 'i', 'D', 'vk'), K('E', 'i', 'E', 'vk'),
    K('F', 'i', 'F', 'vk'), K('X', 'i', 'X', 'vk'), K('Y', 'i', 'Y', 'vk'), K('M', 'i', 'M', 'vk'), K('STO →', 'a', 'sto', 'fk'),
    K('Ans', 'i', 'Ans'), K('PreAns', 'i', 'PreAns'), K('M+', 'a', 'mplus', 'fk'), K('M−', 'a', 'mminus', 'fk'), K('MC', 'a', 'mclear', 'fk'),
  ] },
  { id: 'more', keys: [
    K('', 'a', 'consts', 'fk wide', ''), K('', 'a', 'convs', 'fk wide', ''), K('i', 'i', 'i'), K('Conjg', 'f', 'Conjg('), K('Arg', 'f', 'Arg('),
    K('ReP', 'f', 'ReP('), K('ImP', 'f', 'ImP('), K('∠', 'i', '∠'), K('▶r∠θ', 'f', 'toPolar('), K('▶a+bi', 'f', 'toRect('),
    K('▶DMS', 'f', 'dms('), K('Abs', 'f', 'Abs('), K('∛', 'f', 'cbrt('), K('Det', 'f', 'Det('), K('Dot', 'f', 'Dot('),
  ] },
];
const PAD = [
  K('(', 'i', '(', 'fk'), K(')', 'i', ')', 'fk'), K('', 'i', '²', 'fk', 'x<sup>2</sup>'), K('', 'a', 'pow', 'fk', 'x<sup>▫</sup>'), K('', 'a', 'del', 'dl', ''),
  K('7', 'i', '7', 'nk'), K('8', 'i', '8', 'nk'), K('9', 'i', '9', 'nk'), K('÷', 'i', '÷', 'ok'), K('AC', 'a', 'ac', 'ac'),
  K('4', 'i', '4', 'nk'), K('5', 'i', '5', 'nk'), K('6', 'i', '6', 'nk'), K('×', 'i', '×', 'ok'), K('Ans', 'i', 'Ans', 'fk'),
  K('1', 'i', '1', 'nk'), K('2', 'i', '2', 'nk'), K('3', 'i', '3', 'nk'), K('−', 'i', '-', 'ok'), K('', 'a', 'sd', 'fk', 'S⇔D'),
  K('0', 'i', '0', 'nk'), K('.', 'i', '.', 'nk'), K('', 'i', 'ᴇ', 'nk', '×10<sup>x</sup>'), K('+', 'i', '+', 'ok'), K('=', 'a', 'eq', 'eq'),
];

const arrow = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const ALL_CZ = [...CZ_TOP, ...CZ_MID, ...CZ_NUM];
const MODES = [['comp', 'sci', 'calc_m_comp'], ['cmplx', null, 'calc_m_cmplx'], ['stat', 'stat', 'calc_m_stat'], ['base', 'base', 'calc_m_base'], ['eqn', 'eq', 'calc_m_eqn'], ['mat', 'mat', 'calc_m_mat'], ['table', 'table', 'calc_m_tab'], ['vec', 'vec', 'calc_m_vec']];

/** which memory letters does an expression read? (CALC asks for their values) */
function scanVars(items, out = new Set()) {
  for (const it of items) {
    if (typeof it === 'string') { if (VARS.includes(it)) out.add(it); }
    else if (it && typeof it === 'object') for (const k of Object.keys(it)) if (Array.isArray(it[k])) scanVars(it[k], out);
  }
  return out;
}

export function sciPane(ctx, host = {}) {
  const st = loadCalc();
  const ed = new Editor();
  const reg = new WeakMap();
  const cx = makeCtx({ ang: st.setup.ang || 'deg', cmplx: st.cmplx, vars: { ...st.vars }, ans: st.ans == null ? 0 : st.ans, preans: 0 });
  const syncData = () => { const d = engineData(); cx.mats = d.mats; cx.vcts = d.vcts; cx.stat = d.stat; };      // MatA–C, VctA–C and the STAT table come from the other panes
  syncData();
  let setup = { ...st.setup };
  let prefs = loadPrefs();
  let fresh = false;            // a result is showing: the next key starts a new line (an operator continues from Ans)
  let last = null;              // the last evaluate() result
  let exactOver = null;         // S⇔D: null = automatic
  let page = 0;
  let shift = false, alpha = 0, hyp = false, ovr = false;     // Casio states: SHIFT · ALPHA (1 = once, 2 = locked) · hyp · overwrite
  let hi = -1;                  // which history entry ▲ ▼ are showing (-1 = none)
  let engK = null;              // ENG: how many steps of three the exponent was moved
  let off = false;              // the screen is "switched off" (SHIFT AC); ON wakes it

  /* ---------- the display ---------- */
  const exprEl = h('div', { class: 'cs-expr', dir: 'ltr', tabindex: '-1' });
  const resEl = h('div', { class: 'cs-res', dir: 'ltr', 'aria-live': 'polite' });
  const angBtn = h('button', { class: 'cs-chip', type: 'button', onClick: () => openSettings() });
  const badge = (txt, cls) => h('span', { class: 'cs-st ' + cls, hidden: true }, txt);
  const shBadge = badge('S', 'sh'), alBadge = badge('A', 'al'), hypBadge = badge('hyp', 'hy'), ovrBadge = badge('INS', 'ov');
  const memBadge = h('span', { class: 'cs-mem', hidden: true }, 'M');
  const ib = (cls, label, fn, icon) => h('button', { class: 'cs-ib ' + cls, type: 'button', 'aria-label': label, onClick: fn, html: ic(icon) });
  const top = h('div', { class: 'cs-top' }, angBtn, shBadge, alBadge, hypBadge, ovrBadge, memBadge, h('span', { class: 'sp' }),
    ib('', t('calc_undo'), () => { if (ed.undo()) { fresh = false; edited(); } }, 'undo'),
    ib('hd-arr', '◀', () => move(-1), 'back'), ib('hd-arr', '▶', () => move(1), 'chev'),
    ib('', t('calc_copy'), () => copyResult(), 'copy'), ib('', t('calc_hist'), () => toggleHist(), 'history'), ib('', t('calc_set'), () => openSettings(), 'settings'));
  const offEl = h('button', { class: 'cz-off', type: 'button', hidden: true, 'aria-label': 'ON', onClick: () => wake() }, h('span', null, 'ON'));
  const disp = h('div', { class: 'cs-disp' }, top, exprEl, resEl, offEl);

  const paintMeta = () => {
    angBtn.textContent = ({ deg: 'DEG', rad: 'RAD', gra: 'GRA' })[cx.ang] + (cx.cmplx ? ' · CMPLX' : '');
    memBadge.hidden = !(cx.vars.M);
    shBadge.hidden = !shift; alBadge.hidden = !alpha; alBadge.textContent = alpha === 2 ? 'A·LOCK' : 'A';
    hypBadge.hidden = !hyp; ovrBadge.hidden = !ovr; ovrBadge.textContent = 'OVR';
    el.classList.toggle('is-shift', shift); el.classList.toggle('is-alpha', !!alpha); el.classList.toggle('ovr', ovr);
    el.querySelectorAll('.k-shift').forEach((b) => b.classList.toggle('on', shift));
    el.querySelectorAll('.k-alpha').forEach((b) => b.classList.toggle('on', !!alpha));
    el.querySelectorAll('.k-hyp').forEach((b) => b.classList.toggle('on', hyp));
  };

  function fit() {                                   // the biggest size that fits; scroll to the caret when nothing does
    const sizes = [38, 32, 27, 23, 20, 17];
    let ok = false;
    for (const s of sizes) { exprEl.style.fontSize = s + 'px'; if (exprEl.scrollWidth <= exprEl.clientWidth + 1 && exprEl.scrollHeight <= exprEl.clientHeight + 1) { ok = true; break; } }
    const caret = exprEl.querySelector('.caret');
    if (caret && !ok) {
      const x = caret.offsetLeft;
      if (x < exprEl.scrollLeft + 12) exprEl.scrollLeft = Math.max(0, x - 12);
      else if (x > exprEl.scrollLeft + exprEl.clientWidth - 24) exprEl.scrollLeft = x - exprEl.clientWidth + 24;
    } else exprEl.scrollLeft = 0;
  }
  const paintExpr = () => { exprEl.replaceChildren(drawSlot(ed.items, ed.cur, reg, 'sl rt')); fit(); };

  const descOf = (r) => describe(r.value, { ...setup, ang: cx.ang, cplx: setup.cplx }, { decimal: r.decimal, dir: r.dir, showExact: exactOver });
  const copyText = (r) => { const d = descOf(r); return typeof r.value === 'number' ? decimalText(r.value, { ...setup, sep: false }) : d.kind === 'num' ? itemsText(d.items) : ''; };
  const errMsg = (e) => { const c = e && e.code; return t('calc_err_' + (['math', 'syntax', 'arg', 'dim', 'cant', 'nosol', 'stack', 'time'].includes(c) ? c : 'math')); };

  function paintResult(final) {
    engK = null;
    if (!last) { resEl.replaceChildren(); resEl.className = 'cs-res'; return; }
    const d = descOf(last);
    resEl.className = 'cs-res' + (final ? ' final' : ' pv');
    const box = h('div', { class: 'cs-resin' }, drawDesc(d));
    resEl.replaceChildren(box);
    if (final) { box.classList.add('pop'); }
  }
  function preview() {                              // a quiet answer while typing (nothing for unfinished input)
    last = null;
    if (ed.isEmpty || ed.items.includes('→')) { resEl.replaceChildren(); resEl.className = 'cs-res'; return; }
    syncData();
    try {
      const probe = { ...cx, vars: { ...cx.vars }, mats: { ...cx.mats }, vcts: { ...cx.vcts } };
      last = evaluate(ed.items, probe);
      exactOver = null;
      paintResult(false);
    } catch { last = null; resEl.replaceChildren(); resEl.className = 'cs-res'; }
  }
  const edited = () => { hi = -1; paintExpr(); preview(); };
  const say = (node, cls = 'final') => { resEl.className = 'cs-res ' + cls; const box = h('div', { class: 'cs-resin pop' }, node); resEl.replaceChildren(box); };

  /* ---------- typing ---------- */
  function begin(continues) {                        // after "=" a digit starts over, an operator carries on from Ans
    if (!fresh) return;
    fresh = false;
    ed.clear();
    resEl.replaceChildren(); resEl.className = 'cs-res'; last = null;
    if (continues) ed.insert('Ans');
  }
  const over = () => { if (ovr) ed.delNext(); };
  function ins(item) {
    begin(OPK.has(item) || POSTK.has(item));
    if (OPK.has(item) || item === ',' || item === '=') ed.op(item); else { over(); ed.insert(item); }
    edited();
  }
  function tpl(kind) {
    begin(kind === 'pow');
    ed.insertTemplate(kind);
    edited();
  }
  function fnk(name) { begin(false); over(); ed.insert(name); edited(); }
  function powOf(items) { begin(false); items.forEach((x) => ed.insert(x)); ed.insertTemplate('pow'); edited(); }
  function move(d) { fresh = false; if (d < 0) ed.left(); else ed.right(); paintExpr(); }
  function del() { if (fresh) { fresh = false; } ed.backspace(); edited(); }
  function ac() { ed.clear(); fresh = false; last = null; exactOver = null; hi = -1; resEl.replaceChildren(); resEl.className = 'cs-res'; paintExpr(); }

  function equals() {
    if (ed.isEmpty || fresh) return;
    syncData();
    try {
      const r = evaluate(ed.items, cx);
      if (ed.items.includes('→')) {                   // …→MatA / →VctB: keep it for the Matrix and Vector panes
        const mm = {}, vv = {};
        for (const k of Object.keys(cx.mats)) mm[k] = matToStore(cx.mats[k]);
        for (const k of Object.keys(cx.vcts)) vv[k] = vecToStore(cx.vcts[k]);
        saveData({ mats: mm, vcts: vv });
      }
      last = r; exactOver = null; hi = -1;
      cx.preans = cx.ans;
      if (typeof r.value === 'number' || isC(r.value)) cx.ans = r.value; else if (isM(r.value)) cx.matAns = r.value; else if (isV(r.value)) cx.vctAns = r.value;
      paintResult(true);
      fresh = true;
      const d = descOf(r);
      saveCalc({ addHist: { e: JSON.parse(JSON.stringify(ed.items)), r: d.kind === 'num' ? d.items : null, t: copyText(r), at: Date.now() }, vars: cx.vars, ans: typeof cx.ans === 'number' ? cx.ans : null });
      paintMeta();
      if (histPanel.classList.contains('on')) paintHist();
    } catch (e) {
      last = null; fresh = false;
      resEl.className = 'cs-res err'; resEl.replaceChildren(h('div', { class: 'cs-resin' }, errMsg(e)));
      buzz();
    }
  }
  function swapExact() {
    if (!last) return;
    const d = descOf(last);
    if (!d.canToggle) { toast(t('calc_noSD')); return; }
    exactOver = !d.exact;
    paintResult(fresh);
  }
  async function copyResult() {
    if (!last) return;
    try { await navigator.clipboard.writeText(copyText(last)); toast(t('calc_copied')); } catch { toast(t('calc_copyFail')); }
  }
  function memory(sign) {                           // M+ / M−: adds what is on the screen (or the last answer) to M
    let v = null;
    try { v = last && typeof last.value === 'number' ? last.value : (!ed.isEmpty ? evaluate(ed.items, { ...cx, vars: { ...cx.vars } }).value : cx.ans); } catch { v = null; }
    if (typeof v !== 'number') { toast(t('calc_err_arg')); return; }
    cx.vars.M = (cx.vars.M || 0) + sign * v;
    saveCalc({ vars: cx.vars }); paintMeta();
    toast('M = ' + decimalText(cx.vars.M, { ...setup, sep: false }));
  }

  /* ---------- the arrow keys ---------- */
  function replay(dir) {                            // ▲ older · ▼ newer: the calculations made before, back into the editor
    const list = loadCalc().hist;
    const base = hi >= 0 ? hi : (fresh ? 0 : -1);
    const to = base + (dir > 0 ? 1 : -1);
    if (to >= list.length) { if (!list.length) toast(t('calc_histEmpty')); return; }
    fresh = false;
    if (to < 0) { ed.clear(); edited(); return; }
    ed.load(list[to].e); edited(); hi = to;
  }
  function dpad(dir) {
    if (dir === 'left') { fresh = false; if (shift) ed.home(); else ed.left(); paintExpr(); }
    else if (dir === 'right') { fresh = false; if (shift) ed.end(); else ed.right(); paintExpr(); }
    else {
      const d = dir === 'up' ? -1 : 1;
      if (ed.vert(d)) { fresh = false; paintExpr(); }
      else if (d < 0) { if (ed.isEmpty || fresh || hi >= 0) replay(1); else { ed.home(); paintExpr(); } }
      else if (hi >= 0) replay(-1); else if (!fresh) { ed.end(); paintExpr(); }
    }
    shift = false; paintMeta();
  }

  /* ---------- Casio actions ---------- */
  const fieldNum = (txt) => { const s = String(txt).trim(); if (!s) return 0; const r = evaluate(itemsFromText(s), { ...cx, vars: { ...cx.vars }, cmplx: false }); if (typeof r.value !== 'number') throw new Error('nan'); return r.value; };
  const choice = (title, rows, tall) => {            // a sheet of big buttons: rows = [[label, sub, handler]]
    const sheet = openSheet({ title, tall: !!tall });
    sheet.body.append(h('div', { class: 'cs-menu' }, rows.map(([l, s, fn, dis]) => h('button', { class: 'cs-mi', type: 'button', disabled: !!dis, onClick: () => { sheet.close(); fn(); } }, h('b', null, l), s ? h('small', null, s) : null))));
    return sheet;
  };
  const askValues = (title, fields, go, goLabel) => {   // CALC / SOLVE: a few named number fields, then a button
    const sheet = openSheet({ title });
    const inputs = fields.map(([name, def, label]) => {
      const inp = h('input', { class: 'ce-in cs-fld', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', dir: 'ltr', value: def });
      inp.addEventListener('focus', () => inp.select());
      return { name, inp, row: h('label', { class: 'cs-frow' }, h('b', null, label || name + ' ='), inp) };
    });
    const run = () => {
      const out = {};
      try { inputs.forEach((f) => { out[f.name] = fieldNum(f.inp.value); }); } catch { toast(t('calc_err_syntax')); return; }
      sheet.close(); go(out);
    };
    inputs.forEach((f, i) => f.inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (inputs[i + 1]) inputs[i + 1].inp.focus(); else run(); } }));
    sheet.body.append(...inputs.map((f) => f.row), h('button', { class: 'btn', type: 'button', onClick: run }, goLabel));
    setTimeout(() => inputs[0] && inputs[0].inp.focus(), 260);
  };
  function calcAsk() {                               // CALC: give the letters a value, then work the line out
    if (ed.isEmpty) return;
    fresh = false;
    const used = [...scanVars(ed.items)];
    if (!used.length) { equals(); return; }
    askValues(t('calc_calcT'), used.map((v) => [v, String(cx.vars[v] ?? 0)]), (o) => { Object.assign(cx.vars, o); saveCalc({ vars: cx.vars }); fresh = false; equals(); paintMeta(); }, t('calc_calcGo'));
  }
  function solveAsk() {                              // SHIFT CALC: find X so that the left side equals the right side
    if (ed.isEmpty) return;
    fresh = false;
    const fields = [['X', String(cx.vars.X ?? 0), t('calc_solveGuess')]];
    askValues(t('calc_solveT'), fields, (o) => {
      try {
        const r = solveItems(ed.items, cx, o.X);
        cx.vars.X = r.x; saveCalc({ vars: cx.vars });
        const x = decimalText(r.x, { ...setup, sep: false });
        say(h('div', { class: 'cs-solve' }, h('span', { class: 'o' }, 'X ='), h('span', null, x), h('small', null, 'L − R = ' + decimalText(r.res, { ...setup, sep: false }))));
        last = { value: r.x, decimal: true }; fresh = true;
      } catch (e) { resEl.className = 'cs-res err'; resEl.replaceChildren(h('div', { class: 'cs-resin' }, e && e.code === 'math' ? t('calc_solveNone') : errMsg(e))); }
      paintMeta();
    }, t('calc_solveGo'));
  }
  function varSheet(store) {                         // RCL: pick a letter to put into the line · STO: pick the letter to keep the answer in
    const rows = VARS.map((v) => [v, decimalText(cx.vars[v] ?? 0, { ...setup, sep: false }), () => {
      if (store) { begin(true); if (ed.isEmpty) ed.insert('Ans'); ed.insert('→'); ed.insert(v); edited(); equals(); toast(v + ' ← ' + decimalText(cx.vars[v] ?? 0, { ...setup, sep: false })); }
      else { begin(false); ed.insert(v); edited(); }
    }]);
    if (!store) rows.push(['Ans', decimalText(cx.ans, { ...setup, sep: false }), () => { begin(false); ed.insert('Ans'); edited(); }]);
    choice(store ? t('calc_sto') : t('calc_rcl'), rows);
  }
  function engineer(step) {                          // ENG moves the exponent up by 3 · SHIFT ENG (←) moves it down
    if (!last || typeof last.value !== 'number') { toast(t('calc_err_arg')); return; }
    const v = last.value;
    if (v === 0) return;
    engK = engK == null ? 0 : engK + step;
    const E = Math.floor(Math.log10(Math.abs(v)) / 3) * 3 + engK * 3;
    const m = parseFloat((v / 10 ** E).toPrecision(10));
    say(h('span', { class: 'cx res', dir: 'ltr' }, h('span', null, String(m)), h('span', { class: 'o' }, '×10'), h('sup', null, String(E))), resEl.classList.contains('pv') ? 'pv' : 'final');
  }
  function dmsKey() {                                // ° ′ ″ : the first press types °, the next ′, the third ″
    begin(false);
    const { arr, i } = ed.cur;
    let seen = '';
    for (let j = i - 1; j >= 0; j--) { const it = arr[j]; if (it === '°' || it === '′' || it === '″') seen += it; else if (!(typeof it === 'string' && /^[0-9.]$/.test(it))) break; }
    ins(!seen ? '°' : !seen.includes('′') ? '′' : '″');
  }
  function clrMenu() {
    choice(t('calc_clrT'), [
      ['1', t('calc_clrSetup'), () => { setup = { ...DEFAULT_SETUP }; cx.ang = 'deg'; cx.cmplx = false; saveCalc({ setup, cmplx: false }); paintMeta(); if (last) preview(); toast(t('calc_cleared')); }],
      ['2', t('calc_clrMem'), () => { cx.vars = {}; cx.ans = 0; cx.preans = 0; saveCalc({ vars: {}, ans: null }); paintMeta(); toast(t('calc_cleared')); }],
      ['3', t('calc_clrAll'), () => { setup = { ...DEFAULT_SETUP }; cx.vars = {}; cx.ans = 0; cx.preans = 0; cx.ang = 'deg'; cx.cmplx = false; saveCalc({ setup, vars: {}, ans: null, cmplx: false, clearHist: true }); ac(); paintMeta(); toast(t('calc_cleared')); }],
    ]);
  }
  function modeMenu() {
    const has = (id) => (host.has ? host.has(id) : id === 'sci' || id === 'base' || id === 'eq');
    choice(t('calc_modeT'), MODES.map(([id, tab, key], i) => [String(i + 1), t(key) + (tab && !has(tab) ? ' · ' + t('calc_soon') : ''), () => {
      if (id === 'cmplx') { cx.cmplx = !cx.cmplx; saveCalc({ cmplx: cx.cmplx }); paintMeta(); toast('CMPLX ' + (cx.cmplx ? t('on') : t('off'))); }
      else if (tab && host.go) host.go(tab);
    }, !!tab && !has(tab)]));
  }
  function drgMenu() { choice(t('calc_drgT'), [['°', 'DEG', () => ins('°')], ['ʳ', 'RAD', () => ins('ʳ')], ['ᵍ', 'GRA', () => ins('ᵍ')]]); }
  function cmplxMenu() {
    const need = () => { if (!cx.cmplx) { cx.cmplx = true; saveCalc({ cmplx: true }); paintMeta(); } };
    choice(t('calc_cmplxT'), [['i', t('calc_cmplxI'), () => { need(); ins('i'); }], ['Arg', '', () => { need(); fnk('Arg('); }], ['Conjg', '', () => { need(); fnk('Conjg('); }], ['ReP', '', () => { need(); fnk('ReP('); }], ['ImP', '', () => { need(); fnk('ImP('); }], ['▶r∠θ', '', () => { need(); fnk('toPolar('); }], ['▶a+bi', '', () => { need(); fnk('toRect('); }]]);
  }
  function goTab(id) { if (host.go && host.has && host.has(id)) host.go(id); else toast(t('calc_soon')); }
  function sleep() { off = true; offEl.hidden = false; requestAnimationFrame(() => offEl.classList.add('in')); }
  function wake() { off = false; offEl.classList.remove('in'); setTimeout(() => { if (!off) offEl.hidden = true; }, 220); }

  function action(name) {
    switch (name) {
      case 'del': return del();
      case 'ac': return ac();
      case 'eq': return equals();
      case 'sd': return swapExact();
      case 'pow': return tpl('pow');
      case 'mplus': return memory(1);
      case 'mminus': return memory(-1);
      case 'mclear': cx.vars.M = 0; saveCalc({ vars: cx.vars }); paintMeta(); return toast(t('calc_mcleared'));
      case 'consts': return openConsts();
      case 'convs': return openConvs();
      case 'sto': return varSheet(true);
      case 'rcl': return varSheet(false);
      case 'calc': return calcAsk();
      case 'solve': return solveAsk();
      case 'mode': return modeMenu();
      case 'setup': return openSettings();
      case 'on': if (off) return wake(); return ac();
      case 'off': return sleep();
      case 'dms': return dmsKey();
      case 'eng': return engineer(1);
      case 'engl': return engineer(-1);
      case 'abc': setup.frac = setup.frac === 'improper' ? 'mixed' : 'improper'; saveCalc({ setup }); if (last) paintResult(fresh); return toast(t(setup.frac === 'improper' ? 'calc_fracImp' : 'calc_fracMixed'));
      case 'clr': return clrMenu();
      case 'ins': ovr = !ovr; paintMeta(); return toast(ovr ? t('calc_ovr') : t('calc_insM'));
      case 'matrix': return goTab('mat');
      case 'vector': return goTab('vec');
      case 'stat': return goTab('stat');
      case 'base': return goTab('base');
      case 'cmplx': return cmplxMenu();
      case 'drg': return drgMenu();
      default:
    }
  }
  function act(a) {
    if (a.k === 'i') ins(a.v);
    else if (a.k === 'f') fnk(a.v);
    else if (a.k === 't') tpl(a.v);
    else if (a.k === 'p') powOf(a.v);
    else if (a.k === 'a') action(a.v);
  }
  /** one press of a Casio key: SHIFT / ALPHA / hyp decide which of its three jobs runs, then they let go (ALPHA stays when locked) */
  function runCz(d) {
    if (off && !(d.p && d.p.v === 'on')) return;
    let a = d.p;
    if (shift && d.s) a = d.s; else if (alpha && d.a) a = d.a;
    if (a.k === 'a' && a.v === 'shift') { shift = !shift; if (shift && alpha !== 2) alpha = 0; paintMeta(); return; }
    if (a.k === 'a' && a.v === 'alpha') { if (shift) { shift = false; alpha = 2; } else alpha = alpha ? 0 : 1; paintMeta(); return; }
    if (a.k === 'a' && a.v === 'hyp') { hyp = !hyp; shift = false; paintMeta(); return; }
    if (hyp && a.k === 'f' && HYP[a.v]) a = { k: 'f', v: HYP[a.v] };
    shift = false; if (alpha === 1) alpha = 0; hyp = false;
    paintMeta();
    act(a);
    paintMeta();
  }
  function run(def) {
    buzz();
    if (prefs.snd) sfx('move');
    if (def.dp) return dpad(def.dp);
    if (def.id) return runCz(def);
    act(def);
  }

  /* ---------- tap on the line moves the caret ---------- */
  exprEl.addEventListener('pointerdown', (e) => {
    let n = e.target;
    while (n && n !== exprEl && !reg.has(n)) n = n.parentElement;
    const r = n && reg.get(n);
    if (!r) { ed.end(); fresh = false; paintExpr(); return; }
    fresh = false;
    if (r.slot) ed.place(r.arr, r.arr.length);
    else { const b = n.getBoundingClientRect(); ed.place(r.arr, e.clientX < b.left + b.width / 2 ? r.i : r.i + 1); }
    paintExpr();
  });

  /* ---------- keys ---------- */
  const mk = (def) => {                              // my own layout
    const b = h('button', { class: 'ck ' + (def.c || ''), type: 'button' });
    if (def.h) b.innerHTML = def.h; else b.textContent = def.l;
    if (def.k === 'a' && def.v === 'consts') b.append(h('span', { html: ic('atom') }), h('span', null, t('calc_const')));
    if (def.k === 'a' && def.v === 'convs') b.append(h('span', { html: ic('swap') }), h('span', null, t('calc_conv')));
    if (def.k === 'a' && def.v === 'del') b.innerHTML = ic('backspace');
    b.__def = def;
    return b;
  };
  const mkc = (d) => {                               // a Casio key: SHIFT label (yellow) and ALPHA label (red) above the main label
    const b = h('button', { class: 'ck cz k-' + d.id + ' ' + d.c, type: 'button', dataset: { k: d.id } });
    const lab = h('span', { class: 'kp' });
    if (d.id === 'del') lab.innerHTML = ic('backspace'); else lab.innerHTML = d.h;
    b.append(h('span', { class: 'kt' }, d.sl ? h('i', { class: 'ks', html: d.sl }) : null, d.al ? h('i', { class: 'ka', html: d.al }) : null), lab);
    b.__def = d;
    return b;
  };
  const dpKey = (dir) => {
    const b = h('button', { class: 'ck dpk ' + dir, type: 'button', 'aria-label': { up: '▲', down: '▼', left: '◀', right: '▶' }[dir], html: arrow(ARROWS[dir]) });
    b.__def = { dp: dir };
    return b;
  };
  const stripEl = () => h('div', { class: 'cs-dp', dir: 'ltr' }, ['left', 'up', 'down', 'right'].map(dpKey));

  function bindKeys(root) {                          // pointer-down presses (no 300 ms wait), DEL and the arrows repeat while held
    let rep = 0, repT = 0;
    const stop = () => { clearTimeout(repT); clearInterval(rep); };
    root.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.ck'); if (!b || b.disabled || e.button) return;
      e.preventDefault();
      b.classList.add('pr');
      const d = b.__def;
      run(d);
      if (d.dp || d.id === 'del' || (d.k === 'a' && d.v === 'del')) { stop(); repT = setTimeout(() => { rep = setInterval(() => run(d), d.dp ? 90 : 62); }, 420); }
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => root.addEventListener(ev, () => { stop(); root.querySelectorAll('.pr').forEach((x) => x.classList.remove('pr')); }));
    root.addEventListener('click', (e) => { if (e.detail === 0) { const b = e.target.closest('.ck'); if (b && !b.disabled) run(b.__def); } });   // keyboard / screen reader
    attachKeyFx(root);
  }

  /* my layout: the pager of function keys + the number pad */
  const pad = h('div', { class: 'cs-pad', dir: 'ltr' }, PAD.map(mk));
  bindKeys(pad);
  const pageTabs = PAGES.map((p, i) => h('button', { class: 'cs-pg' + (i === page ? ' on' : ''), type: 'button', onClick: () => setPage(i) }, t('calc_pg_' + p.id)));
  const fnPad = h('div', { class: 'cs-fnpad', dir: 'ltr' });
  const fnWrap = h('div', { class: 'cs-fn' }, h('div', { class: 'cs-pages', role: 'tablist' }, pageTabs), fnPad);
  function setPage(i) {
    page = (i + PAGES.length) % PAGES.length;
    pageTabs.forEach((b, k) => { b.classList.toggle('on', k === page); b.setAttribute('aria-selected', String(k === page)); });
    fnPad.replaceChildren(...PAGES[page].keys.map(mk));
  }
  fnPad.addEventListener('click', (e) => { const b = e.target.closest('.ck'); if (b) { buzz(); run(b.__def); } });
  attachKeyFx(fnPad);
  let sx = 0; let sy = 0;
  fnPad.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
  fnPad.addEventListener('pointerup', (e) => { const dx = e.clientX - sx; if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(e.clientY - sy) * 1.6) { setPage(page + (dx < 0 ? 1 : -1)); } });
  setPage(0);

  /* the Casio layout */
  function casioKeys() {
    const cross = h('div', { class: 'cz-cross', dir: 'ltr' }, ['up', 'left', 'right', 'down'].map(dpKey), h('i', { class: 'cz-hub', 'aria-hidden': 'true' }));
    const topKeys = CZ_TOP.map(mkc);
    const topEl = h('div', { class: 'cz-top', dir: 'ltr' }, topKeys.slice(0, 2), cross, topKeys.slice(2));
    const midEl = h('div', { class: 'cz-mid', dir: 'ltr' }, CZ_MID.map(mkc));
    const numEl = h('div', { class: 'cz-num', dir: 'ltr' }, CZ_NUM.map(mkc));
    const keys = h('div', { class: 'cz-keys' }, stripEl(), topEl, midEl, numEl);
    bindKeys(keys);
    return keys;
  }
  function build() {
    prefs = loadPrefs();
    const casio = prefs.layout === 'casio';
    el.dataset.layout = prefs.layout; el.dataset.dpad = prefs.dpad;
    el.classList.toggle('cz', casio); el.classList.toggle('ow', !casio);
    el.replaceChildren(disp, histPanel, ...(casio ? [casioKeys()] : [stripBound(), fnWrap, pad]));
    paintMeta();
    requestAnimationFrame(() => fit());
  }
  let stripOwn = null;
  const stripBound = () => { if (!stripOwn) { stripOwn = stripEl(); bindKeys(stripOwn); } return stripOwn; };

  /* ---------- history ---------- */
  const histList = h('div', { class: 'ch-list' });
  const histPanel = h('div', { class: 'cs-hist' }, h('div', { class: 'ch-head' }, h('b', null, t('calc_hist')),
    h('button', { class: 'cs-chip', type: 'button', onClick: () => { saveCalc({ clearHist: true }); paintHist(); } }, t('calc_clearHist')),
    h('button', { class: 'cs-ib', type: 'button', 'aria-label': t('close'), onClick: () => toggleHist(false), html: ic('close') })), histList);
  function paintHist() {
    const list = loadCalc().hist;
    if (!list.length) { histList.replaceChildren(h('p', { class: 'ch-empty' }, t('calc_histEmpty'))); return; }
    histList.replaceChildren(...list.map((it) => h('div', { class: 'ch-row' },
      h('button', { class: 'ch-e', type: 'button', dir: 'ltr', onClick: () => { ed.load(it.e); fresh = false; toggleHist(false); edited(); } }, drawItems(it.e)),
      h('button', { class: 'ch-r', type: 'button', dir: 'ltr', onClick: () => { if (it.t) { begin(false); String(it.t).split('').forEach((ch) => ed.insert(ch === '-' ? '-' : ch)); edited(); toggleHist(false); } } },
        h('span', { class: 'o' }, '='), it.r ? drawItems(it.r) : h('span', null, it.t || '')))));
  }
  function toggleHist(on) {
    const open = on == null ? !histPanel.classList.contains('on') : on;
    if (open) paintHist();
    histPanel.classList.toggle('on', open);
  }

  /* ---------- settings, constants, conversions ---------- */
  function openSettings() {
    const sheet = openSheet({ title: t('calc_set'), tall: true });
    const seg = (cur, opts, onPick) => { const w = h('div', { class: 'cs-seg', role: 'radiogroup' }); const paint = (v) => [...w.children].forEach((b) => b.classList.toggle('on', b.dataset.v === String(v))); opts.forEach(([v, l]) => w.append(h('button', { type: 'button', dataset: { v: String(v) }, onClick: () => { onPick(v); paint(v); } }, l))); paint(cur); return w; };
    const row = (title, ctl) => h('div', { class: 'cs-srow' }, h('span', null, title), ctl);
    const apply = () => { saveCalc({ setup, cmplx: cx.cmplx }); paintMeta(); if (last) { try { const keep = fresh; if (!keep) preview(); else paintResult(true); } catch { /* ignore */ } } };
    const ui = (patch) => { savePrefs(patch); };

    const { themes, colours } = themeControls(ui);
    const look = Object.fromEntries(lookFields().map((f) => [f.id, f]));
    const lookSeg = (id, after) => { const f = look[id]; return seg(f.get(prefs), f.options, (v) => { ui({ [id]: f.put ? f.put(v) : v }); if (after) after(); }); };
    // the maths options: a change goes to the live calculator state (angle, complex) or to its setup, then the screen repaints
    const read = () => ({ ang: cx.ang, cmplx: cx.cmplx, setup });
    const write = (p) => { if ('ang' in p) { cx.ang = p.ang; setup.ang = p.ang; } if ('cmplx' in p) cx.cmplx = p.cmplx; if (p.setup) Object.assign(setup, p.setup); apply(); };

    sheet.body.append(
      row(look.layout.label, lookSeg('layout', build)),
      row(look.dpad.label, lookSeg('dpad', build)),
      row(t('calc_look'), themes), row(t('calc_colours'), colours),
      row(look.flash.label, lookSeg('flash')), row(look.vib.label, lookSeg('vib')), row(look.snd.label, lookSeg('snd')),
      h('hr', { class: 'cs-hr' }),
      ...mathFields(read, write).map((f) => row(f.label, seg(f.value(), f.options, f.set))));
  }
  function openConsts() {
    const sheet = openSheet({ title: t('calc_const'), tall: true });
    const ar = lang() === 'ar';
    const q = h('input', { class: 'cs-find', type: 'search', placeholder: t('search'), dir: 'auto' });
    const list = h('div', { class: 'cs-clist' });
    const paint = () => {
      const s = q.value.trim().toLowerCase();
      list.replaceChildren(...CONSTS.map((c, i) => ({ c, i })).filter(({ c }) => !s || c.sym.toLowerCase().includes(s) || c.name.en.toLowerCase().includes(s) || c.name.ar.includes(s))
        .map(({ c, i }) => h('button', { class: 'cs-crow', type: 'button', onClick: () => { sheet.close(); begin(false); ed.insert('c#' + i); edited(); } },
          h('b', { class: 'sym' }, c.sym), h('span', { class: 'nm' }, ar ? c.name.ar : c.name.en), h('span', { class: 'vl', dir: 'ltr' }, decimalText(c.v, { ...setup, sep: false }) + (c.unit ? ' ' + c.unit : '')))));
    };
    q.addEventListener('input', paint);
    sheet.body.append(q, list); paint();
  }
  function openConvs() {
    const sheet = openSheet({ title: t('calc_conv'), tall: true });
    const ar = lang() === 'ar';
    const list = h('div', { class: 'cs-clist' });
    CONVS.forEach((c) => list.append(h('button', { class: 'cs-crow', type: 'button', onClick: () => { sheet.close(); begin(false); ed.insert('cv#' + c.n + '('); edited(); } }, h('span', { class: 'nm' }, ar ? c.name.ar : c.name.en))));
    sheet.body.append(h('p', { class: 'note' }, t('calc_convHint')), list);
  }

  /* ---------- desktop keyboard ---------- */
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key;
    if (off) { if (k === 'Enter' || k === ' ') { wake(); e.preventDefault(); return true; } return false; }
    if (/^[0-9]$/.test(k)) ins(k);
    else if (k === '.' || k === ',') ins('.');
    else if (k === '+') ins('+');
    else if (k === '-') ins('-');
    else if (k === '*' || k === 'x' || k === 'X') ins('×');
    else if (k === '/') ins('÷');
    else if (k === '(' || k === ')') ins(k);
    else if (k === '^') tpl('pow');
    else if (k === '!') ins('!');
    else if (k === '%') ins('%');
    else if (k === 'Enter' || k === '=') equals();
    else if (k === 'Backspace') del();
    else if (k === 'Escape') { if (histPanel.classList.contains('on')) toggleHist(false); else ac(); }
    else if (k === 'ArrowLeft') dpad('left');
    else if (k === 'ArrowRight') dpad('right');
    else if (k === 'ArrowUp') dpad('up');
    else if (k === 'ArrowDown') dpad('down');
    else if (k === 'p' || k === 'P') ins('π');
    else return false;
    e.preventDefault();
    return true;
  }

  const el = h('div', { class: 'cs' });
  const onUi = () => { if (!el.isConnected) { window.removeEventListener('ahos-calc-ui', onUi); return; } const p = loadPrefs(); if (p.layout !== prefs.layout || p.dpad !== prefs.dpad) build(); else prefs = p; };
  window.addEventListener('ahos-calc-ui', onUi);
  build(); paintExpr();
  const press = (id) => { const d = ALL_CZ.find((x) => x.id === id); if (d) runCz(d); };
  return {
    el, onKey, focus: () => { try { exprEl.focus({ preventScroll: true }); } catch { /* ignore */ } }, refit: () => { fit(); },
    api: { ed, run, equals, ac, get last() { return last; }, cx, ins, tpl, press, dpad, get state() { return { shift, alpha, hyp, ovr, hi, off }; } },
  };
}
