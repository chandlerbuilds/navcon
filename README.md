# Navcon

Walking directions inside conference venues. Scan a booth's QR code or type the nearest booth, pick where you're going, and get the shortest walkable route. No install, no sign-in, and routing keeps working with no signal.

First venue: KubeCon + CloudNativeCon North America 2026, Solutions Showcase (237 booths, 233 exhibitors).

## How it works

- **Venue bundle.** `tools/build_venue.py` reads a vector floor-plan PDF and writes `public/venues/<id>.json`: the hall outline, every booth with its number, service areas, restrooms and entrances. Booth shapes and numbers are read from the PDF automatically; exhibitor names come from `data/<id>/exhibitors.tsv`.
- **Routing on the phone.** `src/routing` subtracts the obstacles from the hall, grows them by a clearance margin, lays a 0.5 m grid over what is left and runs A*. Cells near walls cost more and every turn costs distance, so routes run down the middle of aisles with 45 and 90 degree turns. No paths are drawn by hand.
- **Where a route starts and ends.** If a place has a door (`doors` in the venue bundle), routes use it. If it has none, a route may use any side of the place and picks the one that suits the trip.
- **Three route types.** Standard, no stairs and wheelchair. Wheelchair keeps 0.5 m of clearance instead of 0.3 m.
- **QR links.** `/v/<venue>?from=<place-id>` sets the start. `/v/<venue>/qr` prints a code for every place.
- **Offline.** A service worker caches the app and the venue bundle. Search falls back to an on-device match.

## Sponsor tools

| Tool | Where | What it does |
| --- | --- | --- |
| Elasticsearch | `api/search.ts`, `tools/index_places.mjs` | Typo-tolerant and meaning-based place search |
| Dash0 | `src/telemetry.ts`, Vercel log drain | Sessions, errors, custom events (`qr_scan`, `search`, `route_requested`, ...) |
| Radar | `src/radar.ts`, `src/ui/ArrivalSheet.tsx`, `tools/radar_geofence.mjs` | "Getting here": venue map, address lookup, on-site geofence check, walking time to the venue |
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
python3 tools/build_venue.py map.pdf page-1.png data/kcna26/exhibitors.tsv public/venues/kcna26.json data/kcna26/keywords.tsv
```

## Deploy (Radar)

Every push to `main` deploys to the `lunzerr` cluster in Radar Cloud, at https://lunzerr.cnh.radarhq.io:

1. `.github/workflows/deploy.yaml` builds the `Dockerfile`, pushes `ghcr.io/chandlerbuilds/navcon:<sha>` and commits the new tag to `deploy/kustomization.yaml`.
2. Argo CD (`argocd/application.yaml`, namespace `team-lunzerr`) syncs `deploy/`.

In the container, `server.mjs` serves `dist/`, runs `api/search.ts` as `/api/search` and answers `/healthz` and `/readyz`.

- Browser keys (`VITE_RADAR_KEY`, `VITE_DASH0_ENDPOINT`, `VITE_DASH0_TOKEN`) are GitHub repository variables, baked into the bundle at build time.
- Elasticsearch credentials come from the Secret `app-credentials` (keys `elasticsearch-url`, `elasticsearch-api-key`) in `team-lunzerr`. Create it in Radar Cloud; never commit it. Without it, search runs on the device.

Run the image locally:

```sh
docker build -t navcon . && docker run --rm -p 8080:8080 navcon
```

## Assumptions

- `data/kcna26/keywords.tsv` holds short search keywords for exhibitors (what they do). They were written by hand from general knowledge and should be reviewed; exhibitors without a line are found by name and booth number only.
- Scale is derived from booth sizes on the map, assuming a platinum booth is 20 ft square. Distances are approximate until someone measures one.
- The expo floor is one level, so all three route types are step-free here.
