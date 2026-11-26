// Which folder each media page (Videos, Photos, Audio, PDFs & files) is showing right now. null = the page itself.
// Kept apart from the page code so app.js can step "back" out of a folder without loading the page.
import { state } from '../store.js';

const cur = {};
export const kindFolder = (sec) => (sec && cur[sec] && state.folders.has(cur[sec]) ? cur[sec] : null);
export const setKindFolder = (sec, id) => { if (sec) cur[sec] = id || null; };
/** One step up out of a folder (to the folder it sits in, or to the page). False when the page was not inside a folder. */
export function kindFolderUp(sec) {
  const id = kindFolder(sec);
  if (!id) return false;
  cur[sec] = state.folders.get(id).parentId || null;
  return true;
}
