#!/usr/bin/env node
// Index a venue's places into Elasticsearch. Run on every publish.
//   ELASTICSEARCH_URL=... ELASTICSEARCH_API_KEY=... node tools/index_places.mjs kcna26
import { existsSync, readFileSync } from 'node:fs';

const venueId = process.argv[2] ?? 'kcna26';
const url = process.env.ELASTICSEARCH_URL?.replace(/\/$/, '');
const key = process.env.ELASTICSEARCH_API_KEY;
const index = process.env.ELASTICSEARCH_INDEX ?? 'navcon-places';
if (!url || !key) { console.error('Set ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY.'); process.exit(1); }

const venue = JSON.parse(readFileSync(new URL(`../public/venues/${venueId}.json`, import.meta.url), 'utf8'));
const descriptions = new Map();
const descPath = new URL(`../data/${venueId}/descriptions.tsv`, import.meta.url);
if (existsSync(descPath)) {
  for (const line of readFileSync(descPath, 'utf8').split('\n')) {
    const [id, text] = line.split('\t');
    if (id && text) descriptions.set(id.trim(), text.trim());
  }
}

const docs = [
  ...venue.booths.map((b) => ({ place_id: b.id, name: b.name ?? `Booth ${b.number}`, booth: b.number, kind: 'booth', tier: b.tier, aliases: [`booth ${b.number}`] })),
  ...venue.areas.map((a) => ({ place_id: a.id, name: a.name, kind: a.kind, aliases: [] })),
  ...venue.points.map((p) => ({ place_id: p.id, name: p.name, kind: p.kind, aliases: p.kind === 'restroom' ? ['bathroom', 'toilet', 'wc'] : [] })),
].map((d) => ({ ...d, venue: venueId, description: descriptions.get(d.place_id) ?? descriptions.get(d.booth ?? '') ?? d.name }));

async function es(method, path, body, type = 'application/json') {
  const r = await fetch(`${url}${path}`, { method, headers: { Authorization: `ApiKey ${key}`, 'Content-Type': type }, body });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
}

const mapping = (semantic) => ({
  mappings: {
    properties: {
      venue: { type: 'keyword' }, place_id: { type: 'keyword' }, booth: { type: 'keyword' }, kind: { type: 'text' }, tier: { type: 'text' },
      name: { type: 'text' }, aliases: { type: 'text' },
      // semantic_text gives meaning-based matching ("tools for tracing") with no separate embedding pipeline
      description: semantic ? { type: 'semantic_text' } : { type: 'text' },
    },
  },
});

await es('DELETE', `/${index}`);
let created = await es('PUT', `/${index}`, JSON.stringify(mapping(true)));
let semantic = created.ok;
if (!created.ok) {
  console.warn('semantic_text not available here, using plain text:', JSON.stringify(created.json.error?.reason ?? created.status));
  created = await es('PUT', `/${index}`, JSON.stringify(mapping(false)));
  if (!created.ok) { console.error('could not create index', created.json); process.exit(1); }
}
const lines = docs.flatMap((d) => [JSON.stringify({ index: { _index: index, _id: `${venueId}:${d.place_id}` } }), JSON.stringify(d)]).join('\n') + '\n';
const bulk = await es('POST', '/_bulk?refresh=true', lines, 'application/x-ndjson');
if (!bulk.ok || bulk.json.errors) { console.error('bulk index failed', JSON.stringify(bulk.json).slice(0, 600)); process.exit(1); }
console.log(`indexed ${docs.length} places for ${venueId} into ${index} (${semantic ? 'semantic_text' : 'text'} descriptions, ${descriptions.size} written descriptions)`);
