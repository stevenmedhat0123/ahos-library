// One file that keeps the sound (or video, or photo) together with its text: "name.ahostx".
//   8 bytes  "AHOSTX1\n"
//   4 bytes  length of the header (big endian)
//   header   JSON, UTF-8: { v, name, kind, ext, mime, size, tx }
//   the rest the original media file, byte for byte
// The media is never read into memory (Blob slices), so a long recording is as cheap as a short one.
const MAGIC = 'AHOSTX1\n';
export const TX_EXT = 'ahostx';
export const TX_MIME = 'application/x-ahos-transcript';

const enc = new TextEncoder(), dec = new TextDecoder('utf-8');

/** Builds the single file from an item's description ({ name, kind, ext, mime }), its transcription and its media Blob. */
export function packTx(meta, tx, media) {
  const head = enc.encode(JSON.stringify({ v: 1, name: meta.name, kind: meta.kind, ext: meta.ext || '', mime: meta.mime || (media && media.type) || '', size: media ? media.size : 0, tx }));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, head.length, false);
  return new Blob([enc.encode(MAGIC), len, head, media || new Blob([])], { type: TX_MIME });
}

/** Is this file one of ours? (by its first bytes, not its name) */
export async function isTxFile(file) {
  try { return dec.decode(await file.slice(0, MAGIC.length).arrayBuffer()) === MAGIC; } catch { return false; }
}

/** Opens a single file: { head, media } (media is a Blob with the right type), or null when it is not one of ours / is damaged. */
export async function unpackTx(file) {
  try {
    if (!(await isTxFile(file))) return null;
    const lenAt = MAGIC.length;
    const n = new DataView(await file.slice(lenAt, lenAt + 4).arrayBuffer()).getUint32(0, false);
    if (n <= 0 || n > 8 * 1024 * 1024 || lenAt + 4 + n > file.size) return null;
    const head = JSON.parse(dec.decode(await file.slice(lenAt + 4, lenAt + 4 + n).arrayBuffer()));
    if (!head || head.v !== 1 || !head.tx || typeof head.tx.text !== 'string') return null;
    const media = file.slice(lenAt + 4 + n);
    if (head.size && media.size !== head.size) return null;            // cut short on the way
    return { head, media: media.size ? media.slice(0, media.size, head.mime || '') : null };
  } catch { return null; }
}

/** A file name that is safe on any phone: no slashes, no control characters, ending .ahostx. */
export function packName(name) {
  const base = String(name || 'transcript').replace(/\.[^./\\]{1,8}$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'transcript';
  return `${base}.${TX_EXT}`;
}
