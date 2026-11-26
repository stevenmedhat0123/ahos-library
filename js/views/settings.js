// Settings – its own section of the Hub, and only settings. The first screen is a grid of categories (with a search box over all of them);
// a category opens as a page of rows. Everything that is not a setting lives elsewhere: the account, subscription and codes in "Subscriptions &
// Codes", the owner's tools in their own sections, the trash in its own section.
import { h, fmtBytes, isNative } from '../util.js';
import { ic } from '../icons.js';
import { t, lang, setLang } from '../i18n.js';
import { state, setSetting, storageInfo, requestPersist, wipeAll, emit } from '../store.js';
import { confirmDialog, toast, progressCard, infoDialog } from '../ui.js';
import { hasPin, createPin, removePin } from '../actions.js';
import { getAppInfo, checkForUpdates, isWebBuild } from '../updater.js';
import { openUpdateSheet, openWhatsNew } from './update.js';
import { whatsNewItems } from '../whatsnew.js';
import { createBackup, pickAndRestore, pendingCount, clearPending } from '../backup.js';
import { ensureThumbs, missingThumbs } from '../covers.js';
import { appIconRow } from '../appicons.js';
import { setFullscreenSetting, playbackAvailable, notificationState, askNotifyPermission, openNotificationSettings, openExternal, CUTOUT_MODES, CUTOUT_DEFAULT, displayInfo } from '../native.js';
import { BG_STYLES, BG_SHAPES, previewStyle } from '../bg.js';
import { pickFiles } from '../import.js';
import { storageRows } from '../storageui.js';
import { generalRows, homeRows, soundRows } from './hubui.js';
import { seg, row, picker, onoff, note } from './setui.js';
import { loadPrefs, savePrefs } from '../calc/prefs.js';
import { lookFields, themeControls, mathFields } from '../calc/prefsui.js';
import { loadCalc, saveCalc } from '../calc/state.js';
import { loadCss } from '../lazycss.js';
import { sfx } from '../sound.js';

const SKINS = [['lapis', '#141D4F', '#0B1233'], ['midnight', '#17214A', '#060A1C'], ['black', '#2A2A33', '#000000'], ['violet', '#2A1C64', '#120A2E'], ['emerald', '#144339', '#061F1B'], ['ruby', '#481A2E', '#1F0914'], ['ocean', '#11465F', '#04202E']];
const SKINS_LIGHT = [['lapis', '#F4EEDF', '#EADFC6'], ['midnight', '#EEF1F7', '#CBD4E6'], ['black', '#FFFFFF', '#E4E4E9'], ['violet', '#F3EFFC', '#D9CEF3'], ['emerald', '#ECF6F2', '#C9E4DA'], ['ruby', '#FBEFF2', '#F1CCD7'], ['ocean', '#E9F4FA', '#C2DDEB']];
const ACCENTS = [['gold', '#E7B94F', '#3CCBBC'], ['sky', '#4FA8FF', '#A78BFA'], ['rose', '#FF5C8A', '#FFB86B'], ['violet', '#A78BFA', '#5EEAD4'], ['mint', '#34D399', '#60A5FA'], ['coral', '#FF7A45', '#FFD166'], ['red', '#FF4D4D', '#FF9F43']];

/** Android notifications (player controls): shows whether they are allowed and takes you to where to change it. */
function notificationsRow() {
  const sub = h('small', null, '…');
  const el = h('button', { class: 'row tap', onClick: async () => {
    const st = await notificationState();
    if (st && st.needsAsk) { askNotifyPermission(); setTimeout(paint, 1500); } else openNotificationSettings();
  } }, h('span', { class: 'row-ic', html: ic('bell') }), h('span', { class: 'row-tx' }, h('b', null, t('notifTitle')), sub));
  async function paint() {
    const st = await notificationState();
    sub.textContent = !st ? t('notifUnknown') : st.enabled && !st.needsAsk ? t('notifOn') : st.needsAsk ? t('notifAsk') : t('notifOff');
  }
  paint();
  document.addEventListener('visibilitychange', function again() { if (!el.isConnected) { document.removeEventListener('visibilitychange', again); return; } if (!document.hidden) paint(); });
  return el;
}


/** The grid of background looks: each tile is a tiny live picture of the look, drawn in your colours. */
function bgPicker(s, ctx) {
  const cur = BG_STYLES.includes(s.bgStyle) ? s.bgStyle : 'shine';
  const choose = async (id) => {
    if (id === 'image' && !ctx.bgPicture.has()) { if (!(await pickPicture(ctx))) return; }
    setSetting('bgStyle', id); ctx.applyAppearance();
  };
  const tiles = BG_STYLES.map((id) => {
    const cv = h('canvas', { class: 'bgt-cv', width: 96, height: 64 });
    const tile = h('button', { class: 'bgt' + (cur === id ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(cur === id), 'aria-label': t('bgSt_' + id), onClick: () => choose(id) },
      id === 'image' ? h('span', { class: 'bgt-cv bgt-img', style: ctx.bgPicture.url() ? { backgroundImage: `url("${ctx.bgPicture.url()}")` } : null, html: ctx.bgPicture.url() ? '' : ic('image') }) : cv,
      h('span', { class: 'bgt-nm' }, t('bgSt_' + id)));
    if (id !== 'image') (window.requestIdleCallback || setTimeout)(() => { try { previewStyle(cv, id, { shapes: s.bgShapes || 'mix' }); } catch { /* preview only */ } });
    return tile;
  });
  return h('div', { class: 'bgpick-wrap' }, h('div', { class: 'bgpick-hd' }, h('b', null, t('bgStyle')), h('small', null, t('bgStyleSub'))), h('div', { class: 'bgpick', role: 'radiogroup' }, tiles));
}
async function pickPicture(ctx) {
  let files;
  try { files = await pickFiles({ accept: 'image/*', multiple: false }); } catch { return false; }
  const f = files && files[0];
  if (!f) return false;
  const ok = await ctx.bgPicture.set(f);
  if (!ok) { toast(t('bgPicFail')); return false; }
  setSetting('bgImage', Date.now());
  return true;
}


/* ---------------- the calculator's settings (the same ones its own settings sheet has) ---------------- */
function calcRows(ctx) {
  const p = loadPrefs();
  const rows = lookFields().slice(0, 2).map((f) => row({ icon: 'calc', title: f.label, control: seg(f.options, f.get(p), (v) => { savePrefs({ [f.id]: v }); ctx.rerender(); }) }));
  const { themes, colours } = themeControls(savePrefs);
  rows.push(h('div', { class: 'row col' }, h('span', { class: 'row-tx' }, h('b', null, t('calc_look'))), themes),
    h('div', { class: 'row col' }, h('span', { class: 'row-tx' }, h('b', null, t('calc_colours'))), colours));
  lookFields().slice(2).forEach((f) => rows.push(row({ icon: 'calc', title: f.label, control: seg(f.options, f.get(p), (v) => { savePrefs({ [f.id]: f.put ? f.put(v) : v }); ctx.rerender(); }) })));
  const read = () => { const c = loadCalc(); return { ang: c.setup.ang || 'deg', cmplx: c.cmplx, setup: c.setup }; };
  const write = (patch) => { const c = loadCalc(); const setup = { ...c.setup, ...(patch.setup || {}) }; if ('ang' in patch) setup.ang = patch.ang; saveCalc({ setup, cmplx: 'cmplx' in patch ? patch.cmplx : c.cmplx }); };
  mathFields(read, write).forEach((f) => rows.push(row({ icon: 'calc', title: f.label, control: seg(f.options, f.value(), (v) => { f.set(v); ctx.rerender(); }) })));
  return rows;
}

/* ---------------- the categories ---------------- */
function appearanceRows(ctx) {
  const s = state.settings;
  return [
    row({ icon: 'sun', title: t('theme'), control: seg([['dark', t('themeDark')], ['light', t('themeLight')], ['auto', t('themeAuto')]], s.theme, (v) => { setSetting('theme', v); ctx.applyAppearance(); }) }),
    row({ icon: 'sparkle', title: t('skin'), sub: t('skinSub'), control: picker(document.documentElement.dataset.theme === 'light' ? SKINS_LIGHT : SKINS, s.skin || 'lapis', (v) => { setSetting('skin', v); ctx.applyAppearance(); }, 'skin_') }),
    row({ icon: 'star', title: t('accent'), sub: t('accentSub'), control: picker(ACCENTS, s.accent || 'gold', (v) => { setSetting('accent', v); ctx.applyAppearance(); }, 'accent_') }),
    row({ icon: 'image', title: t('background'), sub: t('backgroundSub'), control: seg([['full', t('bgFull')], ['calm', t('bgCalm')], ['off', t('bgOff')]], s.bg, (v) => { setSetting('bg', v); ctx.applyAppearance(); }) }),
    bgPicker(s, ctx),
    s.bgStyle === 'shapes' ? h('div', { class: 'row col' }, h('span', { class: 'row-tx' }, h('b', null, t('bgShapes')), h('small', null, t('bgShapesSub'))),
      h('div', { class: 'chips' }, BG_SHAPES.map((k) => h('button', { class: 'chip' + ((s.bgShapes || 'mix') === k ? ' on' : ''), type: 'button', onClick: () => { setSetting('bgShapes', k); ctx.applyAppearance(); } }, t('bgSh_' + k))))) : null,
    s.bgStyle === 'image' ? row({ icon: 'image', title: t('bgPicture'), sub: ctx.bgPicture.has() ? t('bgPictureSub') : t('bgNone'), control: h('div', { class: 'row-btns' },
      h('button', { class: 'btn sm', type: 'button', onClick: async () => { if (await pickPicture(ctx)) ctx.applyAppearance(); } }, ctx.bgPicture.has() ? t('bgChange') : t('bgChoose')),
      ctx.bgPicture.has() ? h('button', { class: 'btn sm ghost', type: 'button', onClick: async () => { await ctx.bgPicture.remove(); setSetting('bgImage', 0); setSetting('bgStyle', 'shine'); ctx.applyAppearance(); } }, t('bgRemove')) : null) }) : null,
    s.bgStyle === 'image' ? row({ icon: 'sun', title: t('bgDim'), sub: t('bgDimSub'), control: seg([[0.3, t('bgDim_low')], [0.55, t('bgDim_mid')], [0.8, t('bgDim_high')]], [0.3, 0.55, 0.8].reduce((a, b) => (Math.abs(b - (s.bgDim ?? 0.55)) < Math.abs(a - (s.bgDim ?? 0.55)) ? b : a)), (v) => { setSetting('bgDim', v); ctx.applyAppearance(); }) }) : null,
    row({ icon: 'play', title: t('playBtnStyle'), sub: t('playBtnSub'), control: seg([['none', t('pbNone')], ['clear', t('pbClear')], ['glass', t('pbGlass')]], s.playBtn || 'none', (v) => { setSetting('playBtn', v); ctx.applyAppearance(); }) }),
    appIconRow(ctx, row),
  ];
}

function generalAll(ctx) {
  const s = state.settings;
  return [
    row({ icon: 'globe', title: t('language'), control: seg([['ar', 'العربية'], ['en', 'English']], lang(), (v) => { setLang(v); setSetting('lang', v); ctx.applyAppearance(); }) }),
    ...generalRows(ctx),
    row({ icon: 'fit', title: t('fullscreen'), sub: t(isNative() ? 'fullscreenSub' : 'fullscreenSubWeb'), control: seg([[true, t('on')], [false, t('off')]], !!s.fullscreen, (v) => { setSetting('fullscreen', v); setFullscreenSetting(v); }) }),
    playbackAvailable() ? row({ icon: 'fit', title: t('cutout'), sub: t('cutoutSub'), control: seg(CUTOUT_MODES.map((m) => [m, t('cutout_' + m)]), CUTOUT_MODES.includes(s.cutout) ? s.cutout : CUTOUT_DEFAULT, (v) => { setSetting('cutout', v); ctx.applyAppearance(); }) }) : null,
    playbackAvailable() ? row({ icon: 'search', title: t('scrCheck'), sub: t('scrCheckSub'), onClick: () => screenCheck() }) : null,
  ];
}

/** Settings > Screen check: what the phone reports about the screen and where it put the page (for a screenshot when the top looks wrong). */
async function screenCheck() {
  const info = await displayInfo();
  const probe = h('div', { style: { position: 'fixed', left: '-9px', top: '0', width: '1px', height: '1px', visibility: 'hidden', padding: 'var(--safe-t) 0 var(--safe-b) 0' } });
  document.body.appendChild(probe);
  const pcs = getComputedStyle(probe), safeT = pcs.paddingTop, safeB = pcs.paddingBottom;
  probe.remove();
  const dp = (v) => (info && info.density ? `${Math.round(v / info.density)} dp` : '');
  const modes = { 0: 'default', 1: 'short edges', 2: 'never (below the camera)', 3: 'always' };
  infoDialog({ title: t('scrCheck'), rows: info ? [
    [t('scrPhone'), `${info.maker || ''} ${info.model || ''} · Android API ${info.sdk}`],
    [t('scrScreen'), `${info.screenW} × ${info.screenH} px · ×${(info.density || 0).toFixed(2)}`],
    [t('scrPage'), `x ${info.webX}, y ${info.webY} (${dp(info.webY)}) · ${info.webW} × ${info.webH} px`],
    [t('scrCutMode'), info.cutoutMode == null ? '—' : `${info.cutoutMode} · ${modes[info.cutoutMode] || ''}`],
    [t('scrSetting'), CUTOUT_MODES.includes(state.settings.cutout) ? state.settings.cutout : CUTOUT_DEFAULT],
    [t('scrSafe'), `${safeT} / ${safeB}`],
    info.hidden != null ? [t('scrHidden'), info.hidden || t('scrNone')] : null,
    info.tree ? [t('scrTree'), h('pre', { class: 'scr-tree' }, info.tree)] : null,
  ] : [[t('scrCheck'), t('scrWeb')]] });
}

function playbackRows(ctx) {
  const s = state.settings;
  return [
    row({ icon: 'repeat', title: t('playMode'), sub: t('playModeSub'), control: seg([['seq', t('pm_seq')], ['all', t('pm_all')], ['one', t('pm_one')], ['once', t('pm_once')]], s.playMode || 'seq', (v) => { setSetting('playMode', v); ctx.rerender(); }) }),
    row({ icon: 'sun', title: t('keepAwake'), sub: t('keepAwakeSub'), control: seg([[true, t('on')], [false, t('off')]], s.keepAwake !== false, (v) => setSetting('keepAwake', v)) }),
    row({ icon: 'audio', title: t('bgAudio'), sub: t('bgAudioSub'), control: seg([[true, t('on')], [false, t('off')]], s.bgAudio !== false, (v) => setSetting('bgAudio', v)) }),
    playbackAvailable() ? notificationsRow() : null,
    row({ icon: 'pip', title: t('autoPip'), sub: t('autoPipSub'), control: seg([[true, t('on')], [false, t('off')]], !!s.autoPip, (v) => setSetting('autoPip', v)) }),
    row({ icon: 'mute', title: t('openMuted'), control: seg([[true, t('on')], [false, t('off')]], !!s.openMuted, (v) => setSetting('openMuted', v)) }),
  ];
}

function readingRows() {
  const s = state.settings;
  return [row({ icon: 'bookOpen', title: t('pdfBookDefault'), sub: t('pdfBookDefaultSub'), control: seg([[true, t('on')], [false, t('off')]], !!s.pdfBook, (v) => setSetting('pdfBook', v)) })];
}

function storageAll(ctx) {
  const storage = h('div', { class: 'storage' }, h('div', { class: 'meter' }, h('i')), h('small', null, '…'));
  storageInfo().then((si) => {
    const pct = si.quota ? Math.min(100, (si.usage / si.quota) * 100) : 0;
    storage.querySelector('i').style.width = Math.max(2, pct) + '%';
    storage.querySelector('small').textContent = si.quota
      ? t('storageLine', { used: fmtBytes(si.usage), quota: fmtBytes(si.quota), files: fmtBytes(si.files) })
      : t('storageFiles', { files: fmtBytes(si.files) });
    if (!si.persisted && si.quota) {
      storage.append(h('button', { class: 'btn ghost sm', onClick: async () => { const ok = await requestPersist(); toast(ok ? t('persistOn') : t('persistDenied')); ctx.rerender(); } }, t('keepStorage')));
    } else if (si.persisted) storage.append(h('small', { class: 'ok' }, t('persistOn')));
  });
  const noPic = missingThumbs().filter((it) => it.meta?.thumbWhy !== 'password').length;
  return [
    ...storageRows(ctx, { row, seg }),
    row({ icon: 'storage', title: t('onThisDevice'), sub: t('offlineNote') }), storage,
    row({ icon: 'image', title: t('rebuildThumbs'), sub: t('rebuildThumbsSub', { n: noPic }), onClick: async () => {
      const card = progressCard(t('rebuildingThumbs'));
      const r = await ensureThumbs({ force: true, onProgress: (i, n) => card.update(`${i} / ${n}`, n ? i / n : 1) });
      card.done();
      if (r.busy) return;
      toast(r.made || r.failed ? t('thumbsDone', r) : t('thumbsNothing'));
      ctx.rerender();
    } }),
    row({ icon: 'trash', title: t('deleteEverything'), sub: t('deleteEverythingSub'), danger: true, onClick: async () => {
      if (!(await confirmDialog({ title: t('deleteEverything'), message: t('deleteEverythingMsg'), ok: t('delete'), danger: true }))) return;
      await wipeAll(); toast(t('libraryCleared'));
    } }),
  ];
}

function backupRows(ctx) {
  const waiting = pendingCount();
  return [
    row({ icon: 'tag', title: t('backupOrg'), sub: t('backupOrgSub'), onClick: () => createBackup({ withFiles: false }) }),
    row({ icon: 'download', title: t('backupFull'), sub: t('backupFullSub'), onClick: () => createBackup({ withFiles: true }) }),
    row({ icon: 'upload', title: t('restore'), sub: t('restoreSub'), onClick: async () => { const r = await pickAndRestore(); if (r) { ctx.applyAppearance(); ctx.rerender(); } } }),
    waiting ? row({ icon: 'info', title: t('pendingTitle', { n: waiting }), sub: t('pendingSub'),
      control: h('button', { class: 'btn ghost sm', onClick: async () => { if (await confirmDialog({ title: t('pendingClear'), message: t('pendingClearMsg'), ok: t('delete'), danger: true })) { clearPending(); toast(t('pendingCleared')); ctx.rerender(); } } }, t('pendingClear')) }) : null,
  ];
}

function privacyRows() {
  return [
    row({ icon: 'lock', title: t('hiddenFolders'), sub: hasPin() ? t('pinIsSet') : t('pinNotSet'),
      control: hasPin()
        ? h('div', { class: 'row-btns' }, h('button', { class: 'btn ghost sm', onClick: async () => { await removePin(); } }, t('removePin')))
        : h('button', { class: 'btn primary sm', onClick: async () => { await createPin(); emit(); } }, t('createPin')) }),
    note(t('pinNote')),
  ];
}

function updateRows(ctx) {
  const s = state.settings;
  const info = getAppInfo();
  const upd = h('div', { class: 'upd-status' });
  const updBtn = h('button', { class: 'btn primary sm' }, t('checkUpdates'));
  const runCheck = async () => {
    updBtn.disabled = true; upd.textContent = t('checking');
    const r = await checkForUpdates({ manual: true });
    updBtn.disabled = false;
    if (r.status === 'available') {
      upd.replaceChildren(h('b', null, t('updateAvailable', { v: r.release.label })),
        h('button', { class: 'btn primary sm', onClick: () => openUpdateSheet(r.release) }, t('view')));
      openUpdateSheet(r.release);
    } else if (r.status === 'latest') upd.textContent = t('upToDate');
    else if (r.status === 'norepo') upd.textContent = t('noUpdateSource');
    else upd.textContent = t('updateError');
  };
  updBtn.addEventListener('click', runCheck);
  const about = h('footer', { class: 'about' },
    h('div', { class: 'about-mark' }, h('b', null, 'AHOS Library'), h('small', null, `v${info.version} · build ${info.build}`)),
    h('small', null, t('aboutLine')));
  if (isWebBuild()) {
    return [
      row({ icon: 'download', title: t('version'), sub: `${info.version}${info.channel === 'beta' ? ' beta' : ''} · web` }),
      row({ icon: 'cloud', title: t('webUpdates'), sub: t('webUpdatesSub') }),
      whatsNewItems().length ? row({ icon: 'info', title: t('wnRow'), sub: t('wnRowSub'), onClick: () => openWhatsNew(whatsNewItems(), info.version) }) : null,
      ctx.canInstall() ? row({ icon: 'mobile', title: t('installApp'), sub: t('installSub'), onClick: () => ctx.install() }) : null,
      info.repo ? row({ icon: 'mobile', title: t('getAndroid'), sub: t('getAndroidSub'), onClick: () => openExternal(`https://github.com/${info.repo}/releases`) }) : null,
      about,
    ];
  }
  return [
    row({ icon: 'download', title: t('version'), sub: `${info.version}${info.channel === 'beta' ? ' beta' : ''} · build ${info.build}` }),
    row({ icon: 'sparkle', title: t('channel'), sub: t('channelSub'), control: seg([['stable', t('chStable')], ['beta', t('chBeta')]], s.channel || info.channel || 'stable', (v) => { setSetting('channel', v); ctx.rerender(); }) }),
    row({ icon: 'cloud', title: t('checkUpdates'), control: updBtn }),
    upd,
    whatsNewItems().length ? row({ icon: 'info', title: t('wnRow'), sub: t('wnRowSub'), onClick: () => openWhatsNew(whatsNewItems(), info.version) }) : null,
    ctx.canInstall() ? row({ icon: 'mobile', title: t('installApp'), sub: t('installSub'), onClick: () => ctx.install() }) : null,
    about,
  ];
}

/*  id          title key       summary key     icon        colours                    rows */
const CATS = [
  { id: 'general', title: 'set_general', gs: 'gs_general', icon: 'settings', g: ['#60A5FA', '#6366F1'], rows: generalAll },
  { id: 'appearance', title: 'appearance', gs: 'gs_appearance', icon: 'sparkle', g: ['#F472B6', '#A855F7'], rows: appearanceRows },
  { id: 'hubset', title: 'hubset', gs: 'gs_hubset', icon: 'hub', g: ['#FBBF24', '#F43F5E'], rows: homeRows },
  { id: 'sound', title: 'hub_set_sound', gs: 'gs_sound', icon: 'speaker', g: ['#34D399', '#0EA5E9'], rows: soundRows },
  { id: 'calc', title: 'sec_calc', gs: 'gs_calc', icon: 'calc', g: ['#22D3EE', '#3B82F6'], rows: calcRows },
  { id: 'playback', title: 'playback', gs: 'gs_playback', icon: 'play', g: ['#7C5CF0', '#FF5C7A'], rows: playbackRows },
  { id: 'reading', title: 'reading', gs: 'gs_reading', icon: 'book', g: ['#A3E635', '#14B8A6'], rows: readingRows },
  { id: 'libStorage', title: 'libStorage', gs: 'gs_libStorage', icon: 'storage', g: ['#94A3B8', '#475569'], rows: storageAll },
  { id: 'backup', title: 'backup', gs: 'gs_backup', icon: 'download', g: ['#FCD34D', '#F59E0B'], rows: backupRows },
  { id: 'privacy', title: 'privacy', gs: 'gs_privacy', icon: 'lock', g: ['#FB7185', '#E11D48'], rows: privacyRows },
  { id: 'updates', title: 'updates', gs: 'gs_updates', icon: 'cloud', g: ['#38BDF8', '#6366F1'], rows: updateRows },
];

let curCat = null;       // the category page that is open (null = the list of categories)
let query = '';          // what is typed in the search box

/** Back inside Settings: from a category page to the list. Returns false when already on the list (the caller then goes to the Hub). */
export function settingsBack(ctx) {
  if (query) { query = ''; ctx.rerender(false, true); return true; }
  if (curCat) { curCat = null; ctx.rerender(false, true); return true; }
  return false;
}
/** Settings opened from outside (a link such as "Notifications are off → Settings") can land straight on a category. */
export function openSettingsCategory(id) { curCat = CATS.some((c) => c.id === id) ? id : null; query = ''; }

export function renderSettings(ctx) {
  loadCss('css/calc.css');                                         // the calculator's colour pickers live in this category
  const cat = CATS.find((c) => c.id === curCat) || null;
  const root = h('div', { class: 'screen settings sec-page', dataset: { cat: cat ? cat.id : '' }, style: cat ? { '--g1': cat.g[0], '--g2': cat.g[1] } : { '--g1': '#94A3B8', '--g2': '#475569' } });

  const back = h('button', { class: 'icon-btn', type: 'button', 'aria-label': cat ? t('back') : t('hub_back'), onClick: () => { sfx('back'); if (!settingsBack(ctx)) ctx.goHub(); } }, h('span', { class: 'flip-rtl', html: ic('back') }));
  const hubBtn = cat ? h('div', { class: 'top-actions' }, h('button', { class: 'icon-btn hub-back', type: 'button', 'aria-label': t('hub_back'), onClick: () => { sfx('back'); curCat = null; ctx.goHub(); }, html: ic('hub') })) : null;
  root.append(h('header', { class: 'top sec-top' }, back, h('span', { class: 'sec-badge', html: ic(cat ? cat.icon : 'settings') }), h('h1', { class: 'top-title' }, t(cat ? cat.title : 'settings')), hubBtn));

  const body = h('div', { class: 'set-body' });
  const list = (rows) => h('div', { class: 'set-list' }, rows.filter(Boolean));

  if (cat) {
    body.append(list(cat.rows(ctx)));
    root.append(body);
    return root;
  }

  // the list of categories, with a search box over every setting
  const results = h('div', { class: 'set-results' });
  const grid = h('div', { class: 'set-grid' }, CATS.map((c) => h('button', { class: 'set-cat', type: 'button', dataset: { id: c.id }, style: { '--g1': c.g[0], '--g2': c.g[1] }, onClick: () => { sfx('open'); curCat = c.id; ctx.rerender(false, true); } },
    h('span', { class: 'set-ico', html: ic(c.icon) }),
    h('span', { class: 'set-tx' }, h('b', null, t(c.title)), h('small', null, t(c.gs))),
    h('span', { class: 'set-chev flip-rtl', html: ic('chev') }))));
  let built = null;                                                  // every category's rows, built once the first time something is searched
  const find = () => {
    const q = query.trim().toLowerCase();
    grid.hidden = !!q; results.hidden = !q;
    if (!q) return;
    built = built || CATS.map((c) => [c, c.rows(ctx).filter(Boolean)]);
    const out = [];
    for (const [c, rows] of built) {
      const hit = rows.filter((r) => (r.textContent || '').toLowerCase().includes(q));
      if (hit.length) out.push(h('section', { class: 'set-res', style: { '--g1': c.g[0], '--g2': c.g[1] } },
        h('button', { class: 'set-res-hd', type: 'button', onClick: () => { curCat = c.id; query = ''; ctx.rerender(false, true); } }, h('span', { class: 'set-ico sm', html: ic(c.icon) }), h('b', null, t(c.title)), h('span', { class: 'set-chev flip-rtl', html: ic('chev') })),
        list(hit)));
    }
    results.replaceChildren(...(out.length ? out : [h('p', { class: 'set-none' }, t('set_noMatch', { q: query.trim() }))]));
  };
  const input = h('input', { class: 'set-q', type: 'search', placeholder: t('set_search'), value: query, enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': t('set_search'),
    onInput: () => { query = input.value; find(); } });
  body.append(h('label', { class: 'set-search' }, h('span', { html: ic('search') }), input), grid, results);
  root.append(body);
  find();
  return root;
}
