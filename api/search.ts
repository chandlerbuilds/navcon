/**
 * Place search, backed by Elasticsearch. The phone never talks to Elasticsearch
 * directly: this function holds the API key and returns only place ids.
 * server.mjs serves it as /api/search in the container on the Radar cluster.
 *
 * Environment (from the Kubernetes Secret app-credentials, see deploy/deployment.yaml):
 *   ELASTICSEARCH_URL      project endpoint, e.g. https://<project>.es.<region>.elastic.cloud
 *   ELASTICSEARCH_API_KEY  read-only key for the index; never the indexing key
 *   ELASTICSEARCH_INDEX    optional, defaults to navcon-places
 * Without the URL and key, search answers {configured:false} and the phone searches on its own.
 */

/** The parts of the request and response that server.mjs passes in. */
export interface SearchRequest {
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
}
export interface SearchResponse {
  setHeader(name: string, value: string): SearchResponse;
  status(code: number): SearchResponse;
  json(body: unknown): SearchResponse;
}

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

// Time budgets. The meaning-based query can be slow while Elastic's inference warms up
// after a quiet spell; the plain query is fast. Worst case stays under the phone's 3 s timeout.
const SEMANTIC_MS = 1500, LEXICAL_MS = 1000;

async function search(venue: string, q: string, withSemantic: boolean, ms: number): Promise<Response> {
  return fetch(`${ES_URL}/${INDEX}/_search`, {
    method: 'POST',
    headers: { Authorization: `ApiKey ${ES_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(query(venue, q, withSemantic)),
    signal: AbortSignal.timeout(ms),
  });
}

/** Try the meaning-based query first; if it is slow or fails, answer with the plain typo-tolerant one. */
async function searchWithFallback(venue: string, q: string, traceparent: unknown): Promise<{ r: Response; semantic: boolean }> {
  if (semantic) {
    try {
      const r = await search(venue, q, true, SEMANTIC_MS);
      if (r.ok) return { r, semantic: true };
      await r.body?.cancel();
      if (r.status === 400) semantic = false; // index has no semantic field: stop asking for it
      else console.warn(JSON.stringify({ msg: 'semantic_fallback', status: r.status, venue, traceparent }));
    } catch (err) {
      console.warn(JSON.stringify({ msg: 'semantic_fallback', error: String(err), venue, traceparent }));
    }
  }
  return { r: await search(venue, q, false, LEXICAL_MS), semantic: false };
}

export default async function handler(req: SearchRequest, res: SearchResponse) {
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  const venue = String(req.query.venue ?? '').trim().slice(0, 40);
  if (!q || !venue) return res.status(400).json({ error: 'q and venue are required' });
  // Not configured is a normal state (the app then searches on the device), so it is not an error.
  if (!ES_URL || !ES_KEY) return res.status(200).json({ configured: false });
  const ip = String(req.headers['x-forwarded-for'] ?? 'unknown').split(',')[0].trim();
  if (limited(ip)) return res.status(429).json({ error: 'too many requests' });

  const started = Date.now();
  try {
    const { r, semantic: usedSemantic } = await searchWithFallback(venue, q, req.headers.traceparent);
    if (!r.ok) {
      console.error(JSON.stringify({ msg: 'search_failed', status: r.status, venue, traceparent: req.headers.traceparent }));
      return res.status(502).json({ error: 'search service error' });
    }
    const data = (await r.json()) as { hits: { hits: { _source: { place_id: string } }[] } };
    const ids = data.hits.hits.map((h) => h._source.place_id);
    // One structured line per search, on the pod's stdout (kubectl logs, or Dash0 if the cluster ships logs there).
    console.log(JSON.stringify({ msg: 'search', venue, query_length: q.length, results: ids.length, semantic: usedSemantic, es_ms: Date.now() - started, traceparent: req.headers.traceparent }));
    res.setHeader('Cache-Control', 'public, max-age=30');
    return res.status(200).json({ ids, source: 'elasticsearch' });
  } catch (err) {
    console.error(JSON.stringify({ msg: 'search_failed', error: String(err), venue, traceparent: req.headers.traceparent }));
    return res.status(502).json({ error: 'search service unavailable' });
  }
}
