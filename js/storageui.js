// Settings rows for "where the files are kept": the site's own space, the phone's storage, or both.
import { h, fmtBytes } from './util.js';
import { t } from './i18n.js';
import { state, setSetting, storageInfo, storageUsed, phoneUsable, moveAllStorage } from './store.js';
import { actionSheet, confirmDialog, progressCard, toast } from './ui.js';

const GB = 1024 * 1024 * 1024;
const LIMITS = [0, 2 * GB, 5 * GB, 10 * GB, 20 * GB, 50 * GB, 100 * GB];
const limitText = (v) => (v > 0 ? fmtBytes(v) : t('st_noLimit'));

function meterBlock(title, icon) {
  const bar = h('i');
  const line = h('small', null, '…');
  const el = h('div', { class: 'storage st-place' }, h('b', { class: 'st-title' }, title), h('div', { class: 'meter' }, bar), line);
  return { el, set(pct, text) { bar.style.width = Math.max(2, Math.min(100, pct)) + '%'; line.textContent = text; } };
}

async function moveFlow(to, ctx) {
  const u = storageUsed();
  const n = to === 'phone' ? u.nSite : u.nPhone, size = to === 'phone' ? u.site : u.phone;
  if (!n) { toast(t('st_moveNone')); return; }
  if (!await confirmDialog({ title: t('st_moveAsk', { n }), message: t('st_moveAskMsg', { size: fmtBytes(size) }), ok: t('st_moveGo') })) return;
  let stop = false;
  const card = progressCard(t('st_moving'), { onCancel: () => { stop = true; } });
  let r;
  try {
    r = await moveAllStorage(to, {
      shouldStop: () => stop,
      onProgress: ({ done, total, name, f }) => card.update(`${done + 1} / ${total}  ·  ${name}`, (done + f) / total),
    });
  } catch (e) { console.warn('move failed', e); r = { moved: 0, failed: n, full: false }; }
  card.done();
  const parts = [t('st_movedN', { n: r.moved })];
  if (r.full) parts.push(t('st_moveFull'));
  else if (r.failed) parts.push(t('st_moveFailed', { n: r.failed }));
  toast(parts.join(' · '), { ms: 6000 });
  ctx.rerender();
}

/** The rows of the "Storage places" group. helpers = { row, seg } from the settings screen. */
export function storageRows(ctx, { row, seg }) {
  const s = state.settings;
  const phone = phoneUsable();
  const mode = phone && ['site', 'both', 'phone'].includes(s.storeMode) ? s.storeMode : 'site';
  const rows = [];

  if (!phone) {
    rows.push(row({ icon: 'mobile', title: t('st_phoneTitle'), sub: t('st_noPhone') }));
  } else {
    rows.push(row({ icon: 'storage', title: t('st_where'), sub: t('st_whereSub'),
      control: seg([['site', t('st_site')], ['both', t('st_both')], ['phone', t('st_phone')]], mode, (v) => { setSetting('storeMode', v); ctx.rerender(); }) }));
    if (mode === 'both') {
      rows.push(row({ icon: 'sort', title: t('st_first'), sub: t('st_firstSub'),
        control: seg([['site', t('st_site')], ['phone', t('st_phone')]], s.storeFirst === 'phone' ? 'phone' : 'site', (v) => { setSetting('storeFirst', v); ctx.rerender(); }) }));
    }
    if (mode !== 'site') {
      rows.push(row({ icon: 'mobile', title: t('st_limit'), sub: t('st_limitSub'),
        control: h('span', { class: 'row-val' }, limitText(s.phoneLimit || 0)),
        onClick: () => actionSheet(t('st_limit'), LIMITS.map((v) => ({ label: limitText(v), checked: (s.phoneLimit || 0) === v, onClick: () => { setSetting('phoneLimit', v); ctx.rerender(); } }))) }));
    }
  }

  const site = meterBlock(t('st_siteTitle')), ph = meterBlock(t('st_phoneTitle'));
  rows.push(site.el);
  if (phone) rows.push(ph.el);
  storageInfo().then((si) => {
    site.set(si.quota ? (si.usage / si.quota) * 100 : 0, si.quota
      ? t('st_siteLine', { files: fmtBytes(si.site.files), used: fmtBytes(si.usage), quota: fmtBytes(si.quota) })
      : t('storageFiles', { files: fmtBytes(si.site.files) }));
    if (phone) {
      const free = si.phone.free;
      const total = free >= 0 ? si.phone.files + free : 0;
      ph.set(total ? (si.phone.files / total) * 100 : 0, free >= 0
        ? t('st_phoneLine', { files: fmtBytes(si.phone.files), free: fmtBytes(free) })
        : t('storageFiles', { files: fmtBytes(si.phone.files) }));
    }
  });

  if (phone) {
    const u = storageUsed();
    rows.push(row({ icon: 'move', title: t('st_move'), sub: t('st_moveSub'), onClick: () => actionSheet(t('st_move'), [
      { icon: 'mobile', label: t('st_moveToPhone', { n: u.nSite, size: fmtBytes(u.site) }), onClick: () => moveFlow('phone', ctx) },
      { icon: 'globe', label: t('st_moveToSite', { n: u.nPhone, size: fmtBytes(u.phone) }), onClick: () => moveFlow('site', ctx) },
    ]) }));
  }
  return rows;
}
