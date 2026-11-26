// AHOS Calc – what the calculator remembers between openings (and shares between the section and the Board's sheet): history, the memory
// variables A–F / X / Y / M, the angle unit, the number format and Ans. One localStorage key, read fresh before every write so two open
// instances never overwrite each other's history.
import { DEFAULT_SETUP } from './fmt.js';

const KEY = 'ahos.calc';
const MAXH = 80;

const fresh = () => ({ hist: [], vars: {}, ans: null, setup: { ...DEFAULT_SETUP }, cmplx: false });

export function loadCalc() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return fresh();
    const s = fresh();
    if (Array.isArray(raw.hist)) s.hist = raw.hist.filter((x) => x && Array.isArray(x.e)).slice(0, MAXH);
    if (raw.vars && typeof raw.vars === 'object') for (const k of Object.keys(raw.vars)) if (Number.isFinite(raw.vars[k])) s.vars[k] = raw.vars[k];
    if (raw.ans != null && Number.isFinite(raw.ans)) s.ans = raw.ans;
    if (raw.setup && typeof raw.setup === 'object') s.setup = { ...DEFAULT_SETUP, ...raw.setup };
    s.cmplx = !!raw.cmplx;
    return s;
  } catch { return fresh(); }
}

/** merge `patch` into what is stored now ({hist:[entry,…] are added to the front, the rest replaces}) */
export function saveCalc(patch) {
  try {
    const cur = loadCalc();
    if (patch.addHist) { cur.hist = [patch.addHist, ...cur.hist].slice(0, MAXH); }
    if (patch.clearHist) cur.hist = [];
    for (const k of ['vars', 'ans', 'setup', 'cmplx']) if (k in patch) cur[k] = patch[k];
    localStorage.setItem(KEY, JSON.stringify(cur));
    return cur;
  } catch { return null; }
}
