# Navcon feature log

What changed, when, and whether it is live. One entry per merged pull request or other notable update.

How to keep it:

- Add a new entry at the **end** of the file. Never rewrite or delete an old entry, except to correct a fact.
- The "Current status" block below is the one exception: it is a snapshot, so edit it in place.
- A pull request that changes what the app does, or how it is built or deployed, adds its own entry in the same pull request.
- Use the entry shape below. Times are Mountain Time.
- "State" is one of: **Live** (on the deployed sites), **Merged** (on `main`, nothing for users to see), **Built, off** (in the code but switched off), **Open** (pull request not merged).

```
### HH:MM · Short title · PR #N (or commit)
- **By:** who
- **What changed:** one or two sentences, in terms of what a user or teammate would notice
- **State:** Live | Merged | Built, off | Open, plus anything it is waiting on
```

The product spec is `docs/SPEC.md`. The spec says what Navcon should be; this log says what has actually happened.

## Current status

This block is the only part of the file that is edited in place. Update it whenever something merges or goes live, and change the time. Last updated 15:42.

**Open pull requests**

- **PR #6 · Gitar demo.** Lowers one routing cost on purpose, which fails the check "diagonal leg in a square hall". Gitar diagnosed it and asked for the routing code to be put back. Do not merge while CI is red.

**Not live yet**

- **Elasticsearch search.** The cluster has credentials but its search requests fail, most likely because the venue has not been indexed (`npm run index:places`). The app falls back to on-device search.
- **Dash0 telemetry.** The live build has no Dash0 endpoint. Waiting on `VITE_DASH0_ENDPOINT` and `VITE_DASH0_TOKEN` as GitHub repository variables, then a rebuild.

## 2026-11-09 (hackathon day)

### 14:09 · MVP: venue data, on-device routing, PWA · commit bac0bda
- **By:** Chandler, with Claude
- **What changed:** The venue bundle built from the KubeCon NA 2026 expo map (237 booths), walking routes computed on the phone with three profiles (standard, no stairs, wheelchair), text steps, QR links, the printable QR sheet, and offline use after the first load.
- **State:** Live

### 14:11 · "Getting here" arrival screen and venue geofence script · commit 41b4bfd
- **By:** Chandler, with Claude
- **What changed:** A screen that shows the venue on a map with an on-site check, built on the location SDK from radar.com.
- **State:** Built, off. It only appears when `VITE_RADAR_KEY` is set. It uses a different product from the hackathon's Radar (the Kubernetes UI), so it is not a sponsor integration.

### 14:19 · Search by what an exhibitor does · PR #1
- **By:** Chandler, with Claude
- **What changed:** Search finds exhibitors by keyword ("observability") as well as by name, booth number and typo. The search endpoint answers quietly when Elasticsearch is not configured, and the app then searches on the device.
- **State:** Live, using on-device search. Elasticsearch is not configured on either site yet.

### 14:38 · Routes down the middle of aisles with square turns · PR #2
- **By:** Chandler, with Claude
- **What changed:** Routes keep to the middle of aisles and turn only in 45 degree steps: square where booths stand square, diagonal where booths are slanted. A place with a door is entered through it; otherwise the route picks the side that suits the trip. A dotted arc links the end of the route to the place.
- **State:** Live

### 14:49 · Deploy to Kubernetes on the Radar Cloud cluster · PR #4
- **By:** Bruce
- **What changed:** Every push to `main` builds a container and rolls it out through Argo CD to the team namespace (`team-lunzerr`), at https://lunzerr.cnh.radarhq.io. The container serves the app and runs the search function. The Vercel site stays up as a second copy.
- **State:** Live. Health checks pass.

### 15:23 · Gitar review instructions; README corrections · PR #5
- **By:** Chandler, with Claude. Reviewed by Sean and Gitar.
- **What changed:** `.gitar/review/` now holds the routing rules and team conventions that Gitar reviews every pull request against. The README describes the right Radar, and discloses AI assistant use as the hackathon rules require.
- **State:** Merged

### 15:36 · Arc bows upward; no vendor names during a route; handoff docs · PR #3
- **By:** Chandler, with Claude. Reviewed by Sean and Gitar.
- **What changed:** The dotted arc into a place always bows toward the top of the screen. While a route is shown, vendor names are removed from the map and booth numbers stay. `CLAUDE.md` and `docs/SPEC.md` are now in the repository.
- **State:** Live on the cluster (build 8096295).

### 15:42 · Interface changes no longer need a second approval · PR #7
- **By:** Chandler, with Claude
- **What changed:** A working rule, not a feature. Interface-only pull requests may be merged by their author once CI and Gitar finish. Routing, search, server, deploy and data changes still need another person's approval. This log and its review rule arrive in the same pull request.
- **State:** Open

### 16:16 · Map-first single page: plan card, map, directions sheet · PR #9
- **By:** Bruce, with Claude. Reviewed by Gitar.
- **What changed:** Interface only; routing and search behave as before. On phones the route plan sits in a card above the map and the directions in a sheet below it; on wide screens both move to a column beside the map. The navy header is gone, From and To share one box, route types are a segmented control, and the directions lead with distance and walking time. Icons are drawn instead of text characters. Every control is at least 44 px tall.
- **State:** Open

### 16:22 · Search telemetry counts on-device searches; Vercel removed · branch `dash0-search-telemetry`
- **By:** Sean, with Claude
- **What changed:** The `search` and `search_no_results` events now fire for every search, not only when Elasticsearch answers. They count what the attendee was shown, with `source` set to `elasticsearch` or `device`. Every Dash0 event also carries the build mode (`deployment.environment.name`) and the site's host name (`deployment.name`), so the dashboard can tell local runs from the live site.
- **Also:** Vercel is no longer used. Removed `vercel.json` and the unused `@vercel/node` package, and changed the docs to describe the cluster deploy only. The Vercel project itself was not touched.
- **State:** Open. Needs a second approval (search, deploy files). Sends nothing until the Dash0 keys are set.

### 16:30 · Map no longer leaves line trails on iPhone · PR #11
- **By:** Chandler, with Claude
- **What changed:** Panning or zooming the map on an iPhone left trails of old outline strokes behind. Map lines now get their on-screen width from the zoom level instead of `vector-effect: non-scaling-stroke`, which is what WebKit was failing to repaint. Lines look the same as before.
- **State:** Merged. Confirmed on a real iPhone in Safari and Chrome using the pull request's preview build.

### 16:42 · Plan moves to the bottom sheet on phones · PR (this one)
- **By:** Bruce, with Claude
- **What changed:** Interface only. On phones, From, To, swap and route type sit in the bottom sheet above the directions, within reach of a thumb; the top keeps a slim brand bar. The empty-state text under the map is removed, including the "Venue staff: QR codes to print" link (`/v/<venue>/qr` still works). Split out of the in-app scanner pull request, which needs its own approval.
- **State:** Open
