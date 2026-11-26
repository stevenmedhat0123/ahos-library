// AHOS Calc – the Matrix pane (MatA–MatC, up to 4 × 4) and the Vector pane (VctA–VctC, 2 or 3 components) – one file, two panes.
// Fill the grids, then write what to calculate (MatA×MatB, Det(MatA), MatA⁻¹, Dot(VctA,VctB), Angle(…) …) with the token keys or the preset
// chips; the answer is a matrix / vector / number and can be kept in MatA–C / VctA–C with one tap. The data is shared with the scientific
// screen, where MatA, VctB … can be used too.
import { h } from '../util.js';
import { t } from '../i18n.js';
import { toast } from '../ui.js';
import { sfx } from '../sound.js';
import { evaluate, makeCtx, itemsFromText } from './expr.js';
import { describe, DEFAULT_SETUP } from './fmt.js';
import { drawDesc } from './display.js';
import { isM, isV } from './core.js';
import { loadData, saveData, engineData, matToStore, vecToStore } from './data.js';
import { loadCalc } from './state.js';

const NAMES = ['A', 'B', 'C'];
const AR = '٠١٢٣٤٥٦٧٨٩';
const latin = (s) => String(s).replace(/[٠-٩]/g, (d) => String(AR.indexOf(d))).replace(/٫/g, '.').replace(/٬/g, '');

const TOKENS = {
  mat: ['MatA', 'MatB', 'MatC', 'MatAns', '+', '−', '×', '÷', 'Det(', 'Trn(', 'Ident(', '⁻¹', '²', '³', '(', ')'],
  vec: ['VctA', 'VctB', 'VctC', 'VctAns', '+', '−', '×', '÷', 'Dot(', 'Angle(', 'UnitV(', 'Abs(', '(', ')', ','],
};
const PRESETS = {
  mat: [['A+B', 'MatA+MatB'], ['A−B', 'MatA-MatB'], ['A×B', 'MatA×MatB'], ['det A', 'Det(MatA)'], ['A⁻¹', 'MatA⁻¹'], ['Aᵀ', 'Trn(MatA)'], ['A²', 'MatA²'], ['2A', '2×MatA'], ['I₃', 'Ident(3)']],
  vec: [['A+B', 'VctA+VctB'], ['A−B', 'VctA-VctB'], ['A×B', 'VctA×VctB'], ['A·B', 'Dot(VctA,VctB)'], ['∠(A,B)', 'Angle(VctA,VctB)'], ['|A|', 'Abs(VctA)'], ['Â', 'UnitV(VctA)'], ['2A', '2×VctA']],
};

export function mvPane(kind) {
  const isMat = kind === 'mat';
  const st = loadCalc();
  const setup = { ...DEFAULT_SETUP, ...st.setup };
  const cx = makeCtx({ ang: setup.ang, vars: { ...st.vars }, cmplx: false });
  const data = loadData();
  const grids = {};                                   // name → { r, c, t: [text…] }
  NAMES.forEach((n) => {
    const m = isMat ? data.mats[n] : data.vcts[n];
    const saved = (isMat ? data.mtext : data.vtext)[n];
    if (isMat) {
      const r = m ? m.r : 2, c = m ? m.c : 2;
      grids[n] = { r, c, t: saved && saved.length === r * c ? saved.slice() : (m ? m.a.map(String) : Array(r * c).fill('')) };
    } else {
      const k = m ? m.a.length : 3;
      grids[n] = { r: 1, c: k, t: saved && saved.length === k ? saved.slice() : (m ? m.a.map(String) : Array(k).fill('')) };
    }
  });
  let cur = 'A';
  let expr = isMat ? 'MatA×MatB' : 'VctA×VctB';
  let ans = null;

  const chips = h('div', { class: 'ce-types', role: 'tablist' }, NAMES.map((n) => h('button', { class: 'ce-chip', type: 'button', dataset: { id: n }, onClick: () => pick(n) }, (isMat ? 'Mat' : 'Vct') + n)));
  const dims = h('div', { class: 'mv-dims' });
  const grid = h('div', { class: 'mv-grid', dir: 'ltr' });
  const out = h('div', { class: 'mv-out', 'aria-live': 'polite' });
  const field = h('input', { class: 'ce-in cs-fld mv-expr', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done', dir: 'ltr', placeholder: isMat ? 'MatA×MatB' : 'VctA×VctB', 'aria-label': t('mv_expr') });
  field.value = expr;

  const num = (s) => { const v = latin(s).trim(); if (!v) return 0; if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(v)) return Number(v); const r = evaluate(itemsFromText(v.replace(/\*/g, '×').replace(/−/g, '-')), { ...cx, vars: { ...cx.vars } }); if (typeof r.value !== 'number') throw new Error('nan'); return r.value; };

  /** text grids → stored numbers (a grid with a bad cell keeps its old numbers) */
  function commit() {
    const d = loadData();
    const mats = { ...d.mats }, vcts = { ...d.vcts }, tx = { ...(isMat ? d.mtext : d.vtext) };
    NAMES.forEach((n) => {
      const g = grids[n];
      tx[n] = g.t.slice();
      try {
        const a = g.t.map(num);
        if (isMat) mats[n] = { r: g.r, c: g.c, a }; else vcts[n] = { a };
      } catch { /* leave the stored numbers */ }
    });
    saveData(isMat ? { mats, mtext: tx } : { vcts, vtext: tx });
  }

  function buildDims() {
    const g = grids[cur];
    dims.replaceChildren();
    const stepper = (label, get, set, min, max) => {
      const v = h('b', { class: 'mv-dv' }, String(get()));
      const bump = (d) => { const n = Math.max(min, Math.min(max, get() + d)); if (n === get()) return; set(n); sfx('tab'); buildDims(); buildGrid(); commit(); update(); };
      return h('div', { class: 'mv-step' }, h('span', null, label), h('button', { class: 'cs-ib', type: 'button', 'aria-label': '−', disabled: get() <= min, onClick: () => bump(-1) }, '−'), v, h('button', { class: 'cs-ib', type: 'button', 'aria-label': '+', disabled: get() >= max, onClick: () => bump(1) }, '+'));
    };
    const resize = (r, c) => {
      const old = grids[cur], nt = Array(r * c).fill('');
      for (let i = 0; i < Math.min(r, old.r); i++) for (let j = 0; j < Math.min(c, old.c); j++) nt[i * c + j] = old.t[i * old.c + j];
      grids[cur] = { r, c, t: nt };
    };
    if (isMat) dims.append(stepper(t('mv_rows'), () => grids[cur].r, (n) => resize(n, grids[cur].c), 1, 4), stepper(t('mv_cols'), () => grids[cur].c, (n) => resize(grids[cur].r, n), 1, 4));
    else dims.append(...[2, 3].map((k) => h('button', { class: 'ce-chip mv-dim' + (g.c === k ? ' on' : ''), type: 'button', onClick: () => { resize(1, k); buildDims(); buildGrid(); commit(); update(); } }, k === 2 ? '2D  (x, y)' : '3D  (x, y, z)')));
  }
  function buildGrid() {
    const g = grids[cur];
    grid.replaceChildren();
    grid.style.setProperty('--c', isMat ? g.c : 1);
    const cells = isMat ? g.r * g.c : g.c;
    for (let i = 0; i < cells; i++) {
      const lab = isMat ? 'abcd'[Math.floor(i / g.c)] + (i % g.c + 1) : 'xyz'[i];
      const el = h('input', { class: 'ce-in mv-in', type: 'text', inputmode: 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: i === cells - 1 ? 'done' : 'next', placeholder: '0', dir: 'ltr', 'aria-label': lab });
      el.value = g.t[i] || '';
      el.addEventListener('input', () => { g.t[i] = el.value; let bad = false; try { num(el.value); } catch { bad = true; } el.classList.toggle('bad', bad); commit(); update(); });
      el.addEventListener('focus', () => el.select());
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const all = [...grid.querySelectorAll('.mv-in')]; (all[all.indexOf(el) + 1] || el).focus(); } });
      grid.append(isMat ? el : h('label', { class: 'mv-vc' }, h('b', null, lab), el));
    }
  }

  function engineCtx() {
    const d = engineData();
    const c = { ...cx, vars: { ...cx.vars }, mats: d.mats, vcts: d.vcts, stat: d.stat };
    if (ans) { if (isM(ans)) c.matAns = ans; else if (isV(ans)) c.vctAns = ans; }
    return c;
  }
  const errText = (e) => t('calc_err_' + (e && ['math', 'syntax', 'arg', 'dim', 'cant', 'nosol'].includes(e.code) ? e.code : 'syntax'));

  function update() {
    out.replaceChildren();
    const s = expr.trim();
    if (!s) { out.append(h('p', { class: 'ce-hint' }, t('mv_hint'))); return; }
    let r;
    try { r = evaluate(itemsFromText(latin(s).replace(/\*/g, '×').replace(/−/g, '-')), engineCtx()); } catch (e) { out.append(h('p', { class: 'ce-bad' }, errText(e))); return; }
    const v = r.value;
    const d = describe(v, setup, {});
    out.append(h('div', { class: 'mv-res', dir: 'ltr' }, drawDesc(d)));
    if (isM(v) || isV(v)) {
      const fits = isM(v) ? v.r <= 4 && v.c <= 4 : v.a.length === 2 || v.a.length === 3;
      if (fits) out.append(h('div', { class: 'mv-keep' }, h('span', null, t('mv_keep')), ...NAMES.map((n) => h('button', { class: 'cs-chip', type: 'button', onClick: () => keep(n, v) }, '→ ' + (isMat ? 'Mat' : 'Vct') + n))));
      ans = v;
    }
  }
  function keep(n, v) {
    const d = loadData();
    if (isMat) { d.mats[n] = matToStore(v); d.mtext[n] = v.a.map((x) => String(parseFloat(x.toPrecision(12)))); grids[n] = { r: v.r, c: v.c, t: d.mtext[n].slice() }; saveData({ mats: d.mats, mtext: d.mtext }); }
    else { d.vcts[n] = vecToStore(v); d.vtext[n] = v.a.map((x) => String(parseFloat(x.toPrecision(12)))); grids[n] = { r: 1, c: v.a.length, t: d.vtext[n].slice() }; saveData({ vcts: d.vcts, vtext: d.vtext }); }
    sfx('tab'); toast(t('mv_kept', { n: (isMat ? 'Mat' : 'Vct') + n }));
    pick(n); update();
  }

  function pick(n) {
    cur = n;
    [...chips.children].forEach((c) => { const on = c.dataset.id === n; c.classList.toggle('on', on); c.setAttribute('aria-selected', String(on)); });
    buildDims(); buildGrid();
  }

  function insert(tok) {
    const el = field;
    const a = el.selectionStart == null ? el.value.length : el.selectionStart, b = el.selectionEnd == null ? a : el.selectionEnd;
    el.value = el.value.slice(0, a) + tok + el.value.slice(b);
    const p = a + tok.length; el.setSelectionRange(p, p);
    expr = el.value; update();
  }
  field.addEventListener('input', () => { expr = field.value; update(); });
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') field.blur(); });

  const tokens = h('div', { class: 'mv-toks', dir: 'ltr' }, TOKENS[kind].map((tk) => h('button', { class: 'mv-tok', type: 'button', onMousedown: (e) => e.preventDefault(), onClick: () => { sfx('tab'); insert(tk); } }, tk)),
    h('button', { class: 'mv-tok del', type: 'button', 'aria-label': t('delete'), onClick: () => { const a = field.selectionStart == null ? field.value.length : field.selectionStart; if (a > 0) { field.value = field.value.slice(0, a - 1) + field.value.slice(a); field.setSelectionRange(a - 1, a - 1); expr = field.value; update(); } } }, '⌫'));
  const presets = h('div', { class: 'mv-pre', dir: 'ltr' }, PRESETS[kind].map(([l, e]) => h('button', { class: 'ce-chip', type: 'button', onClick: () => { field.value = expr = e; sfx('tab'); update(); } }, l)));
  const clear = h('button', { class: 'cs-chip', type: 'button', onClick: () => { const g = grids[cur]; g.t = Array(g.t.length).fill(''); buildGrid(); commit(); update(); } }, t('calc_eq_clear'));

  const el = h('div', { class: 'ce mv' }, chips, h('div', { class: 'ce-form mv-form' }, dims, grid, h('div', { class: 'ce-tools' }, clear)),
    h('h4', { class: 'cv-h' }, t('mv_calc')), presets, field, tokens, out);
  pick('A');
  commit();                                                // first opening: the zero grids become real MatA–C / VctA–C
  update();
  return { el };
}
export const matPane = () => mvPane('mat');
export const vecPane = () => mvPane('vec');
