// Sound for the speech engines: a recording, a song or the sound track of a video becomes plain 16 kHz mono samples (what Whisper listens to),
// and can be cut into short WAV pieces (what the cloud engine is sent). The browser does the decoding, so whatever the phone can play works.
const RATE = 16000;
/** Longer than this is not decoded in one go (a phone runs out of memory): the person is told to cut it into parts. */
export const MAX_SECONDS = 50 * 60;

/** Samples (Float32, mono, 16 kHz) and the length in seconds of any sound or video file. Throws { code: 'decode' | 'too_long' | 'empty' }. */
export async function decodeMono16k(blob, onProgress) {
  const Ctx = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : (typeof webkitOfflineAudioContext !== 'undefined' ? webkitOfflineAudioContext : null);
  if (!Ctx) throw Object.assign(new Error('decode'), { code: 'decode' });
  if (onProgress) onProgress(0.05);
  const buf = await blob.arrayBuffer();
  let audio;
  try { audio = await new Ctx(1, RATE, RATE).decodeAudioData(buf); } catch { throw Object.assign(new Error('decode'), { code: 'decode' }); }
  if (!audio || !audio.length) throw Object.assign(new Error('empty'), { code: 'empty' });
  if (audio.duration > MAX_SECONDS) throw Object.assign(new Error('too_long'), { code: 'too_long', seconds: audio.duration });
  const n = audio.numberOfChannels, out = new Float32Array(audio.length);
  for (let c = 0; c < n; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / n;
  }
  if (onProgress) onProgress(1);
  return { pcm: out, rate: audio.sampleRate || RATE, dur: audio.duration };
}

/** A 16-bit mono WAV of samples [from, to) (in seconds). */
export function wavPiece(pcm, rate, fromSec, toSec) {
  const a = Math.max(0, Math.floor(fromSec * rate)), b = Math.min(pcm.length, Math.floor(toSec * rate));
  const n = Math.max(0, b - a);
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, pcm[a + i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Cuts [0, dur) into pieces of about `step` seconds, preferring to cut in a quiet moment (the lowest-energy 200 ms in the last 10 s of each piece). */
export function cutPoints(pcm, rate, dur, step = 120) {
  const pts = [0];
  let at = 0;
  while (dur - at > step * 1.25) {
    const target = at + step, win = Math.floor(0.2 * rate);
    let best = target, bestE = Infinity;
    for (let t = target - 10; t <= target; t += 0.2) {
      const s = Math.floor(t * rate);
      let e = 0;
      for (let i = s; i < s + win && i < pcm.length; i += 16) e += Math.abs(pcm[i]);
      if (e < bestE) { bestE = e; best = t + 0.1; }
    }
    pts.push(best); at = best;
  }
  pts.push(dur);
  return pts;
}
