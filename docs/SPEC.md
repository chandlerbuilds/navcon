# Navcon product specification

As of 2026-11-09, 2:45pm MST. This file mirrors the editable doc "Navcon product specification" and is the copy that travels with the code. `CLAUDE.md` holds the build status and next steps.

## Summary

Navcon gives conference attendees walking directions between booths, rooms and landmarks inside a venue, with no app install and no sign-in.

An attendee scans a booth's QR code or types the nearest booth, picks a destination, and gets the shortest walkable route. A step-free or wheelchair route is one tap away. Venue staff set up a venue once by supplying the floor plan and marking obstacles; the system works out the walkable paths.

- Problem: finding your position, your destination and a route on a static conference map takes effort. Doing it 20 to 30 times a day is exhausting.
- Product: a web app (PWA) for attendees and a web admin portal for venue staff.
- Principle: as simple as possible, and it must keep working when conference Wi-Fi does not. More features means more noise.
- Demo deadline: 2026-11-09, 5:30pm MST. The MVP is a live public link that judges and attendees open on their own phones.

## Goals and non-goals

Goals
- Route between any two places in a venue without crossing walls or booths.
- Three route profiles: standard, no stairs, wheelchair.
- Run as a PWA in iOS Safari and Android Chrome, with no install and no account.
- Keep routing offline after the first load.
- Let a venue admin set up a venue from a floor plan without drawing paths by hand.
- Use Elasticsearch, Radar, Dash0 and Gitar so that each does a job the product needs.

Non-goals (cut on purpose)
- Live position tracking (a moving blue dot). Web apps on iPhone cannot read Bluetooth beacons.
- An "I'm here" progress tap. Scanning another QR code is the only way to update position.
- Choosing a place by tapping it on the map. Start and destination come from a QR code or the search box.
- Native iOS and Android apps.
- Attendee accounts, saved routes or history.
- Voice guidance.
- Vendor promotions or other booth content.

## Users and roles

| Role | Signs in | Uses | Can do |
| --- | --- | --- | --- |
| Attendee | No | PWA | Search places, get routes, scan QR codes |
| Venue admin | Yes, by email link | Admin portal | Create and edit their organization's venues, publish, download the QR sheet, invite other admins |
| Platform owner | Yes | Admin portal | See all organizations. Not built. |

Each venue belongs to one organization. Admins see and edit only their own organization's venues. Attendees only ever read a venue's published data, never the admin database.

## Attendee app (PWA)

1. Open. Scanning a booth's QR code opens the app at that venue with the start already set. Opening the venue link without a QR code shows the venue with an empty start.
2. Set the start (skipped after a QR scan). One search box accepts a booth number, a company name, a landmark, or what a company does ("observability"). Fuzzy matching forgives typos.
3. Set the destination. The same search box.
4. Choose a profile. Standard, no stairs or wheelchair. Remembered on the device.
5. See the route. Under the map: distance, walking time and short text steps that name landmarks.
6. Update position. Scanning any other QR code on the way resets the start and redraws the route to the same destination.

| Requirement | Detail |
| --- | --- |
| Start input | QR link, or search by booth number, company, landmark or keyword |
| Destination input | The same search |
| Profiles | Standard, no stairs, wheelchair |
| Route line | Runs down the middle of aisles. Turns only in 45 degree steps: square turns where booths stand square, 45 degree legs where booths are slanted. |
| Route ends | A dotted arc of round dots links the end of the route to the place. The arc always bows toward the top of the screen. |
| Map during a route | Everything off the route is dimmed. Vendor names are removed, not greyed; booth numbers stay. The start, the destination and the landmarks named in the steps keep their names. Plain facilities (seating, meal pick-up) keep theirs, greyed. |
| Route output | Distance in feet and metres, walking time, text steps |
| More than one floor | One floor shown at a time, with a "next floor" control at each stair, escalator or elevator. Not built; the first venue is one level. |
| More than one building | Outdoor and shuttle legs show the time between buildings. Not built. |
| No route found | A message that names the profile and destination |
| QR link format | `https://<app>/v/<venue>?from=<place-id>&src=qr`. A plain link opened by the phone's own camera. No in-app scanner. |
| QR sheet | `/v/<venue>/qr` prints one code per place plus one for the app itself |
| Language | English only for now |

## Admin portal

Specified, not built.

1. Create the venue: name and street address. The address is looked up so the venue sits in the right place on a map.
2. Add floors: upload a floor plan (PDF or image) for each floor. Set the scale by clicking two points and typing the real distance between them.
3. Mark obstacles: trace or import the hall outline, booths and walls as shapes. Everything inside the outline that is not an obstacle is walkable.
4. Mark doors, connectors and places. Doors belong to a place. Connectors are stairs, escalators, elevators, ramps and shuttle stops. Places are booths (number, vendor, keywords), rooms, landmarks and amenities. An exhibitor list can be imported as a CSV.
5. Check and publish. The portal checks that every place is reachable under every profile and lists any that are not. Publishing makes the new version live, updates search and produces a printable QR sheet.

- Floor plan import: if the PDF holds vector shapes, the portal proposes obstacles for the admin to accept or fix. Confirmed on the KubeCon NA 2026 expo map: the hall outline, 237 booths and their numbers were read from the PDF automatically by `tools/build_venue.py`. If the plan is a flat image, the admin traces over it.
- Versions: each publish creates a version. Phones pick up the newest version on their next load.
- Stable QR codes: place ids never change between versions, so printed QR codes keep working.
- Closures: an admin adds a temporary "closed" shape and republishes. Routes then avoid it.
- Access: sign in by email link. Admins belong to an organization and see only its venues.

## Routing engine

Routes are computed on the phone from the venue's obstacles, so they work offline and cannot cross a wall.

1. Take the hall outline and subtract the obstacles. Grow each obstacle by a clearance margin so routes keep off walls and booth edges.
2. Lay a grid over the remaining walkable space, with 0.5 m cells.
3. Give each cell a cost that is higher near a wall, so a route keeps to the middle of its aisle.
4. Find the cheapest path across the grid with the A* algorithm. The search tracks heading as well as position, and every turn costs distance, so routes come out as a few straight legs.
5. Follow the local aisle direction: square turns where booths stand square, 45 degree legs where booths are slanted. Routes never turn at any other angle.
6. Name each turn after the nearest landmark to produce the text steps.

| Profile | Clearance margin | Stairs | Escalators | Elevators and ramps |
| --- | --- | --- | --- | --- |
| Standard | 0.3 m | Yes | Yes | Yes |
| No stairs | 0.3 m | No | Yes | Yes |
| Wheelchair | 0.5 m | No | No | Yes |

A gap must be at least twice the margin wide to be used. The margins are defaults an admin can change per venue.

Where a route starts and ends
- If a place has a door, routes always use it.
- If it has no door, as with most booths and open areas, a route may use any side of the place and takes the one that suits the trip.
- Cramped gaps behind a booth or against a wall are not used when the place also faces a proper aisle.

Floors and buildings: each floor has its own grid, and connectors join the grids. A connector carries a travel time and the profiles allowed to use it. A shuttle is a connector between two stops. Not built; the first venue is one level in one building.

Checks (run in automated tests, and on publish once the portal exists)
- Every place is reachable under every profile, or it is flagged.
- No route segment crosses an obstacle or leaves the hall.
- Routes keep the promised clearance.
- Routes turn only in 45 degree steps and keep to the middle of wide aisles.
- A place with a door is reached through that door; a place without one is left on the side that suits the trip.

Targets: a route in a 200 m by 150 m hall is computed in under 200 ms on a mid-range phone. Walking time assumes 1.2 m per second. Measured so far only in Node: 5 to 190 ms for the first venue (227 m by 314 m).

## Architecture and data model

Attendee phones read one published file per venue and compute routes locally. Only search, telemetry and the "Getting here" screen need the network.

| Part | Runs on | Does |
| --- | --- | --- |
| Attendee PWA | Phone browser | Floor plan drawn by the app itself (SVG), search box, routing, offline cache |
| Venue bundle | Static file, `public/venues/<id>.json` | One file per venue: outline, zones, booths, areas, points, doors, keywords |
| API functions | `server.mjs` in the container, `api/` | Search proxy to Elasticsearch |
| Admin portal | Browser, signed in | Venue editor, checks, publish. Not built. |
| Admin database | Postgres with sign-in (Supabase proposed) | Organizations, admins, venues, drafts, versions. Not built. |
| Elasticsearch | Elastic Cloud | Place search |
| Radar | Radar | Arrival map, address lookup, venue geofence, walking time |
| Dash0 | Dash0 | Sessions, traces, custom events, dashboards |
| Gitar | GitHub repository | Pull request review and CI fixes |

Hosting is the team namespace on the `lunzerr` Kubernetes cluster in Radar Cloud. Every push to `main` builds a container image with the PWA and the search function, and Argo CD rolls it out.

Shapes are stored in metres, origin top left, y pointing down. The first venue's scale is derived from booth sizes, assuming a platinum booth is 20 ft square.

## Sponsor integrations

| Tool | Job in Navcon | Demo moment |
| --- | --- | --- |
| Elasticsearch | Place search: typo-tolerant match on booth number, company and landmark, plus meaning-based match on what a company does | Type a misspelled vendor name, then "tools for tracing", and get the right booths |
| Radar | A "Getting here" screen: the venue on a map, address lookup, a geofence that tells you whether you are on site, and walking time to the venue | Tap Getting here: the venue on a Radar map, an on-site check and the walking time from where you stand |
| Dash0 | Real-user monitoring in the PWA, including the timing of each search request, and custom navigation events | A dashboard of most-requested booths, searches with no results and search speed |
| Gitar | Reviews every pull request and repairs failing CI | A pull request where a routing check failed and Gitar fixed it |

Elasticsearch
- One `navcon-places` index, filtered by venue. Fields: name, booth, aliases, kind, tier, description.
- Names and booth numbers use fuzzy matching. The description (company name plus keywords) is a `semantic_text` field where the cluster supports it.
- The phone never calls Elasticsearch directly. `api/search.ts` holds the key and returns place ids.
- `npm run index:places` re-indexes a venue.
- Offline fallback: the venue bundle carries names, numbers and keywords, so search still works with no signal.

Radar
- The indoor floor plan is drawn by the app itself, so it works with no signal. Radar powers the separate "Getting here" screen.
- Maps: the venue on a Radar map. Address lookup: Radar geocoding turns the venue's address into a position.
- Geofence: one per venue (`tools/radar_geofence.mjs`). When a person taps "Check my location", the web SDK reports whether they are on site. Location is requested only then.
- Travel time: the distance API gives the walking time from the person's location to the venue.

Dash0
- The Web SDK in the PWA records sessions, errors and page speed.
- `api/search.ts` logs one structured line per search with the browser's `traceparent`. These logs stay in the cluster; nothing forwards them to Dash0 yet.
- Custom events: `qr_scan`, `search`, `search_no_results`, `route_requested`, `route_failed`, `route_updated`.
- Still to make: one dashboard for organizers and one alert on search or route failures.

Gitar
- Installed on the GitHub repository; its check ran on pull request 3.
- CI runs type checks, the routing checks and a build on every pull request.

## Robustness, accessibility and privacy

| If this fails | The attendee gets |
| --- | --- |
| Signal, after the first load | Full routing from the cached venue bundle. Search runs on the device. |
| Search service | The same on-device search, with a small "limited search" note |
| Radar map service | The floor plan and routing unchanged. Only the Getting here screen needs the network. |
| Location permission | The venue's address instead |
| A QR code for a removed place | The venue with an empty start and a short message |
| A route for the chosen profile | A message naming the profile and destination |

Accessibility
- Wheelchair and no-stairs routes are full profiles.
- Every route has text steps a screen reader can read.
- Touch targets are at least 44 px, contrast aims for WCAG AA, and nothing relies on color alone.

Privacy
- No attendee accounts and no stored location history.
- Location is requested only on the Getting here screen and is never sent with telemetry.
- Telemetry records events and place ids, not people.

Speed targets
- First load in under 3 seconds on a 4G connection, with a venue bundle under 500 KB (the first venue's is 48 KB).
- Route shown within 1 second of choosing a destination.
- A room full of people opening the app at once adds no routing load, because routing runs on each phone. Search requests are rate-limited.

## Demo plan for 2026-11-09

| Priority | Scope | State at 2:45pm |
| --- | --- | --- |
| Must demo | Public link on real venue data: QR link, search, three profiles, route with text steps, offline routing | Live |
| Must demo | Elasticsearch search, Radar Getting here screen and geofence, Dash0 SDK, events and dashboard | Built, waiting for keys; never run against the real services |
| Must demo | Gitar on the repository with routing checks in CI | CI live; Gitar installed. The demo pull request with a failing check is still to do. |
| If time allows | A thin slice of the admin portal: sign in, edit places, republish, download the QR sheet | Not started |
| After today | Obstacle editor with PDF import, multiple organizations, floors, shuttle legs, closures | Not started |

Demo script
1. Put the app's QR code on screen so the audience opens it on their own phones. Then scan a booth's QR code to set the start.
2. Search for a vendor by a misspelled name, then by what they sell.
3. Switch to the wheelchair profile. This floor is one level, so the route keeps wider clearance; stairs and elevators matter at multi-level venues.
4. Turn on airplane mode and route again.
5. Show the Dash0 dashboard and a pull request that Gitar fixed.

## Open questions

- Scale is assumed from booth sizes, taking a platinum booth as 20 ft square. One real measurement would confirm it.
- Confirm Supabase for the admin database and sign-in.
- Who creates the Elastic, Radar, Dash0 and Gitar accounts and keys?
- Where can QR codes be posted at the venue for the demo?
- Do any places at this venue have real doors that should be marked?
