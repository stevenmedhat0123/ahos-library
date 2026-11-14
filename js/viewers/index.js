// Chooses the right viewer for an item. Viewers load lazily so start-up stays fast.
import { state } from '../store.js';
import { actionSheet, toast } from '../ui.js';
import { t } from '../i18n.js';
import { exportItem, itemDetails, renameItem, deleteItems } from '../actions.js';
import { fmtBytes } from '../util.js';

export async function openItem(id, list = []) {
  const it = state.items.get(id);
  if (!it) return;
  try {
    if (it.kind === 'video' || it.kind === 'audio') return (await import('./video.js')).openMedia(id, list);
    if (it.kind === 'image') return (await import('./image.js')).openImages(id, list);
    if (it.kind === 'book') {
      if (it.ext === 'board') return (await import('./board.js')).openBoard(id);
      if (it.ext === 'pdf') return (await import('./pdf.js')).openPdf(id);
      if (it.ext === 'epub') return (await import('./epub.js')).openEpubBook(id);
      return (await import('./text.js')).openText(id);
    }
  } catch (e) {
    console.error('viewer failed', e);
    toast(t('viewerFailed'));
    return;
  }
  actionSheet(`${it.name}  ·  ${fmtBytes(it.size)}`, [
    { icon: 'share', label: t('exportOpenWith'), hint: t('noPreview'), onClick: () => exportItem(id) },
    { icon: 'info', label: t('details'), onClick: () => itemDetails(id) },
    { icon: 'edit', label: t('rename'), onClick: () => renameItem(id) },
    { icon: 'trash', label: t('delete'), danger: true, onClick: () => deleteItems([id]) },
  ]);
}
