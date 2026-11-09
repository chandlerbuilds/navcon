# Project conventions

Navcon gives conference attendees walking directions inside a venue: a PWA with no install and no sign-in. The product spec is `docs/SPEC.md`. These conventions reflect how the team works.

## Keep it simple

The owner's rule is "more features means more noise". Flag any new attendee-facing interaction, and flag outright anything the spec lists as a non-goal:

- live position tracking (a moving blue dot)
- an "I'm here" progress tap
- choosing a place by tapping it on the map
- attendee accounts, saved routes or history
- voice guidance
- vendor promotions or other booth content

Start and destination come only from a QR link or the search box.

## Never commit keys

No API keys, tokens or passwords anywhere in the repository, including tests, examples and documentation. Browser keys are `VITE_*` build-time variables and are public by design. Server keys (Elasticsearch) come from the deployment's secrets at run time. Flag any string that looks like a real key, and any `VITE_*` variable that would carry a server-side secret into the browser bundle.

## The app works offline and without keys

After the first load, routing and on-device search work with no signal. Every sponsor integration is optional at run time: with its keys missing or its service down, the app must still load, search and route. Flag code that throws, blocks rendering or waits without a timeout when Elasticsearch or Dash0 is unconfigured or unreachable.

## The phone never calls Elasticsearch directly

Search goes through `api/search.ts`, which holds the key, rate-limits requests and returns only place ids. Flag any browser code that would talk to the cluster itself, and any change that removes the rate limit or the request timeout.

## Privacy

There are no attendee accounts and no stored location history. Telemetry (`src/telemetry.ts`) records events and place ids, never people. Flag any new telemetry attribute or log field that could identify a person or carry a location.

## Accessibility

Wheelchair and no stairs are full route profiles, not afterthoughts. Every route has text steps a screen reader can read. Touch targets are at least 44 px, and nothing relies on colour alone. Flag UI changes that break one of these.

## Generated data is not edited by hand

`public/venues/*.json` is written by `tools/build_venue.py`. Flag hand edits to a venue bundle: the change belongs in the builder or in `data/<venue>/`. Place ids must not change between versions, because printed QR codes point at them. The organizers' floor-plan PDF is never committed.

## Deploys

Every push to `main` deploys to production. The image `newName` and `newTag` in `deploy/kustomization.yaml` are set by the deploy workflow: flag manual edits to them.

## Pull requests

One change per pull request, with a description that says what was checked. A change to the interface should say it was checked in a phone-sized browser, because that is how judges and attendees open the app.

## Feature log

`docs/FEATURE_LOG.md` records what changed and whether it is live. A pull request that changes what the app does, or how it is built or deployed, adds one entry at the end of the log, in the shape the log describes. Flag such a pull request when it has no entry. Flag any pull request that rewrites or deletes an existing entry, unless it says it is correcting a fact.
