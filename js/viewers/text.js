// Plain-text reader (.txt, .md) with the same look as the book reader.
import { h, clamp, debounce, readText, esc } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { state, getBlob, setSetting } from '../store.js';
import { mountViewer, touchOpened, saveProgress, barBtn } from './common.js';
import { itemActions } from '../actions.js';

const THEMES = ['paper', 'sepia', 'dark', 'black'];
const COLORS = { paper: ['#F6F0E0', '#2B2418'], sepia: ['#E7D8BA', '#3A2E1B'], dark: ['#10173A', '#E8E1CC'], black: ['#000', '#C9C2AE'] };

export async function openText(id) {
  const item = state.items.get(id);
  if (!item) return;
  touchOpened(id);
  const rs = { ...state.settings.reader };
  const V = mountViewer('textv', { onClose: () => { persist.flush?.(); } });
  const root = V.el;
  const body = h('article', { class: 'tx-body' });
  const scroller = h('div', { class: 'tx-scroll' }, body);
  const paint = () => {
    const [bg, fg] = COLORS[rs.theme] || COLORS.paper;
    root.style.setProperty('--ep-bg', bg); root.style.setProperty('--ep-fg', fg);
    body.style.fontSize = rs.size + 'px'; body.style.lineHeight = rs.lh;
    body.style.fontFamily = rs.font === 'sans' ? 'Inter, "Noto Sans Arabic", system-ui, sans-serif' : 'Georgia, "Noto Naskh Arabic", serif';
  };
  const change = (k, v) => { rs[k] = v; setSetting('reader', { ...rs }); paint(); };
  const top = h('div', { class: 'rv-top' },
    h('button', { class: 'vbtn', 'aria-label': t('back'), onClick: () => V.close(), html: ic('back', 'flip-rtl') }),
    h('div', { class: 'rv-title', dir: 'auto' }, item.name.replace(/\.[^.]+$/, '')),
    h('button', { class: 'vbtn txt', 'aria-label': 'A-', onClick: () => change('size', clamp(rs.size - 1, 12, 36)) }, 'A−'),
    h('button', { class: 'vbtn txt', 'aria-label': 'A+', onClick: () => change('size', clamp(rs.size + 1, 12, 36)) }, 'A+'),
    h('button', { class: 'vbtn', 'aria-label': t('theme'), onClick: () => change('theme', THEMES[(THEMES.indexOf(rs.theme) + 1) % THEMES.length]), html: ic('moon') }),
    barBtn('more', t('more'), () => itemActions(id, { afterDelete: () => V.close() })));
  root.append(scroller, top);
  paint();

  const blob = await getBlob(id);
  const text = blob ? await readText(blob) : '';
  const parts = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const frag = document.createDocumentFragment();
  for (const p of parts) { const el = document.createElement('p'); el.dir = 'auto'; el.textContent = p; el.style.whiteSpace = 'pre-wrap'; frag.append(el); }
  body.append(frag);

  const persist = debounce(() => {
    const max = scroller.scrollHeight - scroller.clientHeight;
    const r = max > 0 ? scroller.scrollTop / max : 0;
    saveProgress(id, r, r);
  }, 700);
  scroller.addEventListener('scroll', persist, { passive: true });
  const r0 = item.progress?.pos;
  if (typeof r0 === 'number' && r0 > 0.01 && r0 < 0.99) requestAnimationFrame(() => { scroller.scrollTop = r0 * (scroller.scrollHeight - scroller.clientHeight); });
  let sx = 0, sy = 0;
  scroller.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
  scroller.addEventListener('pointerup', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) < 8) root.classList.toggle('chrome-off'); });
}

export { esc };
