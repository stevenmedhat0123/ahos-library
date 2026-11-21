// AHOS Calc – the settings the calculator has, written once for both places that show them: the calculator's own settings sheet and the
// app's Settings → Calculator. This file only builds the controls (colour swatches, pickers, the list of maths options); where the values are
// kept is prefs.js (look) and state.js (maths).
import { h } from '../util.js';
import { t } from '../i18n.js';
import { THEMES, SWATCH, CUSTOM_DEFAULTS, loadPrefs, savePrefs } from './prefs.js';

/** The look-and-feel options as data: [{ id, label, options: [[value, label]…] }] – the values come from loadPrefs(), a change goes to savePrefs(). */
export function lookFields() {
  const onOff = [[0, t('off')], [1, t('on')]];
  return [
    { id: 'layout', label: t('calc_lay'), options: [['casio', t('calc_lay_casio')], ['own', t('calc_lay_own')]], get: (p) => p.layout },
    { id: 'dpad', label: t('calc_dpad'), options: [['mid', t('calc_dp_mid')], ['top', t('calc_dp_top')], ['bottom', t('calc_dp_bottom')]], get: (p) => p.dpad },
    { id: 'flash', label: t('calc_flash'), options: onOff, get: (p) => (p.flash ? 1 : 0), put: (v) => !!v },
    { id: 'vib', label: t('calc_vib'), options: onOff, get: (p) => (p.vib ? 1 : 0), put: (v) => !!v },
    { id: 'snd', label: t('calc_keysnd'), options: onOff, get: (p) => (p.snd ? 1 : 0), put: (v) => !!v },
  ];
}

/** The theme swatches and the five colour pickers. `ui(patch)` stores a change (savePrefs by default). Returns { themes, colours }. */
export function themeControls(ui = savePrefs) {
  const themes = h('div', { class: 'cs-themes', role: 'radiogroup' });
  const paint = () => { const cur = loadPrefs().theme; [...themes.children].forEach((b) => b.classList.toggle('on', b.dataset.id === cur)); };
  THEMES.forEach((id) => {
    themes.append(h('button', { class: 'cs-th', type: 'button', role: 'radio', dataset: { id }, onClick: () => { ui({ theme: id }); paint(); } },
      h('span', { class: 'sw' }, SWATCH[id].map((c) => h('i', { style: { background: c } }))), h('b', null, t('calc_th_' + id))));
  });
  themes.append(h('button', { class: 'cs-th', type: 'button', role: 'radio', dataset: { id: 'custom' }, onClick: () => { ui({ theme: 'custom' }); paint(); } },
    h('span', { class: 'sw rainbow' }, h('i'), h('i'), h('i')), h('b', null, t('calc_th_custom'))));
  paint();
  const cur = loadPrefs().custom;
  const colour = (k, label) => h('label', { class: 'cs-col' }, h('input', { type: 'color', value: cur[k] || CUSTOM_DEFAULTS[k], onInput: (e) => { ui({ theme: 'custom', custom: { [k]: e.target.value } }); paint(); } }), h('span', null, label));
  const colours = h('div', { class: 'cs-cols' }, colour('fn', t('calc_col_fn')), colour('num', t('calc_col_num')), colour('op', t('calc_col_op')), colour('acc', t('calc_col_acc')), colour('disp', t('calc_col_disp')));
  return { themes, colours };
}

/** The maths options as data: [{ id, label, options, value, set(v) }]. `read()` gives { ang, cmplx, setup }; `write({ ang?, cmplx?, setup? })` stores a change. */
export function mathFields(read, write) {
  const onOff = [[0, t('off')], [1, t('on')]];
  return [
    { id: 'ang', label: t('calc_ang'), options: [['deg', 'DEG'], ['rad', 'RAD'], ['gra', 'GRA']], value: () => read().ang, set: (v) => write({ ang: v }) },
    { id: 'mode', label: t('calc_fmt'), options: [['norm1', 'Norm 1'], ['norm2', 'Norm 2'], ['fix', 'Fix'], ['sci', 'Sci']], value: () => read().setup.mode || 'norm1',
      set: (v) => { const s = read().setup; write({ setup: { mode: v, ...((v === 'fix' || v === 'sci') && !s.digits ? { digits: v === 'fix' ? 3 : 4 } : {}) } }); } },
    { id: 'digits', label: t('calc_digits'), options: [[0, t('calc_auto')], [2, '2'], [3, '3'], [4, '4'], [6, '6'], [9, '9']], value: () => read().setup.digits || 0, set: (v) => write({ setup: { digits: v } }) },
    { id: 'cmplx', label: t('calc_cplxMode'), options: onOff, value: () => (read().cmplx ? 1 : 0), set: (v) => write({ cmplx: !!v }) },
    { id: 'frac', label: t('calc_frac'), options: [['mixed', t('calc_fracMixed')], ['improper', t('calc_fracImp')]], value: () => read().setup.frac || 'mixed', set: (v) => write({ setup: { frac: v } }) },
    { id: 'sep', label: t('calc_sep'), options: onOff, value: () => (read().setup.sep ? 1 : 0), set: (v) => write({ setup: { sep: !!v } }) },
  ];
}
