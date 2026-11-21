// Subscriptions & Codes – a section of its own, for everybody.
//   a member:  "my subscription" (days left, end date), enter a new code, check again, and the account (password, sign out)
//   the owner: the codes, the members and his own account, in three tabs
import { h, fmtDate } from '../util.js';
import { ic } from '../icons.js';
import { t, lang } from '../i18n.js';
import { toast, confirmDialog, promptDialog } from '../ui.js';
import { gateEnabled, sessionInfo, isOwner, isForever, daysLeft, redeem, refresh, changePassword, logout } from '../auth.js';
import { sfx } from '../sound.js';
import { errText } from './gate.js';

const SOON_DAYS = 7;       // "ending soon" – the ring turns amber
const RING_DAYS = 30;      // the ring is full when a month or more is left

/** Asks for the current and then the new password. Resolves to { cur, next } or null when cancelled / too short. */
export async function askPasswords(title, curMsg, nextMsg, min) {
  const cur = await promptDialog({ title, message: curMsg, type: 'password', ok: t('next'), maxlength: 200 });
  if (!cur) return null;
  const next = await promptDialog({ title, message: nextMsg, type: 'password', ok: t('save'), maxlength: 200 });
  if (!next) return null;
  if (next.length < min) { toast(t('g_pwShort', { n: min })); return null; }
  return { cur, next };
}

const ringSvg = (frac, forever) => {
  const r = 52, c = 2 * Math.PI * r;
  return `<svg viewBox="0 0 120 120" aria-hidden="true"><circle class="sb-ring-bg" cx="60" cy="60" r="${r}"/><circle class="sb-ring-fg" cx="60" cy="60" r="${r}" stroke-dasharray="${(c * (forever ? 1 : Math.max(0.04, Math.min(1, frac)))).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 60 60)"/></svg>`;
};

/** The big card on top: how much of the subscription is left. */
function statusCard(info) {
  const forever = info.role === 'owner' || isForever(info.end);
  const n = forever ? 0 : daysLeft(info.end);
  const soon = !forever && n <= SOON_DAYS;
  const card = h('section', { class: 'sb-hero' + (soon ? ' soon' : '') + (forever ? ' forever' : ''), 'aria-live': 'polite' });
  const centre = forever
    ? h('b', { class: 'sb-num inf', html: ic('infinity') })
    : h('b', { class: 'sb-num' }, String(n));
  card.append(
    h('div', { class: 'sb-ring', html: ringSvg(n / RING_DAYS, forever) }, h('div', { class: 'sb-ring-tx' }, centre, forever ? null : h('small', null, t('subs_days')))),
    h('div', { class: 'sb-hero-tx' },
      h('small', { class: 'sb-who', dir: 'auto' }, info.name),
      h('h2', null, info.role === 'owner' ? t('subs_ownerNoEnd') : forever ? t('acc_forever') : t('subs_active')),
      info.role === 'owner' ? h('p', null, t('subs_ownerNoEndSub'))
        : forever ? h('p', null, t('subs_foreverSub'))
          : h('p', null, t('acc_untilLeft', { date: fmtDate(info.end, lang()), n })),
      soon ? h('p', { class: 'sb-warn' }, t('acc_soon', { n })) : null));
  return card;
}

/** Enter a new code (extends the subscription from where it ends). */
function codeCard(repaint) {
  const input = h('input', { class: 'field g-code', type: 'text', dir: 'ltr', placeholder: t('o_codePh'), 'aria-label': t('g_code'), autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', maxlength: 64 });
  const btn = h('button', { class: 'btn primary lg', type: 'submit' }, t('g_activate'));
  const form = h('form', { class: 'sb-card sb-code', novalidate: true, onSubmit: async (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (!code) { toast(t('g_codeNeeded')); input.focus(); return; }
    btn.disabled = true;
    try {
      const end = await redeem(code);
      sfx('select');
      toast(isForever(end) ? t('g_validForever') : t('g_validUntil', { date: fmtDate(end, lang()) }));
      input.value = '';
      repaint();
    } catch (x) { sfx('error'); toast(errText(x)); } finally { btn.disabled = false; }
  } },
  h('div', { class: 'sb-card-hd' }, h('span', { class: 'set-ico sm', style: { '--g1': '#FCD34D', '--g2': '#F59E0B' }, html: ic('key') }), h('b', null, t('acc_newCode'))),
  h('p', { class: 'note' }, t('subs_codeSub')),
  input, btn);
  return form;
}

const row = (icon, title, sub, onClick, danger = false) => h('button', { class: 'row tap' + (danger ? ' danger' : ''), type: 'button', onClick },
  h('span', { class: 'row-ic', html: ic(icon) }), h('span', { class: 'row-tx' }, h('b', null, title), sub ? h('small', null, sub) : null));

/** Name, change password, sign out. */
function accountCard(info) {
  const initial = Array.from(info.name || '?')[0].toUpperCase();
  return h('section', { class: 'sb-card sb-acc' },
    h('div', { class: 'sb-me' }, h('span', { class: 'sb-avatar', 'aria-hidden': 'true' }, initial),
      h('span', { class: 'sb-me-tx' }, h('b', { dir: 'auto' }, info.name), h('small', null, info.role === 'owner' ? t('acc_owner') : t('subs_member')))),
    h('div', { class: 'set-list' },
      row('lock', t('acc_changePw'), null, async () => {
        const r = await askPasswords(t('acc_changePw'), t('acc_curPw'), t('g_newPw'), info.role === 'owner' ? 8 : 6);
        if (!r) return;
        try { await changePassword(r.cur, r.next); sfx('select'); toast(t('g_pwChanged')); } catch (x) { toast(errText(x)); }
      }),
      row('upload', t('g_signOut'), null, async () => {
        if (await confirmDialog({ title: t('g_signOut'), message: t('acc_signOutMsg'), ok: t('g_signOut'), danger: true })) logout();
      }, true)));
}

/** "Check again" – asks the server how things stand now (a new code the owner just made, a block, a new end date). */
function syncButton(repaint) {
  const b = h('button', { class: 'btn ghost sb-sync', type: 'button', onClick: async () => {
    b.disabled = true;
    const r = await refresh();
    b.disabled = false;
    if (r.offline) { toast(t('g_err_offline')); return; }
    toast(t('subs_synced'));
    repaint();
  } }, h('span', { html: ic('refresh') }), t('g_checkAgain'));
  return b;
}

/** The owner's three tabs: codes, members, his account. */
async function ownerTabs(info) {
  const m = await import('./owner.js');
  return m.renderOwnerTabs(info);
}

/** The section's page (called by section.js with the app context). */
export async function renderSubs(ctx) {
  const root = h('div', { class: 'subs' });
  const paint = async () => {
    const info = sessionInfo();
    if (!gateEnabled() || !info) {
      root.replaceChildren(h('div', { class: 'sb-card sb-off' }, h('b', null, t('subs_off')), h('p', { class: 'note' }, t('subs_offSub'))));
      return;
    }
    if (isOwner()) {
      const tabs = await ownerTabs(info);
      root.replaceChildren(statusCard(info), tabs);
      return;
    }
    root.replaceChildren(statusCard(info), codeCard(paint), syncButton(paint), accountCard(info));
  };
  await paint();
  root.refresh = () => paint();
  return root;
}
