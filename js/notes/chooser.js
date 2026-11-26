// "New note": a text note you type, or a handwriting note (a board with ruled pages). Asked every time – both are one tap away.
import { t } from '../i18n.js';
import { actionSheet, toast } from '../ui.js';

export async function newTextNote({ folderId = null, openItem } = {}) {
  try {
    const { createTextNote } = await import('./model.js');
    const id = await createTextNote({ folderId });
    openItem?.(id);
    return id;
  } catch (e) { console.warn('new text note', e); toast(t('bd_failed')); return null; }
}

export async function newHandNote({ folderId = null, openItem } = {}) {
  try {
    const [{ newNoteSheet }, { createNote }] = await Promise.all([import('../board/sheets.js'), import('../board/note.js')]);
    newNoteSheet({ folderId, onCreate: async (paper) => { try { openItem?.(await createNote({ folderId, paper })); } catch (e) { console.warn('new note', e); toast(t('bd_failed')); } } });
  } catch (e) { console.warn('new note', e); toast(t('bd_failed')); }
}

export function newNoteChooser(opts = {}) {
  actionSheet(t('note_new'), [
    { icon: 'textNote', label: t('nt_newText'), hint: t('nt_newTextHint'), onClick: () => newTextNote(opts) },
    { icon: 'bdPen', label: t('nt_newHand'), hint: t('nt_newHandHint'), onClick: () => newHandNote(opts) },
  ]);
}
