// Words, in Arabic (Modern + Egyptian) and English: tokens, a light stemmer, the little words that carry no meaning, and which language a text is in.
// Used by the offline summariser (summary.js) so a summary never needs the internet.

const DIAC = /[ً-ٰٟۖ-ۭـ]/g;          // vowel marks, small signs, tatweel
const AR_LETTER = /[ء-يٮ-ۓۺ-ۿ]/g;
const LATIN_LETTER = /[A-Za-z]/g;

/** 'ar' or 'en' (the language most of the letters belong to); 'ar' when there are none. */
export function detectLang(text) {
  const s = String(text || '');
  const ar = (s.match(AR_LETTER) || []).length, en = (s.match(LATIN_LETTER) || []).length;
  return en > ar * 1.2 ? 'en' : 'ar';
}

/** Same word, same spelling: no marks, one kind of alef / yaa / haa, Arabic digits to 0-9, lower case. */
export function normalize(s) {
  return String(s || '')
    .replace(DIAC, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6F0))
    .toLowerCase();
}

const AR_STOP = `في من على الى إلى عن هذا هذه هذي ذلك تلك هناك هنا التي الذي الذين اللي ما ماذا لا لم لن لما ان أن إن انه أنه انها أنها كان كانت كانوا يكون تكون هو هي هم هن نحن انا أنا انت أنت انتم مع ثم او أو بل قد لقد كل بعض هل لكن لكن ايضا أيضا حتى بعد قبل عند عندما حيث اذا إذا اذ إذ كما اي أي كيف لماذا متى اين أين بين خلال دون غير سوى فقط جدا جداً التى
ده دي دا دول دى ده فى مش علشان عشان كده كدا يعني يعنى بس لسه لسا كمان برضه برضو انت إنت احنا إحنا هو هى ايه إيه ليه ازاي إزاي فين امتى مين طب طيب خلاص اللى اللي ممكن لازم عايز عايزة عاوز عاوزة بقى بقا كان كانت يا بقي
و ف ب ل ك`.split(/\s+/).filter(Boolean);
const EN_STOP = `a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yeah okay ok um uh like really actually basically gonna wanna`.split(/\s+/).filter(Boolean);
export const STOP = new Set([...AR_STOP, ...EN_STOP].map(normalize));

const PRE = ['وال', 'بال', 'كال', 'فال', 'لل', 'ال', 'ول', 'ل', 'ب', 'ف', 'و'];   // wal bal kal fal ll al wl l b f w
const SUF = ['ات', 'ون', 'ين', 'ها', 'هم', 'هن', 'كم', 'ان', 'يه', 'ه', 'ي', 'ا', 'ن'];   // at un in ha hm hn km an ya h y a n

/** A light stem: Arabic loses its prefixes / endings (never below 3 letters), English loses -ing, -ed, -es, -s. */
export function stem(w) {
  if (!w) return w;
  if (/^[a-z0-9]+$/.test(w)) {
    if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
    if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  }
  let x = w;
  for (const p of PRE) if (x.startsWith(p) && x.length - p.length >= 3) { x = x.slice(p.length); break; }
  for (const s of SUF) if (x.endsWith(s) && x.length - s.length >= 3) { x = x.slice(0, -s.length); break; }
  return x;
}

/** The meaningful words of a text, as { w: spelling-as-written, k: stem } in order. */
export function words(text) {
  const out = [];
  const re = /[ء-يٮ-ۓۺ-ۿA-Za-z0-9٠-٩]+(?:['’][A-Za-z]+)?/g;
  for (const m of String(text || '').matchAll(re)) {
    const raw = m[0];
    const n = normalize(raw);
    if (n.length < 2 || STOP.has(n)) continue;
    out.push({ w: raw, k: stem(n) });
  }
  return out;
}
