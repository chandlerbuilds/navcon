# Navcon

Walking directions inside conference venues. Scan a booth's QR code or type the nearest booth, pick where you're going, and get the shortest walkable route. No install, no sign-in, and routing keeps working with no signal.

First venue: KubeCon + CloudNativeCon North America 2026, Solutions Showcase (237 booths, 233 exhibitors).

## How it works

- **Venue bundle.** `tools/build_venue.py` reads a vector floor-plan PDF and writes `public/venues/<id>.json`: the hall outline, every booth with its number, service areas, restrooms and entrances. Booth shapes and numbers are read from the PDF automatically; exhibitor names come from `data/<id>/exhibitors.tsv`.
- **Routing on the phone.** `src/routing` subtracts the obstacles from the hall, grows them by a clearance margin, lays a 0.5 m grid over what is left and runs A*. No paths are drawn by hand.
- **Three route types.** Standard, no stairs and wheelchair. Wheelchair keeps 0.5 m of clearance instead of 0.3 m.
- **QR links.** `/v/<venue>?from=<place-id>` sets the start. `/v/<venue>/qr` prints a code for every place.
- **Offline.** A service worker caches the app and the venue bundle. Search falls back to an on-device match.

## Sponsor tools

| Tool | Where | What it does |
| --- | --- | --- |
| Elasticsearch | `api/search.ts`, `tools/index_places.mjs` | Typo-tolerant and meaning-based place search |
| Dash0 | `src/telemetry.ts`, Vercel log drain | Sessions, errors, custom events (`qr_scan`, `search`, `route_requested`, ...) |
| Radar | `src/radar.ts` (in progress) | Venue geofence check, arrival map, walking time to the entrance |
| Gitar | this repository | Reviews pull requests and repairs failing CI, including the routing checks |

## Develop

```sh
npm install
npm run dev        # local app
npm test           # routing checks
npm run build
```

Copy `.env.example` to `.env.local` and fill in keys to switch the sponsor pieces on. Everything works without them.

Rebuild the venue bundle from a map PDF (the PDF itself is not committed):

```sh
pdftoppm -r 200 -f 1 -l 1 -png map.pdf page
python3 tools/build_venue.py map.pdf page-1.png data/kcna26/exhibitors.tsv public/venues/kcna26.json
```

## Assumptions

- Scale is derived from booth sizes on the map, assuming a platinum booth is 20 ft square. Distances are approximate until someone measures one.
- The expo floor is one level, so all three route types are step-free here.
