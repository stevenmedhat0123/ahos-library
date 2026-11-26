// AHOS Calc – the data the panes share: the matrices MatA–C, the vectors VctA–C and the STAT table. They live in one localStorage key so the
// Matrix / Vector / Statistics panes can fill them and the scientific screen can use them (MatA×MatB, Det(MatA), x̄, ŷ(5) …).
import { Mat, Vec } from './core.js';
import { computeStat, STAT_TYPES } from './stat.js';

const KEY = 'ahos.calc.data';
const NAMES = ['A', 'B', 'C'];
const num = (v) => typeof v === 'number' && Number.isFinite(v);

const fresh = () => ({ mats: {}, vcts: {}, stat: { type: 'sd', rows: [] }, mtext: {}, vtext: {} });

export function loadData() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    const d = fresh();
    if (!raw || typeof raw !== 'object') return d;
    for (const n of NAMES) {
      const m = raw.mats && raw.mats[n];
      if (m && Number.isInteger(m.r) && Number.isInteger(m.c) && m.r >= 1 && m.r <= 4 && m.c >= 1 && m.c <= 4 && Array.isArray(m.a) && m.a.length === m.r * m.c && m.a.every(num)) d.mats[n] = { r: m.r, c: m.c, a: m.a.slice() };
      const v = raw.vcts && raw.vcts[n];
      if (v && Array.isArray(v.a) && (v.a.length === 2 || v.a.length === 3) && v.a.every(num)) d.vcts[n] = { a: v.a.slice() };
    }
    if (raw.stat && STAT_TYPES.includes(raw.stat.type) && Array.isArray(raw.stat.rows)) {
      d.stat = { type: raw.stat.type, rows: raw.stat.rows.filter((r) => r && num(r.x)).slice(0, 80).map((r) => ({ x: r.x, ...(num(r.y) ? { y: r.y } : {}), ...(num(r.f) ? { f: r.f } : {}) })) };
    }
    for (const k of ['mtext', 'vtext']) if (raw[k] && typeof raw[k] === 'object') for (const n of NAMES) if (Array.isArray(raw[k][n])) d[k][n] = raw[k][n].map(String).slice(0, 16);
    return d;
  } catch { return fresh(); }
}

/** merge a patch ({mats, vcts, stat, mtext, vtext} – each replaces what it names) into what is stored now */
export function saveData(patch) {
  try {
    const cur = loadData();
    for (const k of Object.keys(patch)) cur[k] = patch[k];
    localStorage.setItem(KEY, JSON.stringify(cur));
    try { window.dispatchEvent(new CustomEvent('ahos-calc-data')); } catch { /* ignore */ }
    return cur;
  } catch { return null; }
}

/** the stored data as engine objects: { mats:{A:Mat}, vcts:{A:Vec}, stat } for makeCtx() */
export function engineData() {
  const d = loadData();
  const mats = {}, vcts = {};
  for (const n of Object.keys(d.mats)) mats[n] = new Mat(d.mats[n].r, d.mats[n].c, d.mats[n].a.slice());
  for (const n of Object.keys(d.vcts)) vcts[n] = new Vec(d.vcts[n].a.slice());
  let stat = null;
  if (d.stat.rows.length) { try { stat = computeStat(d.stat.type, d.stat.rows); } catch { stat = null; } }
  return { mats, vcts, stat };
}

/** engine Mat / Vec → what is stored */
export const matToStore = (m) => ({ r: m.r, c: m.c, a: m.a.slice() });
export const vecToStore = (v) => ({ a: v.a.slice() });
