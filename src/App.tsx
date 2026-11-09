import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Profile } from './routing/grid';
import { feet, PROFILE_LABEL, Router, type RouteOutcome } from './routing/route';
import { track } from './telemetry';
import { MapView } from './ui/MapView';
import { SearchSheet } from './ui/SearchSheet';
import type { Place, VenueBundle } from './venue/types';

const QrSheet = lazy(() => import('./ui/QrSheet'));

const DEFAULT_VENUE = 'kcna26';
const PROFILES: Profile[] = ['standard', 'nostairs', 'wheelchair'];
const QUICK = ['main-entrance', 'restrooms-hall-b', 'restroom-hall-1-north', 'meal-halls-a-b', 'demo-theater', 'cloud-native-theater', 'project-pavilion', 'corner-store'];

function readUrl() {
  const parts = location.pathname.split('/').filter(Boolean);
  const q = new URLSearchParams(location.search);
  const profile = q.get('profile') as Profile | null;
  let stored: Profile | null = null;
  try { stored = localStorage.getItem('navcon.profile') as Profile | null; } catch { /* private mode */ }
  return {
    venue: parts[0] === 'v' && parts[1] ? parts[1] : DEFAULT_VENUE,
    page: parts[2] === 'qr' ? ('qr' as const) : ('map' as const),
    from: q.get('from'),
    to: q.get('to'),
    viaQr: q.get('src') === 'qr',
    profile: PROFILES.includes(profile as Profile) ? (profile as Profile) : PROFILES.includes(stored as Profile) ? (stored as Profile) : 'standard',
  };
}

export default function App() {
  const initial = useMemo(readUrl, []);
  const [venue, setVenue] = useState<VenueBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fromId, setFromId] = useState<string | null>(initial.from);
  const [toId, setToId] = useState<string | null>(initial.to);
  const [profile, setProfile] = useState<Profile>(initial.profile);
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const hadRoute = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch(`/venues/${encodeURIComponent(initial.venue)}.json`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((v: VenueBundle) => { if (alive) setVenue(v); })
      .catch(() => { if (alive) setLoadError('This venue could not be loaded. Check your connection and try again.'); });
    return () => { alive = false; };
  }, [initial.venue]);

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); };
  }, []);

  const router = useMemo(() => (venue ? new Router(venue) : null), [venue]);

  // Build the walkable grid ahead of the first route, off the critical path.
  useEffect(() => {
    if (!router) return;
    const t = setTimeout(() => router.grid(profile), 50);
    return () => clearTimeout(t);
  }, [router, profile]);

  // A QR code for a place that has since been removed opens the venue with an empty start.
  useEffect(() => {
    if (!router) return;
    if (fromId && !router.place(fromId)) { setFromId(null); setNotice('That QR code points to a place that is no longer on this map. Choose where you are.'); }
    else if (fromId && initial.viaQr && fromId === initial.from) track('qr_scan', { place: fromId });
    if (toId && !router.place(toId)) setToId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const from = router?.place(fromId), to = router?.place(toId);

  useEffect(() => {
    if (!venue || initial.page !== 'map') return;
    const q = new URLSearchParams();
    if (fromId) q.set('from', fromId);
    if (toId) q.set('to', toId);
    if (profile !== 'standard') q.set('profile', profile);
    const qs = q.toString();
    history.replaceState(null, '', `/v/${venue.id}${qs ? `?${qs}` : ''}`);
    try { localStorage.setItem('navcon.profile', profile); } catch { /* private mode */ }
  }, [venue, fromId, toId, profile, initial.page]);

  const outcome = useMemo<(RouteOutcome & { ms: number }) | null>(() => {
    if (!router || !from || !to) return null;
    if (from.id === to.id) return { ok: false, reason: 'The start and the destination are the same place.', ms: 0 };
    const t0 = performance.now();
    const r = router.route(from.id, to.id, profile);
    return { ...r, ms: performance.now() - t0 };
  }, [router, from, to, profile]);

  useEffect(() => {
    if (!outcome || !from || !to) return;
    if (outcome.ok) {
      track(hadRoute.current ? 'route_updated' : 'route_requested', { from: from.id, to: to.id, profile, meters: Math.round(outcome.route.meters), compute_ms: Math.round(outcome.ms) });
      hadRoute.current = true;
    } else {
      track('route_failed', { from: from.id, to: to.id, profile, reason: outcome.reason });
    }
  }, [outcome, from, to, profile]);

  if (loadError) return <main className="center"><p>{loadError}</p><button className="primary" onClick={() => location.reload()}>Try again</button></main>;
  if (!venue || !router) return <main className="center" aria-busy="true"><p>Loading the venue…</p></main>;

  if (initial.page === 'qr') {
    return <Suspense fallback={<main className="center"><p>Loading…</p></main>}><QrSheet venue={venue} places={router.places} /></Suspense>;
  }

  const route = outcome?.ok ? outcome.route : null;
  const quick = QUICK.map((id) => router.place(id)).filter((p): p is Place => !!p);
  const pick = (p: Place) => {
    if (picking === 'from') setFromId(p.id); else setToId(p.id);
    setPicking(null);
    setNotice(null);
  };

  return (
    <div className="app">
      <header className="bar">
        <strong>Navcon</strong>
        <span className="venue">{venue.name}</span>
      </header>

      <section className="form" aria-label="Plan a route">
        <div className="fields">
          <button className="field" onClick={() => setPicking('from')}>
            <span className="tag tag-from" aria-hidden="true">A</span>
            <span className="f-label">From</span>
            <span className={from ? 'f-value' : 'f-value empty'}>{from ? from.title : 'Where are you?'}</span>
          </button>
          <button className="field" onClick={() => setPicking('to')}>
            <span className="tag tag-to" aria-hidden="true">B</span>
            <span className="f-label">To</span>
            <span className={to ? 'f-value' : 'f-value empty'}>{to ? to.title : 'Where to?'}</span>
          </button>
          <button className="swap" onClick={() => { setFromId(toId); setToId(fromId); }} disabled={!from && !to} aria-label="Swap start and destination">⇅</button>
        </div>
        <div className="chips" role="group" aria-label="Route type">
          {PROFILES.map((p) => (
            <button key={p} className="chip" aria-pressed={profile === p} onClick={() => setProfile(p)}>{PROFILE_LABEL[p]}</button>
          ))}
        </div>
      </section>

      {!online && <p className="banner">You are offline. Routes still work; search matches names and booth numbers only.</p>}
      {notice && <p className="banner" role="status">{notice}</p>}

      <MapView venue={venue} route={route} from={from} to={to} />

      <section className="panel" aria-live="polite">
        {route ? (
          <>
            <p className="summary">
              <strong>{feet(route.meters)} ft</strong> ({Math.round(route.meters)} m) · about {Math.max(1, Math.round(route.seconds / 60))} min · {PROFILE_LABEL[route.profile]}
            </p>
            <ol className="steps">{route.steps.map((s, i) => <li key={i}>{s.text}</li>)}</ol>
            <p className="hint">Scan another booth's QR code on the way to update where you are.</p>
          </>
        ) : outcome && !outcome.ok ? (
          <p className="summary" role="alert">{outcome.reason}</p>
        ) : (
          <>
            <p className="summary">{from ? `You are at ${from.title}. Choose where to go.` : 'Scan a booth’s QR code, or tell us where you are.'}</p>
            <p className="hint">This single-level floor has no stairs, so all three route types are step-free. Wheelchair routes keep extra clearance.</p>
            <p className="hint"><a href={`/v/${venue.id}/qr`}>Venue staff: QR codes to print</a></p>
          </>
        )}
      </section>

      {picking && (
        <SearchSheet
          venueId={venue.id}
          places={router.places}
          title={picking === 'from' ? 'Where are you?' : 'Where to?'}
          quick={quick}
          onPick={pick}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
