// Settings for the Hub: where the app opens, which sections show and in what order, the outline of the tiles, motion, rotation, sounds.
import { h } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { state, setSetting } from '../store.js';
import { openSheet } from '../ui.js';
import { manageableSections, sectionById, shapeFor, ownerSeesAll, visibleSections } from '../sections.js';
import { tileArt, ensureShapeDefs, SHAPE_LIST } from '../hubart.js';
import { setRotationMode, rotationAvailable } from '../native.js';
import { sfx } from '../sound.js';
import { introWanted, playIntro } from '../intro.js';
import { row, seg, onoff, slider } from './setui.js';

const shapeTile = (shape, sectionId = 'player', colors = null) => h('span', { class: 'hub-box' },
  h('span', { class: 'hub-shape', dataset: { sh: shape }, style: colors ? { '--g1': colors[0], '--g2': colors[1] } : null }, h('span', { class: 'hub-ic', html: tileArt(sectionId) })));

/** The picker of outlines. For the whole Hub (sectionId = null) or for one section ('' / mixed = back to the default). */
export function openShapePicker(ctx, sectionId = null) {
  ensureShapeDefs();
  const st = state.settings;
  const cur = sectionId ? (st.tileShapes && st.tileShapes[sectionId]) || 'mixed' : st.tileShape || 'mixed';
  const def = sectionId ? sectionById(sectionId) : null;
  const sheet = openSheet({ title: sectionId ? t('sec_' + sectionId) : t('shape_title') });
  const pick = (v) => {
    if (sectionId) {
      const map = { ...(st.tileShapes || {}) };
      if (v === 'mixed') delete map[sectionId]; else map[sectionId] = v;
      setSetting('tileShapes', map);
    } else setSetting('tileShape', v);
    sfx('select'); sheet.close(); ctx.rerender();
  };
  const opt = (v, label, art) => h('button', { class: 'shp-opt' + (cur === v ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(cur === v), onClick: () => pick(v) }, art, h('span', null, label));
  sheet.body.append(
    h('p', { class: 'note' }, t(sectionId ? 'shape_oneSub' : 'shape_allSub')),
    h('div', { class: 'shp-grid', role: 'radiogroup' },
      opt('mixed', t(sectionId ? 'shape_default' : 'shape_mixed'), h('span', { class: 'shp-mixed' }, h('i'), h('i'), h('i'), h('i'))),
      SHAPE_LIST.map((sh) => opt(sh, t('shape_' + sh), shapeTile(sh, sectionId || 'player', (def || sectionById('player')).g)))));
}

/** Sections: reorder with ▲▼, show/hide with the switch, and give any one of them its own outline. */
export function openSectionsManager(ctx) {
  ensureShapeDefs();
  const sheet = openSheet({ title: t('sm_title') });
  const list = h('div', { class: 'sm-list' });
  sheet.body.append(h('p', { class: 'note' }, t('sm_sub')), ownerSeesAll() ? h('p', { class: 'note' }, t('sm_ownerAll')) : null, list, h('button', { class: 'btn ghost sm', type: 'button', onClick: () => { setSetting('sections', { order: [], hidden: [] }); paint(); ctx.rerender(); } }, t('sm_reset')));
  function save(order, hidden) { setSetting('sections', { order, hidden }); sfx('tab'); paint(); ctx.rerender(); }
  function paint() {
    const all = manageableSections();
    const hidden = new Set((state.settings.sections && state.settings.sections.hidden) || []);
    const order = all.map((s) => s.id);
    const shown = all.filter((s) => !hidden.has(s.id)).length;
    list.replaceChildren(...all.map((s, i) => {
      const off = hidden.has(s.id);
      const move = (d) => { const o = order.slice(); const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; save(o, [...hidden]); };
      return h('div', { class: 'sm-row' + (off ? ' off' : '') },
        h('button', { class: 'sm-tile', type: 'button', 'aria-label': t('shape_title'), onClick: () => { sheet.close(); openShapePicker(ctx, s.id); } }, shapeTile(shapeFor(s.id), s.id, s.g)),
        h('span', { class: 'sm-name' }, t('sec_' + s.id)),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': '▲', disabled: i === 0, onClick: () => move(-1), html: ic('bdChevUp') }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': '▼', disabled: i === all.length - 1, onClick: () => move(1), html: ic('down') }),
        h('button', { class: 'switch' + (off ? '' : ' on'), type: 'button', role: 'switch', 'aria-checked': String(!off), 'aria-label': t('sec_' + s.id),
          onClick: () => { if (!off && shown <= 1) return; const hs = new Set(hidden); if (off) hs.delete(s.id); else hs.add(s.id); save(order, [...hs]); } }, h('i')));
    }));
  }
  paint();
}

/** How long the opening picture stays: a slider from 1 to 5 seconds, and a button to see it right now. */
function introLength() {
  const test = h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': t('hs_introTry'), html: ic('play'), onClick: () => {
    const input = test.closest('.set-range')?.querySelector('input');
    if (input) setSetting('introSec', Number(input.value));
    if (!introWanted()) return;
    playIntro(visibleSections().find((x) => x.id !== 'settings') || sectionById('calc'));
  } });
  return slider({ key: 'introSec', min: 1, max: 5, step: 0.5, value: state.settings.introSec, fmt: (v) => t('secs', { n: v }), extra: test, after: () => sfx('select') });
}

/** Settings → General: the screen the app opens on, and how the screen turns. */
export function generalRows(ctx) {
  const s = state.settings;
  return [
    row({ icon: 'hub', title: t('hs_start'), sub: t('hs_startSub'), control: seg([['hub', t('hs_startHub')], ['player', t('hs_startPlayer')]], s.startOn || 'hub', (v) => { setSetting('startOn', v); ctx.rerender(); }) }),
    row({ icon: 'rotate', title: t('rot_title'), sub: t(rotationAvailable() ? 'rot_sub' : 'rot_subWeb'),
      control: seg([['auto', t('rot_auto')], ['portrait', t('rot_portrait')], ['landscape', t('rot_landscape')], ['button', t('rot_button')]], s.rotation || 'auto', (v) => { setSetting('rotation', v); setRotationMode(v); ctx.rerender(); }) }),
  ];
}

/** Settings → Home & sections: the row of sections, the tile outlines, motion, the opening picture, merging the media sections. */
export function homeRows(ctx) {
  const s = state.settings;
  ensureShapeDefs();
  const after = () => ctx.applyAppearance();
  return [
    row({ icon: 'grid', title: t('sm_title'), sub: t('sm_rowSub'), onClick: () => openSectionsManager(ctx) }),
    row({ icon: 'sparkle', title: t('shape_title'), sub: t('shape_rowSub'), onClick: () => openShapePicker(ctx),
      control: h('span', { class: 'shp-cur' }, (s.tileShape && s.tileShape !== 'mixed') ? shapeTile(s.tileShape) : h('span', { class: 'shp-mixed sm' }, h('i'), h('i'), h('i'), h('i'))) }),
    row({ icon: 'player', title: t('hs_merge'), sub: t('hs_mergeSub'), control: onoff('playerMerged', { def: false }) }),
    row({ icon: 'play', title: t('hs_motion'), sub: t('hs_motionSub'), control: onoff('hubMotion', { after }) }),
    row({ icon: 'sparkle', title: t('hs_intro'), sub: t('hs_introSub'), control: onoff('sectionIntro', { after: () => ctx.rerender() }) }),
    s.sectionIntro !== false ? row({ icon: 'clock', title: t('hs_introSec'), sub: t('hs_introSecSub'), control: introLength() }) : null,
  ];
}

/** Settings → Sounds. */
export function soundRows(ctx) {
  const s = state.settings;
  return [
    row({ icon: 'speaker', title: t('snd_title'), sub: t('snd_sub'), control: seg([[true, t('on')], [false, t('off')]], s.sounds !== false, (v) => { setSetting('sounds', v); if (v) sfx('on'); ctx.rerender(); }) }),
    s.sounds !== false ? row({ icon: 'speaker', title: t('snd_vol'), control: seg([[0.3, t('snd_low')], [0.6, t('snd_mid')], [1, t('snd_high')]], [0.3, 0.6, 1].reduce((a, b) => (Math.abs(b - (s.soundVol ?? 0.6)) < Math.abs(a - (s.soundVol ?? 0.6)) ? b : a)), (v) => { setSetting('soundVol', v); sfx('select'); ctx.rerender(); }) }) : null,
    // the owner's default for the notifications he sends to everybody (each one can still be changed when he writes it)
    ownerSeesAll() ? row({ icon: 'bell', title: t('snd_broadcast'), sub: t('snd_broadcastSub'), control: onoff('broadcastSound', { def: true }) }) : null,
  ];
}
