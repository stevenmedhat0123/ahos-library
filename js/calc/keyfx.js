// AHOS Calc – the key light. A pressed key brightens at once and then fades – smoothly, in a fraction of a second – until it is completely
// clear again. It is a plain translucent layer (no glow, no shadow, nothing left behind): the animation runs on the Web Animations API so every
// press restarts it cleanly, even when the keys are hit faster than the fade.

const DOWN = 55, UP = 360, HOLD = 70;          // ms: light up, fade out, shortest time the light stays on for a quick tap

function layer(b) {
  if (b.__fl) return b.__fl;
  const fl = document.createElement('i');
  fl.className = 'fl'; fl.setAttribute('aria-hidden', 'true');
  b.append(fl);
  b.__fl = fl;
  return fl;
}

function light(b) {
  const fl = layer(b);
  if (!fl.animate) return;
  clearTimeout(b.__ft);
  fl.getAnimations().forEach((a) => a.cancel());
  fl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DOWN, easing: 'ease-out', fill: 'forwards' });
  b.__t0 = performance.now();
}

function fade(b) {
  const fl = b.__fl;
  if (!fl || !fl.animate || b.__t0 == null) return;
  const wait = Math.max(0, HOLD - (performance.now() - b.__t0));
  b.__t0 = null;
  b.__ft = setTimeout(() => {
    const a = fl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: UP, easing: 'cubic-bezier(.25,.6,.3,1)', fill: 'forwards' });
    a.onfinish = () => fl.getAnimations().forEach((x) => x.cancel());       // back to the plain stylesheet value (0): nothing stays lit
  }, wait);
}

/** every .ck inside `root` lights on pointer-down and fades after pointer-up (or when the finger slides away) */
export function attachKeyFx(root) {
  const lit = new Set();
  root.addEventListener('pointerdown', (e) => {
    if (root.closest('[data-flash="0"]')) return;
    const b = e.target.closest && e.target.closest('.ck');
    if (!b || b.disabled || e.button) return;
    light(b); lit.add(b);
  }, { passive: true });
  const off = () => { lit.forEach(fade); lit.clear(); };
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => root.addEventListener(ev, off, { passive: true }));
  root.addEventListener('click', (e) => {                        // keyboard / screen-reader activation has no pointer events: give it a short flash too
    if (e.detail !== 0 || root.closest('[data-flash="0"]')) return;
    const b = e.target.closest && e.target.closest('.ck');
    if (b) { light(b); fade(b); }
  });
}
