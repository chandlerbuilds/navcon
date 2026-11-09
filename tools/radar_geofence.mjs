#!/usr/bin/env node
// Create or update the venue's Radar geofence, so the app can tell when someone is on site.
//   RADAR_SECRET_KEY=prj_live_sk_... node tools/radar_geofence.mjs kcna26
import { readFileSync } from 'node:fs';

const venueId = process.argv[2] ?? 'kcna26';
const key = process.env.RADAR_SECRET_KEY;
if (!key) { console.error('Set RADAR_SECRET_KEY (a secret key, never the publishable one, and never commit it).'); process.exit(1); }
const venue = JSON.parse(readFileSync(new URL(`../public/venues/${venueId}.json`, import.meta.url), 'utf8'));
if (!venue.geo) { console.error('This venue has no position.'); process.exit(1); }

const body = new URLSearchParams({
  description: `${venue.name} (${venue.geo.place})`,
  type: 'circle',
  coordinates: JSON.stringify([venue.geo.lng, venue.geo.lat]),
  radius: process.argv[3] ?? '300',
});
const r = await fetch(`https://api.radar.io/v1/geofences/venue/${encodeURIComponent(venueId)}`, {
  method: 'PUT',
  headers: { Authorization: key, 'Content-Type': 'application/x-www-form-urlencoded' },
  body,
});
console.log(r.status, JSON.stringify(await r.json().catch(() => ({}))).slice(0, 400));
process.exit(r.ok ? 0 : 1);
