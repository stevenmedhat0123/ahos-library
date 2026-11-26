// Testing & Publishing – the owner's own section.
//  1. This phone: look for the newest build on GitHub (beta or stable) and install it here first.
//  2. Builds: pick one and send it to the members as Beta or Stable, with the details (title, what is new in both languages) edited by hand.
//  3. What members get now: the build each channel receives, and a way to withdraw one.
// Members never ask GitHub: they ask the access server, which only knows what the owner sent here (see updater.js).
import { h, fmtBytes, fmtDate } from '../util.js';
import { ic } from '../icons.js';
import { t, lang } from '../i18n.js';
import { toast, openSheet, confirmDialog } from '../ui.js';
import { admin } from '../auth.js';
import { sfx } from '../sound.js';
import { getAppInfo, listGithubReleases, checkForUpdates } from '../updater.js';
import { openUpdateSheet, splitNotes } from './update.js';

/** Version text is always left-to-right; isolate it so it does not scramble inside an Arabic line. */
const ltr = (v) => '\u2066' + v + '\u2069';
const chanName = (c) => t(c === 'stable' ? 'pub_stable' : 'pub_beta');

/** The newest build each channel's members receive: Stable members – the newest Stable; Beta members – the newest of either. */
export function liveBuilds(items) {
  const ok = items.filter((x) => !x.withdrawn).sort((a, b) => b.build - a.build || b.time - a.time);
  return { stable: ok.find((x) => x.channel === 'stable') || null, beta: ok[0] || null };
}

/** The "Send to members" sheet for one GitHub build. */
function openSendSheet(rel, onSent) {
  const notes = splitNotes(rel.notes);
  const sheet = openSheet({ title: t('pub_sendTitle'), tall: true });
  let channel = rel.prerelease ? 'beta' : 'stable';
  const label = h('input', { class: 'field', type: 'text', maxlength: 120, value: rel.label || '', 'aria-label': t('pub_label'), dir: 'auto' });
  const en = h('textarea', { class: 'field', rows: 5, maxlength: 3000, 'aria-label': t('pub_notesEn'), dir: 'ltr' }, notes.en.join('\n'));
  const ar = h('textarea', { class: 'field', rows: 5, maxlength: 3000, 'aria-label': t('pub_notesAr'), dir: 'rtl' }, notes.ar.join('\n'));
  const sub = h('p', { class: 'note' });
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': t('pub_channel') });
  const paint = () => {
    seg.replaceChildren(...['beta', 'stable'].map((c) => h('button', { class: 'seg-b' + (channel === c ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(channel === c), dataset: { ch: c }, onClick: () => { channel = c; paint(); } }, chanName(c))));
    sub.textContent = t(channel === 'beta' ? 'pub_chanBetaSub' : 'pub_chanStableSub');
  };
  paint();
  const go = h('button', { class: 'btn primary lg', type: 'submit' }, h('span', { html: ic('rocket') }), t('pub_go'));
  const form = h('form', { class: 'pub-form', novalidate: true, onSubmit: async (e) => {
    e.preventDefault();
    if (!(await confirmDialog({ title: t('pub_sendTitle'), message: t('pub_confirm', { v: label.value.trim() || rel.label, c: chanName(channel) }), ok: t('pub_go') }))) return;
    go.disabled = true;
    try {
      await admin('release/publish', { channel, build: rel.build, version: String(rel.tag || '').replace(/^v/i, ''), label: label.value, url: rel.url, size: rel.size, notes_en: en.value, notes_ar: ar.value });
      sfx('select'); toast(t('pub_done')); sheet.close(); onSent();
    } catch { toast(t('pub_failed')); } finally { go.disabled = false; }
  } },
  h('div', { class: 'upd-head' }, h('b', { dir: 'ltr' }, `${rel.tag || rel.label}`), h('small', null, `${t('pub_build', { v: ltr(String(rel.tag || '').replace(/^v/i, '') || '?'), b: rel.build })}${rel.size ? ' · ' + fmtBytes(rel.size) : ''}`)),
  h('label', { class: 'g-f' }, h('span', null, t('pub_channel')), seg), sub,
  h('label', { class: 'g-f' }, h('span', null, t('pub_label')), label),
  h('label', { class: 'g-f' }, h('span', null, t('pub_notesEn')), en),
  h('label', { class: 'g-f' }, h('span', null, t('pub_notesAr')), ar),
  go);
  sheet.body.append(form);
}

/** The section's page. */
export async function renderPublish() {
  const info = getAppInfo();
  const root = h('div', { class: 'pub' });
  let github = { status: 'idle', list: [] }, sent = [];

  const phoneOut = h('div');
  const checkBtn = h('button', { class: 'btn', type: 'button', onClick: async () => {
    checkBtn.disabled = true; checkBtn.textContent = t('pub_checking');
    const r = await checkForUpdates({ manual: true });
    checkBtn.disabled = false; checkBtn.textContent = t('pub_check');
    phoneOut.replaceChildren(...(r.status === 'available'
      ? [h('div', { class: 'pub-found' }, h('b', { dir: 'auto' }, `${t('pub_found')}: ${r.release.label}`), h('button', { class: 'btn sm', type: 'button', onClick: () => openUpdateSheet(r.release) }, t('pub_install')))]
      : [h('p', { class: 'note', style: { color: '#fff' } }, r.status === 'latest' ? t('pub_latest') : r.status === 'norepo' ? t('pub_norepo') : t(r.reason === 'offline' ? 'pub_offline' : 'pub_err'))]));
    if (r.status !== 'norepo') await load();
  } }, t('pub_check'));
  const hero = h('section', { class: 'pub-hero' }, h('small', null, t('pub_phone')), h('b', null, t('pub_build', { v: ltr(info.version || '?'), b: info.build || 0 })), checkBtn, phoneOut);

  const buildsBox = h('div', { class: 'pub-card' });
  const liveBox = h('div', { class: 'pub-card' });

  const chipsFor = (b) => {
    const mine = sent.filter((x) => x.build === b.build && !x.withdrawn);
    return mine.length ? mine.map((x) => h('span', { class: 'pub-chip ' + x.channel }, t('pub_sentAs', { c: chanName(x.channel) }))) : [h('span', { class: 'pub-chip' }, t('pub_onlyYou'))];
  };
  const paint = () => {
    // 1) builds
    const list = github.list;
    buildsBox.replaceChildren(
      h('h3', null, t('pub_builds'), h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': t('pub_refresh'), onClick: () => load(), html: ic('refresh') })),
      h('p', { class: 'note' }, t('pub_buildsSub')),
      ...(github.status === 'norepo' ? [h('p', { class: 'note' }, t('pub_norepo'))]
        : github.status === 'error' ? [h('p', { class: 'note' }, t(github.reason === 'offline' ? 'pub_offline' : 'pub_err'))]
          : list.length ? list.map((b) => h('button', { class: 'pub-build', type: 'button', dataset: { build: String(b.build) }, onClick: () => openSendSheet(b, load) },
            h('b', { dir: 'auto' }, b.label), h('small', null, b.size ? fmtBytes(b.size) : ''),
            h('div', { class: 'pub-chips' }, h('span', { class: 'pub-chip ' + (b.prerelease ? 'beta' : 'stable') }, chanName(b.prerelease ? 'beta' : 'stable') + ' · GitHub'), ...chipsFor(b)),
            h('small', { style: { gridColumn: '1 / -1' } }, b.time ? fmtDate(b.time, lang()) : '')))
            : [h('p', { class: 'note' }, github.status === 'idle' ? t('pub_checking') : t('pub_noBuilds'))]));
    // 2) what members get
    const live = liveBuilds(sent);
    const liveRow = (key, rel) => h('div', { class: 'pub-live-row', dataset: { live: key } },
      h('span', null, h('small', null, t(key === 'stable' ? 'pub_liveStable' : 'pub_liveBeta')), h('b', { dir: 'auto' }, rel ? (rel.label || rel.version) : t('pub_none')), rel ? h('small', null, `${t('pub_build', { v: ltr(rel.version || '?'), b: rel.build })} · ${chanName(rel.channel)}`) : null),
      rel ? h('button', { class: 'btn ghost sm danger-t', type: 'button', onClick: () => withdraw(rel) }, t('pub_withdraw')) : null);
    const old = sent.filter((x) => x !== live.stable && x !== live.beta);
    liveBox.replaceChildren(
      h('h3', null, t('pub_live')),
      h('div', { class: 'pub-live' }, liveRow('stable', live.stable), liveRow('beta', live.beta)),
      old.length ? h('h3', null, t('pub_history')) : null,
      ...old.map((x) => h('div', { class: 'pub-live-row' + (x.withdrawn ? ' off' : '') },
        h('span', null, h('b', { dir: 'auto' }, x.label || x.version), h('small', null, `${chanName(x.channel)} · ${t('pub_build', { v: ltr(x.version || '?'), b: x.build })} · ${fmtDate(x.time, lang())}${x.withdrawn ? ' · ' + t('pub_withdrawn') : ''}`)),
        x.withdrawn ? null : h('button', { class: 'btn ghost sm danger-t', type: 'button', onClick: () => withdraw(x) }, t('pub_withdraw')))));
  };
  async function withdraw(rel) {
    if (!(await confirmDialog({ title: t('pub_withdrawQ'), message: t('pub_withdrawMsg'), ok: t('pub_withdraw'), danger: true }))) return;
    try { await admin('release/withdraw', { id: rel.id }); sfx('select'); await load(); } catch { toast(t('pub_failed')); }
  }
  async function load() {
    const [g, s] = await Promise.all([listGithubReleases(), admin('release/list').then((r) => r.items).catch(() => sent)]);
    github = g; sent = s; paint();
  }
  paint();
  root.append(hero, buildsBox, liveBox);
  load();
  return root;
}
