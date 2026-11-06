// Name normalisation shared with the access server (server/worker.js). Keep the two in sync: the password salt is derived from this key.
export function nameKey(name) {
  return String(name || '').normalize('NFKC')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
export function validName(name) {
  const clean = String(name || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (clean.length > 80) return false;
  if (!/^[\p{L}\p{M}' -]+$/u.test(clean)) return false;
  const parts = clean.split(' ').filter((p) => p.replace(/[^\p{L}]/gu, '').length >= 2);
  return parts.length >= 4;
}
export const cleanName = (name) => String(name || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
