// Soft interface sounds, made on the spot with Web Audio (no audio files): a small tick when you move between things, a gentle chime when
// you open something, a falling note when you go back. Quiet on purpose – think console menus, not alarms.
import { state } from './store.js';

let ac = null;
let master = null;
let lastMove = 0;
let primed = false;

const on = () => state.settings.sounds !== false;
const volume = () => { const v = Number(state.settings.soundVol); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.6; };

function ensure() {
  if (ac) return ac;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ac = new AC({ latencyHint: 'interactive' });
    master = ac.createGain();
    master.gain.value = 1;
    const comp = ac.createDynamicsCompressor();            // keeps a quick run of ticks from ever getting loud
    comp.threshold.value = -24; comp.ratio.value = 6;
    master.connect(comp); comp.connect(ac.destination);
  } catch { ac = null; }
  return ac;
}

/** Browsers only allow sound after a touch / key: wake the audio engine on the first one so the first menu sound is not lost. */
export function primeSound() {
  if (primed) return;
  primed = true;
  const wake = () => { const c = ensure(); if (c && c.state === 'suspended') c.resume().catch(() => {}); };
  addEventListener('pointerdown', wake, { once: true, capture: true, passive: true });
  addEventListener('keydown', wake, { once: true, capture: true, passive: true });
}

/** One soft note: sine body + a quiet triangle overtone, quick attack, exponential fade. */
function note(freq, at, dur, gain, { glideTo = 0, type = 'sine', over = 0.28 } = {}) {
  const t0 = ac.currentTime + at;
  const g = ac.createGain();
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.03);
  if (over) {
    const g2 = ac.createGain(); const o2 = ac.createOscillator();
    o2.type = 'triangle'; o2.frequency.setValueAtTime(freq * 2, t0);
    g2.gain.setValueAtTime(0.0001, t0);
    g2.gain.exponentialRampToValueAtTime(gain * over, t0 + 0.005);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.6);
    o2.connect(g2); g2.connect(master);
    o2.start(t0); o2.stop(t0 + dur);
  }
}

const SOUNDS = {
  move: (v) => note(1020, 0, 0.075, 0.05 * v, { glideTo: 760 }),
  tab: (v) => note(880, 0, 0.06, 0.04 * v, { glideTo: 700, over: 0.15 }),
  select: (v) => { note(660, 0, 0.16, 0.07 * v); note(990, 0.07, 0.24, 0.06 * v); },
  open: (v) => { note(440, 0, 0.2, 0.06 * v, { glideTo: 660 }); note(880, 0.09, 0.3, 0.05 * v); },
  back: (v) => { note(740, 0, 0.1, 0.055 * v); note(494, 0.07, 0.2, 0.05 * v); },
  on: (v) => { note(660, 0, 0.09, 0.05 * v); note(990, 0.06, 0.14, 0.05 * v); },
  off: (v) => { note(660, 0, 0.09, 0.05 * v); note(440, 0.06, 0.14, 0.05 * v); },
  intro: (v) => { note(330, 0, 0.5, 0.045 * v, { glideTo: 480 }); note(660, 0.1, 0.5, 0.04 * v); note(990, 0.22, 0.6, 0.035 * v, { over: 0.1 }); note(1320, 0.34, 0.5, 0.025 * v, { over: 0 }); },
  notify: (v) => { note(784, 0, 0.16, 0.08 * v); note(1046, 0.13, 0.2, 0.07 * v); note(1318, 0.27, 0.34, 0.06 * v); },
  error: (v) => { note(220, 0, 0.12, 0.07 * v, { type: 'triangle', over: 0 }); note(196, 0.11, 0.18, 0.06 * v, { type: 'triangle', over: 0 }); },
};

/** Plays a named menu sound ('move' | 'tab' | 'select' | 'open' | 'back' | 'on' | 'off' | 'intro' | 'notify' | 'error'). Never throws, never blocks. */
export function sfx(name) {
  if (!on() || !SOUNDS[name]) return;
  const v = volume();
  if (v <= 0) return;
  if (name === 'move' || name === 'tab') {              // a fast swipe over many tiles must not turn into a buzz
    const now = performance.now();
    if (now - lastMove < 70) return;
    lastMove = now;
  }
  try {
    const c = ensure();
    if (!c) return;
    if (c.state === 'suspended') { c.resume().catch(() => {}); if (c.state === 'suspended') return; }
    SOUNDS[name](v);
  } catch { /* sound is a nicety, never a failure */ }
}
