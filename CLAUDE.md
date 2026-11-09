# Navcon

Walking directions inside conference venues. A PWA with on-device routing; no install, no sign-in. Built at a hackathon on 2026-11-09 with a demo deadline of 5:30pm MST that day.

- Product spec: `docs/SPEC.md` (read it before changing behavior)
- Live app: https://lunzerr.cnh.radarhq.io (production = `main`; every push builds an image and Argo CD rolls it out to the `lunzerr` cluster)
- Repository: https://github.com/chandlerbuilds/navcon (public)
- Team: Chandler (owner, `chandlerbuilds`), Sean and Bruce (collaborators)

## Commands

```sh
npm install
npm run dev          # local app
npm run typecheck
npm test             # routing and search checks (about 10 s)
npm run build        # type-check, then build to dist/
npm run index:places # index a venue into Elasticsearch (needs keys)
```

CI (`.github/workflows/ci.yml`) runs typecheck, test and build on every push and pull request. `.github/workflows/deploy.yaml` builds the container on every push to `main`.

## How we work

- Change `main` through pull requests, and wait for CI and Gitar to finish before merging. A human merges.
- Interface-only changes may be merged by their author without a second approval: files under `src/ui/`, `src/styles.css`, `index.html` and icons in `public/`. There are no preview links: check the branch with `npm run dev` in a phone-sized browser first.
- Everything else needs another person's approval before it merges: routing (`src/routing/`), search and the API (`api/`, `src/search/`), `server.mjs`, deploy files, CI workflows, venue data and `tools/`. In `src/App.tsx`, layout-only edits count as interface changes; anything that changes behaviour needs approval.
- A pull request that changes what the app does, or how it is built or deployed, adds an entry at the end of `docs/FEATURE_LOG.md`.
- Keep it simple. The owner's rule: more features means more noise. Do not add interactions the spec lists as non-goals (for example an "I'm here" tap, or picking places by tapping the map).
- The app is public and judges will open it on their phones. Check a change in a phone-sized browser before proposing it.
- Never commit keys. Browser keys are `VITE_*` build-time variables; set them as GitHub repository variables, which `deploy.yaml` passes to the image build. Server keys live in the Kubernetes Secret `app-credentials` (see `deploy/deployment.yaml`).
- The organizers' floor-plan PDF is not in this public repository. Only data derived from it is.

## Layout

| Path | What |
| --- | --- |
| `public/venues/kcna26.json` | The venue bundle: outline, zones, 237 booths, 39 areas, points, keywords. Generated; do not edit by hand. |
| `tools/build_venue.py` | Builds the bundle from the vector PDF. Holds the curated tables: area names (`AREAS`), icon positions (`POINTS`), doors (`DOORS`, empty). |
| `data/kcna26/exhibitors.tsv` | Booth number to exhibitor name (233 exhibitors, 236 booth numbers) |
| `data/kcna26/keywords.tsv` | Booth number to search keywords. Written from general knowledge; not reviewed. |
| `src/routing/grid.ts` | Walkable grid (0.5 m), clearance, per-cell cost, aisle orientation, access cells |
| `src/routing/astar.ts` | Path search over (cell, heading). Constants: `TURN`, `OFF_AXIS`, `H_WEIGHT`. |
| `src/routing/route.ts` | `Router`: access rules (doors first, else any side), text steps |
| `src/search/local.ts`, `remote.ts` | On-device search; Elasticsearch client with fallback |
| `src/ui/MapView.tsx` | SVG floor plan with pan and zoom, route line, dotted arc, labels |
| `src/ui/SearchSheet.tsx`, `QrSheet.tsx`, `ArrivalSheet.tsx` | Search, printable QR codes, Radar "Getting here" |
| `src/telemetry.ts`, `src/radar.ts` | Dash0 events; lazy Radar loader |
| `api/search.ts` | Elasticsearch search proxy with rate limit; `server.mjs` serves it as `/api/search` |
| `tools/index_places.mjs`, `tools/radar_geofence.mjs` | Index a venue; create the venue geofence |
| `tests/routing.test.ts` | The routing and search checks |

## Rebuilding the venue bundle

Needs the PDF (ask Chandler: `KCNA26-ExpoHallMap_Digital.pdf`), `pdftoppm`, and Python with `pdfplumber` and `pillow`.

```sh
pdftoppm -r 200 -f 1 -l 1 -png map.pdf page
python3 tools/build_venue.py map.pdf page-1.png data/kcna26/exhibitors.tsv public/venues/kcna26.json data/kcna26/keywords.tsv
```

Coordinates are metres, origin top left, y down. 1 PDF point = 0.4726 m, assuming a platinum booth is 20 ft square.

## Routing rules that must hold

These came from the owner's review of real routes and are covered by tests. Keep them.

- A route never crosses a booth, a service area or the hall outline, and keeps its profile's clearance (0.3 m standard and no stairs, 0.5 m wheelchair).
- Routes run down the middle of aisles: cells near walls cost more.
- Routes turn only in 45 degree steps. Square turns in Halls 1 to 5; 45 degree legs in Halls A to C, where booths are turned exactly 45 degrees. Pure orthogonal routing would be wrong there.
- A place with doors is always entered and left through a door. A place without doors can be reached from any side; the search picks the side that suits the trip and skips cramped gaps behind the place.
- The link from the route's end into the place is a dotted arc that always bows toward the top of the screen.
- While a route is shown, vendor names are removed from the map (not greyed). Booth numbers stay. The start, destination and step landmarks keep their names.

## Status at 2:45pm MST, 2026-11-09

Live and checked in a phone-sized Chrome (including offline reload): venue data, routing, text steps, on-device search with keywords, QR deep links, QR sheet.

Open pull request: number 3, "Concave-down dotted arc; no vendor names during a route". If it is still open, it also carries this file and `docs/SPEC.md`.

Built but never run against the real service (waiting for keys, then a rebuild):

| Tool | Keys | Then |
| --- | --- | --- |
| Elasticsearch | `ELASTICSEARCH_URL`, `ELASTICSEARCH_API_KEY` | `npm run index:places`, then check `/api/search?venue=kcna26&q=dash0` |
| Dash0 | `VITE_DASH0_ENDPOINT`, `VITE_DASH0_TOKEN` as GitHub repository variables | Confirm events arrive; build the dashboard and one alert |
| Radar | `VITE_RADAR_KEY`; `RADAR_SECRET_KEY=... node tools/radar_geofence.mjs kcna26` | Open "Getting here" on a phone |
| Gitar | Installed: a Gitar check ran on pull request 3 | Open a pull request with a failing routing check for the demo |

Not started: the admin portal (see the spec), Dash0 dashboard and alert.

## Known gaps and unverified items

- Not tested on a real iPhone or in Safari; only Chrome with phone emulation.
- Route computation is 5 to 190 ms in Node for this venue. Not timed on a phone. If it is slow there, raise `H_WEIGHT` in `src/routing/astar.ts` or move the search to a web worker.
- The scale is an assumption (see above), so distances and times are approximate.
- Restroom and entrance positions were placed by hand from icons on the map.
- Booth 261 is on the map with no listed exhibitor.
- No place has doors marked; the map shows none.
- With a wide place directly under a wall, the top of the dotted arc can rise slightly past the place's edge.
- The semantic part of the Elasticsearch query (`semantic` on `description`) is written from the docs and untested; `api/search.ts` retries without it if the cluster rejects it.

## Demo script

1. QR code for the app on screen; the audience opens it on their phones. Scan a booth's QR code to set the start.
2. Search a vendor by a misspelled name, then by what they sell ("observability").
3. Switch to wheelchair: wider clearance on this one-level floor.
4. Airplane mode, route again.
5. Dash0 dashboard, and a pull request that Gitar fixed.
