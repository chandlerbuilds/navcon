import type { Place } from '../venue/types';

const SYNONYMS: Record<string, string> = {
  bathroom: 'restroom', bathrooms: 'restroom', toilet: 'restroom', toilets: 'restroom', wc: 'restroom', restrooms: 'restroom',
  lunch: 'meal', food: 'meal', eat: 'meal', exit: 'entrance', door: 'entrance', sit: 'seating', seats: 'seating', chairs: 'seating',
  tshirt: 't-shirt', swag: 'corner store', aws: 'amazon web services', gcp: 'google cloud', azure: 'microsoft azure',
};

export function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Edit distance where swapping two neighbouring letters counts as one change. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

interface Indexed { place: Place; title: string; words: string[]; squashed: string; extra: string; tags: string[] }
const cache = new WeakMap<Place[], Indexed[]>();

function index(places: Place[]): Indexed[] {
  let idx = cache.get(places);
  if (!idx) {
    idx = places.map((place) => {
      const title = norm(place.title);
      return { place, title, words: title.split(' '), squashed: title.replace(/ /g, ''), extra: norm(place.subtitle), tags: norm(place.tags ?? '').split(' ').filter(Boolean) };
    });
    cache.set(places, idx);
  }
  return idx;
}

function score(e: Indexed, q: string, qWords: string[], qSquashed: string): number {
  if (/^\d+$/.test(q)) {
    const num = e.place.number;
    if (num === q) return 1000;
    if (num && num.startsWith(q)) return 500 - (num.length - q.length);
    return 0;
  }
  if (e.title === q) return 900;
  if (e.title.startsWith(q) || e.squashed.startsWith(qSquashed)) return 700 - e.title.length * 0.1;
  if (qWords.every((w) => e.words.some((t) => t.startsWith(w)))) return 600 - e.title.length * 0.1;
  if (e.title.includes(q) || e.squashed.includes(qSquashed)) return 400;
  if (qWords.every((w) => e.words.some((t) => t.startsWith(w)) || e.extra.split(' ').some((t) => t.startsWith(w)))) return 350;
  // what the exhibitor does: "observability", "postgres", "api gateway"
  if (e.tags.length && qWords.every((w) => w.length >= 3 && e.tags.some((t) => t.startsWith(w)))) return 250;
  if (qSquashed.length >= 4) {
    const max = qSquashed.length >= 7 ? 2 : 1;
    let best = max + 1;
    for (const t of [...e.words, e.squashed]) {
      best = Math.min(best, editDistance(qSquashed, t, max), editDistance(qSquashed, t.slice(0, qSquashed.length), max));
    }
    if (best <= max) return 300 - best * 50;
  }
  return 0;
}

/** Typo-tolerant search over the venue's own place list. Works with no network. */
export function searchLocal(places: Place[], query: string, limit = 8): Place[] {
  let q = norm(query);
  if (!q) return [];
  q = q.split(' ').map((w) => SYNONYMS[w] ?? w).join(' ');
  q = SYNONYMS[q.replace(/ /g, '')] ?? q;
  const qWords = q.split(' '), qSquashed = q.replace(/ /g, '');
  const hits: { place: Place; s: number }[] = [];
  for (const e of index(places)) {
    const s = score(e, q, qWords, qSquashed);
    if (s > 0) hits.push({ place: e.place, s: s + (e.place.kind === 'booth' ? 1 : 0) });
  }
  hits.sort((a, b) => b.s - a.s || a.place.title.localeCompare(b.place.title));
  // keyword matches ("observability") can be many: show more of them than name matches
  const cap = hits.length && hits[0].s <= 251 ? Math.max(limit, 24) : limit;
  return hits.slice(0, cap).map((h) => h.place);
}
