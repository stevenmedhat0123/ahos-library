// AHOS Calc – the Statistics pane (STAT mode): a table of x (and y, and a frequency), one-variable statistics, seven regression models, the
// estimates x̂ / ŷ and a little plot. The table is kept in the shared data (data.js) so the scientific screen can use x̄, σx, Σx², ŷ(…) too.
import { h } from '../util.js';
import { t } from '../i18n.js';
import { toast } from '../ui.js';
import { evaluate, makeCtx, itemsFromText } from './expr.js';
import { describe, DEFAULT_SETUP, decimalText } from './fmt.js';
import { drawDesc } from './display.js';
import { computeStat, STAT_TYPES, isPaired, regPredict, regInverse } from './stat.js';
import { loadData, saveData } from './data.js';
import { loadCalc } from './state.js';
import { fmtNum } from './units.js';

const LABEL = { sd: '1-VAR', lin: 'y = a + bx', quad: 'y = a + bx + cx²', log: 'y = a + b·ln x', exp: 'y = a·e^(bx)', ab: 'y = a·b^x', pow: 'y = a·x^b', inv: 'y = a + b/x' };
const ONE = ['n', 'x̄', 'Σx', 'Σx²', 'σx', 'sx', 'minX', 'maxX', 'Q1', 'Med', 'Q3'];
const TWO = ['ȳ', 'Σy', 'Σy²', 'Σxy', 'σy', 'sy', 'minY', 'maxY'];
const SHOW = { minX: 'min x', maxX: 'max x', minY: 'min y', maxY: 'max y' };
const MAXROWS = 80;
const AR = '٠١٢٣٤٥٦٧٨٩';
const latin = (s) => String(s).replace(/[٠-٩]/g, (d) => String(AR.indexOf(d))).replace(/٫/g, '.').replace(/٬/g, '');
const svgNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const e = document.createElementNS(svgNS, tag); for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]); return e; };

export function statPane() {
  const st = loadCalc();
  const setup = { ...DEFAULT_SETUP, ...st.setup };
  const cx = makeCtx({ ang: setup.ang, vars: { ...st.vars } });
  const stored = loadData().stat;
  let type = STAT_TYPES.includes(stored.type) ? stored.type : 'sd';
  let rows = stored.rows.map((r) => ({ x: String(r.x), y: r.y == null ? '' : String(r.y), f: r.f == null || r.f === 1 ? '' : String(r.f) }));
  const blank = () => ({ x: '', y: '', f: '' });
  const ensureTail = () => { while (rows.length < 3 || !isEmpty(rows[rows.length - 1]) && rows.length < MAXROWS) rows.push(blank()); };
  const isEmpty = (r) => !r.x.trim() && !r.y.trim() && !r.f.trim();

  const number = (txt) => {
    const s = latin(txt).trim();
    if (!s) return null;
    if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) return Number(s);
    const r = evaluate(itemsFromText(s.replace(/\*/g, '×')), { ...cx, vars: { ...cx.vars } });
    if (typeof r.value !== 'number') throw new Error('nan');
    return r.value;
  };

  const chips = h('div', { class: 'ce-types st-types', role: 'tablist' }, STAT_TYPES.map((id) => h('button', { class: 'ce-chip', type: 'button', dataset: { id }, onClick: () => pick(id) }, LABEL[id])));
  const table = h('div', { class: 'st-tab', dir: 'ltr' });
  const out = h('div', { class: 'st-out', 'aria-live': 'polite' });
  const plot = h('div', { class: 'st-plot' });
  const est = h('div', { class: 'st-est' });
  const clear = h('button', { class: 'cs-chip', type: 'button', onClick: () => { rows = []; ensureTail(); buildTable(); update(); } }, t('calc_eq_clear'));

  const cell = (r, key, ph) => {
    const el = h('input', { class: 'st-in', type: 'text', inputmode: 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'next', placeholder: ph, dir: 'ltr', 'aria-label': ph });
    el.value = r[key];
    el.addEventListener('input', () => { r[key] = el.value; const last = rows[rows.length - 1]; if (!isEmpty(last) && rows.length < MAXROWS) { rows.push(blank()); addRow(rows[rows.length - 1], rows.length - 1); } update(); });
    el.addEventListener('focus', () => el.select());
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const col = [...table.querySelectorAll('.st-in[data-k="' + key + '"]')], i = col.indexOf(el);
      (col[i + 1] || el).focus();
    });
    el.addEventListener('paste', (e) => {
      const txt = (e.clipboardData && e.clipboardData.getData('text')) || '';
      const lines = txt.split(/\r?\n/).filter((l) => l.trim());
      const toks = lines.map((l) => l.trim().split(/[\t;,]+|\s+/).filter(Boolean));
      if (!toks.length || (toks.length === 1 && toks[0].length < 2)) return;
      e.preventDefault();
      const cols = isPaired(type) ? ['x', 'y', 'f'] : ['x', 'f'];
      const row0 = rows.indexOf(r), col0 = cols.indexOf(key);
      if (toks.length === 1) toks[0].forEach((v, i) => { const rr = row0 + i; if (rr >= MAXROWS) return; while (rows.length <= rr) rows.push(blank()); rows[rr][key] = v; });
      else toks.forEach((line, i) => line.forEach((v, j) => { const rr = row0 + i, cc = cols[col0 + j]; if (!cc || rr >= MAXROWS) return; while (rows.length <= rr) rows.push(blank()); rows[rr][cc] = v; }));
      ensureTail(); buildTable(); update();
    });
    el.dataset.k = key;
    return el;
  };
  const paired = () => isPaired(type);
  function addRow(r, i) {
    const row = h('div', { class: 'st-row' + (paired() ? ' p' : '') },
      h('span', { class: 'st-n' }, String(i + 1)), cell(r, 'x', 'x'), paired() ? cell(r, 'y', 'y') : null, cell(r, 'f', 'f'),
      h('button', { class: 'st-x', type: 'button', 'aria-label': t('delete'), onClick: () => { rows.splice(rows.indexOf(r), 1); ensureTail(); buildTable(); update(); } }, '×'));
    table.append(row);
  }
  function buildTable() {
    table.replaceChildren(h('div', { class: 'st-row st-head' + (paired() ? ' p' : '') }, h('span', { class: 'st-n' }, '#'), h('b', null, 'x'), paired() ? h('b', null, 'y') : null, h('b', null, 'f'), h('span')));
    rows.forEach((r, i) => addRow(r, i));
  }

  function parsed() {
    const list = [];
    for (const r of rows) {
      if (isEmpty(r)) continue;
      const x = number(r.x);
      if (x == null) continue;
      const o = { x };
      if (paired()) { const y = number(r.y); if (y == null) continue; o.y = y; }
      const f = number(r.f);
      if (f != null) o.f = f;
      list.push(o);
    }
    return list;
  }

  const val = (v, label) => {
    const ok = typeof v === 'number' && Number.isFinite(v);
    let body;
    if (ok) body = drawDesc(describe(v, setup, { decimal: true })); else body = h('span', null, '—');
    return h('button', { class: 'st-card', type: 'button', dir: 'ltr', title: t('calc_copy'), onClick: async () => { if (!ok) return; try { await navigator.clipboard.writeText(decimalText(v, { ...setup, sep: false })); toast(t('calc_copied')); } catch { toast(t('calc_copyFail')); } } },
      h('b', { class: 'st-lab' }, SHOW[label] || label), h('span', { class: 'st-val' }, body));
  };
  const sg = (v) => (v < 0 ? ' − ' : ' + ') + fmtNum(Math.abs(v), false);
  function equation(reg) {
    const A = reg.A, B = reg.B, C = reg.C, n = (v) => fmtNum(v, false);
    switch (reg.type) {
      case 'lin': return 'y = ' + n(A) + sg(B) + 'x';
      case 'quad': return 'y = ' + n(A) + sg(B) + 'x' + sg(C) + 'x²';
      case 'log': return 'y = ' + n(A) + sg(B) + '·ln x';
      case 'exp': return 'y = ' + n(A) + '·e^(' + n(B) + 'x)';
      case 'ab': return 'y = ' + n(A) + '·' + n(B) + '^x';
      case 'pow': return 'y = ' + n(A) + '·x^' + n(B);
      case 'inv': return 'y = ' + n(A) + sg(B) + '/x';
    }
    return '';
  }

  function drawPlot(list, reg) {
    plot.replaceChildren();
    if (!paired() || !list.length) return;
    const xs = list.map((r) => r.x), ys = list.map((r) => r.y);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (x0 === x1) { x0 -= 1; x1 += 1; }
    const px = (x1 - x0) * 0.08; x0 -= px; x1 += px;
    const curve = [];
    if (reg) for (let i = 0; i <= 80; i++) { const x = x0 + ((x1 - x0) * i) / 80; try { const y = regPredict(reg, x); if (Number.isFinite(y)) curve.push([x, y]); } catch { /* outside the model's domain */ } }
    curve.forEach(([, y]) => { y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
    if (y0 === y1) { y0 -= 1; y1 += 1; }
    const py = (y1 - y0) * 0.1; y0 -= py; y1 += py;
    const W = 320, H = 170, L = 6, R = 6, T = 8, B = 16;
    const X = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R), Y = (y) => H - B - ((y - y0) / (y1 - y0)) * (H - T - B);
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'st-svg', role: 'img', 'aria-label': t('calc_st_plot') });
    svg.append(sv('rect', { x: L, y: T, width: W - L - R, height: H - T - B, class: 'st-frame' }));
    if (x0 < 0 && x1 > 0) svg.append(sv('line', { x1: X(0), x2: X(0), y1: T, y2: H - B, class: 'st-axis' }));
    if (y0 < 0 && y1 > 0) svg.append(sv('line', { x1: L, x2: W - R, y1: Y(0), y2: Y(0), class: 'st-axis' }));
    if (curve.length > 1) svg.append(sv('polyline', { points: curve.map(([x, y]) => X(x).toFixed(1) + ',' + Y(y).toFixed(1)).join(' '), class: 'st-curve' }));
    list.forEach((r) => svg.append(sv('circle', { cx: X(r.x).toFixed(1), cy: Y(r.y).toFixed(1), r: 3.2, class: 'st-dot' })));
    const lab = (txt, x, anchor) => { const e = sv('text', { x, y: H - 3, 'text-anchor': anchor, class: 'st-tick' }); e.textContent = txt; svg.append(e); };
    lab(fmtNum(Math.min(...xs), false), L + 2, 'start'); lab(fmtNum(Math.max(...xs), false), W - R - 2, 'end');
    plot.append(svg);
  }

  const E = { reg: null, runs: [] };                // the estimate rows keep what was typed; they only look at the current regression
  function buildEst() {
    est.replaceChildren(); E.runs = [];
    if (!paired()) return;
    const mk = (lab, resLab, fn) => {
      const input = h('input', { class: 'st-in est', type: 'text', inputmode: 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: lab, dir: 'ltr', 'aria-label': lab });
      const outEl = h('span', { class: 'st-eout', dir: 'ltr' }, '—');
      const run = () => {
        let v;
        try { v = number(input.value); } catch { v = undefined; }
        if (v == null || !E.reg) { outEl.textContent = '—'; return; }
        try { const r = fn(E.reg, v); outEl.textContent = Number.isFinite(r) ? fmtNum(r, false) : '—'; } catch { outEl.textContent = t('calc_eq_none'); }
      };
      input.addEventListener('input', run);
      input.addEventListener('focus', () => input.select());
      E.runs.push(run);
      return h('div', { class: 'st-erow' }, h('b', null, lab + ' ='), input, h('span', { class: 'st-arrow' }, '→'), h('b', null, resLab + ' ='), outEl);
    };
    est.append(h('h4', { class: 'cv-h' }, t('calc_st_est')), mk('x', 'ŷ', (reg, v) => regPredict(reg, v)), mk('y', 'x̂', (reg, v) => regInverse(reg, v)));
  }
  const showEst = (reg) => { E.reg = reg || null; est.hidden = !E.reg; E.runs.forEach((f) => f()); };

  function update() {
    let list = [], res = null, bad = false;
    try { list = parsed(); } catch { bad = true; }
    saveData({ stat: { type, rows: bad ? loadData().stat.rows : list } });
    out.replaceChildren();
    if (bad) { out.append(h('p', { class: 'ce-bad' }, t('calc_err_syntax'))); plot.replaceChildren(); showEst(null); return; }
    if (!list.length) { out.append(h('p', { class: 'ce-hint' }, t('calc_st_hint'))); plot.replaceChildren(); showEst(null); return; }
    try { res = computeStat(type, list); } catch (e) {
      out.append(h('p', { class: 'ce-bad' }, e && e.code === 'math' ? t('calc_st_none') : t('calc_err_' + (e && ['arg', 'syntax'].includes(e.code) ? e.code : 'math'))));
      plot.replaceChildren(); showEst(null); return;
    }
    const v = res.vars;
    if (res.reg) {
      const reg = res.reg;
      out.append(h('div', { class: 'st-eqn', dir: 'ltr' }, equation(reg)));
      const regRow = [['a', v.RegA], ['b', v.RegB]];
      if (reg.type === 'quad') regRow.push(['c', v.RegC]);
      if (v.r != null) regRow.push(['r', v.r]);
      out.append(h('div', { class: 'st-grid' }, regRow.map(([l, x]) => val(x, l))));
    }
    out.append(h('div', { class: 'st-grid' }, ONE.filter((k) => k in v).map((k) => val(v[k], k))));
    if (res.reg) out.append(h('div', { class: 'st-grid' }, TWO.filter((k) => k in v).map((k) => val(v[k], k))));
    drawPlot(list, res.reg);
    showEst(res.reg);
  }

  function pick(id) {
    type = id;
    [...chips.children].forEach((c) => { const on = c.dataset.id === id; c.classList.toggle('on', on); c.setAttribute('aria-selected', String(on)); });
    buildTable(); buildEst(); update();
  }

  ensureTail();
  const el = h('div', { class: 'ce st' }, chips, h('div', { class: 'st-box' }, table, h('div', { class: 'ce-tools' }, clear)), out, plot, est);
  pick(type);
  return { el };
}
