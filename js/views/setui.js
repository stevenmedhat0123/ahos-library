// The little builders every Settings page uses: a row (icon, title, small text, a control on the end), a segmented choice, a colour picker
// strip, an on/off choice and a slider. Written once so every page looks and behaves the same.
import { h } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { state, setSetting } from '../store.js';

/** One choice out of a few, as touching buttons. options = [[value, label]…] */
export function seg(options, value, onChange) {
  return h('div', { class: 'seg' + (options.length > 3 ? ' many' : ''), role: 'radiogroup' }, options.map(([v, label]) =>
    h('button', { class: 'seg-b' + (value === v ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(value === v), onClick: () => onChange(v) }, label)));
}

export function row({ icon, title, sub, control, onClick, danger }) {
  return h(onClick ? 'button' : 'div', { class: 'row' + (danger ? ' danger' : '') + (onClick ? ' tap' : ''), type: onClick ? 'button' : null, onClick },
    icon ? h('span', { class: 'row-ic', html: ic(icon) }) : null,
    h('span', { class: 'row-tx' }, h('b', null, title), sub ? h('small', null, sub) : null),
    control || null);
}

/** A strip of colour tiles (each [id, colourA, colourB]); `labelKey` + id is the accessible name. */
export function picker(list, value, onPick, labelKey) {
  return h('div', { class: 'pick-row', role: 'radiogroup' }, list.map(([id, a, b]) =>
    h('button', { class: 'pick' + (value === id ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(value === id), 'aria-label': t(labelKey + id),
      style: { background: `linear-gradient(135deg, ${a} 50%, ${b} 50%)` }, onClick: () => onPick(id) })));
}

/** On / Off for a stored setting. `after` runs once it is saved (the page usually redraws or re-applies the look there). */
export function onoff(key, { def = true, after } = {}) {
  const s = state.settings;
  return seg([[true, t('on')], [false, t('off')]], s[key] === undefined ? def : s[key] !== false && !!s[key], (v) => { setSetting(key, v); if (after) after(v); });
}

/** A slider for a number setting: min – max, step, shown with `fmt(value)`; `after` runs when the finger lets go. */
export function slider({ key, min, max, step, value, fmt = String, after, extra }) {
  const v = Math.min(max, Math.max(min, Number(value) || min));
  const out = h('output', { class: 'set-range-v' }, fmt(v));
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(v),
    onInput: () => { out.textContent = fmt(Number(input.value)); },
    onChange: () => { setSetting(key, Number(input.value)); if (after) after(Number(input.value)); } });
  return h('div', { class: 'set-range' }, input, out, extra || null);
}

/** A small explanatory paragraph under a block of rows. */
export const note = (text) => h('p', { class: 'note' }, text);
