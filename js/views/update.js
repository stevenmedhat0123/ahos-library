// The "new version" sheet: what changed, a Download button with a live progress line (file name, size so far, speed),
// then an Install button. Also the "What's new" sheet shown once after the app has been updated.
import { h, fmtBytes, fmtDur } from '../util.js';
import { t, lang } from '../i18n.js';
import { openSheet } from '../ui.js';
import { dl, onDownloadChange, startDownload, cancelDownloadNow, installDownloaded, canDownloadInApp } from '../updater.js';

const AR = /[؀-ۿ]/;
/** GitHub release text -> only the lines in the user's language, without the install boilerplate. */
export function releaseNotes(body, language = lang()) {
  const lines = String(body || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
    .filter((x) => !/^\*\*AHOS/i.test(x) && !/^(Install:|التثبيت:)/i.test(x) && !x.startsWith('>'));
  const want = language === 'ar';
  const mine = lines.filter((x) => AR.test(x) === want);
  return mine.length ? mine : lines;
}

const pct = (d) => (d.total > 0 ? Math.min(100, Math.floor((d.bytes / d.total) * 100)) : 0);

export function openUpdateSheet(release) {
  let off = () => {};
  const sheet = openSheet({ title: t('updTitle'), className: 'upd-sheet', onClose: () => off() });
  const mine = () => dl.release && dl.release.url === release.url;

  const notes = releaseNotes(release.notes);
  const bar = h('i');
  const barEl = h('div', { class: 'upd-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar);
  const fileEl = h('div', { class: 'upd-file', dir: 'ltr' });
  const sizeEl = h('span');
  const speedEl = h('span');
  const prog = h('div', { class: 'upd-prog' }, fileEl, barEl, h('div', { class: 'upd-nums' }, sizeEl, speedEl));
  const msg = h('div', { class: 'upd-msg' });
  const main = h('button', { class: 'btn primary lg', type: 'button' });
  const cancel = h('button', { class: 'btn ghost', type: 'button', onClick: () => cancelDownloadNow() }, t('cancel'));

  sheet.body.append(
    h('div', { class: 'upd-head' }, h('b', { dir: 'auto' }, release.label), release.size ? h('small', null, fmtBytes(release.size)) : null),
    notes.length ? h('div', { class: 'upd-notes' }, notes.map((x) => h('p', { dir: 'auto' }, x))) : null,
    main, prog, cancel, msg);

  const paint = () => {
    const d = mine() ? dl : { state: 'idle', bytes: 0, total: 0, speed: 0, name: '', error: '', needsPermission: false };
    const busy = d.state === 'starting' || d.state === 'downloading';
    const done = d.state === 'ready' || d.state === 'installing';
    prog.hidden = !(busy || done);
    cancel.hidden = !busy;
    msg.hidden = true; msg.className = 'upd-msg';
    main.disabled = busy;
    if (busy) {
      main.textContent = `${t('updDownloading')} ${pct(d)}%`;
      main.onclick = null;
    } else if (done) {
      main.textContent = t('updInstall');
      main.onclick = () => installDownloaded();
    } else {
      main.textContent = d.state === 'error' ? t('updRetry') : (release.size ? `${t('downloadUpdate')} · ${fmtBytes(release.size)}` : t('downloadUpdate'));
      main.onclick = async () => { const r = await startDownload(release); if (r === 'external') show(t('updBrowser')); };
    }
    if (busy || done) {
      const total = d.total > 0 ? d.total : release.size || 0;
      const p = done ? 100 : pct({ bytes: d.bytes, total });
      fileEl.textContent = d.name || '';
      bar.style.width = p + '%';
      barEl.setAttribute('aria-valuenow', String(p));
      sizeEl.textContent = done ? `${t('updDone')} · ${fmtBytes(d.bytes)}` : total ? `${fmtBytes(d.bytes)} / ${fmtBytes(total)} · ${p}%` : fmtBytes(d.bytes);
      speedEl.textContent = busy && d.speed > 0 ? `${fmtBytes(d.speed)}/s${total > d.bytes ? ' · ' + t('updLeft', { t: fmtDur((total - d.bytes) / d.speed) }) : ''}` : '';
    }
    if (d.state === 'error') show(t('updFailed', { e: d.error }), 'bad');
    else if (d.needsPermission) show(t('updNeedPerm'), 'warn');
    else if (d.state === 'installing') show(t('updInstalling'));
    else if (done && d.error) show(t('updFailed', { e: d.error }), 'bad');
  };
  function show(text, kind = '') { msg.hidden = false; msg.className = 'upd-msg ' + kind; msg.textContent = text; }
  off = onDownloadChange(paint);
  if (!canDownloadInApp()) { /* browser build: the button opens the file in the browser */ }
  paint();
  return sheet;
}

/** "What's new": a short list in the user's language. `items` = ['…', …]. */
export function openWhatsNew(items, version) {
  const sheet = openSheet({ title: t('wnTitle'), className: 'upd-sheet' });
  sheet.body.append(
    h('div', { class: 'upd-head' }, h('b', null, `AHOS Library ${version || ''}`.trim())),
    h('ul', { class: 'wn-list' }, items.map((x) => h('li', { dir: 'auto' }, x))),
    h('button', { class: 'btn primary lg', type: 'button', onClick: () => sheet.close() }, t('wnOk')));
  return sheet;
}
