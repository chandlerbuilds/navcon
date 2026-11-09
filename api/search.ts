import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Place search, backed by Elasticsearch. The phone never talks to Elasticsearch
 * directly: this function holds the API key and returns only place ids.
 *
 * Environment: ELASTICSEARCH_URL, ELASTICSEARCH_API_KEY, ELASTICSEARCH_INDEX (optional).
 */
const ES_URL = process.env.ELASTICSEARCH_URL?.replace(/\/$/, '');
const ES_KEY = process.env.ELASTICSEARCH_API_KEY;
const INDEX = process.env.ELASTICSEARCH_INDEX ?? 'navcon-places';

// Small per-instance rate limit: 40 requests per 10 seconds per client.
const WINDOW_MS = 10_000, LIMIT = 40;
const seen = new Map<string, { n: number; t: number }>();
let semantic = true; // turned off for this instance if the index has no semantic field

function limited(ip: string): boolean {
  const now = Date.now();
  const e = seen.get(ip);
  if (!e || now - e.t > WINDOW_MS) { seen.set(ip, { n: 1, t: now }); return false; }
  e.n += 1;
  if (seen.size > 5000) seen.clear();
  return e.n > LIMIT;
}

function query(venue: string, q: string, withSemantic: boolean) {
  const should: unknown[] = [
    { term: { booth: { value: q, boost: 12 } } },
    { match_phrase_prefix: { name: { query: q, boost: 6 } } },
    { multi_match: { query: q, fields: ['name^4', 'aliases^3', 'kind', 'tier'], fuzziness: 'AUTO', prefix_length: 1 } },
  ];
  if (withSemantic) should.push({ semantic: { field: 'description', query: q, boost: 2 } });
  return {
    size: 8,
    _source: ['place_id'],
    query: { bool: { filter: [{ term: { venue } }], should, minimum_should_match: 1 } },
  };
}

async function search(venue: string, q: string, withSemantic: boolean): Promise<Response> {
  return fetch(`${ES_URL}/${INDEX}/_search`, {
    method: 'POST',
    headers: { Authorization: `ApiKey ${ES_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(query(venue, q, withSemantic)),
    signal: AbortSignal.timeout(1200),
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  const venue = String(req.query.venue ?? '').trim().slice(0, 40);
  if (!q || !venue) return res.status(400).json({ error: 'q and venue are required' });
  // Not configured is a normal state (the app then searches on the device), so it is not an error.
  if (!ES_URL || !ES_KEY) return res.status(200).json({ configured: false });
  const ip = String(req.headers['x-forwarded-for'] ?? 'unknown').split(',')[0].trim();
  if (limited(ip)) return res.status(429).json({ error: 'too many requests' });

  const started = Date.now();
  try {
    let r = await search(venue, q, semantic);
    if (r.status === 400 && semantic) { semantic = false; r = await search(venue, q, false); }
    if (!r.ok) {
      console.error(JSON.stringify({ msg: 'search_failed', status: r.status, venue, traceparent: req.headers.traceparent }));
      return res.status(502).json({ error: 'search service error' });
    }
    const data = (await r.json()) as { hits: { hits: { _source: { place_id: string } }[] } };
    const ids = data.hits.hits.map((h) => h._source.place_id);
    // One structured line per search: Dash0 receives it through the Vercel log drain.
    console.log(JSON.stringify({ msg: 'search', venue, query_length: q.length, results: ids.length, semantic, es_ms: Date.now() - started, traceparent: req.headers.traceparent }));
    res.setHeader('Cache-Control', 'public, max-age=30');
    return res.status(200).json({ ids, source: 'elasticsearch' });
  } catch (err) {
    console.error(JSON.stringify({ msg: 'search_failed', error: String(err), venue, traceparent: req.headers.traceparent }));
    return res.status(502).json({ error: 'search service unavailable' });
  }
}
