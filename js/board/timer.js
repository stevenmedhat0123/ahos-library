// A timer that floats over the board: a countdown (presets or any minutes/seconds) or a stopwatch.
// It is optional: nothing shows until it is opened from the More menu. When a countdown ends it beeps (Web Audio), vibrates and flashes.
// Time is measured against the clock (not by counting ticks), so it stays right even if the page is throttled.
import { h } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { toast } from '../ui.js';

const KEY = 'ahos.board.timer';
const PRESETS = [1, 3, 5, 10, 15, 30, 45, 60];
const two = (n) => String(n).padStart(2, '0');
export const fmtTime = (sec) => { sec = Math.max(0, Math.round(sec)); const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60; return (hh ? hh + ':' : '') + two(mm) + ':' + two(ss); };

function load() {
  try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); return { mode: o.mode === 'watch' ? 'watch' : 'down', total: Math.max(1, Math.min(359999, o.total | 0 || 300)), sound: o.sound !== false }; } catch { return { mode: 'down', total: 300, sound: true }; }
}

/** Three short beeps. Returns false when the browser has no Web Audio. */
export function beep(ctx) {
  if (!ctx) return false;
  try {
    const t0 = ctx.currentTime + 0.02;
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), s = t0 + i * 0.32;
      o.type = 'sine'; o.frequency.value = i === 2 ? 1175 : 880;
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.5, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.24);
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.26);
    }
    return true;
  } catch { return false; }
}

/** host = the board's root element. Returns { open(), close(), el, running }. */
export function createBoardTimer({ host }) {
  const st = { ...load(), run: false, left: 0, endAt: 0, base: 0, startedAt: 0, shown: false, setup: false, done: false };
  st.left = st.total;
  let ctx = null, tick = 0, drag = null;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ mode: st.mode, total: st.total, sound: st.sound })); } catch { /* storage blocked */ } };
  const audio = () => { try { ctx ||= new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch { ctx = null; } };

  const face = h('button', { class: 'tm-face', type: 'button', 'aria-label': t('tm_title') });
  const go = h('button', { class: 'tm-go', type: 'button' });
  const rst = h('button', { class: 'tm-b', type: 'button', 'aria-label': t('tm_reset'), title: t('tm_reset'), html: ic('tmReset') });
  const x = h('button', { class: 'tm-b', type: 'button', 'aria-label': t('tm_close'), title: t('tm_close'), html: ic('close') });
  const bar = h('div', { class: 'tm-bar' }, face, go, rst, x);
  const panel = h('div', { class: 'tm-panel' });
  const el = h('div', { class: 'bd-timer', dir: 'ltr', hidden: true }, bar, panel);
  host.append(el);

  const now = () => performance.now();
  const remaining = () => (st.mode === 'down' ? Math.max(0, (st.endAt - now()) / 1000) : (st.base + (st.run ? (now() - st.startedAt) / 1000 : 0)));

  function paint() {
    const v = st.run ? remaining() : st.mode === 'down' ? st.left : st.base;
    face.textContent = fmtTime(st.mode === 'down' ? Math.ceil(v - 0.001) : Math.floor(v));
    go.replaceChildren(h('span', { html: ic(st.run ? 'pause' : 'play') }));
    go.setAttribute('aria-label', st.run ? t('tm_pause') : t('tm_start'));
    el.classList.toggle('run', st.run); el.classList.toggle('done', st.done); el.classList.toggle('low', st.mode === 'down' && st.run && v <= 10);
  }
  function loop() {
    clearInterval(tick);
    if (!st.run) return;
    tick = setInterval(() => {
      if (st.mode === 'down' && remaining() <= 0) { finish(); return; }
      paint();
    }, 200);
  }
  function finish() {
    clearInterval(tick); st.run = false; st.left = 0; st.done = true; paint();
    if (st.sound) { beep(ctx); try { navigator.vibrate?.([300, 120, 300, 120, 500]); } catch { /* no vibration */ } }
    toast(t('tm_done'));
  }
  function start() {
    audio();
    st.done = false;
    if (st.mode === 'down') { if (st.left <= 0) st.left = st.total; st.endAt = now() + st.left * 1000; }
    else st.startedAt = now();
    st.run = true; st.setup = false; drawPanel(); paint(); loop();
  }
  function pause() {
    if (st.mode === 'down') st.left = Math.max(0, (st.endAt - now()) / 1000); else st.base += (now() - st.startedAt) / 1000;
    st.run = false; clearInterval(tick); paint();
  }
  function reset() { clearInterval(tick); st.run = false; st.done = false; st.left = st.total; st.base = 0; paint(); drawPanel(); }
  function setTotal(sec) { st.total = Math.max(1, Math.min(359999, Math.round(sec))); st.left = st.total; st.done = false; save(); paint(); drawPanel(); }

  function drawPanel() {
    panel.hidden = !st.setup;
    if (!st.setup) { panel.replaceChildren(); return; }
    const seg = h('div', { class: 'tm-seg' }, [['down', t('tm_countdown')], ['watch', t('tm_stopwatch')]].map(([m, label]) => h('button', { type: 'button', class: st.mode === m ? 'on' : '', onClick: () => { if (st.run) pause(); st.mode = m; st.done = false; st.base = 0; st.left = st.total; save(); paint(); drawPanel(); } }, label)));
    const kids = [seg];
    if (st.mode === 'down') {
      const mm = h('input', { class: 'tm-num', type: 'number', inputmode: 'numeric', min: 0, max: 5999, value: Math.floor(st.total / 60), 'aria-label': t('tm_min') });
      const ss = h('input', { class: 'tm-num', type: 'number', inputmode: 'numeric', min: 0, max: 59, value: st.total % 60, 'aria-label': t('tm_sec') });
      const apply = () => { const m = Math.max(0, Math.min(5999, parseInt(mm.value, 10) || 0)), s = Math.max(0, Math.min(59, parseInt(ss.value, 10) || 0)); if (m * 60 + s > 0) setTotalQuiet(m * 60 + s); };
      mm.addEventListener('change', apply); ss.addEventListener('change', apply);
      kids.push(h('div', { class: 'tm-presets' }, PRESETS.map((m) => h('button', { type: 'button', class: 'tm-chip' + (st.total === m * 60 ? ' on' : ''), onClick: () => setTotal(m * 60) }, `${m} ${t('tm_min')}`))),
        h('div', { class: 'tm-custom' }, h('span', null, t('tm_custom')), mm, h('b', null, ':'), ss));
    }
    kids.push(h('div', { class: 'tm-foot' },
      h('button', { type: 'button', class: 'tm-chip' + (st.sound ? ' on' : ''), onClick: () => { st.sound = !st.sound; save(); if (st.sound) { audio(); beep(ctx); } drawPanel(); } }, h('span', { html: ic('bell') }), t('tm_sound')),
      h('button', { type: 'button', class: 'tm-start', onClick: () => start() }, h('span', { html: ic('play') }), t('tm_start'))));
    panel.replaceChildren(...kids);
  }
  function setTotalQuiet(sec) { st.total = sec; st.left = sec; st.done = false; save(); paint(); }

  /* ----- drag the bar to move the timer ----- */
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') && e.target !== face) return;
    const r = el.getBoundingClientRect(), hr = host.getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false, hr, onFace: e.target === face };
    try { bar.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  bar.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    drag.moved = true;
    const w = el.offsetWidth, hh = el.offsetHeight;
    const left = Math.max(4, Math.min(drag.hr.width - w - 4, e.clientX - drag.hr.left - drag.dx));
    const top = Math.max(4, Math.min(drag.hr.height - hh - 4, e.clientY - drag.hr.top - drag.dy));
    el.style.left = left + 'px'; el.style.top = top + 'px'; el.style.insetInlineEnd = 'auto'; el.style.insetInlineStart = 'auto'; el.style.right = 'auto';
  });
  const endDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag; drag = null;
    try { bar.releasePointerCapture(d.id); } catch { /* ignore */ }
    if (!d.moved && e && d.onFace) { st.setup = !st.setup; drawPanel(); }          // a tap on the time opens / closes the settings
  };
  bar.addEventListener('pointerup', endDrag); bar.addEventListener('pointercancel', endDrag);
  go.addEventListener('click', () => (st.run ? pause() : start()));
  rst.addEventListener('click', reset);
  x.addEventListener('click', () => close());
  const onVis = () => { if (!document.hidden && st.run) { if (st.mode === 'down' && remaining() <= 0) finish(); else paint(); } };
  document.addEventListener('visibilitychange', onVis);

  function open() {
    if (!st.shown) { st.shown = true; el.hidden = false; st.setup = !st.run; reset(); st.setup = true; drawPanel(); }
    else { el.hidden = false; st.setup = !st.run; drawPanel(); }
    paint();
  }
  function close() { clearInterval(tick); st.run = false; st.shown = false; st.setup = false; el.hidden = true; }
  return {
    el, open, close,
    get running() { return st.run; },
    get shown() { return st.shown; },
    destroy() { clearInterval(tick); document.removeEventListener('visibilitychange', onVis); try { ctx?.close(); } catch { /* ignore */ } el.remove(); },
  };
}
