// Settings: language, look, hidden folders, storage, updates.
import { h, fmtBytes, fmtDate, isNative } from '../util.js';
import { ic } from '../icons.js';
import { t, lang, setLang } from '../i18n.js';
import { state, setSetting, storageInfo, requestPersist, wipeAll, emit } from '../store.js';
import { confirmDialog, toast, promptDialog } from '../ui.js';
import { hasPin, createPin, removePin } from '../actions.js';
import { getAppInfo, checkForUpdates, isWebBuild } from '../updater.js';
import { openUpdateSheet, openWhatsNew } from './update.js';
import { whatsNewItems } from '../whatsnew.js';
import { createBackup, pickAndRestore, pendingCount, clearPending } from '../backup.js';
import { ensureThumbs, missingThumbs } from '../covers.js';
import { progressCard } from '../ui.js';
import { setFullscreenSetting, playbackAvailable, notificationState, askNotifyPermission, openNotificationSettings, openExternal } from '../native.js';
import { gateEnabled, sessionInfo, logout, redeem, changePassword, daysLeft, isForever } from '../auth.js';
import { BG_STYLES, BG_SHAPES, previewStyle } from '../bg.js';
import { pickFiles } from '../import.js';
import { storageRows } from '../storageui.js';

function seg(options, value, onChange) {
  return h('div', { class: 'seg' + (options.length > 3 ? ' many' : ''), role: 'radiogroup' }, options.map(([v, label]) =>
    h('button', { class: 'seg-b' + (value === v ? ' on' : ''), role: 'radio', 'aria-checked': String(value === v), onClick: () => onChange(v) }, label)));
}

function row({ icon, title, sub, control, onClick, danger }) {
  const el = h(onClick ? 'button' : 'div', { class: 'row' + (danger ? ' danger' : '') + (onClick ? ' tap' : ''), onClick },
    icon ? h('span', { class: 'row-ic', html: ic(icon) }) : null,
    h('span', { class: 'row-tx' }, h('b', null, title), sub ? h('small', null, sub) : null),
    control || null);
  return el;
}

const SKINS = [['lapis', '#141D4F', '#0B1233'], ['midnight', '#17214A', '#060A1C'], ['black', '#2A2A33', '#000000'], ['violet', '#2A1C64', '#120A2E'], ['emerald', '#144339', '#061F1B'], ['ruby', '#481A2E', '#1F0914'], ['ocean', '#11465F', '#04202E']];
const ACCENTS = [['gold', '#E7B94F', '#3CCBBC'], ['sky', '#4FA8FF', '#A78BFA'], ['rose', '#FF5C8A', '#FFB86B'], ['violet', '#A78BFA', '#5EEAD4'], ['mint', '#34D399', '#60A5FA'], ['coral', '#FF7A45', '#FFD166'], ['red', '#FF4D4D', '#FF9F43']];

function picker(list, value, onPick, labelKey) {
  return h('div', { class: 'pick-row', role: 'radiogroup' }, list.map(([id, a, b]) =>
    h('button', { class: 'pick' + (value === id ? ' on' : ''), role: 'radio', 'aria-checked': String(value === id), 'aria-label': t(labelKey + id),
      style: { background: `linear-gradient(135deg, ${a} 50%, ${b} 50%)` }, onClick: () => onPick(id) })));
}

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
  const cur = s.bgStyle || 'topo';
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

/** Which sections are open. Kept here so a section stays open when the screen redraws after a setting changes. */
const openGroups = new Set();

/** A section that folds into one tappable card: tap to show what is inside, tap again to hide it. */
function group(key, icon, ...rows) {
  const open = openGroups.has(key);
  const sub = t('gs_' + key);
  const wrap = h('div', { class: 'group-wrap' }, h('div', { class: 'group-inner' }, h('div', { class: 'group-body' }, rows.filter(Boolean))));
  wrap.inert = !open;
  const head = h('button', { class: 'group-head', type: 'button', 'aria-expanded': String(open), onClick: () => {
    const on = !sec.classList.contains('open');
    sec.classList.toggle('open', on);
    head.setAttribute('aria-expanded', String(on));
    wrap.inert = !on;
    if (on) openGroups.add(key); else openGroups.delete(key);
  } },
  h('span', { class: 'group-ic', html: ic(icon) }),
  h('span', { class: 'group-tx' }, h('b', null, t(key)), sub ? h('small', null, sub) : null),
  h('span', { class: 'group-chev', html: ic('down') }));
  const sec = h('section', { class: 'group' + (open ? ' open' : '') }, head, wrap);
  return sec;
}

export function renderSettings(ctx) {
  const s = state.settings;
  const info = getAppInfo();
  const root = h('div', { class: 'screen settings' });
  root.append(h('header', { class: 'top' }, h('h1', { class: 'top-title' }, t('settings'))));

  const me = gateEnabled() ? sessionInfo() : null;
  if (me) {
    const owner = me.role === 'owner';
    root.append(group('acc_title', 'shield',
      row({ icon: 'shield', title: me.name, sub: owner ? t('acc_owner') : isForever(me.end) ? t('acc_forever') : t('acc_untilLeft', { date: fmtDate(me.end, lang()), n: daysLeft(me.end) }) }),
      owner ? row({ icon: 'star', title: t('o_title'), sub: t('o_titleSub'), onClick: () => import('./owner.js').then((m) => m.openOwnerPanel()) }) : null,
      owner ? null : row({ icon: 'unlock', title: t('acc_newCode'), onClick: async () => {
        const code = await promptDialog({ title: t('acc_newCode'), placeholder: t('g_code'), ok: t('g_activate'), maxlength: 80 });
        if (!code) return;
        try { const end = await redeem(code); toast(isForever(end) ? t('g_validForever') : t('g_validUntil', { date: fmtDate(end, lang()) })); ctx.rerender(); } catch (e) { toast(t('g_err_' + (e.code || 'generic'))); }
      } }),
      row({ icon: 'lock', title: t('acc_changePw'), onClick: async () => {
        const cur = await promptDialog({ title: t('acc_changePw'), message: t('acc_curPw'), type: 'password', ok: t('next'), maxlength: 200 });
        if (!cur) return;
        const next = await promptDialog({ title: t('acc_changePw'), message: t('g_newPw'), type: 'password', ok: t('save'), maxlength: 200 });
        if (!next) return;
        if (next.length < (owner ? 8 : 6)) { toast(t('g_pwShort', { n: owner ? 8 : 6 })); return; }
        try { await changePassword(cur, next); toast(t('g_pwChanged')); } catch (e) { toast(t('g_err_' + (e.code || 'generic'))); }
      } }),
      row({ icon: 'upload', title: t('g_signOut'), danger: true, onClick: async () => {
        if (await confirmDialog({ title: t('g_signOut'), message: t('acc_signOutMsg'), ok: t('g_signOut'), danger: true })) logout();
      } })));
  }

  root.append(group('appearance', 'sparkle',
    row({ icon: 'globe', title: t('language'), control: seg([['ar', 'العربية'], ['en', 'English']], lang(), (v) => { setLang(v); setSetting('lang', v); ctx.applyAppearance(); }) }),
    row({ icon: 'sun', title: t('theme'), control: seg([['dark', t('themeDark')], ['light', t('themeLight')], ['auto', t('themeAuto')]], s.theme, (v) => { setSetting('theme', v); ctx.applyAppearance(); }) }),
    row({ icon: 'sparkle', title: t('skin'), sub: t('skinSub'), control: picker(SKINS, s.skin || 'lapis', (v) => { setSetting('skin', v); ctx.applyAppearance(); }, 'skin_') }),
    row({ icon: 'star', title: t('accent'), sub: t('accentSub'), control: picker(ACCENTS, s.accent || 'gold', (v) => { setSetting('accent', v); ctx.applyAppearance(); }, 'accent_') }),
    row({ icon: 'image', title: t('background'), sub: t('backgroundSub'), control: seg([['full', t('bgFull')], ['calm', t('bgCalm')], ['off', t('bgOff')]], s.bg, (v) => { setSetting('bg', v); ctx.applyAppearance(); }) }),
    bgPicker(s, ctx),
    s.bgStyle === 'shapes' ? h('div', { class: 'row col' }, h('span', { class: 'row-tx' }, h('b', null, t('bgShapes')), h('small', null, t('bgShapesSub'))),
      h('div', { class: 'chips' }, BG_SHAPES.map((k) => h('button', { class: 'chip' + ((s.bgShapes || 'mix') === k ? ' on' : ''), type: 'button', onClick: () => { setSetting('bgShapes', k); ctx.applyAppearance(); } }, t('bgSh_' + k))))) : null,
    s.bgStyle === 'image' ? row({ icon: 'image', title: t('bgPicture'), sub: ctx.bgPicture.has() ? t('bgPictureSub') : t('bgNone'), control: h('div', { class: 'row-btns' },
      h('button', { class: 'btn sm', type: 'button', onClick: async () => { if (await pickPicture(ctx)) ctx.applyAppearance(); } }, ctx.bgPicture.has() ? t('bgChange') : t('bgChoose')),
      ctx.bgPicture.has() ? h('button', { class: 'btn sm ghost', type: 'button', onClick: async () => { await ctx.bgPicture.remove(); setSetting('bgImage', 0); setSetting('bgStyle', 'topo'); ctx.applyAppearance(); } }, t('bgRemove')) : null) }) : null,
    s.bgStyle === 'image' ? row({ icon: 'sun', title: t('bgDim'), sub: t('bgDimSub'), control: seg([[0.3, t('bgDim_low')], [0.55, t('bgDim_mid')], [0.8, t('bgDim_high')]], [0.3, 0.55, 0.8].reduce((a, b) => (Math.abs(b - (s.bgDim ?? 0.55)) < Math.abs(a - (s.bgDim ?? 0.55)) ? b : a)), (v) => { setSetting('bgDim', v); ctx.applyAppearance(); }) }) : null,
    row({ icon: 'play', title: t('playBtnStyle'), sub: t('playBtnSub'), control: seg([['none', t('pbNone')], ['clear', t('pbClear')], ['glass', t('pbGlass')]], s.playBtn || 'none', (v) => { setSetting('playBtn', v); ctx.applyAppearance(); }) }),
    row({ icon: 'fit', title: t('fullscreen'), sub: t(isNative() ? 'fullscreenSub' : 'fullscreenSubWeb'), control: seg([[true, t('on')], [false, t('off')]], !!s.fullscreen, (v) => { setSetting('fullscreen', v); setFullscreenSetting(v); }) })));

  root.append(group('playback', 'play',
    row({ icon: 'repeat', title: t('playMode'), sub: t('playModeSub'), control: seg([['seq', t('pm_seq')], ['all', t('pm_all')], ['one', t('pm_one')], ['once', t('pm_once')]], s.playMode || 'seq', (v) => { setSetting('playMode', v); ctx.rerender(); }) }),
    row({ icon: 'sun', title: t('keepAwake'), sub: t('keepAwakeSub'), control: seg([[true, t('on')], [false, t('off')]], s.keepAwake !== false, (v) => setSetting('keepAwake', v)) }),
    row({ icon: 'audio', title: t('bgAudio'), sub: t('bgAudioSub'), control: seg([[true, t('on')], [false, t('off')]], s.bgAudio !== false, (v) => setSetting('bgAudio', v)) }),
    playbackAvailable() ? notificationsRow() : null,
    row({ icon: 'pip', title: t('autoPip'), sub: t('autoPipSub'), control: seg([[true, t('on')], [false, t('off')]], !!s.autoPip, (v) => setSetting('autoPip', v)) }),
    row({ icon: 'mute', title: t('openMuted'), control: seg([[true, t('on')], [false, t('off')]], !!s.openMuted, (v) => setSetting('openMuted', v)) })));

  root.append(group('reading', 'book',
    row({ icon: 'bookOpen', title: t('pdfBookDefault'), sub: t('pdfBookDefaultSub'), control: seg([[true, t('on')], [false, t('off')]], !!s.pdfBook, (v) => setSetting('pdfBook', v)) })));

  // ---- Library & storage ----
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
  root.append(group('storagePlaces', 'storage', ...storageRows(ctx, { row, seg })));
  root.append(group('libStorage', 'storage',
    row({ icon: 'storage', title: t('onThisDevice'), sub: t('offlineNote') }), storage,
    row({ icon: 'image', title: t('rebuildThumbs'), sub: t('rebuildThumbsSub', { n: noPic }), onClick: async () => {
      const card = progressCard(t('rebuildingThumbs'));
      const r = await ensureThumbs({ force: true, onProgress: (i, n) => card.update(`${i} / ${n}`, n ? i / n : 1) });
      card.done();
      if (r.busy) return;
      toast(r.made || r.failed ? t('thumbsDone', r) : t('thumbsNothing'));
      ctx.rerender();
    } })));

  // ---- Backup & restore ----
  const waiting = pendingCount();
  root.append(group('backup', 'download',
    row({ icon: 'tag', title: t('backupOrg'), sub: t('backupOrgSub'), onClick: () => createBackup({ withFiles: false }) }),
    row({ icon: 'download', title: t('backupFull'), sub: t('backupFullSub'), onClick: () => createBackup({ withFiles: true }) }),
    row({ icon: 'upload', title: t('restore'), sub: t('restoreSub'), onClick: async () => { const r = await pickAndRestore(); if (r) { ctx.applyAppearance(); ctx.rerender(); } } }),
    waiting ? row({ icon: 'info', title: t('pendingTitle', { n: waiting }), sub: t('pendingSub'),
      control: h('button', { class: 'btn ghost sm', onClick: async () => { if (await confirmDialog({ title: t('pendingClear'), message: t('pendingClearMsg'), ok: t('delete'), danger: true })) { clearPending(); toast(t('pendingCleared')); ctx.rerender(); } } }, t('pendingClear')) }) : null));

  // ---- Privacy ----
  root.append(group('privacy', 'lock',
    row({ icon: 'lock', title: t('hiddenFolders'), sub: hasPin() ? t('pinIsSet') : t('pinNotSet'),
      control: hasPin()
        ? h('div', { class: 'row-btns' }, h('button', { class: 'btn ghost sm', onClick: async () => { await removePin(); } }, t('removePin')))
        : h('button', { class: 'btn primary sm', onClick: async () => { await createPin(); emit(); } }, t('createPin')) }),
    h('p', { class: 'note' }, t('pinNote'))));

  // ---- Updates ----
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
  if (isWebBuild()) {
    root.append(group('updates', 'cloud',
      row({ icon: 'download', title: t('version'), sub: `${info.version}${info.channel === 'beta' ? ' beta' : ''} · web` }),
      row({ icon: 'cloud', title: t('webUpdates'), sub: t('webUpdatesSub') }),
      whatsNewItems().length ? row({ icon: 'info', title: t('wnRow'), sub: t('wnRowSub'), onClick: () => openWhatsNew(whatsNewItems(), info.version) }) : null,
      ctx.canInstall() ? row({ icon: 'mobile', title: t('installApp'), sub: t('installSub'), onClick: () => ctx.install() }) : null,
      info.repo ? row({ icon: 'mobile', title: t('getAndroid'), sub: t('getAndroidSub'), onClick: () => openExternal(`https://github.com/${info.repo}/releases`) }) : null));
  } else
  root.append(group('updates', 'cloud',
    row({ icon: 'download', title: t('version'), sub: `${info.version}${info.channel === 'beta' ? ' beta' : ''} · build ${info.build}` }),
    row({ icon: 'sparkle', title: t('channel'), sub: t('channelSub'), control: seg([['stable', t('chStable')], ['beta', t('chBeta')]], s.channel || info.channel || 'stable', (v) => { setSetting('channel', v); ctx.rerender(); }) }),
    row({ icon: 'cloud', title: t('checkUpdates'), control: updBtn }),
    upd,
    whatsNewItems().length ? row({ icon: 'info', title: t('wnRow'), sub: t('wnRowSub'), onClick: () => openWhatsNew(whatsNewItems(), info.version) }) : null,
    ctx.canInstall() ? row({ icon: 'mobile', title: t('installApp'), sub: t('installSub'), onClick: () => ctx.install() }) : null));

  // ---- Danger zone ----
  root.append(group('data', 'trash',
    row({ icon: 'trash', title: t('deleteEverything'), sub: t('deleteEverythingSub'), danger: true, onClick: async () => {
      if (!(await confirmDialog({ title: t('deleteEverything'), message: t('deleteEverythingMsg'), ok: t('delete'), danger: true }))) return;
      await wipeAll(); toast(t('libraryCleared'));
    } })));

  root.append(h('footer', { class: 'about' },
    h('div', { class: 'about-mark' }, h('b', null, 'AHOS Library'), h('small', null, `v${info.version} · build ${info.build}`)),
    h('small', null, t('aboutLine'))));
  return root;
}
